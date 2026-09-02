import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";

import { initializeProjectDb } from "../../lib/runtime/db";
import { readActiveRuleUpdateReviewWaitScope } from "../../lib/runtime/agent-command";
import {
  decideRuleUpdateProposal,
  failRuleUpdateApply,
  claimRuleUpdateDecision,
  createRuleUpdateReview,
  draftRuleUpdateProposal,
  getRuleUpdateReviewProjection,
  publishRuleUpdateReview,
  reviseRuleUpdateProposal,
  retryRuleUpdateApply
} from "../../lib/runtime/rule-update-review";
import { findEarliestPendingAgentCommand } from "../../lib/runtime/agent-command";
import { closeProjectDb, openProjectDb } from "../../lib/runtime/db";
import { authorizeRuleUpdateProposalPathOnDb } from "../../lib/runtime/rule-update-policy";
import { validateRuleUpdateIngestPlanOnDb } from "../../lib/runtime/rule-update-policy";
import { completeRuleUpdateApplyOnArtifactDeclaration } from "../../lib/runtime/rule-update-apply";
import { logEventOnDb } from "../../lib/runtime/events";
import { prepareDesignSystemIngestOnDb } from "../../lib/runtime/design-system-ingest";
import { checkDesignSystemDeclarationLinksOnDb } from "../../lib/runtime/design-system-status";

const cleanup: string[] = [];

afterEach(() => {
  for (const projectPath of cleanup.splice(0)) {
    rmSync(projectPath, { recursive: true, force: true });
  }
});

function createProject(): string {
  const projectPath = mkdtempSync(path.join(tmpdir(), "ikran-rule-review-"));
  cleanup.push(projectPath);
  initializeProjectDb(projectPath);
  return projectPath;
}

function seedComponentTarget(projectPath: string): void {
  const db = openProjectDb(projectPath);
  try {
    db.prepare(
      `INSERT INTO source_artifacts
         (id, path, artifact_type, semantic_purpose, related_record_ids_json,
          readiness, declaration_version, status, created_at, updated_at,
          content_digest)
       VALUES ('source-component-recovery',
               'design-system/components/project-item.json',
               'component-spec', 'test fixture', '[]', NULL, 1, 'ingested',
               '2026-08-29T00:00:00.000Z', '2026-08-29T00:00:00.000Z',
               'digest-component-1')`
    ).run();
    db.prepare(
      `INSERT INTO design_system_entries
         (id, source_artifact_path, file_kind, section, entry_id, name,
          value_json, meaning, status, links_json, position, created_at, updated_at)
       VALUES
         ('inventory-project-item', 'design-system/component-list.json',
          'component-list.json', 'components.inventory', 'component-project-item',
          'Project item', ?, 'Project item component', 'candidate', '[]', 0, ?, ?),
         ('spec-project-item', 'design-system/components/project-item.json',
          'component-spec', 'components.spec', 'component-project-item-spec',
          'Project item', '{}', 'Project item specification', 'candidate', '[]', 0, ?, ?)`
    ).run(
      JSON.stringify({
        name: "Project item",
        specPath: "design-system/components/project-item.json"
      }),
      "2026-08-29T00:00:00.000Z",
      "2026-08-29T00:00:00.000Z",
      "2026-08-29T00:00:00.000Z",
      "2026-08-29T00:00:00.000Z"
    );
  } finally {
    closeProjectDb(db);
  }
}

function componentSpecBody(axis: "style" | "context"): string {
  return JSON.stringify({
    id: "component-project-item-spec",
    name: "Project item",
    value: {
      description: "Reusable project detail content block.",
      props: [],
      variants: [{ axis, name: "detail" }],
      stateMatrix: [],
      guidelines: [{ kind: "do", text: "Keep comparison labels outside media." }],
      tokenLinks: [],
      codeLinks: []
    },
    status: "candidate",
    links: ["designer-feedback"]
  });
}

function seedExistingInteractionRule(projectPath: string): void {
  const db = openProjectDb(projectPath);
  try {
    db.prepare(
      `INSERT INTO source_artifacts
         (id, path, artifact_type, semantic_purpose, related_record_ids_json,
          readiness, declaration_version, status, created_at, updated_at,
          content_digest)
       VALUES ('source-retire', 'design-system/interaction-rules.json',
               'interaction-rules.json', 'test fixture', '[]', NULL, 1,
               'ingested', '2026-08-21T00:00:00.000Z',
               '2026-08-21T00:00:00.000Z', 'digest-retire')`
    ).run();
    db.prepare(
      `INSERT INTO design_system_entries
         (id, source_artifact_path, file_kind, section, entry_id, name,
          value_json, meaning, status, links_json, position, created_at, updated_at)
       VALUES ('row-retire', 'design-system/interaction-rules.json',
               'interaction-rules.json', 'interaction',
               'interaction.selection-feedback', 'Selection feedback',
               '"Show feedback immediately."', 'Show feedback immediately.',
               'formalized', '[]', 0, '2026-08-21T00:00:00.000Z',
               '2026-08-21T00:00:00.000Z')`
    ).run();
  } finally {
    closeProjectDb(db);
  }
}

