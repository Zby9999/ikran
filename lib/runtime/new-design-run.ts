// Issue 13 — human-intent new design run (mechanism only).
//
// A new design run is declared only after Design System formalization
// (`ready_for_new_design`). The payload Runtime returns to the Agent is the
// generation context contract: intent + design-system source (version explicit,
// Formalized hard / Candidate soft). Feedback, events, and annotations are
// never included.

import { randomUUID } from "node:crypto";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { withProjectTransaction } from "./db";
import { buildLoggedEvent, insertEvent, logEventOnDb } from "./events";
import { requireProjectPhase } from "./project-phase";
import { designSystemVersionOnDb } from "./prototype-surface";

export const NEW_DESIGN_RUN_KIND = "new_design" as const;
export const SEED_RECONSTRUCTION_RUN_KIND = "seed_reconstruction" as const;

export type PrototypeRunKind =
  | typeof NEW_DESIGN_RUN_KIND
  | typeof SEED_RECONSTRUCTION_RUN_KIND;

export interface NewDesignRunContextEntry {
  id: string;
  entry_id: string;
  section: string;
  name: string | null;
  meaning: string;
  value: unknown;
  status: "formalized" | "candidate" | "gap";
  source_artifact_path: string;
  /** Hard reference when formalized; soft when candidate. Gaps are informational. */
  reference_priority: "hard" | "soft" | "gap";
}

export interface NewDesignRunContext {
  intent: string;
  design_system_version: string;
  priority_contract: {
    formalized: "hard_reference";
    candidate: "soft_reference";
    conflict_rule: "formalized_wins_and_must_be_marked";
  };
  entries: NewDesignRunContextEntry[];
  /** Explicitly empty so callers cannot mistake omission for "look elsewhere". */
  excluded: {
    designer_feedback: false;
    events: false;
    annotations: false;
    prior_conversation: false;
  };
}

export interface RecordNewDesignRunInput {
  runId: string;
  intent: string;
  usedCandidateIds?: string[];
}

export type RecordNewDesignRunResult =
  | {
      ok: true;
      run: {
        id: string;
        run_id: string;
        kind: typeof NEW_DESIGN_RUN_KIND;
        intent: string;
        design_system_version: string;
        used_candidate_ids: string[];
        created_at: string;
      };
      context: NewDesignRunContext;
      event_id: string;
    }
  | {
      ok: false;
      reason:
        | "phase_gate"
        | "invalid_run"
        | "run_already_exists"
        | "candidate_entry_not_found"
        | "candidate_entry_not_candidate"
        | "db_error";
      phase?: string;
    };

/**
 * Validate that each id exists in design_system_entries with status=candidate.
 * Shared by run declaration and artifact declaration.
 */
export function validateUsedCandidateIdsOnDb(
  db: DatabaseType,
  usedCandidateIds: readonly string[]
):
  | { ok: true; ids: string[] }
  | {
      ok: false;
      reason: "candidate_entry_not_found" | "candidate_entry_not_candidate";
    } {
  const ids = [
    ...new Set(
      usedCandidateIds
        .map((id) => id.trim())
        .filter((id) => id.length > 0)
    )
  ];
  for (const id of ids) {
    const row = db
      .prepare(
        `SELECT status FROM design_system_entries WHERE id = ? OR entry_id = ?`
      )
      .get(id, id) as { status: string } | undefined;
    if (!row) {
      return { ok: false, reason: "candidate_entry_not_found" };
    }
    if (row.status !== "candidate") {
      return { ok: false, reason: "candidate_entry_not_candidate" };
    }
  }
  return { ok: true, ids };
}

