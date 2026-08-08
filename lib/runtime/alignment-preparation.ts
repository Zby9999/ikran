import { randomUUID } from "node:crypto";
import path from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import {
  closeProjectDb,
  openProjectDb,
  withProjectTransaction
} from "./db";
import { logEventOnDb } from "./events";
import { emitRecordEvent } from "./record-bus";

export type WorkflowStage =
  | "seed-reference-registration"
  | "alignment-preparing"
  | "alignment-answering"
  | "initial-design-system-preparing";

export type AlignmentInputSnapshotData = {
  design_language_description: string;
  seed_references: Array<{
    id: string;
    figma_seed_reference: string;
    file_key: string;
    node_id: string;
    reference_note: string;
    evidence_version: {
      id: string;
      frame_node_id: string;
      frame_name: string;
      created_at: string;
    };
  }>;
};

export type AlignmentInputSnapshotRecord = {
  id: string;
  data: AlignmentInputSnapshotData;
  created_at: string;
};

export type AlignmentAttemptRecord = {
  id: string;
  input_snapshot_id: string;
  status: "preparing" | "answering" | "completed" | "abandoned";
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  abandoned_at: string | null;
};

export type AgentCommandRecord = {
  id: string;
  command_type:
    | "prepare_design_intent_alignment"
    | "prepare_initial_design_system";
  status: "pending" | "claimed" | "completed" | "cancelled" | "failed";
  alignment_attempt_id: string;
  payload: Record<string, unknown>;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
  claimed_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
};

export type ProjectWorkflowRecord = {
  stage: WorkflowStage;
  current_alignment_attempt_id: string | null;
  updated_at: string | null;
};

export type AlignmentPreparationState = {
  workflow: ProjectWorkflowRecord;
  current_attempt: AlignmentAttemptRecord | null;
  input_snapshot: AlignmentInputSnapshotRecord | null;
  commands: AgentCommandRecord[];
};

type PreparationFailureReason =
  | "design_language_description_required"
  | "seed_reference_required"
  | "seed_evidence_required"
  | "alignment_attempt_active"
  | "alignment_completed"
  | "db_error";

type PreparationFailure = { ok: false; reason: PreparationFailureReason };

function mapAttempt(
  row: Record<string, unknown> | undefined
): AlignmentAttemptRecord | null {
  if (!row) return null;
  return {
    id: String(row.id),
    input_snapshot_id: String(row.input_snapshot_id),
    status: String(row.status) as AlignmentAttemptRecord["status"],
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    completed_at:
      typeof row.completed_at === "string" ? row.completed_at : null,
    abandoned_at:
      typeof row.abandoned_at === "string" ? row.abandoned_at : null
  };
}

function mapSnapshot(
  row: Record<string, unknown> | undefined
): AlignmentInputSnapshotRecord | null {
  if (!row) return null;
  return {
    id: String(row.id),
    data: JSON.parse(String(row.snapshot_json)) as AlignmentInputSnapshotData,
    created_at: String(row.created_at)
  };
}

function mapCommand(row: Record<string, unknown>): AgentCommandRecord {
  return {
    id: String(row.id),
    command_type: String(row.command_type) as AgentCommandRecord["command_type"],
    status: String(row.status) as AgentCommandRecord["status"],
    alignment_attempt_id: String(row.alignment_attempt_id),
    payload: JSON.parse(String(row.payload_json)) as Record<string, unknown>,
    idempotency_key: String(row.idempotency_key),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    claimed_at: typeof row.claimed_at === "string" ? row.claimed_at : null,
    completed_at:
      typeof row.completed_at === "string" ? row.completed_at : null,
    cancelled_at:
      typeof row.cancelled_at === "string" ? row.cancelled_at : null
  };
}