test("retire drafts bind one existing Rule without inventing replacement prose", () => {
  const projectPath = createProject();
  seedExistingInteractionRule(projectPath);
  const review = createRuleUpdateReview(projectPath, { context: "Retire duplicate rule" });
  if (!review.ok) throw new Error(review.reason);

  expect(draftRuleUpdateProposal(projectPath, {
    reviewId: review.review.id,
    kind: "retire",
    classification: "proposed_update",
    title: "Selection feedback",
    fullRuleBody: "",
    reason: "The behavior is duplicated by the canonical feedback rule.",
    affectedItems: ["interaction.selection-feedback"],
    evidenceRecordIds: [],
    target: {
      category: "foundations.interaction",
      sourceArtifactPath: "design-system/interaction-rules.json",
      entryId: "interaction.selection-feedback"
    }
  })).toMatchObject({
    ok: true,
    proposal: {
      kind: "retire",
      full_rule_body: "",
      current_rule_body: "Show feedback immediately.",
      base_digest: "digest-retire",
      target: {
        sourceArtifactPath: "design-system/interaction-rules.json",
        entryId: "interaction.selection-feedback",
        proposedTargetPath: null
      }
    }
  });

  expect(draftRuleUpdateProposal(projectPath, {
    reviewId: review.review.id,
    kind: "retire",
    classification: "proposed_update",
    title: "Missing rule",
    fullRuleBody: "",
    reason: "It is obsolete.",
    affectedItems: [],
    evidenceRecordIds: [],
    target: {
      category: "foundations.interaction",
      sourceArtifactPath: "design-system/interaction-rules.json",
      entryId: "interaction.missing"
    }
  })).toEqual({ ok: false, reason: "rule_entry_not_found" });

  expect(publishRuleUpdateReview(projectPath, review.review.id).ok).toBe(true);
  const published = getRuleUpdateReviewProjection(projectPath);
  if (!published.ok) throw new Error(published.reason);
  const proposalId = published.reviews[0]?.proposals[0]?.id;
  if (!proposalId) throw new Error("retire proposal missing");
  expect(reviseRuleUpdateProposal(projectPath, {
    proposalId,
    title: "Missing rule",
    fullRuleBody: "",
    target: {
      category: "foundations.interaction",
      sourceArtifactPath: "design-system/interaction-rules.json",
      entryId: "interaction.missing"
    }
  })).toEqual({ ok: false, reason: "rule_entry_not_found" });
  expect(decideRuleUpdateProposal(projectPath, {
    proposalId,
    decision: "accepted"
  })).toMatchObject({
    ok: true,
    command: {
      payload: {
        proposal_id: proposalId,
        kind: "retire",
        full_rule_body: ""
      }
    }
  });
  expect(claimRuleUpdateDecision(projectPath)).toMatchObject({
    ok: true,
    completed: false,
    proposal: { id: proposalId, kind: "retire" }
  });
});

test("retire ingest accepts only the exact target removal", () => {
  const projectPath = createProject();
  seedExistingInteractionRule(projectPath);
  const review = createRuleUpdateReview(projectPath, { context: "Retire exact Rule" });
  if (!review.ok) throw new Error(review.reason);
  const proposal = draftRuleUpdateProposal(projectPath, {
    reviewId: review.review.id,
    kind: "retire",
    classification: "proposed_update",
    title: "Selection feedback",
    fullRuleBody: "",
    reason: "Duplicated by a canonical rule.",
    affectedItems: [],
    evidenceRecordIds: [],
    target: {
      category: "foundations.interaction",
      sourceArtifactPath: "design-system/interaction-rules.json",
      entryId: "interaction.selection-feedback"
    }
  });
  if (!proposal.ok) throw new Error(proposal.reason);
  const db = openProjectDb(projectPath);
  try {
    const emptyPlan = {
      fileKind: "interaction-rules.json" as const,
      sourcePath: "design-system/interaction-rules.json",
      rows: [],
      firstIngest: false,
      systemName: null,
      now: "2026-08-21T00:00:01.000Z"
    };
    expect(validateRuleUpdateIngestPlanOnDb(db, proposal.proposal.id, emptyPlan))
      .toEqual({ ok: true });

    expect(validateRuleUpdateIngestPlanOnDb(db, proposal.proposal.id, {
      ...emptyPlan,
      fileKind: "layout-rules.json"
    })).toMatchObject({ ok: false, reason: "retire_semantic_diff_mismatch" });

    expect(validateRuleUpdateIngestPlanOnDb(db, proposal.proposal.id, {
      ...emptyPlan,
      rows: [{
        entry_id: "interaction.other",
        section: "interaction",
        name: "Unrelated",
        kind: null,
        domain: null,
        value: "Added content",
        source_captures: [],
        meaning: "Added content",
        status: "formalized",
        links: [],
        position: 0
      }]
    })).toMatchObject({ ok: false, reason: "retire_semantic_diff_mismatch" });
  } finally {
    closeProjectDb(db);
  }
});

test("rejecting a retire leaves the active Rule untouched and needs no write", () => {
  const projectPath = createProject();
  seedExistingInteractionRule(projectPath);
  const review = createRuleUpdateReview(projectPath, { context: "Reject Retire" });
  if (!review.ok) throw new Error(review.reason);
  const proposal = draftRuleUpdateProposal(projectPath, {
    reviewId: review.review.id,
    kind: "retire",
    classification: "proposed_update",
    title: "Keep selection feedback",
    fullRuleBody: "",
    reason: "Review whether this is truly duplicated.",
    affectedItems: ["interaction.selection-feedback"],
    evidenceRecordIds: [],
    target: {
      category: "foundations.interaction",
      sourceArtifactPath: "design-system/interaction-rules.json",
      entryId: "interaction.selection-feedback"
    }
  });
  if (!proposal.ok) throw new Error(proposal.reason);
  expect(publishRuleUpdateReview(projectPath, review.review.id).ok).toBe(true);
  expect(decideRuleUpdateProposal(projectPath, {
    proposalId: proposal.proposal.id,
    decision: "rejected"
  })).toMatchObject({ ok: true, proposal: { status: "rejected" } });
  expect(claimRuleUpdateDecision(projectPath)).toMatchObject({
    ok: true,
    completed: true,
    proposal: { id: proposal.proposal.id, status: "rejected" }
  });
  const db = openProjectDb(projectPath);
  try {
    expect(db.prepare(
      `SELECT entry_id FROM design_system_entries
       WHERE source_artifact_path = ? AND entry_id = ?`
    ).get(
      "design-system/interaction-rules.json",
      "interaction.selection-feedback"
    )).toEqual({ entry_id: "interaction.selection-feedback" });
  } finally {
    closeProjectDb(db);
  }
});

