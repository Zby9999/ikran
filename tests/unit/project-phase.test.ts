import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";

import { initializeProjectDb } from "../../lib/runtime/db";
import { listEvents } from "../../lib/runtime/events";
import { getProjectDbPath } from "../../lib/runtime/paths";
import { recordDesignerFeedback } from "../../lib/runtime/designer-feedback";
import { subscribeRecordEvents } from "../../lib/runtime/record-bus";
import { recordSourceArtifact } from "../../lib/runtime/source-artifact";
import { sourceContentDigestOf } from "../../lib/runtime/source-artifact-digest";
import { claimConsolidateReview } from "../../lib/runtime/consolidate-review";
import { reconcileDesignerConversation } from "../../lib/runtime/conversation-reconciliation";
import {
  abandonProjectPhase,
  confirmDraftDesignSystem,
  confirmPrototype,
  formalizeDesignSystem,
  getProjectPhase,
  requireProjectPhase
} from "../../lib/runtime/project-phase";

const REVIEW =
  "Reviewed the phase's prototype modifications; no reusable-rule candidates.";

function withProject(run: (projectPath: string) => void): void {
  const projectPath = mkdtempSync(path.join(tmpdir(), "ikran-project-phase-"));
  try {
    initializeProjectDb(projectPath);
    run(projectPath);
  } finally {
    rmSync(projectPath, { recursive: true, force: true });
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

function consumeFeedback(
  projectPath: string,
  feedbackId: string,
  proposalId = "proposal-1"
): void {
  const db = new DatabaseSync(getProjectDbPath(projectPath));
  try {
    db.prepare(
      `INSERT INTO designer_feedback_review_consumption
       (feedback_id, proposal_id, consumed_at)
       VALUES (?, ?, ?)`
    ).run(feedbackId, proposalId, "2026-08-06T12:00:00.000Z");
  } finally {
    db.close();
  }
}

function completeEmptyRuleUpdateReview(
  projectPath: string,
  cycle: string
): void {
  const reviewId = `review-${cycle}`;
  const messageId = `message-${cycle}`;
  expect(
    reconcileDesignerConversation(projectPath, {
      reviewId,
      conversationId: `conversation-${cycle}`,
      runId: `run-${cycle}`,
      sessionId: `session-${cycle}`,
      startMessageId: messageId,
      endMessageId: messageId,
      messages: [
        {
          id: messageId,
          role: "designer",
          content: "Prototype confirmed; no reusable rule changes."
        }
      ],
      decisions: []
    })
  ).toMatchObject({
    ok: true,
    reconciliation: { id: reviewId, decision_count: 0 }
  });
  expect(claimConsolidateReview(projectPath, reviewId)).toMatchObject({
    ok: true,
    reconciliation_id: reviewId
  });
}

function declareLayoutRuleSource(projectPath: string): {
  relativePath: string;
  absolutePath: string;
} {
  const db = new DatabaseSync(getProjectDbPath(projectPath));
  try {
    db.prepare(
      `INSERT INTO alignment_question_cards
       (id, section, observation, question, final_answer, answer_source,
        anchor_json, created_at, updated_at)
       VALUES ('card-formalize-source', 'layout', 'Observed', 'Keep?', 'Yes',
               'designer-edited', '{}', ?, ?)`
    ).run("2026-08-10T00:00:00.000Z", "2026-08-10T00:00:00.000Z");
  } finally {
    db.close();
  }

  const relativePath = "design-system/layout-rules.json";
  const absolutePath = path.join(projectPath, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(
    absolutePath,
    JSON.stringify({
      rules: [
        {
          id: "layout.original",
          value: "Keep the original layout rule.",
          meaning: "Original layout",
          status: "candidate",
          links: ["card-formalize-source"]
        }
      ]
    }),
    "utf8"
  );
  expect(
    recordSourceArtifact(projectPath, {
      path: relativePath,
      artifactType: "layout-rules.json",
      semanticPurpose: "Initial layout rules",
      relatedRecordIds: ["card-formalize-source"]
    }).ok
  ).toBe(true);
  return { relativePath, absolutePath };
}

test("happy path advances seed → draft → prototype → formal → ready_for_new_design", () => {
  withProject((projectPath) => {
    expect(getProjectPhase(projectPath)).toBe("seed");

    // Extraction completion lands the project in draft_design_system.
    setPhase(projectPath, "draft_design_system");

    expect(confirmDraftDesignSystem(projectPath, "I reviewed the Draft; start the Prototype.")).toMatchObject({
      ok: true,
      phase: "prototype_validation"
    });
    expect(confirmPrototype(projectPath)).toMatchObject({
      ok: true,
      phase: "design_system_formal"
    });
    completeEmptyRuleUpdateReview(projectPath, "happy-v1");
    expect(formalizeDesignSystem(projectPath, [], REVIEW)).toMatchObject({
      ok: true,
      phase: "ready_for_new_design"
    });

    expect(getProjectPhase(projectPath)).toBe("ready_for_new_design");
    expect(listEvents(projectPath, "project_phase_confirmed").length).toBe(2);
    expect(listEvents(projectPath, "design_system_formalized")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          phase: "ready_for_new_design"
        })
      })
    ]);
  });
});

