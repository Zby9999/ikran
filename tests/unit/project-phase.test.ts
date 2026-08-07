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
}

function entryStatus(projectPath: string, id: string): string {
  const db = new DatabaseSync(getProjectDbPath(projectPath));
  try {
    const row = db
      .prepare(`SELECT status FROM design_system_entries WHERE id = ?`)
      .get(id) as { status: string };
    return row.status;
  } finally {
    db.close();
  }
}

test("confirm_prototype re-enters design_system_formal from ready_for_new_design (recursion)", () => {
  withProject((projectPath) => {
    // Walk the full v1 chain first.
    setPhase(projectPath, "draft_design_system");
    confirmDraftDesignSystem(projectPath);
    confirmPrototype(projectPath);
    expect(formalizeDesignSystem(projectPath)).toMatchObject({ ok: true });
    expect(getProjectPhase(projectPath)).toBe("ready_for_new_design");

    // Issue 15 recursion: a new-design-run prototype is confirmed, then the
    // Design System formalizes again (v2) — the phase chain must not dead-end.
    expect(confirmPrototype(projectPath)).toMatchObject({
      ok: true,
      phase: "design_system_formal",
      from_phase: "ready_for_new_design"
    });
    expect(formalizeDesignSystem(projectPath)).toMatchObject({
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
    setPhase(projectPath, "design_system_formal");
    insertCandidateEntry(projectPath, "cand-a");
    insertCandidateEntry(projectPath, "cand-b");

    const result = formalizeDesignSystem(projectPath, ["cand-a"]);
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

      events.length = 0;
      expect(formalizeDesignSystem(projectPath)).toMatchObject({ ok: true });
      // No promotions → phase event only, no design-system invalidation.
      expect(events).toEqual([
        { kind: "phase", action: "updated", id: "project-phase" }
      ]);

      // Promotions additionally invalidate the Design System Browser.
      events.length = 0;
      confirmPrototype(projectPath);
      insertCandidateEntry(projectPath, "cand-a");
      expect(formalizeDesignSystem(projectPath, ["cand-a"])).toMatchObject({
        ok: true
      });
      expect(events).toEqual([
        { kind: "phase", action: "updated", id: "project-phase" },
        { kind: "phase", action: "updated", id: "project-phase" },
        { kind: "design-system", action: "updated", id: "design-system-entries" }
      ]);

      // Failed transitions emit nothing.
      events.length = 0;
      setPhase(projectPath, "design_system_formal");
      recordDesignerFeedback(projectPath, {
        summary: "block",
        runId: "run-1",
        sessionId: "session-1"
      });
      expect(formalizeDesignSystem(projectPath).ok).toBe(false);
      expect(events).toEqual([]);
    } finally {
      unsubscribe();
    }
  });
});

test("formalize rejects unknown or non-candidate promoteEntryIds without side effects", () => {
  withProject((projectPath) => {
    setPhase(projectPath, "design_system_formal");
    insertCandidateEntry(projectPath, "cand-a");
    insertCandidateEntry(projectPath, "formal-x", "formalized");

    expect(formalizeDesignSystem(projectPath, ["missing"])).toEqual({
      ok: false,
      reason: "candidate_entry_not_found"
    });
    expect(formalizeDesignSystem(projectPath, ["formal-x"])).toEqual({
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
    setPhase(projectPath, "design_system_formal");
    insertCandidateEntry(projectPath, "cand-a");
    insertCandidateEntry(projectPath, "cand-b");

    expect(formalizeDesignSystem(projectPath, ["cand-a"])).toMatchObject({
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

test("formalize fails closed when a promoted entry is missing from its source file", () => {
  withProject((projectPath) => {
    setPhase(projectPath, "design_system_formal");
    insertCandidateEntry(projectPath, "cand-a");
    // Source file loses the entry while the DB row stays — drift must stop
    // the promotion instead of being cemented in.
    writeFileSync(
      path.join(projectPath, "design-system/layout-rules.json"),
      JSON.stringify({ rules: [] }),
      "utf8"
    );

    expect(formalizeDesignSystem(projectPath, ["cand-a"])).toMatchObject({
      ok: false,
      reason: "entry_not_in_source_file"
    });
    expect(entryStatus(projectPath, "cand-a")).toBe("candidate");
    expect(getProjectPhase(projectPath)).toBe("design_system_formal");
    expect(listEvents(projectPath, "design_system_formalized")).toEqual([]);
    expect(listEvents(projectPath, "design_system_entry_approved")).toEqual([]);
  });
});
