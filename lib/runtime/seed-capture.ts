// Atomic Seed Reference + Figma positional evidence capture (Issue 05A / ADR 0003).
//
// Shared by Workbench paste and Agent `add_seed_reference`. Requires an active
// Figma Connection. Success writes seed + surface + events in one transaction;
// any failure leaves no half-written research facts.

import { randomUUID } from "node:crypto";
import path from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";
import { withProjectTransaction } from "./db";
import { logEventOnDb } from "./events";
import { getFigmaApiClient } from "./figma-api";
import { parseFigmaSeedIdentity } from "./figma-identity";
import { requireFigmaConnectionCommand } from "./commands/figma-connection";
import { emitRecordEvent } from "./record-bus";
import type { FigmaEvidenceSurfaceRecord } from "./evidence-package";
import type { SeedReferenceRecord } from "./seed-reference";

export type SeedCaptureInitiator = "ui" | "agent";

export type SeedCaptureInput = {
  figmaSeedReference: string;
  /** Optional Reference Note; empty allowed (does not block capture). */
  referenceNote?: string;
  initiator: SeedCaptureInitiator;
};

export type SeedCaptureErrorReason =
  | "figma_connection_required"
  | "missing_figma_seed_reference"
  | "invalid_figma_url"
  | "not_figma_host"
  | "not_figma_design_path"
  | "missing_node_id"
  | "invalid_token"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "screenshot_missing"
  | "malformed_figma_response"
  | "figma_api_error"
  | "db_error";

export type SeedCaptureResult =
  | {
      ok: true;
      record: SeedReferenceRecord;
      surface: FigmaEvidenceSurfaceRecord;
      event_id: string;
      reused?: true;
    }
  | { ok: false; reason: SeedCaptureErrorReason };

function validateCaptureUrl(
  rawUrl: string
):
  | { ok: true; identity: { fileKey: string; nodeId: string }; url: string }
  | { ok: false; reason: SeedCaptureErrorReason } {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { ok: false, reason: "missing_figma_seed_reference" };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: "invalid_figma_url" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: "invalid_figma_url" };
  }
  if (url.hostname !== "figma.com" && url.hostname !== "www.figma.com") {
    return { ok: false, reason: "not_figma_host" };
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const hasDesignPath =
    parts.length >= 2 && (parts[0] === "design" || parts[0] === "file");
  if (!hasDesignPath) {
    return { ok: false, reason: "not_figma_design_path" };
  }
  const identity = parseFigmaSeedIdentity(trimmed);
  if (!identity) {
    return { ok: false, reason: "invalid_figma_url" };
  }
  if (!identity.nodeId) {
    return { ok: false, reason: "missing_node_id" };
  }
  return { ok: true, identity, url: trimmed };
}