test("formalize requires a Rule Update review after Prototype confirmation even when there is no feedback", () => {
  withProject((projectPath) => {
    setPhase(projectPath, "prototype_validation");
    expect(confirmPrototype(projectPath)).toMatchObject({
      ok: true,
      phase: "design_system_formal"
    });

    expect(formalizeDesignSystem(projectPath, [], REVIEW)).toEqual({
      ok: false,
      reason: "rule_update_review_required",
      phase: "design_system_formal"
    });
    expect(listEvents(projectPath, "design_system_formalized")).toEqual([]);
  });
});

test("Prototype confirmation blocks code-linked candidates without a terminal Preview outcome", () => {
  withProject((projectPath) => {
    setPhase(projectPath, "prototype_validation");
    const entryId = insertSpecCandidateEntry(projectPath, "Button", {
      codeLinks: ["prototype/components/Button.tsx"]
    });

    expect(confirmPrototype(projectPath)).toEqual({
      ok: false,
      reason: "component_preview_outcome_required",
      phase: "prototype_validation",
      preview_entry_ids: [entryId]
    });
    expect(getProjectPhase(projectPath)).toBe("prototype_validation");
  });
});

test("formalize blocks code-linked candidates when no Preview registration exists", () => {
  withProject((projectPath) => {
    setPhase(projectPath, "prototype_validation");
    expect(confirmPrototype(projectPath)).toMatchObject({ ok: true });
    completeEmptyRuleUpdateReview(projectPath, "missing-preview-outcome");
    const entryId = insertSpecCandidateEntry(projectPath, "Button", {
      codeLinks: ["prototype/components/Button.tsx"]
    });

    expect(formalizeDesignSystem(projectPath, [], REVIEW)).toEqual({
      ok: false,
      reason: "component_preview_outcome_required",
      phase: "design_system_formal",
      preview_entry_ids: [entryId]
    });
    expect(getProjectPhase(projectPath)).toBe("design_system_formal");
  });
});

