import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";

import { initializeProjectDb } from "../../lib/runtime/db";
import { listEvents } from "../../lib/runtime/events";
import { getProjectDbPath } from "../../lib/runtime/paths";
import { recordDesignerFeedback } from "../../lib/runtime/designer-feedback";
import { proposeRuleUpdate } from "../../lib/runtime/rule-update-proposal";
import { INITIAL_DESIGN_SYSTEM_SOURCE_CONTRACT } from "../../lib/runtime/initial-design-system-preparation";
import {
  CLAUDE_MCP_TEXT_BUDGET,
  IKRAN_MCP_INSTRUCTIONS
} from "../../lib/mcp/shared";

function withProject(run: (projectPath: string) => void): void {
  const projectPath = mkdtempSync(path.join(tmpdir(), "ikran-designer-feedback-"));
  try {
    initializeProjectDb(projectPath);
    run(projectPath);
  } finally {
    rmSync(projectPath, { recursive: true, force: true });
  }
}

function insertSeedReference(projectPath: string, id: string): void {
  const db = new DatabaseSync(getProjectDbPath(projectPath));
  try {
    db.prepare(
      `INSERT INTO seed_references
       (id, figma_seed_reference, original_design_intent, created_at,
        registered_via, file_key, node_id)
       VALUES (?, ?, ?, ?, 'agent', ?, ?)`
    ).run(
      id,
      `https://www.figma.com/design/FeedbackSeed/Frame?node-id=1-1`,
      "Seed for feedback linkage",
      "2026-08-06T00:00:00.000Z",
      "FeedbackSeed",
      "1:1"
    );
  } finally {
    db.close();
  }
}

test("recordDesignerFeedback persists the record and designer_feedback_recorded event", () => {
  withProject((projectPath) => {
    insertSeedReference(projectPath, "seed-1");

    const result = recordDesignerFeedback(projectPath, {
      summary: "Keep the sticky bar opaque while scrolling.",
      runId: "run-1",
      sessionId: "session-1",
      seedReferenceId: "seed-1",
      opaqueContext: { selector: "#sticky-nav", host: "cursor-browser" }
    });

    expect(result).toMatchObject({
      ok: true,
      feedback: {
        summary: "Keep the sticky bar opaque while scrolling.",
        run_id: "run-1",
        session_id: "session-1",
        seed_reference_id: "seed-1",
        opaque_context: {
          selector: "#sticky-nav",
          host: "cursor-browser"
        }
      }
    });
    if (!result.ok) return;
    expect(result.feedback.id.length).toBeGreaterThan(0);
    expect(result.event_id).toBeTruthy();

    const db = new DatabaseSync(getProjectDbPath(projectPath));
    try {
      const row = db
        .prepare("SELECT * FROM designer_feedback WHERE id = ?")
        .get(result.feedback.id) as Record<string, unknown>;
      expect(row).toMatchObject({
        summary: "Keep the sticky bar opaque while scrolling.",
        run_id: "run-1",
        session_id: "session-1",
        seed_reference_id: "seed-1"
      });
      expect(JSON.parse(String(row.opaque_context_json))).toEqual({
        selector: "#sticky-nav",
        host: "cursor-browser"
      });
    } finally {
      db.close();
    }

    expect(listEvents(projectPath, "designer_feedback_recorded")).toEqual([
      expect.objectContaining({
        event_id: result.event_id,
        payload: expect.objectContaining({
          feedback_id: result.feedback.id,
          summary: "Keep the sticky bar opaque while scrolling.",
          run_id: "run-1",
          session_id: "session-1"
        })
      })
    ]);
  });
});

test("recordDesignerFeedback rejects forged linkage ids", () => {
  withProject((projectPath) => {
    expect(
      recordDesignerFeedback(projectPath, {
        summary: "Change the card radius.",
        runId: "run-1",
        sessionId: "session-1",
        seedReferenceId: "forged-seed"
      })
    ).toEqual({ ok: false, reason: "linkage_record_not_found" });

    expect(
      recordDesignerFeedback(projectPath, {
        summary: "Change the card radius.",
        runId: "run-1",
        sessionId: "session-1",
        evidenceSurfaceId: "forged-surface"
      })
    ).toEqual({ ok: false, reason: "linkage_record_not_found" });

    expect(
      recordDesignerFeedback(projectPath, {
        summary: "Change the card radius.",
        runId: "run-1",
        sessionId: "session-1",
        regionAnnotationId: "forged-region"
      })
    ).toEqual({ ok: false, reason: "linkage_record_not_found" });

    // `designer_feedback.prototype_surface_id` has no FK (v24 predates the
    // v27 table), so the lookup in designer-feedback.ts is the only guard.
    expect(
      recordDesignerFeedback(projectPath, {
        summary: "Change the card radius.",
        runId: "run-1",
        sessionId: "session-1",
        prototypeSurfaceId: "forged-prototype"
      })
    ).toEqual({ ok: false, reason: "linkage_record_not_found" });

    expect(listEvents(projectPath, "designer_feedback_recorded")).toEqual([]);
  });
});

