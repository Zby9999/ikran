// Semantic event logging.
//
// SQLite `events` is the canonical store. `.ikran/events.jsonl` is an optional
// portable export rebuilt via `exportEventsJsonl` — it is NOT appended on the
// `logEvent` hot path.

import type { DatabaseSync as DatabaseType } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { openProjectDb, closeProjectDb } from "./db";
import { getProjectEventsPath } from "./paths";

export type EventType =
  | "project_created"
  | "folder_selected"
  | "agent_task_started"
  | "agent_task_completed"
  | "agent_task_failed"
  | "seed_reference_registered"
  | "evidence_package_recorded"
  | "figma_evidence_refreshed"
  | "annotation_created"
  | "annotation_primary_confirmed"
  | "annotation_body_updated"
  | "annotation_deleted"
  | "annotation_restored"
  | "question_card_created"
  | "question_card_title_updated"
  | "question_card_anchor_updated"
  | "agent_annotation_updated"
  | "designer_answer_submitted"
  | "alignment_preparation_started"
  | "agent_command_claimed"
  | "alignment_preparation_completed"
  | "alignment_attempt_abandoned"
  | "design_intent_alignment_completed"
  | "design_system_extraction_work_unit_recorded"
  | "design_system_extraction_audit_recorded"
  | "design_system_extraction_coverage_rejected"
  | "initial_design_system_preparation_completed"
  | "initial_design_system_preparation_failed"
  | "seed_extraction_stage_completed"
  | "draft_design_system_generated"
  | "design_system_view_generated"
  | "design_system_entry_approved"
  | "design_system_entry_reverted"
  | "design_system_entry_edited"
  | "source_artifact_declared"
  | "seed_reconstruction_started"
  | "preview_started"
  | "new_prototype_run_created"
  | "rule_update_proposal_created"
  | "rule_update_confirmed"
  | "rule_update_canceled"
  | "designer_feedback_recorded"
  | "consolidate_review_started"
  | "designer_feedback_dismissed"
  | "project_phase_confirmed"
  | "design_system_formalized"
  | "project_phase_abandoned"
  | "export_generated"
  | "invalid_output"
  | "invalid_artifact"
  | "repaired_output";

export interface EventPayload {
  [key: string]: unknown;
}

export interface LoggedEvent {
  event_id: string;
  type: EventType;
  payload: EventPayload;
  created_at: string;
}

function mapEventRow(row: Record<string, unknown>): LoggedEvent {
  const rawPayload = row.payload;
  let payload: EventPayload = {};
  if (typeof rawPayload === "string") {
    try {
      payload = JSON.parse(rawPayload) as EventPayload;
    } catch {
      payload = {};
    }
  } else if (rawPayload && typeof rawPayload === "object") {
    payload = rawPayload as EventPayload;
  }
  return {
    event_id: String(row.event_id),
    type: String(row.type) as EventType,
    payload,
    created_at: String(row.created_at)
  };
}

export function insertEvent(db: DatabaseType, event: LoggedEvent): void {
  const stmt = db.prepare(
    `INSERT INTO events (event_id, type, payload, created_at)
     VALUES (?, ?, ?, ?)`
  );
  stmt.run(event.event_id, event.type, JSON.stringify(event.payload), event.created_at);
}

export function buildLoggedEvent(
  type: EventType,
  payload: EventPayload = {}
): LoggedEvent {
  return {
    event_id: randomUUID(),
    type,
    payload,
    created_at: new Date().toISOString()
  };
}

/** Insert an event on an existing connection (for use inside a transaction). */
export function logEventOnDb(
  db: DatabaseType,
  type: EventType,
  payload: EventPayload = {}
): LoggedEvent {
  const event = buildLoggedEvent(type, payload);
  insertEvent(db, event);
  return event;
}