export function buildNewDesignRunContextOnDb(
  db: DatabaseType,
  intent: string
): NewDesignRunContext {
  const rows = db
    .prepare(
      `SELECT id, entry_id, section, name, meaning, value_json, status,
              source_artifact_path
       FROM design_system_entries
       ORDER BY source_artifact_path ASC, position ASC, entry_id ASC`
    )
    .all() as Array<{
    id: string;
    entry_id: string;
    section: string;
    name: string | null;
    meaning: string;
    value_json: string;
    status: string;
    source_artifact_path: string;
  }>;

  const entries: NewDesignRunContextEntry[] = rows.map((row) => {
    const status =
      row.status === "formalized" || row.status === "candidate"
        ? row.status
        : "gap";
    let value: unknown = row.value_json;
    try {
      value = JSON.parse(row.value_json);
    } catch {
      // Keep raw text when value_json is not JSON.
    }
    return {
      id: row.id,
      entry_id: row.entry_id,
      section: row.section,
      name: row.name,
      meaning: row.meaning,
      value,
      status,
      source_artifact_path: row.source_artifact_path,
      reference_priority:
        status === "formalized" ? "hard" : status === "candidate" ? "soft" : "gap"
    };
  });

  return {
    intent,
    design_system_version: designSystemVersionOnDb(db),
    priority_contract: {
      formalized: "hard_reference",
      candidate: "soft_reference",
      conflict_rule: "formalized_wins_and_must_be_marked"
    },
    entries,
    excluded: {
      designer_feedback: false,
      events: false,
      annotations: false,
      prior_conversation: false
    }
  };
}

/**
 * Declare a human-intent new design run. Rejects unless the project is in
 * `ready_for_new_design`. Returns the generation context packet (intent + DS).
 */
export function recordNewDesignRun(
  projectPath: string,
  input: RecordNewDesignRunInput
): RecordNewDesignRunResult {
  const runId = input.runId.trim();
  const intent = input.intent.trim();
  if (runId.length === 0 || intent.length === 0) {
    return { ok: false, reason: "invalid_run" };
  }

  const gate = requireProjectPhase(projectPath, "ready_for_new_design");
  if (!gate.ok) {
    return { ok: false, reason: "phase_gate", phase: gate.phase };
  }

  const usedCandidateIds = input.usedCandidateIds ?? [];

  try {
    const transaction = withProjectTransaction(projectPath, (db) => {
      const existing = db
        .prepare(`SELECT 1 FROM prototype_runs WHERE run_id = ?`)
        .get(runId);
      if (existing) {
        return { ok: false as const, reason: "run_already_exists" as const };
      }

      const candidates = validateUsedCandidateIdsOnDb(db, usedCandidateIds);
      if (!candidates.ok) return candidates;

      const now = new Date().toISOString();
      const id = randomUUID();
      const designSystemVersion = designSystemVersionOnDb(db);
      db.prepare(
        `INSERT INTO prototype_runs (
           id, run_id, source_artifact_path, prototype_root, dev_command,
           seed_reference_ids_json, evidence_version_ids_json,
           design_system_version, created_at, updated_at,
           kind, intent, used_candidate_ids_json
         ) VALUES (?, ?, '', '', '', '[]', '[]', ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        runId,
        designSystemVersion,
        now,
        now,
        NEW_DESIGN_RUN_KIND,
        intent,
        JSON.stringify(candidates.ids)
      );

      if (candidates.ids.length > 0) {
        logEventOnDb(db, "candidate_dependency_declared", {
          run_id: runId,
          used_candidate_ids: candidates.ids,
          source: "record_new_design_run"
        });
      }

      const event = buildLoggedEvent("new_prototype_run_created", {
        run_id: runId,
        kind: NEW_DESIGN_RUN_KIND,
        intent,
        design_system_version: designSystemVersion,
        used_candidate_ids: candidates.ids
      });
      insertEvent(db, event);

      const context = buildNewDesignRunContextOnDb(db, intent);
      return {
        ok: true as const,
        run: {
          id,
          run_id: runId,
          kind: NEW_DESIGN_RUN_KIND,
          intent,
          design_system_version: designSystemVersion,
          used_candidate_ids: candidates.ids,
          created_at: now
        },
        context,
        event
      };
    });

    if (!transaction.ok) return transaction;
    return {
      ok: true,
      run: transaction.run,
      context: transaction.context,
      event_id: transaction.event.event_id
    };
  } catch {
    return { ok: false, reason: "db_error" };
  }
}