test("formalize rejects undeclared Design System drift instead of absorbing an Agent-added rule", () => {
  withProject((projectPath) => {
    const db = new DatabaseSync(getProjectDbPath(projectPath));
    try {
      db.prepare(
        `INSERT INTO alignment_question_cards
         (id, section, observation, question, final_answer, answer_source,
          anchor_json, created_at, updated_at)
         VALUES ('card-rule-review', 'layout', 'Observed', 'Keep?', 'Yes',
                 'designer-edited', '{}', ?, ?)`
      ).run("2026-08-10T00:00:00.000Z", "2026-08-10T00:00:00.000Z");
    } finally {
      db.close();
    }

    const relativePath = "design-system/layout-rules.json";
    const absolutePath = path.join(projectPath, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    const initialRule = {
      id: "layout.original",
      value: "Keep the original layout rule.",
      meaning: "Original layout",
      status: "candidate",
      links: ["card-rule-review"]
    };
    writeFileSync(
      absolutePath,
      JSON.stringify({ rules: [initialRule] }),
      "utf8"
    );
    expect(
      recordSourceArtifact(projectPath, {
        path: relativePath,
        artifactType: "layout-rules.json",
        semanticPurpose: "Initial layout rules",
        relatedRecordIds: ["card-rule-review"]
      }).ok
    ).toBe(true);

    setPhase(projectPath, "prototype_validation");
    expect(confirmPrototype(projectPath)).toMatchObject({ ok: true });
    completeEmptyRuleUpdateReview(projectPath, "undeclared-rule-drift");

    writeFileSync(
      absolutePath,
      JSON.stringify({
        rules: [
          initialRule,
          {
            id: "layout.agent-added",
            value: "An Agent-invented reusable rule.",
            meaning: "Agent-added layout",
            status: "candidate",
            links: ["card-rule-review"]
          }
        ]
      }),
      "utf8"
    );

    expect(formalizeDesignSystem(projectPath, [], REVIEW)).toEqual({
      ok: false,
      reason: "rule_update_proposal_required",
      phase: "design_system_formal",
      changed_artifact_paths: [relativePath]
    });
    expect(getProjectPhase(projectPath)).toBe("design_system_formal");
    expect(listEvents(projectPath, "design_system_formalized")).toEqual([]);
  });
});

test("formalize fails closed when a declared Design System source is missing", () => {
  withProject((projectPath) => {
    const { relativePath, absolutePath } = declareLayoutRuleSource(projectPath);
    setPhase(projectPath, "prototype_validation");
    expect(confirmPrototype(projectPath)).toMatchObject({ ok: true });
    completeEmptyRuleUpdateReview(projectPath, "missing-declared-source");
    rmSync(absolutePath);

    expect(formalizeDesignSystem(projectPath, [], REVIEW)).toEqual({
      ok: false,
      reason: "design_system_source_not_ready",
      phase: "design_system_formal",
      source_warnings: [
        { path: relativePath, reason: "source_file_missing" }
      ]
    });
    expect(getProjectPhase(projectPath)).toBe("design_system_formal");
    expect(listEvents(projectPath, "design_system_formalized")).toEqual([]);
  });
});

test("formalize fails closed when a declared Design System source is invalid", () => {
  withProject((projectPath) => {
    const { relativePath, absolutePath } = declareLayoutRuleSource(projectPath);
    setPhase(projectPath, "prototype_validation");
    expect(confirmPrototype(projectPath)).toMatchObject({ ok: true });
    completeEmptyRuleUpdateReview(projectPath, "invalid-declared-source");
    writeFileSync(absolutePath, "{ not-json", "utf8");

    expect(formalizeDesignSystem(projectPath, [], REVIEW)).toMatchObject({
      ok: false,
      reason: "design_system_source_not_ready",
      phase: "design_system_formal",
      source_warnings: [
        { path: relativePath, reason: "invalid_json" }
      ]
    });
    expect(getProjectPhase(projectPath)).toBe("design_system_formal");
    expect(listEvents(projectPath, "design_system_formalized")).toEqual([]);
  });
});

test("formalize rejects promoted-source drift that lands after the source snapshot", () => {
  withProject((projectPath) => {
    const { absolutePath } = declareLayoutRuleSource(projectPath);
    setPhase(projectPath, "prototype_validation");
    expect(confirmPrototype(projectPath)).toMatchObject({ ok: true });
    completeEmptyRuleUpdateReview(projectPath, "promotion-baseline-race");

    const result = formalizeDesignSystem(
      projectPath,
      ["layout.original"],
      REVIEW,
      {
        afterSourceSnapshot: () => {
          const source = JSON.parse(readFileSync(absolutePath, "utf8")) as {
            rules: Array<Record<string, unknown>>;
          };
          source.rules[0].value = "External drift after the accepted snapshot.";
          writeFileSync(absolutePath, JSON.stringify(source), "utf8");
        }
      }
    );

    expect(result).toMatchObject({
      ok: false,
      reason: "design_system_source_changed_during_formalize",
      phase: "design_system_formal",
      source_issues: [
        {
          path: "design-system/layout-rules.json",
          reason: "source_content_changed"
        }
      ]
    });
    expect(entryStatus(projectPath, "layout.original")).toBe("candidate");
    expect(getProjectPhase(projectPath)).toBe("design_system_formal");
  });
});

test("formalize never overwrites source drift that lands immediately before a promotion write", () => {
  withProject((projectPath) => {
    const { absolutePath } = declareLayoutRuleSource(projectPath);
    setPhase(projectPath, "prototype_validation");
    expect(confirmPrototype(projectPath)).toMatchObject({ ok: true });
    completeEmptyRuleUpdateReview(projectPath, "promotion-prewrite-race");

    const result = formalizeDesignSystem(
      projectPath,
      ["layout.original"],
      REVIEW,
      {
        beforePromotionWrite: () => {
          const source = JSON.parse(readFileSync(absolutePath, "utf8")) as {
            rules: Array<Record<string, unknown>>;
          };
          source.rules[0].meaning = "Host write immediately before promotion.";
          writeFileSync(absolutePath, JSON.stringify(source), "utf8");
        }
      }
    );

    expect(result).toMatchObject({
      ok: false,
      reason: "design_system_source_changed_during_formalize",
      phase: "design_system_formal",
      source_issues: [
        {
          path: "design-system/layout-rules.json",
          reason: "source_content_changed"
        }
      ]
    });
    const preserved = JSON.parse(readFileSync(absolutePath, "utf8")) as {
      rules: Array<{ meaning: string }>;
    };
    expect(preserved.rules[0].meaning).toBe(
      "Host write immediately before promotion."
    );
    expect(entryStatus(projectPath, "layout.original")).toBe("candidate");
    expect(getProjectPhase(projectPath)).toBe("design_system_formal");
  });
});

test("formalize never overwrites a host write that races its final digest check", () => {
  withProject((projectPath) => {
    const { absolutePath } = declareLayoutRuleSource(projectPath);
    setPhase(projectPath, "prototype_validation");
    expect(confirmPrototype(projectPath)).toMatchObject({ ok: true });
    completeEmptyRuleUpdateReview(projectPath, "promotion-final-race");

    const result = formalizeDesignSystem(
      projectPath,
      ["layout.original"],
      REVIEW,
      {
        beforeSourceDigestVerification: () => {
          const source = JSON.parse(readFileSync(absolutePath, "utf8")) as {
            rules: Array<Record<string, unknown>>;
          };
          source.rules[0].meaning = "Newer host write must survive restore.";
          writeFileSync(absolutePath, JSON.stringify(source), "utf8");
        }
      }
    );

    expect(result).toMatchObject({
      ok: false,
      reason: "design_system_source_changed_during_formalize",
      phase: "design_system_formal"
    });
    const preserved = JSON.parse(readFileSync(absolutePath, "utf8")) as {
      rules: Array<{ meaning: string }>;
    };
    expect(preserved.rules[0].meaning).toBe(
      "Newer host write must survive restore."
    );
    expect(entryStatus(projectPath, "layout.original")).toBe("candidate");
    expect(getProjectPhase(projectPath)).toBe("design_system_formal");
  });
});

test("a Rule Update review from before the latest Prototype confirmation cannot satisfy formalize", () => {
  withProject((projectPath) => {
    setPhase(projectPath, "prototype_validation");
    completeEmptyRuleUpdateReview(projectPath, "premature-review");
    expect(confirmPrototype(projectPath)).toMatchObject({
      ok: true,
      phase: "design_system_formal"
    });

    expect(formalizeDesignSystem(projectPath, [], REVIEW)).toEqual({
      ok: false,
      reason: "rule_update_review_required",
      phase: "design_system_formal"
    });
  });
});

test("out-of-order phase declarations are rejected with current phase", () => {
  withProject((projectPath) => {
    expect(confirmDraftDesignSystem(projectPath, "I reviewed the Draft.")).toEqual({
      ok: false,
      reason: "phase_gate",
      phase: "seed"
    });
    expect(confirmPrototype(projectPath)).toEqual({
      ok: false,
      reason: "phase_gate",
      phase: "seed"
    });
    expect(formalizeDesignSystem(projectPath, [], REVIEW)).toEqual({
      ok: false,
      reason: "phase_gate",
      phase: "seed"
    });

    setPhase(projectPath, "draft_design_system");
    expect(formalizeDesignSystem(projectPath, [], REVIEW)).toEqual({
      ok: false,
      reason: "phase_gate",
      phase: "draft_design_system"
    });

    expect(requireProjectPhase(projectPath, "ready_for_new_design")).toEqual({
      ok: false,
      reason: "phase_gate",
      phase: "draft_design_system"
    });
    expect(listEvents(projectPath, "project_phase_confirmed")).toEqual([]);
    expect(listEvents(projectPath, "design_system_formalized")).toEqual([]);
  });
});

test("draft confirmation requires an explicit designer statement and records it", () => {
  withProject((projectPath) => {
    setPhase(projectPath, "draft_design_system");
    expect(confirmDraftDesignSystem(projectPath, "   ")).toEqual({
      ok: false,
      reason: "explicit_designer_confirmation_required"
    });
    expect(getProjectPhase(projectPath)).toBe("draft_design_system");

    const confirmation = "I reviewed the visible Draft and want to start the Prototype.";
    expect(confirmDraftDesignSystem(projectPath, confirmation)).toMatchObject({
      ok: true,
      phase: "prototype_validation"
    });
    expect(listEvents(projectPath, "project_phase_confirmed")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          command: "confirm_draft_design_system",
          designer_confirmation: confirmation
        })
      })
    ]);
  });
});

