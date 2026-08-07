import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";

import { initializeProjectDb } from "../../lib/runtime/db";
import { listEvents } from "../../lib/runtime/events";
import { getProjectDbPath } from "../../lib/runtime/paths";
import {
  buildNewDesignRunContextOnDb,
  recordNewDesignRun
} from "../../lib/runtime/new-design-run";
import { openProjectDb, closeProjectDb } from "../../lib/runtime/db";
import { claimInitialDesignSystemPreparation } from "../../lib/runtime/initial-design-system-preparation";
import { INITIAL_DESIGN_SYSTEM_SOURCE_CONTRACT } from "../../lib/runtime/initial-design-system-preparation";

function withProject(run: (projectPath: string) => void): void {
  const projectPath = mkdtempSync(path.join(tmpdir(), "ikran-new-design-run-"));
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

function insertSeedReference(projectPath: string, id = "seed-1"): void {
  const db = new DatabaseSync(getProjectDbPath(projectPath));
  try {
    db.prepare(
      `INSERT INTO seed_references
       (id, figma_seed_reference, original_design_intent, created_at,
        registered_via, file_key, node_id)
       VALUES (?, ?, '', ?, 'agent', ?, ?)`
    ).run(
      id,
      `https://www.figma.com/design/AbCdEf/X?node-id=1-2`,
      "2026-08-06T00:00:00.000Z",
      "AbCdEf",
      "1:2"
    );
  } finally {
    db.close();
  }
}

function insertEntry(
  projectPath: string,
  row: {
    id: string;
    entryId: string;
    status: "formalized" | "candidate" | "gap";
    meaning?: string;
  }
): void {
  const db = new DatabaseSync(getProjectDbPath(projectPath));
  try {
    db.prepare(
      `INSERT INTO design_system_entries
       (id, source_artifact_path, file_kind, section, entry_id, name,
        value_json, meaning, status, links_json, position, created_at, updated_at)
       VALUES (?, 'design-system/layout-rules.json', 'layout-rules.json',
               'layout', ?, ?, ?, ?, ?, '[]', 0, ?, ?)`
    ).run(
      row.id,
      row.entryId,
      row.entryId,
      JSON.stringify("value"),
      row.meaning ?? row.entryId,
      row.status,
      "2026-08-06T00:00:00.000Z",
      "2026-08-06T00:00:00.000Z"
    );
  } finally {
    db.close();
  }
}

test("recordNewDesignRun rejects outside ready_for_new_design", () => {
  withProject((projectPath) => {
    setPhase(projectPath, "prototype_validation");
    expect(
      recordNewDesignRun(projectPath, {
        runId: "run-new-1",
        intent: "A quieter product page"
      })
    ).toMatchObject({ ok: false, reason: "phase_gate", phase: "prototype_validation" });
  });
});

test("recordNewDesignRun rejects with no_seed_reference when no Seed Reference exists", () => {
  withProject((projectPath) => {
    setPhase(projectPath, "ready_for_new_design");
    expect(
      recordNewDesignRun(projectPath, {
        runId: "run-new-1",
        intent: "A quieter product page"
      })
    ).toEqual({
      ok: false,
      reason: "no_seed_reference",
      phase: "ready_for_new_design"
    });
  });
});

test("recordNewDesignRun persists run, context packet, and event", () => {
  withProject((projectPath) => {
    setPhase(projectPath, "ready_for_new_design");
    insertSeedReference(projectPath);
    insertEntry(projectPath, {
      id: "formal-1",
      entryId: "layout.formal",
      status: "formalized"
    });
    insertEntry(projectPath, {
      id: "cand-1",
      entryId: "layout.cand",
      status: "candidate"
    });

    const result = recordNewDesignRun(projectPath, {
      runId: "run-new-1",
      intent: "A quieter product page",
      usedCandidateIds: ["cand-1"]
    });

    expect(result).toMatchObject({
      ok: true,
      run: {
        run_id: "run-new-1",
        kind: "new_design",
        intent: "A quieter product page",
        used_candidate_ids: ["cand-1"]
      }
    });
    if (!result.ok) return;

    expect(result.context.intent).toBe("A quieter product page");
    expect(result.context.design_system_version).toBeTruthy();
    expect(result.context.priority_contract).toEqual({
      formalized: "hard_reference",
      candidate: "soft_reference",
      conflict_rule: "formalized_wins_and_must_be_marked"
    });
    expect(result.context.excluded).toEqual({
      designer_feedback: false,
      events: false,
      annotations: false,
      prior_conversation: false
    });
    expect(result.context.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "formal-1",
          status: "formalized",
          reference_priority: "hard"
        }),
        expect.objectContaining({
          id: "cand-1",
          status: "candidate",
          reference_priority: "soft"
        })
      ])
    );
    // Isolation: context must not grow feedback/event/annotation bags.
    expect(Object.keys(result.context).sort()).toEqual([
      "design_system_version",
      "entries",
      "excluded",
      "intent",
      "priority_contract"
    ]);

    const db = new DatabaseSync(getProjectDbPath(projectPath));
    try {
      const row = db
        .prepare(`SELECT * FROM prototype_runs WHERE run_id = ?`)
        .get("run-new-1") as Record<string, unknown>;
      expect(row).toMatchObject({
        kind: "new_design",
        intent: "A quieter product page"
      });
      expect(JSON.parse(String(row.used_candidate_ids_json))).toEqual(["cand-1"]);
    } finally {
      db.close();
    }

    expect(listEvents(projectPath, "new_prototype_run_created")).toEqual([
      expect.objectContaining({
        event_id: result.event_id,
        payload: expect.objectContaining({
          run_id: "run-new-1",
          kind: "new_design",
          intent: "A quieter product page"
        })
      })
    ]);
    expect(listEvents(projectPath, "candidate_dependency_declared")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          used_candidate_ids: ["cand-1"],
          source: "record_new_design_run"
        })
      })
    ]);
  });
});