export function logEvent(
  projectPath: string,
  type: EventType,
  payload: EventPayload = {}
): LoggedEvent {
  const event = buildLoggedEvent(type, payload);
  const db = openProjectDb(projectPath);
  try {
    insertEvent(db, event);
  } finally {
    closeProjectDb(db);
  }
  return event;
}

/**
 * Best-effort audit event for a failed tool call (invalid_output /
 * invalid_artifact). Never masks the structured validation error when audit
 * logging itself fails.
 */
export function logInvalidToolEvent(
  projectPath: string,
  type: EventType,
  tool: string,
  reason: string,
  details?: unknown
): void {
  try {
    const payload: Record<string, unknown> = {
      tool,
      reason
    };
    if (details !== undefined) payload.details = details;
    logEvent(projectPath, type, payload);
  } catch {
    // Best-effort: do not mask the structured validation error if audit fails.
  }
}

/**
 * Rebuild deterministic JSONL from the canonical SQLite events table.
 * Default target is `.ikran/events.jsonl`. Returns the path written.
 */
export function exportEventsJsonl(
  projectPath: string,
  targetPath?: string
): string {
  const outPath = targetPath ?? getProjectEventsPath(projectPath);
  mkdirSync(path.dirname(outPath), { recursive: true });

  const events = listEvents(projectPath);
  const body =
    events.length === 0
      ? ""
      : `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;

  writeFileSync(outPath, body, { encoding: "utf-8" });
  return outPath;
}

export function listEvents(projectPath: string, type?: EventType): LoggedEvent[] {
  const db = openProjectDb(projectPath);
  try {
    const rows = type
      ? (db
          .prepare(
            "SELECT event_id, type, payload, created_at FROM events WHERE type = ? ORDER BY created_at ASC, id ASC"
          )
          .all(type) as Array<Record<string, unknown>>)
      : (db
          .prepare(
            "SELECT event_id, type, payload, created_at FROM events ORDER BY created_at ASC, id ASC"
          )
          .all() as Array<Record<string, unknown>>);
    return rows.map(mapEventRow);
  } finally {
    closeProjectDb(db);
  }
}

/**
 * Select canonical events that may participate in a future successful research
 * package. The canonical event log itself remains a complete audit trail;
 * abandoned Alignment lineage is filtered only at this derived boundary.
 * Issue 15 owns research-package eligibility and file generation.
 */
export function listResearchEligibleEvents(projectPath: string): LoggedEvent[] {
  const db = openProjectDb(projectPath);
  try {
    const abandonedAttemptIds = new Set(
      (db
        .prepare("SELECT id FROM alignment_attempts WHERE status = 'abandoned'")
        .all() as Array<{ id: string }>).map((row) => row.id)
    );
    if (abandonedAttemptIds.size === 0) return listEvents(projectPath);

    const abandonedCardIds = new Set(
      (db
        .prepare(
          `SELECT id FROM alignment_question_cards
           WHERE alignment_attempt_id IN
             (SELECT id FROM alignment_attempts WHERE status = 'abandoned')`
        )
        .all() as Array<{ id: string }>).map((row) => row.id)
    );
    const abandonedCommandIds = new Set(
      (db
        .prepare(
          `SELECT id FROM agent_commands
           WHERE alignment_attempt_id IN
             (SELECT id FROM alignment_attempts WHERE status = 'abandoned')`
        )
        .all() as Array<{ id: string }>).map((row) => row.id)
    );

    return listEvents(projectPath).filter((event) => {
      if (event.type === "alignment_attempt_abandoned") return false;
      const attemptId = event.payload.alignment_attempt_id;
      if (
        typeof attemptId === "string" &&
        abandonedAttemptIds.has(attemptId)
      ) {
        return false;
      }
      const cardId = event.payload.question_card_id;
      if (typeof cardId === "string" && abandonedCardIds.has(cardId)) {
        return false;
      }
      const commandId = event.payload.agent_command_id;
      return !(
        typeof commandId === "string" && abandonedCommandIds.has(commandId)
      );
    });
  } finally {
    closeProjectDb(db);
  }
}