test("abandon returns to seed from mid-chain phases", () => {
  withProject((projectPath) => {
    setPhase(projectPath, "prototype_validation");
    expect(abandonProjectPhase(projectPath)).toMatchObject({
      ok: true,
      phase: "seed"
    });
    expect(getProjectPhase(projectPath)).toBe("seed");
    expect(listEvents(projectPath, "project_phase_abandoned")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          from_phase: "prototype_validation",
          phase: "seed"
        })
      })
    ]);

    expect(abandonProjectPhase(projectPath)).toEqual({
      ok: false,
      reason: "phase_gate",
      phase: "seed"
    });
  });
});

test("requireProjectPhase gates future record_preview and new-design-run callers", () => {
  withProject((projectPath) => {
    // Issue 30: record_preview requires confirm_draft first.
    expect(
      requireProjectPhase(projectPath, "prototype_validation")
    ).toEqual({ ok: false, reason: "phase_gate", phase: "seed" });

    setPhase(projectPath, "prototype_validation");
    expect(
      requireProjectPhase(projectPath, "prototype_validation")
    ).toEqual({ ok: true, phase: "prototype_validation" });

    // Issue 13: new design run requires formalize first.
    expect(
      requireProjectPhase(projectPath, "ready_for_new_design")
    ).toEqual({
      ok: false,
      reason: "phase_gate",
      phase: "prototype_validation"
    });
  });
});