test("recordDesignerFeedback stores string opaqueContext verbatim", () => {
  withProject((projectPath) => {
    const result = recordDesignerFeedback(projectPath, {
      summary: "Tighten the card gap.",
      runId: "run-3",
      sessionId: "session-3",
      opaqueContext: "#card-grid > .tile:nth-child(2)"
    });
    expect(result).toMatchObject({
      ok: true,
      feedback: {
        opaque_context: "#card-grid > .tile:nth-child(2)"
      }
    });
    if (!result.ok) return;
    const db = new DatabaseSync(getProjectDbPath(projectPath));
    try {
      const row = db
        .prepare(
          "SELECT opaque_context_json FROM designer_feedback WHERE id = ?"
        )
        .get(result.feedback.id) as { opaque_context_json: string };
      expect(row.opaque_context_json).toBe("#card-grid > .tile:nth-child(2)");
    } finally {
      db.close();
    }
  });
});

test("designer_feedback ids are valid propose_rule_update evidence", () => {
  withProject((projectPath) => {
    const feedback = recordDesignerFeedback(projectPath, {
      summary: "Promote sticky opacity into a layout rule.",
      runId: "run-2",
      sessionId: "session-2"
    });
    expect(feedback.ok).toBe(true);
    if (!feedback.ok) return;

    const db = new DatabaseSync(getProjectDbPath(projectPath));
    try {
      db.prepare(
        `INSERT INTO design_system_entries
         (id, source_artifact_path, file_kind, section, entry_id, name,
          value_json, meaning, status, links_json, position, created_at, updated_at)
         VALUES ('rule', 'design-system/layout-rules.json', 'layout-rules.json',
                 'layout', 'layout.rule', 'layout.rule', '"Rule"', 'Rule',
                 'candidate', '[]', 0, ?, ?)`
      ).run("2026-08-06T00:00:00.000Z", "2026-08-06T00:00:00.000Z");
    } finally {
      db.close();
    }

    expect(
      proposeRuleUpdate(projectPath, {
        sourceArtifactPath: "design-system/layout-rules.json",
        entryId: "layout.rule",
        proposedTargetPath: "design-system/components/sticky.json",
        reason: "Feedback concluded this belongs on the sticky component.",
        affectedItems: ["Sticky navigation"],
        evidenceRecordIds: [feedback.feedback.id]
      })
    ).toMatchObject({
      ok: true,
      proposal: {
        evidence_record_ids: [feedback.feedback.id],
        status: "awaiting_confirmation"
      }
    });
  });
});

test("design generation source_contract has no feedback read entry", () => {
  const serialized = JSON.stringify(INITIAL_DESIGN_SYSTEM_SOURCE_CONTRACT);
  expect(serialized).not.toMatch(/designer_feedback/i);
  expect(serialized).not.toMatch(/feedback_record/i);
  expect(serialized).not.toMatch(/list_.*feedback/i);
  expect(INITIAL_DESIGN_SYSTEM_SOURCE_CONTRACT.source_root).toBe("design-system");
});

test("feedback MCP surface is write-only", async () => {
  const { readFileSync } = await import("node:fs");
  const feedbackTools = readFileSync(
    path.join(__dirname, "../../lib/mcp/feedback-tools.ts"),
    "utf8"
  );
  expect(feedbackTools).toContain('registerTool(\n    "record_designer_feedback"');
  expect(feedbackTools).not.toMatch(/list_designer_feedback|get_designer_feedback/);
});

test("MCP instructions require completion-time reconciliation and generation isolation", () => {
  expect(Buffer.byteLength(IKRAN_MCP_INSTRUCTIONS, "utf8")).toBeLessThanOrEqual(
    CLAUDE_MCP_TEXT_BUDGET
  );
  expect(IKRAN_MCP_INSTRUCTIONS).toContain(
    "reconcile_designer_conversation"
  );
  expect(IKRAN_MCP_INSTRUCTIONS).not.toContain(
    "declare conclusions via record_designer_feedback"
  );
  expect(IKRAN_MCP_INSTRUCTIONS.toLowerCase()).toMatch(
    /design-system source only|design-system source/
  );
  expect(IKRAN_MCP_INSTRUCTIONS.toLowerCase()).toMatch(/never feedback|not read.*feedback|never.*feedback/);
});