test("draft proposals stay private until their Review publishes as one batch", () => {
  const projectPath = createProject();
  const review = createRuleUpdateReview(projectPath, {
    context: "Prototype validation · navigation behavior"
  });
  expect(review).toMatchObject({ ok: true, review: { status: "draft" } });
  if (!review.ok) return;

  const proposal = draftRuleUpdateProposal(projectPath, {
    reviewId: review.review.id,
    kind: "new",
    classification: "proposed_update",
    title: "Sticky navigation remains visible",
    fullRuleBody: "Keep the primary navigation visible while scrolling.",
    reason: "The confirmed prototype made this behavior reusable.",
    affectedItems: ["Primary navigation"],
    evidenceRecordIds: [],
    target: {
      category: "foundations.interaction",
      sourceArtifactPath: "design-system/interaction-rules.json"
    }
  });
  expect(proposal).toMatchObject({
    ok: true,
    proposal: { status: "pending_review", revision: 1 }
  });
  expect(getRuleUpdateReviewProjection(projectPath)).toEqual({
    ok: true,
    reviews: [],
    categories_with_unfinished_proposals: []
  });
  expect(readActiveRuleUpdateReviewWaitScope(projectPath)).toBeNull();

  expect(publishRuleUpdateReview(projectPath, review.review.id)).toMatchObject({
    ok: true,
    review: { id: review.review.id, status: "published" },
    proposal_count: 1
  });
  expect(getRuleUpdateReviewProjection(projectPath)).toMatchObject({
    ok: true,
    reviews: [
      {
        id: review.review.id,
        status: "published",
        proposals: [
          {
            title: "Sticky navigation remains visible",
            full_rule_body:
              "Keep the primary navigation visible while scrolling.",
            status: "pending_review",
            target: { category: "foundations.interaction" },
            revision: 1
          }
        ]
      }
    ],
    categories_with_unfinished_proposals: ["foundations.interaction"]
  });
  expect(readActiveRuleUpdateReviewWaitScope(projectPath)).toMatchObject({
    scope: { kind: "rule_update_review", id: review.review.id },
    status: "active"
  });
});

test("an empty Review publishes as a completed no-change round without waiting", () => {
  const projectPath = createProject();
  const review = createRuleUpdateReview(projectPath, { context: "No reusable changes" });
  if (!review.ok) throw new Error(review.reason);
  expect(publishRuleUpdateReview(projectPath, review.review.id)).toMatchObject({
    ok: true,
    review: { status: "completed" },
    proposal_count: 0
  });
  expect(readActiveRuleUpdateReviewWaitScope(projectPath)).toBeNull();
});

function publishedProposal(projectPath: string) {
  const review = createRuleUpdateReview(projectPath, { context: "Review 1" });
  if (!review.ok) throw new Error(review.reason);
  const proposal = draftRuleUpdateProposal(projectPath, {
    reviewId: review.review.id,
    kind: "update",
    classification: "proposed_update",
    title: "Original title",
    fullRuleBody: "Original complete rule.",
    reason: "Confirmed behavior changed.",
    affectedItems: ["Navigation"],
    evidenceRecordIds: [],
    target: {
      category: "foundations.layout",
      sourceArtifactPath: "design-system/layout-rules.json",
      entryId: "layout.navigation"
    }
  });
  if (!proposal.ok) throw new Error(proposal.reason);
  const published = publishRuleUpdateReview(projectPath, review.review.id);
  if (!published.ok) throw new Error(published.reason);
  return { review: review.review, proposal: proposal.proposal };
}

test("designer edits append an immutable revision without deciding or waking the Agent", () => {
  const projectPath = createProject();
  const { proposal } = publishedProposal(projectPath);

  expect(
    reviseRuleUpdateProposal(projectPath, {
      proposalId: proposal.id,
      title: "Revised title",
      fullRuleBody: "Revised complete rule.",
      target: {
        category: "foundations.interaction",
        sourceArtifactPath: "design-system/interaction-rules.json",
        entryId: "interaction.navigation"
      }
    })
  ).toMatchObject({
    ok: true,
    proposal: {
      title: "Revised title",
      revision: 2,
      revision_author: "designer",
      status: "pending_review",
      target: { category: "foundations.interaction" }
    }
  });
  expect(findEarliestPendingAgentCommand(projectPath)).toBeNull();

  const db = openProjectDb(projectPath);
  try {
    expect(
      db
        .prepare(
          `SELECT revision, title, author
           FROM rule_update_proposal_revisions
           WHERE proposal_id = ? ORDER BY revision`
        )
        .all(proposal.id)
    ).toEqual([
      { revision: 1, title: "Original title", author: "agent" },
      { revision: 2, title: "Revised title", author: "designer" }
    ]);
  } finally {
    closeProjectDb(db);
  }

  expect(
    reviseRuleUpdateProposal(projectPath, {
      proposalId: proposal.id,
      title: "Revised title",
      fullRuleBody: "Revised complete rule.",
      target: {
        category: "foundations.interaction",
        sourceArtifactPath: "design-system/interaction-rules.json",
        entryId: "interaction.navigation"
      }
    })
  ).toEqual({ ok: false, reason: "revision_unchanged" });
});

test("Accept records one exact decision and publishes an Agent-visible command", () => {
  const projectPath = createProject();
  const { review, proposal } = publishedProposal(projectPath);
  const decision = decideRuleUpdateProposal(projectPath, {
    proposalId: proposal.id,
    decision: "accepted"
  });
  expect(decision).toMatchObject({
    ok: true,
    proposal: { id: proposal.id, revision: 1, status: "waiting_agent" },
    command: {
      command_type: "apply_rule_update_decision",
      scope: { kind: "rule_update_review", id: review.id },
      payload: {
        proposal_id: proposal.id,
        revision: 1,
        decision: "accepted",
        title: "Original title",
        full_rule_body: "Original complete rule.",
        target: {
          category: "foundations.layout",
          sourceArtifactPath: "design-system/layout-rules.json",
          entryId: "layout.navigation"
        }
      }
    }
  });
  expect(readActiveRuleUpdateReviewWaitScope(projectPath)).toBeNull();
  expect(findEarliestPendingAgentCommand(projectPath)).toMatchObject({
    id: decision.ok ? decision.command.id : "",
    status: "pending"
  });
  expect(
    decideRuleUpdateProposal(projectPath, {
      proposalId: proposal.id,
      decision: "accepted"
    })
  ).toMatchObject({ ok: true, reused: true });
});