test("formalize rejects when unreviewed designer_feedback remains", () => {
  withProject((projectPath) => {
    setPhase(projectPath, "prototype_validation");
    const feedback = recordDesignerFeedback(projectPath, {
      summary: "Keep sticky opacity.",
      runId: "run-1",
      sessionId: "session-1"
    });
    expect(feedback.ok).toBe(true);
    if (!feedback.ok) return;
    expect(confirmPrototype(projectPath)).toMatchObject({ ok: true });
    completeEmptyRuleUpdateReview(projectPath, "unreviewed-feedback");

    expect(formalizeDesignSystem(projectPath, [], REVIEW)).toEqual({
      ok: false,
      reason: "unreviewed_feedback",
      phase: "design_system_formal",
      unreviewed_feedback_count: 1
    });
    expect(getProjectPhase(projectPath)).toBe("design_system_formal");

    consumeFeedback(projectPath, feedback.feedback.id);
    expect(formalizeDesignSystem(projectPath, [], REVIEW)).toMatchObject({
      ok: true,
      phase: "ready_for_new_design"
    });
  });
});

function insertCandidateEntry(
  projectPath: string,
  id: string,
  status: "formalized" | "candidate" | "gap" = "candidate"
): void {
  const db = new DatabaseSync(getProjectDbPath(projectPath));
  try {
    db.prepare(
      `INSERT INTO design_system_entries
       (id, source_artifact_path, file_kind, section, entry_id, name,
        value_json, meaning, status, links_json, position, created_at, updated_at)
       VALUES (?, 'design-system/layout-rules.json', 'layout-rules.json',
               'layout', ?, NULL, '"v"', ?, ?, '["card-1"]', 0, ?, ?)`
    ).run(
      id,
      `entry.${id}`,
      `meaning-${id}`,
      status,
      "2026-08-06T00:00:00.000Z",
      "2026-08-06T00:00:00.000Z"
    );
  } finally {
    db.close();
  }
  // The formalize write-back flips status in the source file, so the fixture
  // keeps a real file in step with the DB rows it inserts.
  const absolutePath = path.join(
    projectPath,
    "design-system/layout-rules.json"
  );
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  const json = existsSync(absolutePath)
    ? (JSON.parse(readFileSync(absolutePath, "utf8")) as {
        rules: Array<Record<string, unknown>>;
      })
    : { rules: [] };
  json.rules.push({
    id: `entry.${id}`,
    value: "v",
    meaning: `meaning-${id}`,
    status,
    links: ["card-1"]
  });
  writeFileSync(absolutePath, JSON.stringify(json), "utf8");
  trackDesignSystemFixtureSource(
    projectPath,
    "design-system/layout-rules.json",
    "layout-rules.json"
  );
}

function trackDesignSystemFixtureSource(
  projectPath: string,
  relativePath: string,
  artifactType: string
): void {
  const content = readFileSync(path.join(projectPath, relativePath), "utf8");
  const now = "2026-08-06T00:00:00.000Z";
  const db = new DatabaseSync(getProjectDbPath(projectPath));
  try {
    db.prepare(
      `INSERT INTO source_artifacts
       (id, path, artifact_type, semantic_purpose,
        related_record_ids_json, readiness, declaration_version, status,
        created_at, updated_at, content_digest)
       VALUES (?, ?, ?, 'project-phase fixture', '[]', NULL, 1, 'ingested',
               ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         artifact_type = excluded.artifact_type,
         status = 'ingested',
         updated_at = excluded.updated_at,
         content_digest = excluded.content_digest`
    ).run(
      `fixture-source:${relativePath}`,
      relativePath,
      artifactType,
      now,
      now,
      sourceContentDigestOf(content)
    );
  } finally {
    db.close();
  }
}

/**
 * A component-spec candidate: source file + the DB row its ingest produced
 * (captures live in the source_captures column, stripped from value_json).
 */
function insertSpecCandidateEntry(
  projectPath: string,
  name: string,
  opts: { codeLinks?: string[]; captures?: unknown[] } = {}
): string {
  const entryId = `${name.toLowerCase()}-spec`;
  const rel = `design-system/components/${name.toLowerCase()}.json`;
  const value: Record<string, unknown> = {
    description: `${name} spec.`,
    props: [],
    variants: [],
    stateMatrix: [],
    guidelines: [],
    tokenLinks: [],
    codeLinks: opts.codeLinks ?? []
  };
  if (opts.captures !== undefined) value.sourceCaptures = opts.captures;
  const absolutePath = path.join(projectPath, rel);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(
    absolutePath,
    JSON.stringify({
      id: entryId,
      name,
      meaning: `${name} meaning`,
      status: "candidate",
      links: ["card-1"],
      value
    }),
    "utf8"
  );
  const { sourceCaptures: _stripped, ...dbValue } = value;
  const db = new DatabaseSync(getProjectDbPath(projectPath));
  try {
    db.prepare(
      `INSERT INTO design_system_entries
       (id, source_artifact_path, file_kind, section, entry_id, name,
        value_json, meaning, status, links_json, source_captures_json,
        position, created_at, updated_at)
       VALUES (?, ?, 'component-spec', 'components.spec', ?, ?,
               ?, ?, 'candidate', '["card-1"]', ?, 0, ?, ?)`
    ).run(
      `row-${entryId}`,
      rel,
      entryId,
      name,
      JSON.stringify(dbValue),
      `${name} meaning`,
      JSON.stringify(opts.captures ?? []),
      "2026-08-06T00:00:00.000Z",
      "2026-08-06T00:00:00.000Z"
    );
  } finally {
    db.close();
  }
  trackDesignSystemFixtureSource(projectPath, rel, "component-spec");
  return entryId;
}