export function getAlignmentPreparationOnDb(
  db: DatabaseType
): AlignmentPreparationState {
  const workflowRow = db
    .prepare(
      `SELECT stage, current_alignment_attempt_id, updated_at
       FROM project_workflow WHERE singleton = 1`
    )
    .get() as Record<string, unknown>;
  const workflow: ProjectWorkflowRecord = {
    stage: String(workflowRow.stage) as WorkflowStage,
    current_alignment_attempt_id:
      typeof workflowRow.current_alignment_attempt_id === "string"
        ? workflowRow.current_alignment_attempt_id
        : null,
    updated_at:
      typeof workflowRow.updated_at === "string" ? workflowRow.updated_at : null
  };
  const currentAttemptId = workflow.current_alignment_attempt_id;
  const currentAttempt = currentAttemptId
    ? mapAttempt(
        db
          .prepare("SELECT * FROM alignment_attempts WHERE id = ?")
          .get(currentAttemptId) as Record<string, unknown> | undefined
      )
    : null;
  const inputSnapshot = currentAttempt
    ? mapSnapshot(
        db
          .prepare("SELECT * FROM alignment_input_snapshots WHERE id = ?")
          .get(currentAttempt.input_snapshot_id) as
          | Record<string, unknown>
          | undefined
      )
    : null;
  const commands = currentAttemptId
    ? (
        db
          .prepare(
            `SELECT * FROM agent_commands
             WHERE alignment_attempt_id = ?
             ORDER BY created_at ASC, id ASC`
          )
          .all(currentAttemptId) as Record<string, unknown>[]
      ).map(mapCommand)
    : [];
  return {
    workflow,
    current_attempt: currentAttempt,
    input_snapshot: inputSnapshot,
    commands
  };
}

export function getAlignmentPreparation(
  projectPath: string
): AlignmentPreparationState {
  const db = openProjectDb(projectPath);
  try {
    return getAlignmentPreparationOnDb(db);
  } finally {
    closeProjectDb(db);
  }
}

/**
 * Stages in which a designer Workbench action can still enqueue a durable
 * Agent command: Next phase → prepare_design_intent_alignment, Complete →
 * prepare_initial_design_system. Outside this window no durable command will
 * ever arrive, so re-arming wait_for_agent_command is a guaranteed idle hang.
 */
export const DESIGNER_HANDOFF_STAGES: ReadonlySet<WorkflowStage> = new Set([
  "seed-reference-registration",
  "alignment-preparing",
  "alignment-answering"
]);

export function getProjectWorkflowStage(projectPath: string): WorkflowStage {
  const db = openProjectDb(projectPath);
  try {
    const row = db
      .prepare(`SELECT stage FROM project_workflow WHERE singleton = 1`)
      .get() as { stage: string } | undefined;
    return (row?.stage ?? "seed-reference-registration") as WorkflowStage;
  } finally {
    closeProjectDb(db);
  }
}

function snapshotDataOnDb(
  db: DatabaseType
): AlignmentInputSnapshotData | PreparationFailure {
  const descriptionRow = db
    .prepare(
      `SELECT design_language_description AS value
       FROM project_meta WHERE singleton = 1`
    )
    .get() as { value: string } | undefined;
  const description = descriptionRow?.value?.trim() ?? "";
  if (!description) {
    return { ok: false, reason: "design_language_description_required" };
  }

  const seedRows = db
    .prepare(
      `SELECT s.id, s.figma_seed_reference, s.file_key, s.node_id,
              s.original_design_intent AS reference_note,
              e.id AS evidence_version_id, e.frame_node_id,
              e.frame_name, e.created_at AS evidence_created_at
       FROM seed_references s
       LEFT JOIN figma_evidence_surfaces e ON e.id = s.current_surface_id
       ORDER BY s.created_at ASC, s.id ASC`
    )
    .all() as Array<Record<string, unknown>>;
  if (seedRows.length === 0) {
    return { ok: false, reason: "seed_reference_required" };
  }
  if (seedRows.some((row) => typeof row.evidence_version_id !== "string")) {
    return { ok: false, reason: "seed_evidence_required" };
  }

  return {
    design_language_description: description,
    seed_references: seedRows.map((row) => ({
      id: String(row.id),
      figma_seed_reference: String(row.figma_seed_reference),
      file_key: String(row.file_key),
      node_id: String(row.node_id),
      reference_note: String(row.reference_note ?? ""),
      evidence_version: {
        id: String(row.evidence_version_id),
        frame_node_id: String(row.frame_node_id),
        frame_name: String(row.frame_name),
        created_at: String(row.evidence_created_at)
      }
    }))
  };
}

