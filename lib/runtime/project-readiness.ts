// Project-level Design Language Description + readiness preconditions (Issue 05B).
//
// Description is stored once per project in SQLite `project_meta` — never copied
// onto Seed Reference rows. Empty/whitespace Description does not block capture
// or projection; readiness reports `description_missing` for Issue 07's
// Alignment gate.

import type { DatabaseSync as DatabaseType } from "node:sqlite";
import { openProjectDb, closeProjectDb, withProjectTransaction } from "./db";
import { getProjectPhase, type ProjectPhase } from "./project-phase";

export type ProjectReadinessPrecondition = "description_missing";

export type ProjectReadiness = {
  preconditions: ProjectReadinessPrecondition[];
  designLanguageDescription: string;
  projectPhase: ProjectPhase;
};

function ensureProjectMetaRow(db: DatabaseType): void {
  db.prepare(
    `INSERT OR IGNORE INTO project_meta (singleton, design_language_description)
     VALUES (1, '')`
  ).run();
}

function readDescriptionFromDb(db: DatabaseType): string {
  ensureProjectMetaRow(db);
  const row = db
    .prepare(
      `SELECT design_language_description AS description FROM project_meta WHERE singleton = 1`
    )
    .get() as { description: string } | undefined;
  return typeof row?.description === "string" ? row.description : "";
}

/** Trimmed Description string; whitespace-only becomes empty. */
export function normalizeDesignLanguageDescription(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim();
}

export function getDesignLanguageDescription(projectPath: string): string {
  const db = openProjectDb(projectPath);
  try {
    return readDescriptionFromDb(db);
  } finally {
    closeProjectDb(db);
  }
}

export type SetDesignLanguageDescriptionResult =
  | { ok: true; designLanguageDescription: string }
  | { ok: false; reason: "db_error" };

export function setDesignLanguageDescription(
  projectPath: string,
  description: unknown
): SetDesignLanguageDescriptionResult {
  const normalized = normalizeDesignLanguageDescription(description);
  try {
    withProjectTransaction(projectPath, (db) => {
      ensureProjectMetaRow(db);
      db.prepare(
        `UPDATE project_meta
         SET design_language_description = ?
         WHERE singleton = 1`
      ).run(normalized);
    });
    return { ok: true, designLanguageDescription: normalized };
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

export function getProjectReadiness(projectPath: string): ProjectReadiness {
  const designLanguageDescription = getDesignLanguageDescription(projectPath);
  const preconditions: ProjectReadinessPrecondition[] = [];
  if (designLanguageDescription.length === 0) {
    preconditions.push("description_missing");
  }
  return {
    preconditions,
    designLanguageDescription,
    projectPhase: getProjectPhase(projectPath)
  };
}
