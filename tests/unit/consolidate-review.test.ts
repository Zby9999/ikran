// Issue 29 (MVP chat path): Consolidate review is the only read path into the
// designer feedback library, proposals are durable and proposal-first, and a
// rule-update artifact declaration is only acknowledged against a confirmed
// proposal.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";

import { initializeProjectDb } from "../../lib/runtime/db";
import { listEvents, logEvent } from "../../lib/runtime/events";
import { getProjectDbPath } from "../../lib/runtime/paths";
import { recordDesignerFeedback } from "../../lib/runtime/designer-feedback";
import { reconcileDesignerConversation } from "../../lib/runtime/conversation-reconciliation";
import {
  claimConsolidateReview,
  dismissDesignerFeedback
} from "../../lib/runtime/consolidate-review";
import {
  cancelRuleUpdate,
  confirmRuleUpdate,
  proposeRuleUpdate
} from "../../lib/runtime/rule-update-proposal";
import {
  confirmDraftDesignSystem,
  confirmPrototype,
  countUnreviewedDesignerFeedbackOnDb,
  formalizeDesignSystem,
  listUnreviewedDesignerFeedbackOnDb
} from "../../lib/runtime/project-phase";
import { recordSourceArtifact } from "../../lib/runtime/source-artifact";

function withProject(run: (projectPath: string) => void): void {
  const projectPath = mkdtempSync(
    path.join(tmpdir(), "ikran-consolidate-review-")
  );
  try {
    initializeProjectDb(projectPath);
    run(projectPath);
  } finally {
    rmSync(projectPath, { recursive: true, force: true });
  }
}

function recordFeedback(projectPath: string, summary: string): string {
  const result = recordDesignerFeedback(projectPath, {
    summary,
    runId: "run-1",
    sessionId: "session-1"
  });
  if (!result.ok) throw new Error(`feedback setup failed: ${result.reason}`);
  return result.feedback.id;
}

function completedReconciliation(
  projectPath: string,
  id = "legacy-feedback-review",
  runId = "run-1"
): string {
  const messageId = `${id}-message`;
  const result = reconcileDesignerConversation(projectPath, {
    reviewId: id,
    conversationId: `${id}-conversation`,
    runId,
    sessionId: "session-1",
    startMessageId: messageId,
    endMessageId: messageId,
    messages: [
      {
        id: messageId,
        role: "designer",
        content: "开始审查兼容期 feedback。"
      }
    ],
    decisions: []
  });
  if (!result.ok) {
    throw new Error(`reconciliation setup failed: ${result.reason}`);
  }
  return id;
}

function countUnreviewed(projectPath: string): number {
  const db = new DatabaseSync(getProjectDbPath(projectPath));
  try {
    return countUnreviewedDesignerFeedbackOnDb(db);
  } finally {
    db.close();
  }
}

function listUnreviewed(projectPath: string): string[] {
  const db = new DatabaseSync(getProjectDbPath(projectPath));
  try {
    return listUnreviewedDesignerFeedbackOnDb(db);
  } finally {
    db.close();
  }
}

function insertLayoutRuleEntry(projectPath: string, sourcePath: string): void {
  const db = new DatabaseSync(getProjectDbPath(projectPath));
  try {
    db.prepare(
      `INSERT INTO design_system_entries
       (id, source_artifact_path, file_kind, section, entry_id, name,
        value_json, meaning, status, links_json, position, created_at, updated_at)
       VALUES ('rule', ?, 'layout-rules.json', 'layout', 'layout.rule',
               'layout.rule', '"Rule"', 'Rule', 'candidate', '[]', 0, ?, ?)`
    ).run(sourcePath, "2026-08-06T00:00:00.000Z", "2026-08-06T00:00:00.000Z");
  } finally {
    db.close();
  }
}

function setPhase(projectPath: string, phase: string): void {
  const db = new DatabaseSync(getProjectDbPath(projectPath));
  try {
    db.prepare(
      `UPDATE project_phase SET phase = ?, updated_at = ? WHERE singleton = 1`
    ).run(phase, "2026-08-06T00:00:00.000Z");
  } finally {
    db.close();
  }
}

function proposalRow(
  projectPath: string,
  proposalId: string
): Record<string, unknown> | undefined {
  const db = new DatabaseSync(getProjectDbPath(projectPath));
  try {
    return db
      .prepare("SELECT * FROM rule_update_proposals WHERE id = ?")
      .get(proposalId) as Record<string, unknown> | undefined;
  } finally {
    db.close();
  }
}