test("Agent claim receives the frozen decision; Reject completes without a source write", () => {
  const projectPath = createProject();
  const { review, proposal } = publishedProposal(projectPath);
  expect(
    decideRuleUpdateProposal(projectPath, {
      proposalId: proposal.id,
      decision: "rejected"
    })
  ).toMatchObject({ ok: true, proposal: { status: "rejected" } });

  expect(claimRuleUpdateDecision(projectPath)).toMatchObject({
    ok: true,
    reused: false,
    completed: true,
    command: {
      status: "completed",
      payload: {
        proposal_id: proposal.id,
        revision: 1,
        decision: "rejected"
      }
    }
  });
  expect(getRuleUpdateReviewProjection(projectPath)).toMatchObject({
    ok: true,
    reviews: [{ id: review.id, status: "completed" }],
    categories_with_unfinished_proposals: []
  });
});

test("Reject records the linked feedback disposition instead of blocking formalization", () => {
  const projectPath = createProject();
  const db = openProjectDb(projectPath);
  try {
    db.prepare(
      `INSERT INTO designer_feedback
         (id, summary, run_id, session_id, created_at)
       VALUES ('feedback-rejected', 'Keep this local', 'run-1', 'session-1', ?)`
    ).run(new Date().toISOString());
  } finally {
    closeProjectDb(db);
  }
  const review = createRuleUpdateReview(projectPath, { context: "Reject feedback" });
  if (!review.ok) throw new Error(review.reason);
  const proposal = draftRuleUpdateProposal(projectPath, {
    reviewId: review.review.id,
    kind: "new",
    classification: "local_exception",
    title: "Do not promote",
    fullRuleBody: "This stays local.",
    reason: "The designer rejected global reuse.",
    affectedItems: ["Local prototype"],
    evidenceRecordIds: ["feedback-rejected"],
    target: {
      category: "foundations.interaction",
      sourceArtifactPath: "design-system/interaction-rules.json"
    }
  });
  if (!proposal.ok) throw new Error(proposal.reason);
  expect(publishRuleUpdateReview(projectPath, review.review.id).ok).toBe(true);
  expect(
    decideRuleUpdateProposal(projectPath, {
      proposalId: proposal.proposal.id,
      decision: "rejected"
    }).ok
  ).toBe(true);
  const checked = openProjectDb(projectPath);
  try {
    expect(
      checked
        .prepare(
          `SELECT proposal_id FROM designer_feedback_review_consumption
           WHERE feedback_id = 'feedback-rejected'`
        )
        .get()
    ).toEqual({ proposal_id: proposal.proposal.id });
  } finally {
    closeProjectDb(checked);
  }
});

test("accepted feedback-backed Rule Update preflights and authorizes one exact formalized write", () => {
  const projectPath = createProject();
  seedExistingInteractionRule(projectPath);
  const db = openProjectDb(projectPath);
  try {
    db.prepare(
      `INSERT INTO designer_feedback
         (id, summary, run_id, session_id, created_at)
       VALUES ('feedback-accepted', 'Delay feedback until state changes',
               'run-1', 'session-1', ?)`
    ).run(new Date().toISOString());
  } finally {
    closeProjectDb(db);
  }
  const review = createRuleUpdateReview(projectPath, { context: "Accepted feedback" });
  if (!review.ok) throw new Error(review.reason);
  const body = "Show feedback immediately after the visible state changes.";
  const proposal = draftRuleUpdateProposal(projectPath, {
    reviewId: review.review.id,
    kind: "update",
    classification: "proposed_update",
    title: "Selection feedback timing",
    fullRuleBody: body,
    reason: "The designer confirmed the timing in Prototype review.",
    affectedItems: ["interaction.selection-feedback"],
    evidenceRecordIds: ["feedback-accepted"],
    target: {
      category: "foundations.interaction",
      sourceArtifactPath: "design-system/interaction-rules.json",
      entryId: "interaction.selection-feedback"
    }
  });
  if (!proposal.ok) throw new Error(proposal.reason);
  expect(publishRuleUpdateReview(projectPath, review.review.id).ok).toBe(true);
  expect(decideRuleUpdateProposal(projectPath, {
    proposalId: proposal.proposal.id,
    decision: "accepted"
  }).ok).toBe(true);
  expect(claimRuleUpdateDecision(projectPath)).toMatchObject({ ok: true, completed: false });

  const checked = openProjectDb(projectPath);
  try {
    expect(
      checkDesignSystemDeclarationLinksOnDb(checked, ["feedback-accepted"])
    ).toEqual({ ok: true });
    const prepared = prepareDesignSystemIngestOnDb(checked, {
      fileKind: "interaction-rules.json",
      sourcePath: "design-system/interaction-rules.json",
      now: new Date().toISOString(),
      json: {
        rules: [{
          id: "interaction.selection-feedback",
          value: body,
          meaning: body,
          status: "formalized",
          links: ["feedback-accepted"]
        }]
      }
    });
    expect(prepared).toMatchObject({ ok: true });
    if (prepared.ok) {
      expect(
        validateRuleUpdateIngestPlanOnDb(
          checked,
          proposal.proposal.id,
          prepared.plan
        )
      ).toEqual({ ok: true });
    }
  } finally {
    closeProjectDb(checked);
  }
});

test("an accepted proposal cannot authorize a declaration before Agent claim", () => {
  const projectPath = createProject();
  const { proposal } = publishedProposal(projectPath);
  expect(
    decideRuleUpdateProposal(projectPath, {
      proposalId: proposal.id,
      decision: "accepted"
    }).ok
  ).toBe(true);
  const db = openProjectDb(projectPath);
  try {
    expect(
      authorizeRuleUpdateProposalPathOnDb(
        db,
        proposal.id,
        "design-system/layout-rules.json",
        true
      )
    ).toEqual({ ok: false, reason: "proposal_apply_not_claimed" });
  } finally {
    closeProjectDb(db);
  }
});

