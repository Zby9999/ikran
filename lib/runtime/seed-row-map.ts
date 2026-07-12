// Shared SQLite row → Runtime record mappers (seed + evidence surface).

import type { FigmaEvidenceSurfaceRecord } from "./evidence-package";
import type { SeedReferenceRecord } from "./seed-reference";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

export function mapSeedRow(row: Record<string, unknown>): SeedReferenceRecord {
  return {
    id: String(row.id),
    figma_seed_reference: String(row.figma_seed_reference),
    // Column stores CONTEXT Reference Note (historical name retained).
    original_design_intent: String(row.original_design_intent),
    created_at: String(row.created_at),
    registered_via: row.registered_via === "ui" ? "ui" : "agent",
    file_key: String(row.file_key ?? ""),
    node_id: String(row.node_id ?? ""),
    current_surface_id:
      typeof row.current_surface_id === "string" &&
      row.current_surface_id.trim().length > 0
        ? row.current_surface_id
        : null
  };
}

export function mapSurfaceRow(
  row: Record<string, unknown>
): FigmaEvidenceSurfaceRecord {
  return {
    id: String(row.id),
    seed_reference_id: String(row.seed_reference_id),
    figma_seed_reference: String(row.figma_seed_reference),
    frame_node_id: String(row.frame_node_id),
    frame_name: String(row.frame_name),
    frame_bounds_json:
      typeof row.frame_bounds_json === "string" ? row.frame_bounds_json : null,
    evidence_views_json: String(row.evidence_views_json),
    screenshot_artifact_path:
      typeof row.screenshot_artifact_path === "string"
        ? row.screenshot_artifact_path
        : null,
    screenshot_data_url:
      typeof row.screenshot_data_url === "string"
        ? row.screenshot_data_url
        : null,
    design_signals_json:
      typeof row.design_signals_json === "string"
        ? row.design_signals_json
        : null,
    surface_bounds_json:
      typeof row.surface_bounds_json === "string"
        ? row.surface_bounds_json
        : null,
    positional_nodes_json:
      typeof row.positional_nodes_json === "string"
        ? row.positional_nodes_json
        : null,
    created_at: String(row.created_at),
    superseded_by:
      typeof row.superseded_by === "string" ? row.superseded_by : null
  };
}

/** First seed_reference_registered event id for a seed, if any. */
export function lookupSeedRegisteredEventId(
  db: DatabaseType,
  seedReferenceId: string
): string | null {
  const eventRow = db
    .prepare(
      `SELECT event_id FROM events
       WHERE type = 'seed_reference_registered'
         AND json_extract(payload, '$.seed_reference_id') = ?
       ORDER BY created_at ASC, id ASC
       LIMIT 1`
    )
    .get(seedReferenceId) as { event_id: string } | undefined;
  return eventRow?.event_id ?? null;
}
