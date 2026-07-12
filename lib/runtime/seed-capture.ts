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
import { getFigmaApiClient, type FigmaPositionalCapture } from "./figma-api";
import {
  hasFigmaDesignOrFilePath,
  isFigmaHostname,
  parseFigmaSeedIdentity
} from "./figma-identity";
import { requireFigmaConnectionCommand } from "./commands/figma-connection";
import { emitRecordEvent } from "./record-bus";
import type { FigmaEvidenceSurfaceRecord } from "./evidence-package";
import type { SeedReferenceRecord } from "./seed-reference";
import {
  lookupSeedRegisteredEventId,
  mapSeedRow,
  mapSurfaceRow
} from "./seed-row-map";

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
      /** Attached surface to a pre-existing seed that had no current surface. */
      fulfilled_pending?: true;
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
  if (!isFigmaHostname(url.hostname)) {
    return { ok: false, reason: "not_figma_host" };
  }
  if (!hasFigmaDesignOrFilePath(url.pathname)) {
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

function lookupSurfaceById(
  db: DatabaseType,
  id: string
): FigmaEvidenceSurfaceRecord | null {
  const row = db
    .prepare(`SELECT * FROM figma_evidence_surfaces WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? mapSurfaceRow(row) : null;
}

type PositionalCapturePayload = FigmaPositionalCapture;

/** Build + INSERT surface row, then point seed.current_surface_id at it. */
function insertCapturedSurface(
  db: DatabaseType,
  input: {
    surfaceId: string;
    seedId: string;
    figmaUrl: string;
    createdAt: string;
    capture: PositionalCapturePayload;
  }
): FigmaEvidenceSurfaceRecord {
  const positionalJson = JSON.stringify(input.capture.nodes);
  const surface: FigmaEvidenceSurfaceRecord = {
    id: input.surfaceId,
    seed_reference_id: input.seedId,
    figma_seed_reference: input.figmaUrl,
    frame_node_id: input.capture.frame.nodeId,
    frame_name: input.capture.frame.name,
    frame_bounds_json: input.capture.frame.bounds
      ? JSON.stringify(input.capture.frame.bounds)
      : null,
    evidence_views_json: JSON.stringify({
      rawData: "available",
      screenshot: "available"
    }),
    screenshot_artifact_path: null,
    screenshot_data_url: input.capture.screenshotDataUrl,
    design_signals_json: null,
    surface_bounds_json: JSON.stringify(input.capture.surfaceBounds),
    positional_nodes_json: positionalJson,
    created_at: input.createdAt,
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
    surface.id,
    surface.seed_reference_id,
    surface.figma_seed_reference,
    surface.frame_node_id,
    surface.frame_name,
    surface.frame_bounds_json,
    surface.evidence_views_json,
    surface.screenshot_artifact_path,
    surface.screenshot_data_url,
    surface.design_signals_json,
    surface.surface_bounds_json,
    surface.created_at,
    positionalJson
  );

  db.prepare(
    `UPDATE seed_references SET current_surface_id = ? WHERE id = ?`
  ).run(input.surfaceId, input.seedId);

  return surface;
}

function logEvidenceCaptured(
  db: DatabaseType,
  input: {
    surfaceId: string;
    seedId: string;
    figmaUrl: string;
    initiator: SeedCaptureInitiator;
  }
): void {
  logEventOnDb(db, "evidence_package_recorded", {
    surface_id: input.surfaceId,
    seed_reference_id: input.seedId,
    figma_seed_reference: input.figmaUrl,
    capture_source: "runtime_figma_connection",
    initiator: input.initiator
  });
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
      return {
        ok: true as const,
        record,
        surface,
        event_id: lookupSeedRegisteredEventId(db, record.id) ?? record.id,
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

  const newSeedId = randomUUID();
  const surfaceId = randomUUID();
  const createdAt = new Date().toISOString();
  const capture = captured.capture;

  try {
    const result = withProjectTransaction(projectPath, (db) => {
      // Race or legacy pending: seed may already exist for this identity.
      const conflict = db
        .prepare(
          `SELECT * FROM seed_references WHERE file_key = ? AND node_id = ?`
        )
        .get(validated.identity.fileKey, validated.identity.nodeId) as
        | Record<string, unknown>
        | undefined;

      if (conflict) {
        const existingRecord = mapSeedRow(conflict);
        if (existingRecord.current_surface_id) {
          const surface = lookupSurfaceById(
            db,
            existingRecord.current_surface_id
          );
          if (surface) {
            return {
              ok: true as const,
              record: existingRecord,
              surface,
              event_id:
                lookupSeedRegisteredEventId(db, existingRecord.id) ??
                existingRecord.id,
              reused: true as const
            };
          }
        }

        const seedId = existingRecord.id;
        const seedRegisteredVia = existingRecord.registered_via;
        // DB column `original_design_intent` stores CONTEXT Reference Note.
        const seedReferenceNote = existingRecord.original_design_intent;
        const seedUrl = existingRecord.figma_seed_reference;

        const surface = insertCapturedSurface(db, {
          surfaceId,
          seedId,
          figmaUrl: seedUrl,
          createdAt,
          capture
        });

        let seedEventId = lookupSeedRegisteredEventId(db, seedId);
        if (!seedEventId) {
          const seedEvent = logEventOnDb(db, "seed_reference_registered", {
            seed_reference_id: seedId,
            figma_seed_reference: seedUrl,
            original_design_intent: seedReferenceNote,
            registered_via: seedRegisteredVia,
            initiator
          });
          seedEventId = seedEvent.event_id;
        }

        logEvidenceCaptured(db, {
          surfaceId,
          seedId,
          figmaUrl: seedUrl,
          initiator
        });

        return {
          ok: true as const,
          record: {
            ...existingRecord,
            current_surface_id: surfaceId
          },
          surface,
          event_id: seedEventId,
          fulfilled_pending: true as const
        };
      }

      // Column name is historical; value is optional Reference Note (CONTEXT).
      db.prepare(
        `INSERT INTO seed_references
         (id, figma_seed_reference, original_design_intent, created_at,
          registered_via, file_key, node_id, current_surface_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`
      ).run(
        newSeedId,
        validated.url,
        referenceNote,
        createdAt,
        initiator,
        validated.identity.fileKey,
        validated.identity.nodeId
      );

      const surface = insertCapturedSurface(db, {
        surfaceId,
        seedId: newSeedId,
        figmaUrl: validated.url,
        createdAt,
        capture
      });

      const seedEvent = logEventOnDb(db, "seed_reference_registered", {
        seed_reference_id: newSeedId,
        figma_seed_reference: validated.url,
        original_design_intent: referenceNote,
        registered_via: initiator,
        initiator
      });
      logEvidenceCaptured(db, {
        surfaceId,
        seedId: newSeedId,
        figmaUrl: validated.url,
        initiator
      });

      return {
        ok: true as const,
        record: {
          id: newSeedId,
          figma_seed_reference: validated.url,
          original_design_intent: referenceNote,
          created_at: createdAt,
          registered_via: initiator,
          file_key: validated.identity.fileKey,
          node_id: validated.identity.nodeId,
          current_surface_id: surfaceId
        },
        surface,
        event_id: seedEvent.event_id
      };
    });

    if (result.ok && !result.reused) {
      if (!result.fulfilled_pending) {
        emitRecordEvent({
          kind: "seed",
          action: "created",
          id: result.record.id,
          projectPath: path.resolve(projectPath)
        });
      }
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
