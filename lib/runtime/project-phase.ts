import type { DatabaseSync as DatabaseType } from "node:sqlite";

import {
  closeProjectDb,
  openProjectDb,
  withProjectTransaction
} from "./db";
import { buildLoggedEvent, insertEvent, logEventOnDb } from "./events";

export const PROJECT_PHASES = [
  "seed",
  "draft_design_system",
  "prototype_validation",
  "design_system_formal",
  "ready_for_new_design"
] as const;

export type ProjectPhase = (typeof PROJECT_PHASES)[number];

export type PhaseGateFailure = {
  ok: false;
  reason: "phase_gate";
  phase: ProjectPhase;
};

export type PhaseCommandSuccess = {
  ok: true;
  phase: ProjectPhase;
  from_phase: ProjectPhase;
  event_id: string;
};

export type FormalizeFailure =
  | PhaseGateFailure
  | {
      ok: false;
      reason: "unreviewed_feedback";
      phase: ProjectPhase;
      unreviewed_feedback_count: number;
    }
  | { ok: false; reason: "db_error" };

export type PhaseCommandResult =
  | PhaseCommandSuccess
  | PhaseGateFailure
  | { ok: false; reason: "db_error" };

const ABANDONABLE: ReadonlySet<ProjectPhase> = new Set([
  "draft_design_system",
  "prototype_validation",
  "design_system_formal"
]);

function isProjectPhase(value: unknown): value is ProjectPhase {
  return (
    typeof value === "string" &&
    (PROJECT_PHASES as readonly string[]).includes(value)
  );
}

export function ensureProjectPhaseRow(db: DatabaseType): void {
  db.prepare(
    `INSERT OR IGNORE INTO project_phase (singleton, phase, updated_at)
     VALUES (1, 'seed', ?)`
  ).run(new Date().toISOString());
}

export function readProjectPhaseOnDb(db: DatabaseType): ProjectPhase {
  ensureProjectPhaseRow(db);
  const row = db
    .prepare(`SELECT phase FROM project_phase WHERE singleton = 1`)
    .get() as { phase: string } | undefined;
  return isProjectPhase(row?.phase) ? row.phase : "seed";
}

export function getProjectPhase(projectPath: string): ProjectPhase {
  const db = openProjectDb(projectPath);
  try {
    return readProjectPhaseOnDb(db);
  } finally {
    closeProjectDb(db);
  }
}

/**
 * Reusable phase gate for Issue 30 / 13 and in-module transitions.
 * Returns the current phase on both success and gate failure.
 */
export function requireProjectPhase(
  projectPath: string,
  allowed: ProjectPhase | readonly ProjectPhase[]
): { ok: true; phase: ProjectPhase } | PhaseGateFailure {
  const phase = getProjectPhase(projectPath);
  const allowedList = Array.isArray(allowed) ? allowed : [allowed];
  if (!allowedList.includes(phase)) {
    return { ok: false, reason: "phase_gate", phase };
  }
  return { ok: true, phase };
}

/**
 * Feedback with no recorded disposition: neither consumed by a confirmed
 * rule-update proposal (Issue 29 confirm path) nor explicitly dismissed.
 * Shared seam between the Consolidate review and the formalize gate.
 */
const UNREVIEWED_FEEDBACK_PREDICATE = `
  NOT EXISTS (
    SELECT 1 FROM designer_feedback_review_consumption c
    WHERE c.feedback_id = f.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM designer_feedback_dismissals d
    WHERE d.feedback_id = f.id
  )
`;

export function listUnreviewedDesignerFeedbackOnDb(
  db: DatabaseType
): string[] {
  return (
    db
      .prepare(
        `SELECT f.id AS id
         FROM designer_feedback f
         WHERE ${UNREVIEWED_FEEDBACK_PREDICATE}
         ORDER BY f.created_at ASC, f.id ASC`
      )
      .all() as Array<{ id: string }>
  ).map((row) => row.id);
}