export type PrepareDesignIntentAlignmentSuccess = {
  ok: true;
  reused: boolean;
  workflow: ProjectWorkflowRecord;
  attempt: AlignmentAttemptRecord;
  input_snapshot: AlignmentInputSnapshotRecord;
  command: AgentCommandRecord;
  event_id: string | null;
};

export function prepareDesignIntentAlignment(
  projectPath: string
): PrepareDesignIntentAlignmentSuccess | PreparationFailure {
  try {
    const result = withProjectTransaction(projectPath, (db) => {
      const current = getAlignmentPreparationOnDb(db);
      if (
        current.workflow.stage === "alignment-preparing" &&
        current.current_attempt?.status === "preparing" &&
        current.input_snapshot &&
        current.commands.length === 1
      ) {
        return {
          ok: true as const,
          reused: true,
          workflow: current.workflow,
          attempt: current.current_attempt,
          input_snapshot: current.input_snapshot,
          command: current.commands[0],
          event_id: null
        };
      }
      if (current.workflow.stage === "initial-design-system-preparing") {
        return { ok: false, reason: "alignment_completed" } as const;
      }
      if (current.workflow.stage !== "seed-reference-registration") {
        return { ok: false, reason: "alignment_attempt_active" } as const;
      }

      const snapshotData = snapshotDataOnDb(db);
      if ("ok" in snapshotData && snapshotData.ok === false) {
        return snapshotData;
      }

      const now = new Date().toISOString();
      const snapshotId = randomUUID();
      const attemptId = randomUUID();
      const commandId = randomUUID();
      const idempotencyKey = `prepare_design_intent_alignment:${attemptId}`;
      db.prepare(
        `INSERT INTO alignment_input_snapshots (id, snapshot_json, created_at)
         VALUES (?, ?, ?)`
      ).run(snapshotId, JSON.stringify(snapshotData), now);
      db.prepare(
        `INSERT INTO alignment_attempts
           (id, input_snapshot_id, status, created_at, updated_at, completed_at, abandoned_at)
         VALUES (?, ?, 'preparing', ?, ?, NULL, NULL)`
      ).run(attemptId, snapshotId, now, now);
      db.prepare(
        `INSERT INTO agent_commands
           (id, command_type, status, alignment_attempt_id, payload_json,
            idempotency_key, created_at, updated_at, claimed_at, completed_at, cancelled_at)
         VALUES (?, 'prepare_design_intent_alignment', 'pending', ?, ?, ?, ?, ?, NULL, NULL, NULL)`
      ).run(
        commandId,
        attemptId,
        JSON.stringify({
          alignment_attempt_id: attemptId,
          input_snapshot_id: snapshotId
        }),
        idempotencyKey,
        now,
        now
      );
      db.prepare(
        `UPDATE project_workflow
         SET stage = 'alignment-preparing',
             current_alignment_attempt_id = ?,
             updated_at = ?
         WHERE singleton = 1`
      ).run(attemptId, now);
      const event = logEventOnDb(db, "alignment_preparation_started", {
        alignment_attempt_id: attemptId,
        input_snapshot_id: snapshotId,
        agent_command_id: commandId
      });
      const created = getAlignmentPreparationOnDb(db);
      return {
        ok: true as const,
        reused: false,
        workflow: created.workflow,
        attempt: created.current_attempt!,
        input_snapshot: created.input_snapshot!,
        command: created.commands[0],
        event_id: event.event_id
      };
    });
    if (result.ok && !result.reused) {
      emitRecordEvent({
        kind: "alignment",
        action: "updated",
        id: result.attempt.id,
        projectPath: path.resolve(projectPath)
      });
    }
    return result;
  } catch {
    return { ok: false, reason: "db_error" };
  }
}