test("multiple decisions against one source preserve the accepted base digest", () => {
  const projectPath = createProject();
  const db = openProjectDb(projectPath);
  try {
    db.prepare(
      `INSERT INTO source_artifacts
         (id, path, artifact_type, semantic_purpose, related_record_ids_json,
          readiness, declaration_version, status, created_at, updated_at,
          content_digest)
       VALUES ('source-1', 'design-system/interaction-rules.json',
               'interaction-rules.json', 'test', '[]', NULL, 1, 'ingested',
               '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z', 'digest-1')`
    ).run();
  } finally {
    closeProjectDb(db);
  }
  const review = createRuleUpdateReview(projectPath, { context: "Shared source" });
  if (!review.ok) throw new Error(review.reason);
  const draft = (title: string) => draftRuleUpdateProposal(projectPath, {
    reviewId: review.review.id,
    kind: "new",
    classification: "proposed_update",
    title,
    fullRuleBody: `${title} body`,
    reason: "reason",
    affectedItems: [title],
    evidenceRecordIds: [],
    target: {
      category: "foundations.interaction",
      sourceArtifactPath: "design-system/interaction-rules.json"
    }
  });
  const rejected = draft("Rejected");
  const accepted = draft("Accepted");
  if (!rejected.ok || !accepted.ok) throw new Error("draft failed");
  expect(publishRuleUpdateReview(projectPath, review.review.id).ok).toBe(true);
  expect(decideRuleUpdateProposal(projectPath, { proposalId: rejected.proposal.id, decision: "rejected" }).ok).toBe(true);
  expect(decideRuleUpdateProposal(projectPath, { proposalId: accepted.proposal.id, decision: "accepted" }).ok).toBe(true);
  expect(claimRuleUpdateDecision(projectPath)).toMatchObject({ ok: true, completed: true });
  expect(claimRuleUpdateDecision(projectPath)).toMatchObject({
    ok: true,
    completed: false,
    proposal: { id: accepted.proposal.id, base_digest: "digest-1" }
  });
});

test("later accepted proposals rebase only onto an earlier applied command in the same Review", () => {
  const projectPath = createProject();
  const db = openProjectDb(projectPath);
  try {
    db.prepare(
      `INSERT INTO source_artifacts
         (id, path, artifact_type, semantic_purpose, related_record_ids_json,
          readiness, declaration_version, status, created_at, updated_at,
          content_digest)
       VALUES ('source-sequence', 'design-system/interaction-rules.json',
               'interaction-rules.json', 'test', '[]', NULL, 1, 'ingested',
               '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z', 'digest-1')`
    ).run();
  } finally {
    closeProjectDb(db);
  }
  const review = createRuleUpdateReview(projectPath, { context: "Sequential source" });
  if (!review.ok) throw new Error(review.reason);
  const draft = (title: string) => draftRuleUpdateProposal(projectPath, {
    reviewId: review.review.id,
    kind: "new",
    classification: "proposed_update",
    title,
    fullRuleBody: `${title} body`,
    reason: "reason",
    affectedItems: [title],
    evidenceRecordIds: [],
    target: {
      category: "foundations.interaction",
      sourceArtifactPath: "design-system/interaction-rules.json"
    }
  });
  const first = draft("First accepted");
  const second = draft("Second accepted");
  if (!first.ok || !second.ok) throw new Error("draft failed");
  expect(publishRuleUpdateReview(projectPath, review.review.id).ok).toBe(true);
  expect(decideRuleUpdateProposal(projectPath, { proposalId: first.proposal.id, decision: "accepted" }).ok).toBe(true);
  expect(decideRuleUpdateProposal(projectPath, { proposalId: second.proposal.id, decision: "accepted" }).ok).toBe(true);
  expect(claimRuleUpdateDecision(projectPath)).toMatchObject({
    ok: true,
    proposal: { id: first.proposal.id, base_digest: "digest-1" }
  });
  const applied = openProjectDb(projectPath);
  try {
    applied.prepare(
      `UPDATE source_artifacts SET content_digest = 'digest-2'
       WHERE path = 'design-system/interaction-rules.json'`
    ).run();
    const firstAttempt = applied
      .prepare(
        `SELECT command_id, revision FROM rule_update_apply_attempts
         WHERE proposal_id = ? AND status = 'claimed'`
      )
      .get(first.proposal.id) as { command_id: string; revision: number };
    logEventOnDb(applied, "source_artifact_declared", {
      proposal_id: first.proposal.id,
      path: "design-system/interaction-rules.json",
      rule_update_command_id: firstAttempt.command_id,
      rule_update_revision: firstAttempt.revision
    });
    expect(
      completeRuleUpdateApplyOnArtifactDeclaration(
        applied,
        first.proposal.id,
        "design-system/interaction-rules.json",
        "digest-2",
        new Date().toISOString()
      )
    ).toMatchObject({ applied: true, reviewId: review.review.id });
  } finally {
    closeProjectDb(applied);
  }
  expect(claimRuleUpdateDecision(projectPath)).toMatchObject({
    ok: true,
    proposal: {
      id: second.proposal.id,
      base_digest: "digest-2",
      base_digests: {
        "design-system/interaction-rules.json": "digest-2"
      }
    }
  });
});

test("move proposals preserve their typed source category for the trace projection", () => {
  const projectPath = createProject();
  const review = createRuleUpdateReview(projectPath, { context: "Move trace" });
  if (!review.ok) throw new Error(review.reason);
  expect(
    draftRuleUpdateProposal(projectPath, {
      reviewId: review.review.id,
      kind: "move",
      classification: "rule_conflict",
      title: "Move type token",
      fullRuleBody: "Move the type token into Color.",
      reason: "The semantic destination changed.",
      affectedItems: ["token.type.body"],
      evidenceRecordIds: [],
      target: {
        category: "foundations.color",
        sourceCategory: "foundations.typography",
        sourceArtifactPath: "design-system/token.json",
        proposedTargetPath: "design-system/token.json",
        entryId: "token.type.body"
      }
    })
  ).toMatchObject({
    ok: true,
    proposal: {
      target: {
        category: "foundations.color",
        sourceCategory: "foundations.typography"
      }
    }
  });
});