function consumptionRows(
  projectPath: string
): Array<{ feedback_id: string; proposal_id: string }> {
  const db = new DatabaseSync(getProjectDbPath(projectPath));
  try {
    return db
      .prepare(
        `SELECT feedback_id, proposal_id
         FROM designer_feedback_review_consumption
         ORDER BY feedback_id ASC`
      )
      .all() as Array<{ feedback_id: string; proposal_id: string }>;
  } finally {
    db.close();
  }
}

function proposeReusableCandidateInput(evidenceRecordIds: string[]) {
  return {
    kind: "new",
    classification: "reusable_candidate",
    title: "Sticky bar stays opaque",
    changeDescription:
      "Add a layout rule: sticky navigation keeps a solid background while scrolling.",
    reason: "Three feedback rounds concluded the same opacity behavior.",
    affectedItems: ["Sticky navigation"],
    evidenceRecordIds
  };
}

function proposeReusableCandidate(
  projectPath: string,
  evidenceRecordIds: string[]
) {
  return proposeRuleUpdate(
    projectPath,
    proposeReusableCandidateInput(evidenceRecordIds)
  );
}

test("claim_consolidate_review returns selected reconciliation plus legacy feedback and records the start event", () => {
  withProject((projectPath) => {
    const first = recordFeedback(projectPath, "Keep the sticky bar opaque.");
    const second = recordFeedback(projectPath, "Tighten the card gap.");

    const claim = claimConsolidateReview(
      projectPath,
      completedReconciliation(projectPath)
    );
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;

    expect(claim.feedback_count).toBe(2);
    expect(claim.feedback.map((row) => row.id).sort()).toEqual(
      [first, second].sort()
    );
    expect(claim.feedback[0]).toMatchObject({
      run_id: "run-1",
      session_id: "session-1",
      review_state: "unreviewed",
      consumed_by_proposal_id: null,
      dismissed_reason: null
    });
    expect(claim.unreviewed_feedback_count).toBe(2);
    expect(claim.unreviewed_feedback_ids.sort()).toEqual([first, second].sort());

    expect(listEvents(projectPath, "consolidate_review_started")).toEqual([
      expect.objectContaining({
        event_id: claim.event_id,
        payload: expect.objectContaining({
          feedback_count: 2,
          unreviewed_feedback_count: 2
        })
      })
    ]);
  });
});

test("design_system_formal only claims a reconciliation completed after the latest Prototype confirmation", () => {
  withProject((projectPath) => {
    const staleReconciliationId = completedReconciliation(
      projectPath,
      "before-prototype-confirmation"
    );
    setPhase(projectPath, "prototype_validation");
    const confirmed = confirmPrototype(projectPath);
    expect(confirmed).toMatchObject({
      ok: true,
      phase: "design_system_formal"
    });
    if (!confirmed.ok) return;

    expect(
      claimConsolidateReview(projectPath, staleReconciliationId)
    ).toEqual({
      ok: false,
      reason: "conversation_reconciliation_before_prototype_confirmation"
    });

    const currentReconciliationId = completedReconciliation(
      projectPath,
      "after-prototype-confirmation"
    );
    const claim = claimConsolidateReview(
      projectPath,
      currentReconciliationId
    );
    expect(claim).toMatchObject({
      ok: true,
      reconciliation_id: currentReconciliationId,
      prototype_confirmation_event_id: confirmed.event_id
    });
    if (!claim.ok) return;

    expect(listEvents(projectPath, "consolidate_review_started")).toEqual([
      expect.objectContaining({
        event_id: claim.event_id,
        payload: expect.objectContaining({
          reconciliation_id: currentReconciliationId,
          prototype_confirmation_event_id: confirmed.event_id
        })
      })
    ]);
  });
});

test("design_system_formal rejects a reconciliation from a different Prototype run", () => {
  withProject((projectPath) => {
    setPhase(projectPath, "draft_design_system");
    expect(confirmDraftDesignSystem(projectPath)).toMatchObject({
      ok: true,
      phase: "prototype_validation"
    });
    logEvent(projectPath, "prototype_preview_declared", {
      run_id: "prototype-run-current",
      prototype_run_id: "prototype-record-current"
    });
    const confirmed = confirmPrototype(projectPath);
    expect(confirmed).toMatchObject({
      ok: true,
      phase: "design_system_formal"
    });

    const unrelatedReconciliationId = completedReconciliation(
      projectPath,
      "unrelated-run-review",
      "prototype-run-unrelated"
    );
    expect(
      claimConsolidateReview(projectPath, unrelatedReconciliationId)
    ).toEqual({
      ok: false,
      reason: "conversation_reconciliation_prototype_run_mismatch"
    });

    const currentReconciliationId = completedReconciliation(
      projectPath,
      "current-run-review",
      "prototype-run-current"
    );
    expect(
      claimConsolidateReview(projectPath, currentReconciliationId)
    ).toMatchObject({
      ok: true,
      reconciliation_id: currentReconciliationId,
      prototype_confirmation_event_id: confirmed.ok
        ? confirmed.event_id
        : undefined
    });
  });
});