test("recordNewDesignRun rejects forged or non-candidate usedCandidateIds", () => {
  withProject((projectPath) => {
    setPhase(projectPath, "ready_for_new_design");
    insertSeedReference(projectPath);
    insertEntry(projectPath, {
      id: "formal-1",
      entryId: "layout.formal",
      status: "formalized"
    });

    expect(
      recordNewDesignRun(projectPath, {
        runId: "run-a",
        intent: "Intent",
        usedCandidateIds: ["missing"]
      })
    ).toEqual({ ok: false, reason: "candidate_entry_not_found" });

    expect(
      recordNewDesignRun(projectPath, {
        runId: "run-b",
        intent: "Intent",
        usedCandidateIds: ["formal-1"]
      })
    ).toEqual({ ok: false, reason: "candidate_entry_not_candidate" });
  });
});

test("buildNewDesignRunContextOnDb never surfaces feedback or annotation payloads", () => {
  withProject((projectPath) => {
    const db = openProjectDb(projectPath);
    try {
      const context = buildNewDesignRunContextOnDb(db, "intent");
      expect(context).not.toHaveProperty("designer_feedback");
      expect(context).not.toHaveProperty("annotations");
      expect(context).not.toHaveProperty("events");
      expect(context.excluded).toEqual({
        designer_feedback: false,
        events: false,
        annotations: false,
        prior_conversation: false
      });
    } finally {
      closeProjectDb(db);
    }
  });
});

test("extraction source_contract stays free of feedback library entry points", () => {
  // Issue 27/13 regression: generation/extraction contracts must not point at
  // the feedback library. Consolidate is the only read path.
  const serialized = JSON.stringify(INITIAL_DESIGN_SYSTEM_SOURCE_CONTRACT);
  expect(serialized).not.toContain("designer_feedback");
  expect(serialized).not.toContain("claim_consolidate_review");
  expect(serialized).not.toContain("record_designer_feedback");
  // claimInitialDesignSystemPreparation is a separate path; keep the export
  // imported so dead-code elimination cannot drop the module under test.
  expect(typeof claimInitialDesignSystemPreparation).toBe("function");
});