function retainPreviewOpenGap(projectPath: string, entryId: string): void {
  const now = "2026-08-06T00:00:00.000Z";
  const db = new DatabaseSync(getProjectDbPath(projectPath));
  try {
    const row = db.prepare(
      `SELECT json_extract(value_json, '$.codeLinks[0]') AS module_path
       FROM design_system_entries WHERE entry_id = ?`
    ).get(entryId) as { module_path: string };
    db.prepare(
      `INSERT INTO component_preview_exceptions
       (id, dedupe_key, run_id, entry_id, module_path, kind, status,
        packet_json, exception_digest, disposition_json,
        disposition_event_id, created_at, updated_at, resolved_at)
       VALUES (?, ?, 'fixture-run', ?, ?,
               'missing_evidence', 'resolved', '{}', 'fixture-digest',
               '{"disposition":"retain_open_gap"}', 'fixture-event', ?, ?, ?)`
    ).run(
      `gap-${entryId}`,
      `gap-key-${entryId}`,
      entryId,
      row.module_path,
      now,
      now,
      now
    );
  } finally {
    db.close();
  }
}

const SPEC_CAPTURE = {
  nodeName: "Button / Primary",
  artifactPath: "design-system/captures/button-primary.png",
  capturedAt: "2026-08-03T12:00:00.000Z"
};

function entryStatus(projectPath: string, id: string): string {
  const db = new DatabaseSync(getProjectDbPath(projectPath));
  try {
    const row = db
      .prepare(
        `SELECT status FROM design_system_entries WHERE id = ? OR entry_id = ?`
      )
      .get(id, id) as { status: string };
    return row.status;
  } finally {
    db.close();
  }
}

test("confirm_prototype re-enters design_system_formal from ready_for_new_design (recursion)", () => {
  withProject((projectPath) => {
    // Walk the full v1 chain first.
    setPhase(projectPath, "draft_design_system");
    confirmDraftDesignSystem(projectPath, "I reviewed the Draft.");
    confirmPrototype(projectPath);
    completeEmptyRuleUpdateReview(projectPath, "recursion-v1");
    expect(formalizeDesignSystem(projectPath, [], REVIEW)).toMatchObject({ ok: true });
    expect(getProjectPhase(projectPath)).toBe("ready_for_new_design");

    // Issue 15 recursion: a new-design-run prototype is confirmed, then the
    // Design System formalizes again (v2) — the phase chain must not dead-end.
    expect(confirmPrototype(projectPath)).toMatchObject({
      ok: true,
      phase: "design_system_formal",
      from_phase: "ready_for_new_design"
    });
    completeEmptyRuleUpdateReview(projectPath, "recursion-v2");
    expect(formalizeDesignSystem(projectPath, [], REVIEW)).toMatchObject({
      ok: true,
      phase: "ready_for_new_design"
    });

    expect(listEvents(projectPath, "design_system_formalized")).toHaveLength(2);
    expect(listEvents(projectPath, "project_phase_confirmed")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            from_phase: "ready_for_new_design",
            phase: "design_system_formal",
            command: "confirm_prototype"
          })
        })
      ])
    );
  });
});

test("formalize adjudicates candidates: listed ids flip to formalized, rest stay candidate", () => {
  withProject((projectPath) => {
    setPhase(projectPath, "prototype_validation");
    insertCandidateEntry(projectPath, "cand-a");
    insertCandidateEntry(projectPath, "cand-b");
    expect(confirmPrototype(projectPath)).toMatchObject({ ok: true });
    completeEmptyRuleUpdateReview(projectPath, "candidate-adjudication");

    const result = formalizeDesignSystem(projectPath, ["cand-a"], REVIEW);
    expect(result).toMatchObject({ ok: true, phase: "ready_for_new_design" });

    expect(entryStatus(projectPath, "cand-a")).toBe("formalized");
    expect(entryStatus(projectPath, "cand-b")).toBe("candidate");
    expect(listEvents(projectPath, "design_system_formalized")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          promoted_entry_ids: ["cand-a"]
        })
      })
    ]);
  });
});

