import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";

import { initializeProjectDb } from "../../lib/runtime/db";
import { listEvents } from "../../lib/runtime/events";
import { getProjectDbPath } from "../../lib/runtime/paths";
import { recordDesignerFeedback } from "../../lib/runtime/designer-feedback";
import {
  abandonProjectPhase,
  confirmDraftDesignSystem,
  confirmPrototype,
  formalizeDesignSystem,
  getProjectPhase,
  requireProjectPhase
} from "../../lib/runtime/project-phase";

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

test("happy path advances seed → draft → prototype → formal → ready_for_new_design", () => {
  withProject((projectPath) => {
    expect(getProjectPhase(projectPath)).toBe("seed");

    // Extraction completion lands the project in draft_design_system.
    setPhase(projectPath, "draft_design_system");

    expect(confirmDraftDesignSystem(projectPath)).toMatchObject({
      ok: true,
      phase: "prototype_validation"
    });
    expect(confirmPrototype(projectPath)).toMatchObject({
      ok: true,
      phase: "design_system_formal"
    });
    expect(formalizeDesignSystem(projectPath)).toMatchObject({
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

test("out-of-order phase declarations are rejected with current phase", () => {
  withProject((projectPath) => {
    expect(confirmDraftDesignSystem(projectPath)).toEqual({
      ok: false,
      reason: "phase_gate",
      phase: "seed"
    });
    expect(confirmPrototype(projectPath)).toEqual({
      ok: false,
      reason: "phase_gate",
      phase: "seed"
    });
    expect(formalizeDesignSystem(projectPath)).toEqual({
      ok: false,
      reason: "phase_gate",
      phase: "seed"
    });

    setPhase(projectPath, "draft_design_system");
    expect(formalizeDesignSystem(projectPath)).toEqual({
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
    setPhase(projectPath, "design_system_formal");
    const feedback = recordDesignerFeedback(projectPath, {
      summary: "Keep sticky opacity.",
      runId: "run-1",
      sessionId: "session-1"
    });
    expect(feedback.ok).toBe(true);
    if (!feedback.ok) return;

    expect(formalizeDesignSystem(projectPath)).toEqual({
      ok: false,
      reason: "unreviewed_feedback",
      phase: "design_system_formal",
      unreviewed_feedback_count: 1
    });
    expect(getProjectPhase(projectPath)).toBe("design_system_formal");

    consumeFeedback(projectPath, feedback.feedback.id);
    expect(formalizeDesignSystem(projectPath)).toMatchObject({
      ok: true,
      phase: "ready_for_new_design"
    });
  });
});
