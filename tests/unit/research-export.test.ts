import {
  existsSync,
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
import { logEvent, listEvents } from "../../lib/runtime/events";
import {
  NEW_DESIGN_RUN_KIND,
  recordNewDesignRun
} from "../../lib/runtime/new-design-run";
import { recordDesignerFeedback } from "../../lib/runtime/designer-feedback";
import { claimConsolidateReview } from "../../lib/runtime/consolidate-review";
import { reconcileDesignerConversation } from "../../lib/runtime/conversation-reconciliation";
import {
  confirmDraftDesignSystem,
  confirmPrototype,
  formalizeDesignSystem
} from "../../lib/runtime/project-phase";
import { getExportDir, getProjectDbPath } from "../../lib/runtime/paths";
import {
  evaluateResearchExportEligibility,
  exportResearchPackage,
  RESEARCH_EXPORT_FILES
} from "../../lib/runtime/research-export";
import { IKRAN_MCP_INSTRUCTIONS } from "../../lib/mcp/shared";

function withProject(run: (projectPath: string) => void): void {
  const projectPath = mkdtempSync(path.join(tmpdir(), "ikran-research-export-"));
  try {
    initializeProjectDb(projectPath);
    writeFileSync(
      path.join(projectPath, ".ikran", "config.json"),
      JSON.stringify(
        {
          path: projectPath,
          name: path.basename(projectPath),
          created_at: "2026-08-06T00:00:00.000Z",
          updated_at: "2026-08-06T00:00:00.000Z"
        },
        null,
        2
      )
    );
    run(projectPath);
  } finally {
    rmSync(projectPath, { recursive: true, force: true });
  }
}

function insertSeed(projectPath: string, id: string): void {
  const db = new DatabaseSync(getProjectDbPath(projectPath));
  try {
    db.prepare(
      `INSERT INTO seed_references
       (id, figma_seed_reference, original_design_intent, created_at,
        registered_via, file_key, node_id)
       VALUES (?, ?, ?, ?, 'agent', ?, ?)`
    ).run(
      id,
      `https://www.figma.com/design/ExportSeed/Frame?node-id=1-1`,
      "Seed for export",
      "2026-08-06T00:00:00.000Z",
      "ExportSeed",
      "1:1"
    );
  } finally {
    db.close();
  }
}

function insertAnsweredQuestion(
  projectPath: string,
  id: string,
  opts: { finalAnswer?: string | null; attemptId?: string | null } = {}
): void {
  const db = new DatabaseSync(getProjectDbPath(projectPath));
  try {
    db.prepare(
      `INSERT INTO alignment_question_cards
       (id, section, observation, question, proposed_answer, final_answer,
        answer_source, anchor_json, created_at, updated_at, alignment_attempt_id)
       VALUES (?, 'design-principle', 'obs', 'q?', 'proposed', ?,
               'designer-edited', '{}', ?, ?, ?)`
    ).run(
      id,
      opts.finalAnswer === undefined ? "Final answer" : opts.finalAnswer,
      "2026-08-06T00:01:00.000Z",
      "2026-08-06T00:02:00.000Z",
      opts.attemptId ?? null
    );
  } finally {
    db.close();
  }
}

function insertArtifact(
  projectPath: string,
  id: string,
  artifactPath: string
): void {
  const db = new DatabaseSync(getProjectDbPath(projectPath));
  try {
    const now = "2026-08-06T00:03:00.000Z";
    db.prepare(
      `INSERT INTO source_artifacts
       (id, path, artifact_type, semantic_purpose, related_record_ids_json,
        readiness, declaration_version, status, created_at, updated_at)
       VALUES (?, ?, 'prototype', 'demo', '[]', NULL, 1, 'declared', ?, ?)`
    ).run(id, artifactPath, now, now);
  } finally {
    db.close();
  }
}

function insertFeedback(projectPath: string, id: string, runId: string): void {
  const db = new DatabaseSync(getProjectDbPath(projectPath));
  try {
    db.prepare(
      `INSERT INTO designer_feedback
       (id, summary, run_id, session_id, created_at)
       VALUES (?, ?, ?, 'session-1', ?)`
    ).run(id, `Feedback ${id}`, runId, "2026-08-06T00:04:00.000Z");
  } finally {
    db.close();
  }
}

function insertProposal(
  projectPath: string,
  opts: {
    id: string;
    status: "awaiting_confirmation" | "confirmed" | "canceled";
    classification?: string;
    evidenceIds?: string[];
  }
): void {
  const db = new DatabaseSync(getProjectDbPath(projectPath));
  try {
    db.prepare(
      `INSERT INTO rule_update_proposals
       (id, kind, classification, title, change_description, reason,
        affected_items_json, evidence_record_ids_json, status,
        created_at, decided_at)
       VALUES (?, 'update', ?, 'Title', 'Change', 'Reason',
               '["item"]', ?, ?, ?, ?)`
    ).run(
      opts.id,
      opts.classification ?? "proposed_update",
      JSON.stringify(opts.evidenceIds ?? []),
      opts.status,
      "2026-08-06T00:05:00.000Z",
      opts.status === "awaiting_confirmation"
        ? null
        : "2026-08-06T00:06:00.000Z"
    );
  } finally {
    db.close();
  }
}

function insertPrototypeRun(
  projectPath: string,
  opts: { id: string; runId: string; kind: string; intent?: string }
): void {
  const db = new DatabaseSync(getProjectDbPath(projectPath));
  try {
    const now = "2026-08-06T00:07:00.000Z";
    db.prepare(
      `INSERT INTO prototype_runs
       (id, run_id, source_artifact_path, prototype_root, dev_command,
        seed_reference_ids_json, evidence_version_ids_json,
        design_system_version, created_at, updated_at,
        kind, intent, used_candidate_ids_json)
       VALUES (?, ?, 'proto/App.tsx', '', 'npm run dev', '[]', '[]',
               'ds-v1', ?, ?, ?, ?, '[]')`
    ).run(
      opts.id,
      opts.runId,
      now,
      now,
      opts.kind,
      opts.intent ?? null
    );
  } finally {
    db.close();
  }
}

/** Minimal event sequence that satisfies the Issue 15 eligibility gate. */
function seedEligibleEventSequence(projectPath: string): void {
  logEvent(projectPath, "project_created", { name: "export-demo" });
  logEvent(projectPath, "seed_reference_registered", {
    seed_reference_id: "seed-1"
  });
  logEvent(projectPath, "design_system_formalized", {
    phase: "ready_for_new_design",
    version: "v1"
  });
  logEvent(projectPath, "new_prototype_run_created", {
    run_id: "run-1",
    kind: NEW_DESIGN_RUN_KIND,
    intent: "First new design"
  });
  logEvent(projectPath, "designer_feedback_recorded", {
    feedback_id: "fb-1",
    run_id: "run-1"
  });
  logEvent(projectPath, "rule_update_confirmed", {
    proposal_id: "prop-confirmed",
    classification: "proposed_update",
    status: "confirmed"
  });
  logEvent(projectPath, "design_system_formalized", {
    phase: "ready_for_new_design",
    version: "v2"
  });
  logEvent(projectPath, "new_prototype_run_created", {
    run_id: "run-2",
    kind: NEW_DESIGN_RUN_KIND,
    intent: "Second new design"
  });
}

test("eligibility rejects incomplete recursion and accepts the full sequence", () => {
  withProject((projectPath) => {
    expect(evaluateResearchExportEligibility(projectPath)).toMatchObject({
      eligible: false,
      missing: expect.arrayContaining(["design_system_v1"])
    });

    logEvent(projectPath, "design_system_formalized", { version: "v1" });
    expect(evaluateResearchExportEligibility(projectPath).missing).toContain(
      "first_new_design_run"
    );

    logEvent(projectPath, "new_prototype_run_created", {
      run_id: "run-1",
      kind: NEW_DESIGN_RUN_KIND
    });
    expect(evaluateResearchExportEligibility(projectPath).missing).toContain(
      "feedback_or_confirmed_rule_update"
    );

    logEvent(projectPath, "designer_feedback_recorded", {
      feedback_id: "fb-1"
    });
    expect(evaluateResearchExportEligibility(projectPath).missing).toContain(
      "design_system_v2"
    );

    logEvent(projectPath, "design_system_formalized", { version: "v2" });
    expect(evaluateResearchExportEligibility(projectPath).missing).toContain(
      "second_new_design_run"
    );

    logEvent(projectPath, "new_prototype_run_created", {
      run_id: "run-2",
      kind: NEW_DESIGN_RUN_KIND
    });
    expect(evaluateResearchExportEligibility(projectPath)).toMatchObject({
      eligible: true,
      missing: []
    });
  });
});

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

function consumeFeedback(projectPath: string, feedbackId: string): void {
  const db = new DatabaseSync(getProjectDbPath(projectPath));
  try {
    db.prepare(
      `INSERT INTO designer_feedback_review_consumption
       (feedback_id, proposal_id, consumed_at)
       VALUES (?, 'proposal-1', ?)`
    ).run(feedbackId, "2026-08-06T12:00:00.000Z");
  } finally {
    db.close();
  }
}

function insertSeedReference(projectPath: string): void {
  const db = new DatabaseSync(getProjectDbPath(projectPath));
  try {
    db.prepare(
      `INSERT INTO seed_references
       (id, figma_seed_reference, original_design_intent, created_at,
        registered_via, file_key, node_id)
       VALUES ('seed-1', 'https://www.figma.com/design/AbCdEf/X?node-id=1-2',
               '', '2026-08-06T00:00:00.000Z', 'agent', 'AbCdEf', '1:2')`
    ).run();
  } finally {
    db.close();
  }
}

function completeRuleUpdateReview(
  projectPath: string,
  reviewId: string
): void {
  const messageId = `${reviewId}-message`;
  expect(
    reconcileDesignerConversation(projectPath, {
      reviewId,
      conversationId: `${reviewId}-conversation`,
      runId: `${reviewId}-run`,
      sessionId: `${reviewId}-session`,
      startMessageId: messageId,
      endMessageId: messageId,
      messages: [
        {
          id: messageId,
          role: "designer",
          content: "Prototype confirmed; start the Rule Update review."
        }
      ],
      decisions: []
    })
  ).toMatchObject({
    ok: true,
    reconciliation: { id: reviewId }
  });
  expect(claimConsolidateReview(projectPath, reviewId)).toMatchObject({
    ok: true,
    reconciliation_id: reviewId
  });
}

test("the real command chain reaches eligibility without forged events", () => {
  withProject((projectPath) => {
    // Seed reconstruction prerequisite: a new design run requires a Seed.
    insertSeedReference(projectPath);
    // v1: draft → prototype validation → formal → formalized.
    setPhase(projectPath, "draft_design_system");
    expect(confirmDraftDesignSystem(projectPath)).toMatchObject({ ok: true });
    expect(confirmPrototype(projectPath)).toMatchObject({ ok: true });
    completeRuleUpdateReview(projectPath, "export-review-v1");
    expect(formalizeDesignSystem(projectPath, [], "reviewed")).toMatchObject({
      ok: true
    });
    expect(evaluateResearchExportEligibility(projectPath).missing).toContain(
      "first_new_design_run"
    );

    // First new design run + designer feedback on it.
    const run1 = recordNewDesignRun(projectPath, {
      runId: "run-1",
      intent: "First new design"
    });
    expect(run1).toMatchObject({ ok: true });
    const feedback = recordDesignerFeedback(projectPath, {
      summary: "Tighten the hero spacing.",
      runId: "run-1",
      sessionId: "session-1"
    });
    expect(feedback.ok).toBe(true);
    if (!feedback.ok) return;
    consumeFeedback(projectPath, feedback.feedback.id);

    // v2: confirm the new-design prototype (re-entry from
    // ready_for_new_design), then formalize again.
    expect(confirmPrototype(projectPath)).toMatchObject({
      ok: true,
      from_phase: "ready_for_new_design"
    });
    completeRuleUpdateReview(projectPath, "export-review-v2");
    expect(formalizeDesignSystem(projectPath, [], "reviewed")).toMatchObject({
      ok: true
    });
    expect(evaluateResearchExportEligibility(projectPath).missing).toEqual([
      "second_new_design_run"
    ]);

    // Second new design run completes the recursion.
    const run2 = recordNewDesignRun(projectPath, {
      runId: "run-2",
      intent: "Second new design"
    });
    expect(run2).toMatchObject({ ok: true });
    expect(evaluateResearchExportEligibility(projectPath)).toMatchObject({
      eligible: true,
      missing: []
    });
  });
});

test("exportResearchPackage rejects ineligible projects without writing files", () => {
  withProject((projectPath) => {
    const result = exportResearchPackage(projectPath);
    expect(result).toMatchObject({
      ok: false,
      reason: "research_export_ineligible"
    });
    expect(existsSync(getExportDir(projectPath))).toBe(false);
    expect(listEvents(projectPath, "export_generated")).toHaveLength(0);
  });
});

test("eligible export writes the package, keeps early stages, and guards undeclared artifacts", () => {
  withProject((projectPath) => {
    insertSeed(projectPath, "seed-1");
    insertAnsweredQuestion(projectPath, "q-answered");
    insertAnsweredQuestion(projectPath, "q-draft", { finalAnswer: null });
    insertFeedback(projectPath, "fb-1", "run-1");
    insertFeedback(projectPath, "fb-unreviewed", "run-1");
    insertProposal(projectPath, {
      id: "prop-confirmed",
      status: "confirmed",
      evidenceIds: ["fb-1"]
    });
    insertProposal(projectPath, {
      id: "prop-canceled",
      status: "canceled"
    });
    insertProposal(projectPath, {
      id: "prop-open-gap",
      status: "confirmed",
      classification: "open_gap"
    });
    insertProposal(projectPath, {
      id: "prop-draft",
      status: "awaiting_confirmation"
    });
    insertArtifact(projectPath, "art-1", "proto/App.tsx");
    insertPrototypeRun(projectPath, {
      id: "pr-1",
      runId: "run-1",
      kind: NEW_DESIGN_RUN_KIND,
      intent: "First new design"
    });
    insertPrototypeRun(projectPath, {
      id: "pr-2",
      runId: "run-2",
      kind: NEW_DESIGN_RUN_KIND,
      intent: "Second new design"
    });

    // Undeclared file on disk — must never enter artifacts-index.
    mkdirSync(path.join(projectPath, "proto"), { recursive: true });
    writeFileSync(
      path.join(projectPath, "proto", "Undeclared.tsx"),
      "export default function Undeclared() { return null }"
    );

    seedEligibleEventSequence(projectPath);
    logEvent(projectPath, "invalid_output", { tool: "x", reason: "bad" });
    logEvent(projectPath, "rule_update_canceled", {
      proposal_id: "prop-canceled",
      status: "canceled"
    });
    logEvent(projectPath, "rule_update_proposal_created", {
      proposal_id: "prop-open-gap",
      classification: "open_gap",
      status: "confirmed"
    });
    logEvent(projectPath, "preview_failed", { reason: "install_failed" });

    const result = exportResearchPackage(projectPath);
    expect(result).toMatchObject({
      ok: true,
      files: [...RESEARCH_EXPORT_FILES]
    });
    if (!result.ok) return;

    const exportDir = getExportDir(projectPath);
    for (const file of RESEARCH_EXPORT_FILES) {
      expect(existsSync(path.join(exportDir, file))).toBe(true);
    }

    const events = readFileSync(path.join(exportDir, "events.jsonl"), "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; payload: Record<string, unknown> });

    // Whole successful chain includes early stages, not just the endpoint.
    expect(events.some((e) => e.type === "project_created")).toBe(true);
    expect(events.some((e) => e.type === "seed_reference_registered")).toBe(
      true
    );
    expect(
      events.filter((e) => e.type === "design_system_formalized")
    ).toHaveLength(2);
    expect(events.some((e) => e.type === "export_generated")).toBe(true);

    // Failures / cancels / Open Gap stay out of research facts.
    expect(events.some((e) => e.type === "invalid_output")).toBe(false);
    expect(events.some((e) => e.type === "rule_update_canceled")).toBe(false);
    expect(events.some((e) => e.type === "preview_failed")).toBe(false);
    expect(
      events.some(
        (e) =>
          e.payload.proposal_id === "prop-open-gap" ||
          e.payload.classification === "open_gap"
      )
    ).toBe(false);

    const questions = JSON.parse(
      readFileSync(path.join(exportDir, "alignment-questions.json"), "utf-8")
    ) as Array<{ id: string }>;
    expect(questions.map((q) => q.id)).toEqual(["q-answered"]);

    const answers = JSON.parse(
      readFileSync(path.join(exportDir, "designer-answers.json"), "utf-8")
    ) as Array<{ question_card_id: string }>;
    expect(answers.map((a) => a.question_card_id)).toEqual(["q-answered"]);

    const proposals = JSON.parse(
      readFileSync(
        path.join(exportDir, "rule-update-proposals.json"),
        "utf-8"
      )
    ) as Array<{ proposal_id: string; evidence_record_ids: string[] }>;
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      proposal_id: "prop-confirmed",
      evidence_record_ids: ["fb-1"]
    });

    const feedback = JSON.parse(
      readFileSync(path.join(exportDir, "designer-feedback.json"), "utf-8")
    ) as Array<{ id: string }>;
    // Raw log includes unreviewed feedback; proposals reference a subset.
    expect(feedback.map((f) => f.id).sort()).toEqual([
      "fb-1",
      "fb-unreviewed"
    ]);

    const artifacts = JSON.parse(
      readFileSync(path.join(exportDir, "artifacts-index.json"), "utf-8")
    ) as Array<{ path: string }>;
    expect(artifacts.map((a) => a.path)).toEqual(["proto/App.tsx"]);
    expect(
      artifacts.some((a) => a.path.includes("Undeclared"))
    ).toBe(false);

    const runs = JSON.parse(
      readFileSync(path.join(exportDir, "prototype-runs.json"), "utf-8")
    ) as Array<{ run_id: string; kind: string }>;
    expect(runs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          run_id: "run-1",
          kind: NEW_DESIGN_RUN_KIND
        }),
        expect.objectContaining({
          run_id: "run-2",
          kind: NEW_DESIGN_RUN_KIND
        })
      ])
    );

    const summary = JSON.parse(
      readFileSync(path.join(exportDir, "project-summary.json"), "utf-8")
    ) as {
      seed_references: Array<{ id: string; file_key: string }>;
      design_system_formalize_count: number;
    };
    expect(summary.seed_references).toEqual([
      expect.objectContaining({ id: "seed-1", file_key: "ExportSeed" })
    ]);
    expect(summary.design_system_formalize_count).toBe(2);

    expect(listEvents(projectPath, "export_generated")).toEqual([
      expect.objectContaining({ event_id: result.event_id })
    ]);
  });
});

test("MCP instructions mention export_research within the resident budget", () => {
  expect(IKRAN_MCP_INSTRUCTIONS).toContain("export_research");
  expect(Buffer.byteLength(IKRAN_MCP_INSTRUCTIONS, "utf8")).toBeLessThanOrEqual(
    2150
  );
});
