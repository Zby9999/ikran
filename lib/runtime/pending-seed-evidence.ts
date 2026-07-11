// List seed_references that still need an Agent-declared Evidence Surface
// screenshot (UI-initiated Agent evidence capture).
//
// A seed is pending when its `current_surface_id` is null, or the current
// surface has no usable screenshot (`screenshot_data_url` /
// `screenshot_artifact_path` empty after trim). Historical superseded surfaces
// are ignored — only the current pointer matters.
//
// Pure local SQLite — zero Figma network.

import { openProjectDb, closeProjectDb } from "./db";
import type { SeedReferenceRecord } from "./seed-reference";

/** Pending seed awaiting a usable Evidence Surface screenshot. */
export type PendingSeedEvidenceRecord = Pick<
  SeedReferenceRecord,
  "id" | "figma_seed_reference" | "original_design_intent" | "created_at"
>;

/**
 * Seeds for `projectPath` whose current surface lacks a usable screenshot.
 * Oldest-first (`created_at ASC`).
 */
export function listPendingSeedEvidence(
  projectPath: string
): PendingSeedEvidenceRecord[] {
  const db = openProjectDb(projectPath);
  try {
    return db
      .prepare(
        `SELECT sr.id, sr.figma_seed_reference, sr.original_design_intent, sr.created_at
         FROM seed_references sr
         LEFT JOIN figma_evidence_surfaces fes ON fes.id = sr.current_surface_id
         WHERE sr.current_surface_id IS NULL
            OR (
              (fes.screenshot_data_url IS NULL OR TRIM(fes.screenshot_data_url) = '')
              AND (fes.screenshot_artifact_path IS NULL OR TRIM(fes.screenshot_artifact_path) = '')
            )
         ORDER BY sr.created_at ASC`
      )
      .all() as unknown as PendingSeedEvidenceRecord[];
  } finally {
    closeProjectDb(db);
  }
}