test("claim_consolidate_review preserves linkage ids and opaque context", () => {
  withProject((projectPath) => {
    const db = new DatabaseSync(getProjectDbPath(projectPath));
    try {
      db.prepare(
        `INSERT INTO seed_references
         (id, figma_seed_reference, original_design_intent, created_at,
          registered_via, file_key, node_id)
         VALUES ('seed-1', ?, 'Seed', '2026-08-06T00:00:00.000Z',
                 'agent', 'ConsolidateSeed', '1:1')`
      ).run("https://www.figma.com/design/ConsolidateSeed/Frame?node-id=1-1");
    } finally {
      db.close();
    }

    const linked = recordDesignerFeedback(projectPath, {
      summary: "Sticky bar again.",
      runId: "run-2",
      sessionId: "session-2",
      seedReferenceId: "seed-1",
      opaqueContext: { selector: "#sticky-nav" }
    });
    expect(linked.ok).toBe(true);
    const verbatim = recordDesignerFeedback(projectPath, {
      summary: "Card grid gap.",
      runId: "run-2",
      sessionId: "session-2",
      opaqueContext: "#card-grid > .tile:nth-child(2)"
    });
    expect(verbatim.ok).toBe(true);

    const claim = claimConsolidateReview(
      projectPath,
      completedReconciliation(projectPath)
    );
    expect(claim.ok).toBe(true);
    if (!claim.ok || !linked.ok || !verbatim.ok) return;

    const byId = new Map(claim.feedback.map((row) => [row.id, row]));
    expect(byId.get(linked.feedback.id)).toMatchObject({
      seed_reference_id: "seed-1",
      opaque_context: { selector: "#sticky-nav" }
    });
    expect(byId.get(verbatim.feedback.id)?.opaque_context).toBe(
      "#card-grid > .tile:nth-child(2)"
    );
  });
});

test("propose_rule_update persists new / update / move proposals with a created event", () => {
  withProject((projectPath) => {
    const feedbackId = recordFeedback(projectPath, "Sticky bar stays opaque.");
    const sourceRelative = "design-system/layout-rules.json";
    insertLayoutRuleEntry(projectPath, sourceRelative);

    const created = proposeReusableCandidate(projectPath, [feedbackId]);
    expect(created).toMatchObject({
      ok: true,
      proposal: {
        kind: "new",
        classification: "reusable_candidate",
        title: "Sticky bar stays opaque",
        status: "awaiting_confirmation",
        evidence_record_ids: [feedbackId],
        source_artifact_path: null,
        entry_id: null,
        proposed_target_path: null,
        decided_at: null
      }
    });
    if (!created.ok) return;

    expect(proposalRow(projectPath, created.proposal.proposal_id)).toMatchObject(
      {
        kind: "new",
        classification: "reusable_candidate",
        title: "Sticky bar stays opaque",
        status: "awaiting_confirmation",
        decided_at: null
      }
    );

    const updated = proposeRuleUpdate(projectPath, {
      kind: "update",
      classification: "proposed_update",
      title: "Loosen the card grid gap",
      changeDescription: "Card grid gap moves from 24px to 16px.",
      reason: "Latest feedback overrides the earlier 32px decision.",
      affectedItems: ["Card grid"],
      evidenceRecordIds: [feedbackId],
      sourceArtifactPath: sourceRelative,
      entryId: "layout.rule"
    });
    expect(updated).toMatchObject({
      ok: true,
      proposal: {
        kind: "update",
        classification: "proposed_update",
        source_artifact_path: sourceRelative,
        entry_id: "layout.rule"
      }
    });

    const moved = proposeRuleUpdate(projectPath, {
      kind: "move",
      classification: "local_exception",
      reason: "This behavior belongs to the sticky component.",
      affectedItems: ["Sticky navigation"],
      evidenceRecordIds: [feedbackId],
      sourceArtifactPath: sourceRelative,
      entryId: "layout.rule",
      proposedTargetPath: "design-system/components/sticky.json"
    });
    expect(moved).toMatchObject({
      ok: true,
      proposal: {
        kind: "move",
        classification: "local_exception",
        proposed_target_path: "design-system/components/sticky.json"
      }
    });

    const events = listEvents(projectPath, "rule_update_proposal_created");
    expect(events.length).toBe(3);
    if (!created.ok) return;
    expect(events[0].payload).toMatchObject({
      proposal_id: created.proposal.proposal_id,
      kind: "new",
      classification: "reusable_candidate",
      status: "awaiting_confirmation"
    });
  });
});

