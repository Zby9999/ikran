// Semantic event logging.
//
// Events are durably recorded in two places:
// - SQLite `events` table for fast querying/indexing.
// - `.ikran/events.jsonl` for portable research export.
//
// Event types mirror the PRD's semantic event model. Low-level UI noise such as
// canvas pan/zoom/keystrokes is intentionally not logged here.

import type { Database as DatabaseType } from "better-sqlite3";
import { appendFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { openProjectDb, closeProjectDb } from "./db";
import { getProjectEventsPath, getIkranDir } from "./paths";

export type EventType =
  | "project_created"
  | "folder_selected"
  | "agent_task_started"
  | "agent_task_completed"
  | "agent_task_failed"
  | "seed_evidence_import_started"
  | "figma_evidence_package_returned"
  | "real_agent_seed_evidence_smoke_recorded"
  | "annotation_created"
  | "question_card_created"
  | "designer_answer_submitted"
  | "seed_extraction_stage_completed"
  | "draft_design_system_generated"
  | "design_system_view_generated"
  | "seed_reconstruction_started"
  | "preview_started"
  | "new_prototype_run_created"
  | "rule_update_proposal_created"
  | "rule_update_confirmed"
  | "rule_update_canceled"
  | "export_generated"
  | "invalid_output"
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

export function logEvent(
  projectPath: string,
  type: EventType,
  payload: EventPayload = {}
): LoggedEvent {
  const event: LoggedEvent = {
    event_id: randomUUID(),
    type,
    payload,
    created_at: new Date().toISOString()
  };

  mkdirSync(getIkranDir(projectPath), { recursive: true });

  // SQLite
  const db = openProjectDb(projectPath);
  try {
    insertEvent(db, event);
  } finally {
    closeProjectDb(db);
  }

  // JSONL
  appendFileSync(getProjectEventsPath(projectPath), `${JSON.stringify(event)}\n`, {
    encoding: "utf-8"
  });

  return event;
}

function insertEvent(db: DatabaseType, event: LoggedEvent): void {
  const stmt = db.prepare(
    `INSERT INTO events (event_id, type, payload, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(event_id) DO NOTHING`
  );
  stmt.run(event.event_id, event.type, JSON.stringify(event.payload), event.created_at);
}

export function listEvents(projectPath: string, type?: EventType): LoggedEvent[] {
  const db = openProjectDb(projectPath);
  try {
    if (type) {
      return db
        .prepare("SELECT * FROM events WHERE type = ? ORDER BY created_at ASC")
        .all(type) as LoggedEvent[];
    }
    return db
      .prepare("SELECT * FROM events ORDER BY created_at ASC")
      .all() as LoggedEvent[];
  } finally {
    closeProjectDb(db);
  }
}