export function countUnreviewedDesignerFeedbackOnDb(
  db: DatabaseType
): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM designer_feedback f
       WHERE ${UNREVIEWED_FEEDBACK_PREDICATE}`
    )
    .get() as { count: number };
  return Number(row.count);
}

export function listUnreviewedDesignerFeedback(
  projectPath: string
): string[] {
  const db = openProjectDb(projectPath);
  try {
    return listUnreviewedDesignerFeedbackOnDb(db);
  } finally {
    closeProjectDb(db);
  }
}

export function countUnreviewedDesignerFeedback(projectPath: string): number {
  const db = openProjectDb(projectPath);
  try {
    return countUnreviewedDesignerFeedbackOnDb(db);
  } finally {
    closeProjectDb(db);
  }
}

/**
 * Advance seed → draft_design_system after successful Initial Design System
 * extraction. No-op when already past seed. Used inside finalize transactions.
 */
export function advanceToDraftDesignSystemOnDb(db: DatabaseType): void {
  ensureProjectPhaseRow(db);
  const current = readProjectPhaseOnDb(db);
  if (current !== "seed") return;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE project_phase SET phase = ?, updated_at = ? WHERE singleton = 1`
  ).run("draft_design_system", now);
  logEventOnDb(db, "project_phase_confirmed", {
    from_phase: "seed",
    phase: "draft_design_system",
    command: "initial_design_system_preparation_completed"
  });
}

function transitionPhase(
  projectPath: string,
  from: ProjectPhase,
  to: ProjectPhase,
  eventType: "project_phase_confirmed" | "design_system_formalized" | "project_phase_abandoned",
  command: string
): PhaseCommandResult {
  try {
    const transaction = withProjectTransaction(projectPath, (db) => {
      const current = readProjectPhaseOnDb(db);
      if (current !== from) {
        return {
          ok: false as const,
          reason: "phase_gate" as const,
          phase: current
        };
      }
      const now = new Date().toISOString();
      db.prepare(
        `UPDATE project_phase SET phase = ?, updated_at = ? WHERE singleton = 1`
      ).run(to, now);
      const event = buildLoggedEvent(eventType, {
        from_phase: from,
        phase: to,
        command
      });
      insertEvent(db, event);
      return { ok: true as const, event };
    });
    if (!transaction.ok) return transaction;
    return {
      ok: true,
      phase: to,
      from_phase: from,
      event_id: transaction.event.event_id
    };
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

export function confirmDraftDesignSystem(
  projectPath: string
): PhaseCommandResult {
  return transitionPhase(
    projectPath,
    "draft_design_system",
    "prototype_validation",
    "project_phase_confirmed",
    "confirm_draft_design_system"
  );
}

export function confirmPrototype(projectPath: string): PhaseCommandResult {
  return transitionPhase(
    projectPath,
    "prototype_validation",
    "design_system_formal",
    "project_phase_confirmed",
    "confirm_prototype"
  );
}

export function formalizeDesignSystem(
  projectPath: string
): PhaseCommandSuccess | FormalizeFailure {
  try {
    const transaction = withProjectTransaction(projectPath, (db) => {
      const current = readProjectPhaseOnDb(db);
      if (current !== "design_system_formal") {
        return {
          ok: false as const,
          reason: "phase_gate" as const,
          phase: current
        };
      }
      const unreviewed = countUnreviewedDesignerFeedbackOnDb(db);
      if (unreviewed > 0) {
        return {
          ok: false as const,
          reason: "unreviewed_feedback" as const,
          phase: current,
          unreviewed_feedback_count: unreviewed
        };
      }
      const now = new Date().toISOString();
      db.prepare(
        `UPDATE project_phase SET phase = ?, updated_at = ? WHERE singleton = 1`
      ).run("ready_for_new_design", now);
      const event = buildLoggedEvent("design_system_formalized", {
        from_phase: "design_system_formal",
        phase: "ready_for_new_design",
        command: "formalize_design_system"
      });
      insertEvent(db, event);
      return { ok: true as const, event };
    });
    if (!transaction.ok) return transaction;
    return {
      ok: true,
      phase: "ready_for_new_design",
      from_phase: "design_system_formal",
      event_id: transaction.event.event_id
    };
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

export function abandonProjectPhase(
  projectPath: string
): PhaseCommandResult {
  try {
    const transaction = withProjectTransaction(projectPath, (db) => {
      const current = readProjectPhaseOnDb(db);
      if (!ABANDONABLE.has(current)) {
        return {
          ok: false as const,
          reason: "phase_gate" as const,
          phase: current
        };
      }
      const now = new Date().toISOString();
      db.prepare(
        `UPDATE project_phase SET phase = ?, updated_at = ? WHERE singleton = 1`
      ).run("seed", now);
      const event = buildLoggedEvent("project_phase_abandoned", {
        from_phase: current,
        phase: "seed",
        command: "abandon_project_phase"
      });
      insertEvent(db, event);
      return { ok: true as const, event, from_phase: current };
    });
    if (!transaction.ok) return transaction;
    return {
      ok: true,
      phase: "seed",
      from_phase: transaction.from_phase,
      event_id: transaction.event.event_id
    };
  } catch {
    return { ok: false, reason: "db_error" };
  }
}