test("propose_rule_update rejects forged evidence, unknown kind, and unknown classification", () => {
  withProject((projectPath) => {
    const feedbackId = recordFeedback(projectPath, "Sticky bar stays opaque.");

    expect(proposeReusableCandidate(projectPath, ["forged-evidence"])).toEqual({
      ok: false,
      reason: "evidence_record_not_found"
    });
    expect(
      proposeRuleUpdate(projectPath, {
        kind: "rewrite",
        classification: "reusable_candidate",
        title: "T",
        changeDescription: "C",
        reason: "R",
        affectedItems: ["A"],
        evidenceRecordIds: [feedbackId]
      })
    ).toEqual({ ok: false, reason: "invalid_proposal_kind" });
    expect(
      proposeRuleUpdate(projectPath, {
        kind: "new",
        classification: "nice_to_have",
        title: "T",
        changeDescription: "C",
        reason: "R",
        affectedItems: ["A"],
        evidenceRecordIds: [feedbackId]
      })
    ).toEqual({ ok: false, reason: "invalid_proposal_classification" });

    expect(listEvents(projectPath, "rule_update_proposal_created")).toEqual([]);
    const db = new DatabaseSync(getProjectDbPath(projectPath));
    try {
      expect(
        db.prepare("SELECT COUNT(*) AS count FROM rule_update_proposals").get()
      ).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });
});

test("confirm_rule_update consumes feedback evidence and clears the unreviewed count", () => {
  withProject((projectPath) => {
    const consumedId = recordFeedback(projectPath, "Sticky bar stays opaque.");
    expect(countUnreviewed(projectPath)).toBe(1);

    const proposal = proposeReusableCandidate(projectPath, [consumedId]);
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    const proposalId = proposal.proposal.proposal_id;

    // Proposing alone must not change any disposition.
    expect(countUnreviewed(projectPath)).toBe(1);

    const confirmed = confirmRuleUpdate(projectPath, { proposalId });
    expect(confirmed).toMatchObject({
      ok: true,
      proposal: { proposal_id: proposalId, status: "confirmed" },
      consumed_feedback_ids: [consumedId]
    });
    if (!confirmed.ok) return;
    expect(confirmed.proposal.decided_at).not.toBeNull();

    expect(proposalRow(projectPath, proposalId)).toMatchObject({
      status: "confirmed"
    });
    expect(consumptionRows(projectPath)).toEqual([
      { feedback_id: consumedId, proposal_id: proposalId }
    ]);
    expect(countUnreviewed(projectPath)).toBe(0);
    expect(listUnreviewed(projectPath)).toEqual([]);

    expect(listEvents(projectPath, "rule_update_confirmed")).toEqual([
      expect.objectContaining({
        event_id: confirmed.event_id,
        payload: expect.objectContaining({
          proposal_id: proposalId,
          consumed_feedback_ids: [consumedId],
          status: "confirmed"
        })
      })
    ]);

    // Re-deciding a decided proposal is rejected.
    expect(confirmRuleUpdate(projectPath, { proposalId })).toEqual({
      ok: false,
      reason: "proposal_not_awaiting_confirmation"
    });
    expect(cancelRuleUpdate(projectPath, { proposalId })).toEqual({
      ok: false,
      reason: "proposal_not_awaiting_confirmation"
    });
    expect(
      confirmRuleUpdate(projectPath, { proposalId: "forged-proposal" })
    ).toEqual({ ok: false, reason: "proposal_not_found" });

    // The confirmed review claim reports the recorded disposition.
    const claim = claimConsolidateReview(
      projectPath,
      completedReconciliation(projectPath)
    );
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    expect(claim.feedback[0]).toMatchObject({
      review_state: "consumed",
      consumed_by_proposal_id: proposalId
    });
  });
});

test("confirm_rule_update attaches capture guidance only for layout / components.spec targets", () => {
  withProject((projectPath) => {
    const feedbackId = recordFeedback(projectPath, "Sticky bar stays opaque.");

    // No rule-artifact path on the proposal: no guidance.
    const plain = proposeReusableCandidate(projectPath, [feedbackId]);
    expect(plain.ok).toBe(true);
    if (!plain.ok) return;
    const plainConfirmed = confirmRuleUpdate(projectPath, {
      proposalId: plain.proposal.proposal_id
    });
    expect(plainConfirmed).toMatchObject({ ok: true, capture_guidance: null });

    for (const target of [
      "design-system/layout-rules.json",
      "design-system/components/button.json"
    ]) {
      const proposal = proposeRuleUpdate(projectPath, {
        ...proposeReusableCandidateInput([feedbackId]),
        proposedTargetPath: target
      });
      expect(proposal.ok).toBe(true);
      if (!proposal.ok) return;
      const confirmed = confirmRuleUpdate(projectPath, {
        proposalId: proposal.proposal.proposal_id
      });
      expect(confirmed).toMatchObject({
        ok: true,
        capture_guidance: expect.stringContaining("capture_rule_screenshot")
      });
    }
  });
});

test("cancel_rule_update closes the proposal without consuming evidence or touching artifacts", () => {
  withProject((projectPath) => {
    const feedbackId = recordFeedback(projectPath, "Sticky bar stays opaque.");
    const sourceRelative = "design-system/layout-rules.json";
    const sourcePath = path.join(projectPath, sourceRelative);
    mkdirSync(path.dirname(sourcePath), { recursive: true });
    writeFileSync(sourcePath, JSON.stringify({ rules: [] }), "utf8");
    const before = JSON.stringify({ rules: [] });

    const proposal = proposeReusableCandidate(projectPath, [feedbackId]);
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    const proposalId = proposal.proposal.proposal_id;

    const canceled = cancelRuleUpdate(projectPath, { proposalId });
    expect(canceled).toMatchObject({
      ok: true,
      proposal: { proposal_id: proposalId, status: "canceled" }
    });
    if (!canceled.ok) return;

    expect(proposalRow(projectPath, proposalId)).toMatchObject({
      status: "canceled"
    });
    expect(consumptionRows(projectPath)).toEqual([]);
    expect(countUnreviewed(projectPath)).toBe(1);
    expect(readFileSync(sourcePath, "utf8")).toBe(before);

    expect(listEvents(projectPath, "rule_update_canceled")).toEqual([
      expect.objectContaining({
        event_id: canceled.event_id,
        payload: expect.objectContaining({
          proposal_id: proposalId,
          status: "canceled"
        })
      })
    ]);
  });
});

test("dismiss_designer_feedback records an explicit disposition and clears unreviewed", () => {
  withProject((projectPath) => {
    const first = recordFeedback(projectPath, "One-off tweak on this page.");
    const second = recordFeedback(projectPath, "Another one-off tweak.");
    expect(countUnreviewed(projectPath)).toBe(2);

    expect(
      dismissDesignerFeedback(projectPath, {
        feedbackIds: [first, "forged-feedback"],
        reason: "Local exception; no global rule."
      })
    ).toEqual({ ok: false, reason: "feedback_record_not_found" });
    expect(countUnreviewed(projectPath)).toBe(2);

    expect(
      dismissDesignerFeedback(projectPath, {
        feedbackIds: [first, second],
        reason: ""
      })
    ).toEqual({ ok: false, reason: "invalid_dismissal" });

    const dismissed = dismissDesignerFeedback(projectPath, {
      feedbackIds: [first, second],
      reason: "Local exception; no global rule."
    });
    expect(dismissed).toMatchObject({
      ok: true,
      dismissed_feedback_ids: [first, second],
      unreviewed_feedback_count: 0
    });
    if (!dismissed.ok) return;
    expect(dismissed.event_ids.length).toBe(2);

    expect(countUnreviewed(projectPath)).toBe(0);
    expect(
      listEvents(projectPath, "designer_feedback_dismissed").map(
        (event) => event.payload.feedback_id
      )
    ).toEqual([first, second]);

    const claim = claimConsolidateReview(
      projectPath,
      completedReconciliation(projectPath)
    );
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    expect(claim.feedback.map((row) => row.review_state)).toEqual([
      "dismissed",
      "dismissed"
    ]);
    expect(claim.feedback[0].dismissed_reason).toBe(
      "Local exception; no global rule."
    );
  });
});

test("formalize stays gated until every feedback record is confirmed or dismissed", () => {
  withProject((projectPath) => {
    setPhase(projectPath, "prototype_validation");
    const consumedId = recordFeedback(projectPath, "Promote sticky opacity.");
    const dismissedId = recordFeedback(projectPath, "One-off page tweak.");

    expect(confirmPrototype(projectPath)).toMatchObject({
      ok: true,
      phase: "design_system_formal"
    });
    expect(
      claimConsolidateReview(
        projectPath,
        completedReconciliation(projectPath)
      ).ok
    ).toBe(true);

    expect(formalizeDesignSystem(projectPath, [], "reviewed")).toEqual({
      ok: false,
      reason: "unreviewed_feedback",
      phase: "design_system_formal",
      unreviewed_feedback_count: 2
    });

    const proposal = proposeReusableCandidate(projectPath, [consumedId]);
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    expect(
      confirmRuleUpdate(projectPath, {
        proposalId: proposal.proposal.proposal_id
      }).ok
    ).toBe(true);

    expect(formalizeDesignSystem(projectPath, [], "reviewed")).toEqual({
      ok: false,
      reason: "unreviewed_feedback",
      phase: "design_system_formal",
      unreviewed_feedback_count: 1
    });

    expect(
      dismissDesignerFeedback(projectPath, {
        feedbackIds: [dismissedId],
        reason: "Local exception; no global rule."
      }).ok
    ).toBe(true);

    expect(formalizeDesignSystem(projectPath, [], "reviewed")).toMatchObject({
      ok: true,
      phase: "ready_for_new_design"
    });
  });
});

test("record_artifact_written only accepts a confirmed proposalId", () => {
  withProject((projectPath) => {
    const feedbackId = recordFeedback(projectPath, "Sticky bar stays opaque.");
    const artifactRelative = "prototype/sticky-nav.tsx";
    const artifactPath = path.join(projectPath, artifactRelative);
    mkdirSync(path.dirname(artifactPath), { recursive: true });
    writeFileSync(artifactPath, "export const StickyNav = () => null;\n", "utf8");

    const declaration = {
      path: artifactRelative,
      artifactType: "code",
      semanticPurpose: "Sticky navigation rule realization."
    };

    // Unknown proposal id.
    expect(
      recordSourceArtifact(projectPath, {
        ...declaration,
        proposalId: "forged-proposal"
      })
    ).toMatchObject({ ok: false, reason: "proposal_not_found" });

    const proposal = proposeReusableCandidate(projectPath, [feedbackId]);
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    const proposalId = proposal.proposal.proposal_id;

    // Awaiting confirmation is not authorization to write.
    expect(
      recordSourceArtifact(projectPath, { ...declaration, proposalId })
    ).toMatchObject({ ok: false, reason: "proposal_not_confirmed" });
    expect(listEvents(projectPath, "source_artifact_declared")).toEqual([]);

    // Declarations without a proposal link stay unaffected by the gate.
    expect(recordSourceArtifact(projectPath, declaration)).toMatchObject({
      ok: true,
      record: { path: artifactRelative, artifact_type: "code" }
    });

    expect(confirmRuleUpdate(projectPath, { proposalId }).ok).toBe(true);
    const accepted = recordSourceArtifact(projectPath, {
      ...declaration,
      proposalId
    });
    expect(accepted).toMatchObject({
      ok: true,
      record: { path: artifactRelative, declaration_version: 2 }
    });

    const declared = listEvents(projectPath, "source_artifact_declared");
    expect(declared.length).toBe(2);
    expect(declared[0].payload.proposal_id).toBeUndefined();
    expect(declared[1].payload.proposal_id).toBe(proposalId);
  });
});

test("record_artifact_written rejects a blank proposalId before touching the DB", () => {
  withProject((projectPath) => {
    const artifactRelative = "prototype/blank-proposal.tsx";
    const artifactPath = path.join(projectPath, artifactRelative);
    mkdirSync(path.dirname(artifactPath), { recursive: true });
    writeFileSync(artifactPath, "export const Blank = () => null;\n", "utf8");

    expect(
      recordSourceArtifact(projectPath, {
        path: artifactRelative,
        artifactType: "code",
        semanticPurpose: "Blank proposal link.",
        proposalId: "   "
      })
    ).toMatchObject({ ok: false, reason: "invalid_proposal_id" });
    expect(listEvents(projectPath, "source_artifact_declared")).toEqual([]);
  });
});
