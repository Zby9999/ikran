// SQLite state + indexing for a single Ikran project.
//
// Uses Node's built-in `node:sqlite` (`DatabaseSync`) — no native addon, so
// no ABI dependency on the host's Node version. `node:sqlite` is built into
// Node 22.5+ (unflagged since 22.13); the previous `better-sqlite3` native
// module caused `ERR_DLOPEN_FAILED` 500s when the MCP host (Cursor/Codex)
// spawned Ikran under a different Node than the one that installed the addon.
//
//
// Each project has its own `.ikran/ikran.db` file. A fresh connection is opened
// per call so the Runtime behaves correctly when the project folder (and its
// database file) is recreated between runs — for example by tests or by a user
// resetting a project.

import { DatabaseSync } from "node:sqlite";
import type { DatabaseSync as DatabaseType } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { getIkranDir, getProjectDbPath } from "./paths";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,          -- UUID (randomUUID)
  family        TEXT NOT NULL,             -- TaskFamily whitelist value
  payload_json  TEXT NOT NULL,             -- JSON.stringified TaskPayload
  status        TEXT NOT NULL,             -- 'running' | 'done' | 'failed'
  result_json   TEXT,                      -- JSON.stringified validated output (done only)
  error_code    TEXT,                      -- 'timeout' | 'invalid_output' | 'abandoned' | 'adapter_error' (failed only)
  error_message TEXT,
  created_at    TEXT NOT NULL,             -- ISO 8601
  updated_at    TEXT NOT NULL              -- ISO 8601
);

CREATE TABLE IF NOT EXISTS seed_references (
  id TEXT PRIMARY KEY,                  -- UUID (randomUUID)
  figma_seed_reference TEXT NOT NULL,    -- original Figma URL, stored verbatim
  original_design_intent TEXT NOT NULL,  -- designer's original design intent
  created_at TEXT NOT NULL               -- ISO 8601
);

CREATE TABLE IF NOT EXISTS figma_evidence_surfaces (
  id TEXT PRIMARY KEY,
  seed_reference_id TEXT,
  figma_seed_reference TEXT NOT NULL,
  frame_node_id TEXT NOT NULL,
  frame_name TEXT NOT NULL,
  frame_bounds_json TEXT,
  evidence_views_json TEXT NOT NULL,
  screenshot_artifact_path TEXT,
  screenshot_data_url TEXT,
  design_signals_json TEXT,
  surface_bounds_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_family ON tasks(family);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
CREATE INDEX IF NOT EXISTS idx_seed_references_created_at ON seed_references(created_at);
CREATE INDEX IF NOT EXISTS idx_figma_evidence_surfaces_created_at ON figma_evidence_surfaces(created_at);
`;

export function openProjectDb(projectPath: string): DatabaseType {
  const resolved = getProjectDbPath(projectPath);
  mkdirSync(getIkranDir(projectPath), { recursive: true });

  const db = new DatabaseSync(resolved);
  db.exec(SCHEMA);
  db.exec("PRAGMA journal_mode = WAL");
  return db;
}

export function closeProjectDb(db: DatabaseType): void {
  try {
    db.close();
  } catch {
    // ignore close errors
  }
}

// Ensure a project's SQLite database exists with the current schema, then close
// the connection immediately. Use this for one-shot initialization (e.g. project
// binding) so we never leak a SQLite handle by forgetting to close it.
export function initializeProjectDb(projectPath: string): void {
  const db = openProjectDb(projectPath);
  try {
    // Schema and WAL are applied inside openProjectDb; nothing else to do here.
  } finally {
    closeProjectDb(db);
  }
}