test("phase transitions emit record-bus invalidation events", () => {
  withProject((projectPath) => {
    const events: Array<{ kind: string; action: string; id: string }> = [];
    const unsubscribe = subscribeRecordEvents((event) =>
      events.push({ kind: event.kind, action: event.action, id: event.id })
    );
    try {
      setPhase(projectPath, "prototype_validation");
      expect(confirmPrototype(projectPath)).toMatchObject({ ok: true });
      expect(events).toEqual([
        { kind: "phase", action: "updated", id: "project-phase" }
      ]);
      completeEmptyRuleUpdateReview(projectPath, "record-bus-v1");

      events.length = 0;
      expect(formalizeDesignSystem(projectPath, [], REVIEW)).toMatchObject({ ok: true });
      // No promotions → phase event only, no design-system invalidation.
      expect(events).toEqual([
        { kind: "phase", action: "updated", id: "project-phase" }
      ]);

      // Promotions additionally invalidate the Design System Browser.
      events.length = 0;
      confirmPrototype(projectPath);
      completeEmptyRuleUpdateReview(projectPath, "record-bus-v2");
      insertCandidateEntry(projectPath, "cand-a");
      expect(formalizeDesignSystem(projectPath, ["cand-a"], REVIEW)).toMatchObject({
        ok: true
      });
      expect(events).toEqual([
        { kind: "phase", action: "updated", id: "project-phase" },
        { kind: "phase", action: "updated", id: "project-phase" },
        { kind: "design-system", action: "updated", id: "design-system-entries" }
      ]);

      // Failed transitions emit nothing.
      confirmPrototype(projectPath);
      completeEmptyRuleUpdateReview(projectPath, "record-bus-v3");
      events.length = 0;
      recordDesignerFeedback(projectPath, {
        summary: "block",
        runId: "run-1",
        sessionId: "session-1"
      });
      expect(formalizeDesignSystem(projectPath, [], REVIEW).ok).toBe(false);
      expect(events).toEqual([]);
    } finally {
      unsubscribe();
    }
  });
});

test("formalize rejects unknown or non-candidate promoteEntryIds without side effects", () => {
  withProject((projectPath) => {
    setPhase(projectPath, "prototype_validation");
    insertCandidateEntry(projectPath, "cand-a");
    insertCandidateEntry(projectPath, "formal-x", "formalized");
    expect(confirmPrototype(projectPath)).toMatchObject({ ok: true });
    completeEmptyRuleUpdateReview(projectPath, "invalid-candidate-ids");

    expect(formalizeDesignSystem(projectPath, ["missing"], REVIEW)).toEqual({
      ok: false,
      reason: "candidate_entry_not_found"
    });
    expect(formalizeDesignSystem(projectPath, ["formal-x"], REVIEW)).toEqual({
      ok: false,
      reason: "candidate_entry_not_candidate"
    });

    // Rejections are transactional: nothing flipped, phase unchanged.
    expect(entryStatus(projectPath, "cand-a")).toBe("candidate");
    expect(getProjectPhase(projectPath)).toBe("design_system_formal");
    expect(listEvents(projectPath, "design_system_formalized")).toEqual([]);
  });
});

test("formalize writes promoted statuses back to source files with approval-grade provenance", () => {
  withProject((projectPath) => {
    setPhase(projectPath, "prototype_validation");
    insertCandidateEntry(projectPath, "cand-a");
    insertCandidateEntry(projectPath, "cand-b");
    expect(confirmPrototype(projectPath)).toMatchObject({ ok: true });
    completeEmptyRuleUpdateReview(projectPath, "promotion-writeback");

    expect(formalizeDesignSystem(projectPath, ["cand-a"], REVIEW)).toMatchObject({
      ok: true
    });

    // Source file stays in step with the DB: no file↔DB drift.
    const source = JSON.parse(
      readFileSync(
        path.join(projectPath, "design-system/layout-rules.json"),
        "utf8"
      )
    ) as { rules: Array<{ id: string; status: string }> };
    expect(source.rules.find((rule) => rule.id === "entry.cand-a")?.status).toBe(
      "formalized"
    );
    expect(source.rules.find((rule) => rule.id === "entry.cand-b")?.status).toBe(
      "candidate"
    );

    // Per-entry approval-grade provenance: a later ingest of the written-back
    // file accepts the formalized status.
    const approved = listEvents(projectPath, "design_system_entry_approved");
    expect(approved).toHaveLength(1);
    expect(approved[0].payload).toMatchObject({
      source_artifact_path: "design-system/layout-rules.json",
      entry_id: "entry.cand-a",
      from: "candidate",
      to: "formalized",
      via: "formalize_design_system"
    });
    expect(
      typeof (approved[0].payload as { content_digest?: unknown }).content_digest
    ).toBe("string");
  });
});