test("component categories cannot authorize another component artifact", () => {
  const projectPath = createProject();
  const review = createRuleUpdateReview(projectPath, { context: "Typed component" });
  if (!review.ok) throw new Error(review.reason);
  expect(
    draftRuleUpdateProposal(projectPath, {
      reviewId: review.review.id,
      kind: "new",
      classification: "proposed_update",
      title: "Button rule",
      fullRuleBody: "Buttons keep one action hierarchy.",
      reason: "Reusable component behavior.",
      affectedItems: ["button"],
      evidenceRecordIds: [],
      target: {
        category: "component:button",
        sourceArtifactPath: "design-system/components/card.json"
      }
    })
  ).toEqual({
    ok: false,
    reason: "component_target_not_browsable",
    details: { received_id: "button", valid_component_ids: [] }
  });
});

test("component proposals canonicalize legacy spec ids to the browsable inventory id", () => {
  const projectPath = createProject();
  const db = openProjectDb(projectPath);
  try {
    db.prepare(
      `INSERT INTO design_system_entries
         (id, source_artifact_path, file_kind, section, entry_id, name,
          value_json, meaning, status, links_json, position, created_at, updated_at)
       VALUES
         ('inventory-footer', 'design-system/component-list.json',
          'component-list.json', 'components.inventory', 'component-footer',
          'Footer', ?, 'Footer component', 'candidate', '[]', 0, ?, ?),
         ('spec-footer', 'design-system/components/footer.json',
          'component-spec', 'components.spec', 'component-footer-spec',
          'Footer', '{}', 'Footer specification', 'candidate', '[]', 0, ?, ?)`
    ).run(
      JSON.stringify({
        name: "Footer",
        specPath: "design-system/components/footer.json"
      }),
      "2026-08-23T00:00:00.000Z",
      "2026-08-23T00:00:00.000Z",
      "2026-08-23T00:00:00.000Z",
      "2026-08-23T00:00:00.000Z"
    );
  } finally {
    closeProjectDb(db);
  }

  const review = createRuleUpdateReview(projectPath, {
    context: "Footer component rule"
  });
  if (!review.ok) throw new Error(review.reason);
  const fullRuleBody = JSON.stringify({
    id: "component-footer-spec",
    name: "Footer",
    value: {
      description: "Footer spacing specification",
      props: [],
      variants: [],
      stateMatrix: [],
      guidelines: [],
      tokenLinks: [],
      codeLinks: []
    },
    status: "candidate",
    links: ["designer-feedback"]
  });
  const proposal = draftRuleUpdateProposal(projectPath, {
    reviewId: review.review.id,
    kind: "new",
    classification: "proposed_update",
    title: "Footer spacing",
    changeDescription: "Keep footer spacing consistent.",
    fullRuleBody,
    reason: "The rule belongs to Footer.",
    affectedItems: ["Footer"],
    evidenceRecordIds: [],
    target: {
      category: "component:component-footer-spec",
      sourceArtifactPath: "design-system/components/footer.json",
      entryId: "component-footer-spec"
    }
  });

  expect(proposal).toMatchObject({
    ok: true,
    proposal: {
      change_description: "Keep footer spacing consistent.",
      full_rule_body: fullRuleBody,
      target: {
        category: "component:component-footer",
        sourceArtifactPath: "design-system/components/footer.json",
        entryId: "component-footer"
      }
    }
  });
  if (!proposal.ok) throw new Error(proposal.reason);
  // Simulate a proposal persisted by the previous release. Read projection
  // and publication must still recover it through inventory.specPath.
  const legacyDb = openProjectDb(projectPath);
  try {
    legacyDb.prepare(
      `UPDATE rule_update_proposal_revisions
       SET target_category = 'component:component-footer-spec',
           entry_id = 'component-footer-spec'
       WHERE proposal_id = ?`
    ).run(proposal.proposal.id);
    legacyDb.prepare(
      `UPDATE rule_update_proposals SET entry_id = 'component-footer-spec'
       WHERE id = ?`
    ).run(proposal.proposal.id);
  } finally {
    closeProjectDb(legacyDb);
  }
  expect(publishRuleUpdateReview(projectPath, review.review.id).ok).toBe(true);
  expect(getRuleUpdateReviewProjection(projectPath)).toMatchObject({
    ok: true,
    categories_with_unfinished_proposals: ["component:component-footer"],
    reviews: [{
      proposals: [{
        target: {
          category: "component:component-footer",
          entryId: "component-footer"
        }
      }]
    }]
  });
});

test("component proposals reject a schema-invalid machine-write body before review", () => {
  const projectPath = createProject();
  seedComponentTarget(projectPath);
  const review = createRuleUpdateReview(projectPath, {
    context: "Component proposal preflight"
  });
  if (!review.ok) throw new Error(review.reason);

  expect(
    draftRuleUpdateProposal(projectPath, {
      reviewId: review.review.id,
      kind: "update",
      classification: "proposed_update",
      title: "Project comparison module",
      changeDescription: "Add a reusable comparison module.",
      fullRuleBody: componentSpecBody("context"),
      reason: "Reusable on project detail pages.",
      affectedItems: ["Project item"],
      evidenceRecordIds: [],
      target: {
        category: "component:component-project-item",
        sourceArtifactPath: "design-system/components/project-item.json",
        entryId: "component-project-item"
      }
    })
  ).toMatchObject({
    ok: false,
    reason: "invalid_proposal_body",
    details: {
      schema_reason: "invalid_field_type",
      schema_details: { field: "value.variants[0]" }
    }
  });
});