function mapSeedRow(row: Record<string, unknown>): SeedReferenceRecord {
  return {
    id: String(row.id),
    figma_seed_reference: String(row.figma_seed_reference),
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

function mapSurfaceRow(row: Record<string, unknown>): FigmaEvidenceSurfaceRecord {
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

function lookupSurfaceById(
  db: DatabaseType,
  id: string
): FigmaEvidenceSurfaceRecord | null {
  const row = db
    .prepare(`SELECT * FROM figma_evidence_surfaces WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? mapSurfaceRow(row) : null;
}

export async function addSeedReference(
  projectPath: string,
  input: SeedCaptureInput
): Promise<SeedCaptureResult> {
  const connection = await requireFigmaConnectionCommand();
  if (!connection.ok) {
    return { ok: false, reason: "figma_connection_required" };
  }

  const validated = validateCaptureUrl(input.figmaSeedReference);
  if (!validated.ok) return validated;

  const referenceNote =
    typeof input.referenceNote === "string" ? input.referenceNote : "";
  const initiator: SeedCaptureInitiator =
    input.initiator === "ui" ? "ui" : "agent";

  // Reuse existing seed+surface without network refresh (ADR 0003).
  try {
    const reused = withProjectTransaction(projectPath, (db) => {
      const existing = db
        .prepare(
          `SELECT * FROM seed_references WHERE file_key = ? AND node_id = ?`
        )
        .get(validated.identity.fileKey, validated.identity.nodeId) as
        | Record<string, unknown>
        | undefined;
      if (!existing) return null;
      const record = mapSeedRow(existing);
      if (!record.current_surface_id) return null;
      const surface = lookupSurfaceById(db, record.current_surface_id);
      if (!surface) return null;
      const eventRow = db
        .prepare(
          `SELECT event_id FROM events
           WHERE type = 'seed_reference_registered'
             AND json_extract(payload, '$.seed_reference_id') = ?
           ORDER BY created_at ASC, id ASC
           LIMIT 1`
        )
        .get(record.id) as { event_id: string } | undefined;
      return {
        ok: true as const,
        record,
        surface,
        event_id: eventRow?.event_id ?? record.id,
        reused: true as const
      };
    });
    if (reused) return reused;
  } catch {
    return { ok: false, reason: "db_error" };
  }

  const api = getFigmaApiClient();
  const captured = await api.capturePositionalEvidence({
    token: connection.token,
    fileKey: validated.identity.fileKey,
    nodeId: validated.identity.nodeId
  });
  if (!captured.ok) {
    return { ok: false, reason: captured.reason };
  }

  const seedId = randomUUID();
  const surfaceId = randomUUID();
  const createdAt = new Date().toISOString();
  const capture = captured.capture;

  try {
    const result = withProjectTransaction(projectPath, (db) => {
      // Race: another writer may have inserted between reuse check and capture.
      const conflict = db
        .prepare(
          `SELECT * FROM seed_references WHERE file_key = ? AND node_id = ?`
        )
        .get(validated.identity.fileKey, validated.identity.nodeId) as
        | Record<string, unknown>
        | undefined;
      if (conflict) {
        const record = mapSeedRow(conflict);
        if (record.current_surface_id) {
          const surface = lookupSurfaceById(db, record.current_surface_id);
          if (surface) {
            return {
              ok: true as const,
              record,
              surface,
              event_id: record.id,
              reused: true as const
            };
          }
        }
      }

      db.prepare(
        `INSERT INTO seed_references
         (id, figma_seed_reference, original_design_intent, created_at,
          registered_via, file_key, node_id, current_surface_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`
      ).run(
        seedId,
        validated.url,
        referenceNote,
        createdAt,
        initiator,
        validated.identity.fileKey,
        validated.identity.nodeId
      );

      const positionalJson = JSON.stringify(capture.nodes);
      const record: FigmaEvidenceSurfaceRecord = {
        id: surfaceId,
        seed_reference_id: seedId,
        figma_seed_reference: validated.url,
        frame_node_id: capture.frame.nodeId,
        frame_name: capture.frame.name,
        frame_bounds_json: capture.frame.bounds
          ? JSON.stringify(capture.frame.bounds)
          : null,
        evidence_views_json: JSON.stringify({
          rawData: "available",
          screenshot: "available"
        }),
        screenshot_artifact_path: null,
        screenshot_data_url: capture.screenshotDataUrl,
        design_signals_json: null,
        surface_bounds_json: JSON.stringify(capture.surfaceBounds),
        positional_nodes_json: positionalJson,
        created_at: createdAt,
        superseded_by: null
      };

      db.prepare(
        `INSERT INTO figma_evidence_surfaces (
          id, seed_reference_id, figma_seed_reference,
          frame_node_id, frame_name, frame_bounds_json,
          evidence_views_json, screenshot_artifact_path, screenshot_data_url,
          design_signals_json, surface_bounds_json, created_at, superseded_by,
          positional_nodes_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
      ).run(
        record.id,
        record.seed_reference_id,
        record.figma_seed_reference,
        record.frame_node_id,
        record.frame_name,
        record.frame_bounds_json,
        record.evidence_views_json,
        record.screenshot_artifact_path,
        record.screenshot_data_url,
        record.design_signals_json,
        record.surface_bounds_json,
        record.created_at,
        positionalJson
      );

      db.prepare(
        `UPDATE seed_references SET current_surface_id = ? WHERE id = ?`
      ).run(surfaceId, seedId);

      const seedEvent = logEventOnDb(db, "seed_reference_registered", {
        seed_reference_id: seedId,
        figma_seed_reference: validated.url,
        original_design_intent: referenceNote,
        registered_via: initiator,
        initiator
      });
      logEventOnDb(db, "evidence_package_recorded", {
        surface_id: surfaceId,
        seed_reference_id: seedId,
        figma_seed_reference: validated.url,
        capture_source: "runtime_figma_connection",
        initiator
      });

      const seedRecord: SeedReferenceRecord = {
        id: seedId,
        figma_seed_reference: validated.url,
        original_design_intent: referenceNote,
        created_at: createdAt,
        registered_via: initiator,
        file_key: validated.identity.fileKey,
        node_id: validated.identity.nodeId,
        current_surface_id: surfaceId
      };

      return {
        ok: true as const,
        record: seedRecord,
        surface: record,
        event_id: seedEvent.event_id
      };
    });

    if (result.ok && !result.reused) {
      emitRecordEvent({
        kind: "seed",
        action: "created",
        id: result.record.id,
        projectPath: path.resolve(projectPath)
      });
      emitRecordEvent({
        kind: "evidence",
        action: "created",
        id: result.surface.id,
        projectPath: path.resolve(projectPath)
      });
    }

    return result;
  } catch {
    return { ok: false, reason: "db_error" };
  }
}