test("formalize treats a promoted entry missing from its source as unauthorized drift", () => {
  withProject((projectPath) => {
    setPhase(projectPath, "prototype_validation");
    insertCandidateEntry(projectPath, "cand-a");
    // Source file loses the entry while the DB row stays — drift must stop
    // the promotion instead of being cemented in.
    writeFileSync(
      path.join(projectPath, "design-system/layout-rules.json"),
      JSON.stringify({ rules: [] }),
      "utf8"
    );
    expect(confirmPrototype(projectPath)).toMatchObject({ ok: true });
    completeEmptyRuleUpdateReview(projectPath, "missing-source-entry");

    expect(formalizeDesignSystem(projectPath, ["cand-a"], REVIEW)).toMatchObject({
      ok: false,
      reason: "rule_update_proposal_required",
      changed_artifact_paths: ["design-system/layout-rules.json"]
    });
    expect(entryStatus(projectPath, "cand-a")).toBe("candidate");
    expect(getProjectPhase(projectPath)).toBe("design_system_formal");
    expect(listEvents(projectPath, "design_system_formalized")).toEqual([]);
    expect(listEvents(projectPath, "design_system_entry_approved")).toEqual([]);
  });
});

test("formalize rejects an empty or whitespace-only modification review without side effects", () => {
  withProject((projectPath) => {
    setPhase(projectPath, "prototype_validation");
    expect(confirmPrototype(projectPath)).toMatchObject({ ok: true });
    completeEmptyRuleUpdateReview(projectPath, "empty-modification-review");

    for (const empty of ["", "   ", "\n\t"]) {
      expect(formalizeDesignSystem(projectPath, [], empty)).toEqual({
        ok: false,
        reason: "empty_modification_review"
      });
    }
    expect(getProjectPhase(projectPath)).toBe("design_system_formal");
    expect(listEvents(projectPath, "design_system_formalized")).toEqual([]);
  });
});

test("formalize persists the modification review on the formalized event", () => {
  withProject((projectPath) => {
    setPhase(projectPath, "prototype_validation");
    expect(confirmPrototype(projectPath)).toMatchObject({ ok: true });
    completeEmptyRuleUpdateReview(projectPath, "persisted-modification-review");

    expect(formalizeDesignSystem(projectPath, [], `  ${REVIEW}  `)).toMatchObject(
      { ok: true }
    );
    expect(listEvents(projectPath, "design_system_formalized")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          modification_review: REVIEW
        })
      })
    ]);
  });
});

test("formalize hints at promoted entries that still only have sourceCaptures (Issue 31 soft hint)", () => {
  withProject((projectPath) => {
    setPhase(projectPath, "prototype_validation");
    const captureOnly = insertSpecCandidateEntry(projectPath, "Button", {
      captures: [SPEC_CAPTURE]
    });
    const codeBacked = insertSpecCandidateEntry(projectPath, "Card", {
      codeLinks: ["prototypes/components/Card.tsx"],
      captures: [SPEC_CAPTURE]
    });
    retainPreviewOpenGap(projectPath, codeBacked);
    const noEvidence = insertSpecCandidateEntry(projectPath, "Badge");
    expect(confirmPrototype(projectPath)).toMatchObject({ ok: true });
    completeEmptyRuleUpdateReview(projectPath, "capture-hints");

    const result = formalizeDesignSystem(
      projectPath,
      [captureOnly, codeBacked, noEvidence],
      REVIEW
    );
    expect(result).toMatchObject({ ok: true, phase: "ready_for_new_design" });
    if (!result.ok) return;

    // Soft hint only: the promotion still succeeded; the hint lists the one
    // promoted entry with empty codeLinks that still only has sourceCaptures.
    expect(result.code_backfill_hints).toEqual([
      { entry_id: captureOnly, title: "Button" }
    ]);
  });
});

test("formalize returns no backfill hints when promoted entries have code links or none are promoted", () => {
  withProject((projectPath) => {
    setPhase(projectPath, "prototype_validation");
    const codeBacked = insertSpecCandidateEntry(projectPath, "Card", {
      codeLinks: ["prototypes/components/Card.tsx"]
    });
    retainPreviewOpenGap(projectPath, codeBacked);
    expect(confirmPrototype(projectPath)).toMatchObject({ ok: true });
    completeEmptyRuleUpdateReview(projectPath, "no-backfill-hints-v1");

    const promoted = formalizeDesignSystem(projectPath, [codeBacked], REVIEW);
    expect(promoted).toMatchObject({ ok: true });
    if (promoted.ok) expect(promoted.code_backfill_hints).toEqual([]);

    confirmPrototype(projectPath);
    completeEmptyRuleUpdateReview(projectPath, "no-backfill-hints-v2");
    const unpromoted = formalizeDesignSystem(projectPath, [], REVIEW);
    expect(unpromoted).toMatchObject({ ok: true });
    if (unpromoted.ok) expect(unpromoted.code_backfill_hints).toEqual([]);
  });
});