test("publishing revalidates persisted component proposal bodies", () => {
  const projectPath = createProject();
  seedComponentTarget(projectPath);
  const review = createRuleUpdateReview(projectPath, {
    context: "Legacy component proposal preflight"
  });
  if (!review.ok) throw new Error(review.reason);
  const drafted = draftRuleUpdateProposal(projectPath, {
    reviewId: review.review.id,
    kind: "update",
    classification: "proposed_update",
    title: "Project comparison module",
    changeDescription: "Add a reusable comparison module.",
    fullRuleBody: componentSpecBody("style"),
    reason: "Reusable on project detail pages.",
    affectedItems: ["Project item"],
    evidenceRecordIds: [],
    target: {
      category: "component:component-project-item",
      sourceArtifactPath: "design-system/components/project-item.json",
      entryId: "component-project-item"
    }
  });
  if (!drafted.ok) throw new Error(drafted.reason);
  const legacyDb = openProjectDb(projectPath);
  try {
    legacyDb
      .prepare(
        `UPDATE rule_update_proposal_revisions SET full_rule_body = ?
         WHERE proposal_id = ? AND revision = 1`
      )
      .run(componentSpecBody("context"), drafted.proposal.id);
  } finally {
    closeProjectDb(legacyDb);
  }

  expect(publishRuleUpdateReview(projectPath, review.review.id)).toMatchObject({
    ok: false,
    reason: "invalid_proposal_body",
    details: {
      proposal_id: drafted.proposal.id,
      schema_reason: "invalid_field_type"
    }
  });
});

test("component proposals reject non-browsable ids with actionable inventory ids", () => {
  const projectPath = createProject();
  const db = openProjectDb(projectPath);
  try {
    db.prepare(
      `INSERT INTO design_system_entries
         (id, source_artifact_path, file_kind, section, entry_id, name,
          value_json, meaning, status, links_json, position, created_at, updated_at)
       VALUES ('inventory-footer', 'design-system/component-list.json',
               'component-list.json', 'components.inventory',
               'component-footer', 'Footer', ?, 'Footer component',
               'candidate', '[]', 0, ?, ?)`
    ).run(
      JSON.stringify({
        name: "Footer",
        specPath: "design-system/components/footer.json"
      }),
      "2026-08-23T00:00:00.000Z",
      "2026-08-23T00:00:00.000Z"
    );
  } finally {
    closeProjectDb(db);
  }
  const review = createRuleUpdateReview(projectPath, { context: "Ghost target" });
  if (!review.ok) throw new Error(review.reason);

  expect(draftRuleUpdateProposal(projectPath, {
    reviewId: review.review.id,
    kind: "new",
    classification: "proposed_update",
    title: "Ghost rule",
    fullRuleBody: "This must never become an orphan proposal.",
    reason: "Regression fixture.",
    affectedItems: [],
    evidenceRecordIds: [],
    target: {
      category: "component:component-ghost",
      sourceArtifactPath: "design-system/components/ghost.json"
    }
  })).toEqual({
    ok: false,
    reason: "component_target_not_browsable",
    details: {
      received_id: "component-ghost",
      valid_component_ids: ["component-footer"]
    }
  });
});

test("base drift becomes needs_revision before the Agent may write", () => {
  const projectPath = createProject();
  const db = openProjectDb(projectPath);
  try {
    db.prepare(
      `INSERT INTO source_artifacts
         (id, path, artifact_type, semantic_purpose, related_record_ids_json,
          readiness, declaration_version, status, created_at, updated_at,
          content_digest)
       VALUES ('source-conflict', 'design-system/interaction-rules.json',
               'interaction-rules.json', 'test', '[]', NULL, 1, 'ingested',
               '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z', 'digest-1')`
    ).run();
  } finally {
    closeProjectDb(db);
  }
  const review = createRuleUpdateReview(projectPath, { context: "Drift" });
  if (!review.ok) throw new Error(review.reason);
  const drafted = draftRuleUpdateProposal(projectPath, {
    reviewId: review.review.id,
    kind: "new",
    classification: "proposed_update",
    title: "Drift",
    fullRuleBody: "Drift body",
    reason: "reason",
    affectedItems: ["Drift"],
    evidenceRecordIds: [],
    target: {
      category: "foundations.interaction",
      sourceArtifactPath: "design-system/interaction-rules.json"
    }
  });
  if (!drafted.ok) throw new Error(drafted.reason);
  const proposal = drafted.proposal;
  expect(publishRuleUpdateReview(projectPath, review.review.id).ok).toBe(true);
  expect(decideRuleUpdateProposal(projectPath, { proposalId: proposal.id, decision: "accepted" }).ok).toBe(true);
  const changed = openProjectDb(projectPath);
  try {
    changed.prepare(
      "UPDATE source_artifacts SET content_digest = 'digest-2' WHERE path = 'design-system/interaction-rules.json'"
    ).run();
  } finally {
    closeProjectDb(changed);
  }
  expect(claimRuleUpdateDecision(projectPath)).toMatchObject({
    ok: false,
    reason: "proposal_base_digest_conflict",
    details: { expected: "digest-1", observed: "digest-2" }
  });
  expect(getRuleUpdateReviewProjection(projectPath)).toMatchObject({
    ok: true,
    reviews: [{ proposals: [{ id: proposal.id, status: "needs_revision" }] }]
  });
});

