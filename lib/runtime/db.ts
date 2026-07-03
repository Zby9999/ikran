// SQLite state + indexing for a single Ikran project.
//
// Each project has its own `.ikran/ikran.db` file. A fresh connection is opened
// per call so the Runtime behaves correctly when the project folder (and its
// database file) is recreated between runs — for example by tests or by a user
// resetting a project.

import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
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

CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
`;

export function openProjectDb(projectPath: string): DatabaseType {
  const resolved = getProjectDbPath(projectPath);
  mkdirSync(getIkranDir(projectPath), { recursive: true });

  const db = new Database(resolved);
  db.exec(SCHEMA);
  db.pragma("journal_mode = WAL");
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
// binding) so we never leak a better-sqlite3 handle by forgetting to close it.
export function initializeProjectDb(projectPath: string): void {
  const db = openProjectDb(projectPath);
  try {
    // Schema and WAL are applied inside openProjectDb; nothing else to do here.
  } finally {
    closeProjectDb(db);
  }
}
