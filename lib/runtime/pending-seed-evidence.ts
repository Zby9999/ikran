// List seed_references that still need an Agent-declared Evidence Surface
// screenshot (UI-initiated Agent evidence capture).
//
// A seed is pending when there is NO `figma_evidence_surfaces` row linked by
// `seed_reference_id` or matching `figma_seed_reference` that has a usable
// screenshot (`screenshot_data_url` or `screenshot_artifact_path` non-empty
// after trim). Matches Workbench awaiting-evidence projection rules.
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
 * Seeds for `projectPath` with no usable screenshot surface yet.
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
         WHERE NOT EXISTS (
           SELECT 1 FROM figma_evidence_surfaces fes
           WHERE (
             fes.seed_reference_id = sr.id
             OR fes.figma_seed_reference = sr.figma_seed_reference
           )
           AND (
             (fes.screenshot_data_url IS NOT NULL AND TRIM(fes.screenshot_data_url) != '')
             OR (fes.screenshot_artifact_path IS NOT NULL AND TRIM(fes.screenshot_artifact_path) != '')
           )
         )
         ORDER BY sr.created_at ASC`
      )
      .all() as unknown as PendingSeedEvidenceRecord[];
  } finally {
    closeProjectDb(db);
  }
}
