// SQLite state + indexing for a single Ikran project.
//
// Uses Node's built-in `node:sqlite` (`DatabaseSync`) — no native addon, so
// no ABI dependency on the host's Node version. `node:sqlite` is built into
// Node 22.5+ (unflagged since 22.13); the previous `better-sqlite3` native
// module caused `ERR_DLOPEN_FAILED` 500s when the MCP host (Cursor/Codex)
// spawned Ikran under a different Node than the one that installed the addon.
//
// Each project has its own `.ikran/ikran.db` file. A fresh connection is opened
// per call so the Runtime behaves correctly when the project folder (and its
// database file) is recreated between runs — for example by tests or by a user
// resetting a project.
//
// Schema evolution uses `PRAGMA user_version` (see `./migrations`). Existing
// DBs without a version are treated as v0. Before applying migrations to an
// existing non-empty DB, a deterministic `{ikran.db}.v{fromVersion}.bak`
// snapshot is created (fail-closed on same-version conflict or I/O failure).
// Brand-new DBs are not backed up.

import { DatabaseSync } from "node:sqlite";
import type { DatabaseSync as DatabaseType } from "node:sqlite";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { getIkranDir, getProjectDbPath } from "./paths";
import {
  CURRENT_SCHEMA_VERSION,
  applyPendingMigrations,
  getUserVersion
} from "./migrations";

export { CURRENT_SCHEMA_VERSION } from "./migrations";

export function getProjectDbBackupPath(
  projectPath: string,
  fromVersion: number
): string {
  if (!Number.isInteger(fromVersion) || fromVersion < 0) {
    throw new Error(`Invalid database backup source version: ${fromVersion}`);
  }
  return `${getProjectDbPath(projectPath)}.v${fromVersion}.bak`;
}

function isExistingNonEmptyDb(dbPath: string): boolean {
  if (!existsSync(dbPath)) return false;
  try {
    return statSync(dbPath).size > 0;
  } catch (err) {
    throw new Error(
      `Failed to stat project database before migration: ${dbPath}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

/**
 * Deterministic pre-migration backup. `VACUUM INTO` creates a transactionally
 * consistent SQLite snapshot, including committed pages still resident in WAL.
 * Fail-closed: existing backup path or snapshot failure aborts migration.
 */
export function backupProjectDbBeforeMigration(
  projectPath: string,
  fromVersion: number
): string {
  const dbPath = getProjectDbPath(projectPath);
  const bakPath = getProjectDbBackupPath(projectPath, fromVersion);

  if (!isExistingNonEmptyDb(dbPath)) {
    throw new Error(
      `Refusing backup: project database is missing or empty: ${dbPath}`
    );
  }

  if (existsSync(bakPath)) {
    throw new Error(
      `Database migration backup already exists (refusing to overwrite): ${bakPath}`
    );
  }

  const source = new DatabaseSync(dbPath);
  try {
    source.prepare("VACUUM INTO ?").run(bakPath);
  } catch (err) {
    throw new Error(
      `Failed to create database migration backup at ${bakPath}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  } finally {
    closeProjectDb(source);
  }

  return bakPath;
}

export function openProjectDb(projectPath: string): DatabaseType {
  const dbPath = getProjectDbPath(projectPath);
  mkdirSync(getIkranDir(projectPath), { recursive: true });

  const existedNonEmpty = isExistingNonEmptyDb(dbPath);

  // Peek version while the file is closed so the backup is a clean snapshot.
  let currentVersion = 0;
  if (existedNonEmpty) {
    const peek = new DatabaseSync(dbPath);
    try {
      currentVersion = getUserVersion(peek);
    } finally {
      closeProjectDb(peek);
    }

    if (currentVersion < CURRENT_SCHEMA_VERSION) {
      backupProjectDbBeforeMigration(projectPath, currentVersion);
    }
  }

  const db = new DatabaseSync(dbPath);
  try {
    // Workbench authoritative reloads fan out across several read endpoints.
    // Let a short-lived concurrent writer/migration release the WAL lock
    // instead of surfacing a transient `db_error` to the designer action.
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA journal_mode = WAL");

    currentVersion = getUserVersion(db);
    if (currentVersion < CURRENT_SCHEMA_VERSION) {
      applyPendingMigrations(db, currentVersion);
    }

    // Defense in depth: every open connection must end at current version.
    const after = getUserVersion(db);
    if (after !== CURRENT_SCHEMA_VERSION) {
      throw new Error(
        `Database schema version mismatch after migration: expected ${CURRENT_SCHEMA_VERSION}, got ${after}`
      );
    }

    return db;
  } catch (err) {
    closeProjectDb(db);
    throw err;
  }
}

export function closeProjectDb(db: DatabaseType): void {
  try {
    db.close();
  } catch {
    // ignore close errors
  }
}

/**
 * Run `fn` inside a single BEGIN/COMMIT on one project DB connection.
 * On throw: ROLLBACK then rethrow. Connection is always closed.
 */
export function withProjectTransaction<T>(
  projectPath: string,
  fn: (db: DatabaseType) => T
): T {
  const db = openProjectDb(projectPath);
  try {
    db.exec("BEGIN");
    try {
      const result = fn(db);
      db.exec("COMMIT");
      return result;
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // ignore rollback errors; original err is authoritative
      }
      throw err;
    }
  } finally {
    closeProjectDb(db);
  }
}

// Ensure a project's SQLite database exists with the current schema, then close
// the connection immediately. Use this for one-shot initialization (e.g. project
// binding) so we never leak a SQLite handle by forgetting to close it.
export function initializeProjectDb(projectPath: string): void {
  const db = openProjectDb(projectPath);
  closeProjectDb(db);
}