test("failed apply retries the same command and blocks later writes to the same source", () => {
  const projectPath = createProject();
  const db = openProjectDb(projectPath);
  try {
    db.prepare(
      `INSERT INTO source_artifacts
         (id, path, artifact_type, semantic_purpose, related_record_ids_json,
          readiness, declaration_version, status, created_at, updated_at,
          content_digest)
       VALUES ('source-retry', 'design-system/interaction-rules.json',
               'interaction-rules.json', 'test', '[]', NULL, 1, 'ingested',
               '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z', 'digest-1')`
    ).run();
  } finally {
    closeProjectDb(db);
  }
  const review = createRuleUpdateReview(projectPath, { context: "Retry ordering" });
  if (!review.ok) throw new Error(review.reason);
  const make = (title: string) => draftRuleUpdateProposal(projectPath, {
    reviewId: review.review.id,
    kind: "new",
    classification: "proposed_update",
    title,
    fullRuleBody: `${title} body`,
    reason: "reason",
    affectedItems: [title],
    evidenceRecordIds: [],
    target: {
      category: "foundations.interaction",
      sourceArtifactPath: "design-system/interaction-rules.json"
    }
  });
  const first = make("First");
  const second = make("Second");
  if (!first.ok || !second.ok) throw new Error("draft failed");
  expect(publishRuleUpdateReview(projectPath, review.review.id).ok).toBe(true);
  const firstDecision = decideRuleUpdateProposal(projectPath, { proposalId: first.proposal.id, decision: "accepted" });
  const secondDecision = decideRuleUpdateProposal(projectPath, { proposalId: second.proposal.id, decision: "accepted" });
  if (!firstDecision.ok || !secondDecision.ok) throw new Error("decision failed");
  const claimed = claimRuleUpdateDecision(projectPath);
  expect(claimed).toMatchObject({ ok: true, command: { id: firstDecision.command.id } });
  expect(failRuleUpdateApply(projectPath, { commandId: firstDecision.command.id, error: "write_failed" })).toEqual({
    ok: true,
    command_id: firstDecision.command.id
  });
  expect(claimRuleUpdateDecision(projectPath)).toMatchObject({
    ok: false,
    reason: "earlier_rule_update_apply_failed",
    details: { blocking_command_id: firstDecision.command.id }
  });
  expect(retryRuleUpdateApply(projectPath, firstDecision.command.id)).toEqual({
    ok: true,
    command_id: firstDecision.command.id
  });
  const retriedDb = openProjectDb(projectPath);
  try {
    expect(
      retriedDb
        .prepare(
          `SELECT status FROM agent_command_wait_scopes
           WHERE scope_kind = 'rule_update_review' AND scope_id = ?`
        )
        .get(review.review.id)
    ).toEqual({ status: "closed" });
  } finally {
    closeProjectDb(retriedDb);
  }
  expect(claimRuleUpdateDecision(projectPath)).toMatchObject({
    ok: true,
    command: { id: firstDecision.command.id, status: "claimed" }
  });
});

test("an Agent can replace a failed accepted revision and return it to designer review", () => {
  const projectPath = createProject();
  const db = openProjectDb(projectPath);
  try {
    db.prepare(
      `INSERT INTO source_artifacts
         (id, path, artifact_type, semantic_purpose, related_record_ids_json,
          readiness, declaration_version, status, created_at, updated_at,
          content_digest)
       VALUES ('source-revision-recovery', 'design-system/interaction-rules.json',
               'interaction-rules.json', 'test', '[]', NULL, 1, 'ingested',
               '2026-08-29T00:00:00.000Z', '2026-08-29T00:00:00.000Z', 'digest-1')`
    ).run();
  } finally {
    closeProjectDb(db);
  }
  const review = createRuleUpdateReview(projectPath, { context: "Revision recovery" });
  if (!review.ok) throw new Error(review.reason);
  const drafted = draftRuleUpdateProposal(projectPath, {
    reviewId: review.review.id,
    kind: "update",
    classification: "proposed_update",
    title: "Original accepted revision",
    fullRuleBody: "Original body that later proves invalid.",
    reason: "reason",
    affectedItems: ["interaction"],
    evidenceRecordIds: [],
    target: {
      category: "foundations.interaction",
      sourceArtifactPath: "design-system/interaction-rules.json"
    }
  });
  if (!drafted.ok) throw new Error(drafted.reason);
  expect(publishRuleUpdateReview(projectPath, review.review.id).ok).toBe(true);
  const accepted = decideRuleUpdateProposal(projectPath, {
    proposalId: drafted.proposal.id,
    decision: "accepted"
  });
  if (!accepted.ok) throw new Error(accepted.reason);
  const claimed = claimRuleUpdateDecision(projectPath);
  if (!claimed.ok || claimed.completed) throw new Error("claim failed");
  expect(
    failRuleUpdateApply(projectPath, {
      commandId: claimed.command.id,
      error: "schema_validation_failed"
    }).ok
  ).toBe(true);

  const revised = reviseRuleUpdateProposal(projectPath, {
    proposalId: drafted.proposal.id,
    title: "Corrected revision",
    fullRuleBody: "Corrected schema-valid body.",
    target: {
      category: drafted.proposal.target.category,
      ...(drafted.proposal.target.sourceCategory === null
        ? {}
        : { sourceCategory: drafted.proposal.target.sourceCategory }),
      ...(drafted.proposal.target.sourceArtifactPath === null
        ? {}
        : { sourceArtifactPath: drafted.proposal.target.sourceArtifactPath }),
      ...(drafted.proposal.target.entryId === null
        ? {}
        : { entryId: drafted.proposal.target.entryId }),
      ...(drafted.proposal.target.proposedTargetPath === null
        ? {}
        : { proposedTargetPath: drafted.proposal.target.proposedTargetPath })
    },
    author: "agent"
  });
  expect(revised).toMatchObject({
    ok: true,
    proposal: {
      id: drafted.proposal.id,
      revision: 2,
      revision_author: "agent",
      status: "pending_review"
    }
  });
  if (!revised.ok) throw new Error(revised.reason);

  const reaccepted = decideRuleUpdateProposal(projectPath, {
    proposalId: revised.proposal.id,
    decision: "accepted"
  });
  expect(reaccepted).toMatchObject({
    ok: true,
    reused: false,
    proposal: { revision: 2, status: "waiting_agent" }
  });
  if (!reaccepted.ok) throw new Error(reaccepted.reason);
  expect(reaccepted.command.id).not.toBe(accepted.command.id);
  expect(claimRuleUpdateDecision(projectPath)).toMatchObject({
    ok: true,
    command: { id: reaccepted.command.id },
    proposal: { revision: 2, revision_author: "agent" }
  });

  const auditDb = openProjectDb(projectPath);
  try {
    expect(
      auditDb
        .prepare("SELECT status FROM agent_commands WHERE id = ?")
        .get(accepted.command.id)
    ).toEqual({ status: "cancelled" });
    expect(
      auditDb
        .prepare(
          `SELECT decision FROM rule_update_designer_decisions
           WHERE proposal_id = ? AND revision = 1`
        )
        .get(drafted.proposal.id)
    ).toEqual({ decision: "accepted" });
  } finally {
    closeProjectDb(auditDb);
  }
});
