// Semantic MCP tool boundary handler: register_seed_reference.
//
// Records a Figma seed reference and the designer's original design intent as
// Runtime-owned research source-of-truth. This is the minimal semantic tool
// boundary (Issue 02/03): an Agent changes Runtime records through a semantic
// intent tool, NOT through raw exec / headless CLI / canvas geometry.
//
// IMPORTANT — semantic boundary: this handler ONLY performs a LOCAL format
// check on the Figma URL. It does NOT access Figma, does NOT fetch / oEmbed /
// probe the link, and does NOT verify the file actually exists online. The
// ORIGINAL URL is stored verbatim (never rewritten for display), per the
// Issue 02/03 decision. Real Figma evidence ingestion is Agent-host-side
// (Issue 02/05 `record_evidence_package`); Runtime stays zero-Figma-contact.
//
// Idempotency: identity is `fileKey + nodeId` parsed from the URL (ignoring
// share `t=` and other query noise). Re-registering the same file+node returns
// the existing row (`reused: true`) instead of inserting a duplicate — Figma
// re-copied links change `t=` and would otherwise create multiple seeds.
// Concurrency is enforced by UNIQUE(file_key, node_id) + INSERT ON CONFLICT
// inside a single withProjectTransaction (no check-then-insert race).
//
// On validation failure the handler returns a structured error and writes NO
// record and NO event (no half-written state).
//
// Record + event are written atomically in one SQLite transaction. If the event
// INSERT fails, the seed row rolls back and the call returns `ok: false` with
// `reason: "db_error"`. Success always includes a string `event_id`.

import { randomUUID } from "node:crypto";
import type { DatabaseSync as DatabaseType } from "node:sqlite";
import { openProjectDb, closeProjectDb, withProjectTransaction } from "./db";
import { emitRecordEvent } from "./record-bus";
import path from "node:path";
import { logEventOnDb } from "./events";
import {
  parseFigmaSeedIdentity,
  figmaSeedIdentitiesEqual,
  type FigmaSeedIdentity
} from "./figma-identity";

export type { FigmaSeedIdentity };
export { parseFigmaSeedIdentity, figmaSeedIdentitiesEqual };

export interface SeedReferenceInput {
  /** Raw Figma URL, stored verbatim. */
  figmaSeedReference: string;
  /** Designer's original design intent (free text). */
  originalDesignIntent: string;
  /**
   * Who registered the seed. Controls Workbench awaiting UX:
   * - `ui` — legacy rows only (guide, no spinner); HTTP POST rejects new ui writes
   * - `agent` — MCP register_seed_reference: show loading spinner
   * Defaults to `agent` when omitted (MCP / older clients).
   * Product entry is Agent-only; Workbench no longer produces `ui`.
   */
  registeredVia?: "ui" | "agent";
}

/**
 * HTTP POST /api/seed-reference write policy: Agent-only.
 * Rejects `registeredVia: "ui"` so the product entry cannot mint ui rows.
 * Omitted / agent / unknown → agent. Legacy DB ui rows remain readable.
 */
export function resolveHttpRegisteredVia(
  requested: unknown
):
  | { ok: true; registeredVia: "agent" }
  | { ok: false; reason: "ui_registration_disabled" } {
  if (requested === "ui") {
    return { ok: false, reason: "ui_registration_disabled" };
  }
  return { ok: true, registeredVia: "agent" };
}

export interface SeedReferenceRecord {
  id: string;
  /** The original figmaSeedReference input, stored verbatim (not rewritten). */
  figma_seed_reference: string;
  original_design_intent: string;
  created_at: string;
  /** `ui` | `agent` — who registered; missing/legacy treated as agent. */
  registered_via: "ui" | "agent";
  /** Canonical Figma file key (from URL path). */
  file_key: string;
  /** Canonical node id (`-`→`:`); empty string when absent. */
  node_id: string;
  /** Latest evidence surface id for this seed; null until first declaration. */
  current_surface_id: string | null;
}

export type SeedReferenceValidationReason =
  | "missing_figma_seed_reference"
  | "missing_original_design_intent"
  | "invalid_figma_url"
  | "not_figma_host"
  | "not_figma_design_path";

export type SeedReferenceErrorReason = SeedReferenceValidationReason | "db_error";

export interface SeedReferenceResult {
  ok: true;
  record: SeedReferenceRecord;
  /** Canonical audit event id (always a string on success). */
  event_id: string;
  /**
   * True when an existing seed with the same fileKey+nodeId was returned
   * instead of inserting a new row (idempotent re-register).
   */
  reused?: true;
}

export interface SeedReferenceError {
  ok: false;
  reason: SeedReferenceErrorReason;
}

export type SeedReferenceResponse = SeedReferenceResult | SeedReferenceError;

// Local, offline format check of the Figma URL. Does NOT touch the network.
// Accepted: https URL on figma.com / www.figma.com with a /design/<key> or
// /file/<key> path. The original input string is returned for storage verbatim.
export function validateSeedReferenceInput(
  input: SeedReferenceInput
): SeedReferenceValidationReason | null {
  const rawUrl = input?.figmaSeedReference;
  if (typeof rawUrl !== "string" || rawUrl.trim().length === 0) {
    return "missing_figma_seed_reference";
  }
  const intent = input?.originalDesignIntent;
  if (typeof intent !== "string" || intent.trim().length === 0) {
    return "missing_original_design_intent";
  }

  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return "invalid_figma_url";
  }
  if (url.protocol !== "https:") {
    return "invalid_figma_url";
  }
  if (url.hostname !== "figma.com" && url.hostname !== "www.figma.com") {
    return "not_figma_host";
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const hasDesignPath =
    parts.length >= 2 && (parts[0] === "design" || parts[0] === "file");
  if (!hasDesignPath) {
    return "not_figma_design_path";
  }
  return null;
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

function lookupSeedEventId(
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

export function registerSeedReference(
  projectPath: string,
  input: SeedReferenceInput
): SeedReferenceResponse {
  const validationError = validateSeedReferenceInput(input);
  if (validationError) {
    return { ok: false, reason: validationError };
  }

  const identity = parseFigmaSeedIdentity(input.figmaSeedReference);
  if (!identity) {
    // validateSeedReferenceInput already accepted the URL shape; parse failure
    // here is unexpected — treat as invalid rather than inserting without identity.
    return { ok: false, reason: "invalid_figma_url" };
  }

  const registeredVia: "ui" | "agent" =
    input.registeredVia === "ui" ? "ui" : "agent";

  const candidateId = randomUUID();
  const createdAt = new Date().toISOString();

  try {
    const result = withProjectTransaction(projectPath, (db) => {
      const insertResult = db
        .prepare(
          `INSERT INTO seed_references
           (id, figma_seed_reference, original_design_intent, created_at, registered_via, file_key, node_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(file_key, node_id) DO NOTHING`
        )
        .run(
          candidateId,
          input.figmaSeedReference,
          input.originalDesignIntent,
          createdAt,
          registeredVia,
          identity.fileKey,
          identity.nodeId
        );

      if (insertResult.changes === 0) {
        // Conflict: return the existing first-writer row (original URL/intent).
        const existingRow = db
          .prepare(
            `SELECT * FROM seed_references WHERE file_key = ? AND node_id = ?`
          )
          .get(identity.fileKey, identity.nodeId) as
          | Record<string, unknown>
          | undefined;
        if (!existingRow) {
          throw new Error(
            `seed_references ON CONFLICT but no row for file_key=${identity.fileKey} node_id=${identity.nodeId}`
          );
        }
        const record = mapSeedRow(existingRow);
        let eventId = lookupSeedEventId(db, record.id);
        if (eventId === null) {
          const event = logEventOnDb(db, "seed_reference_registered", {
            seed_reference_id: record.id,
            figma_seed_reference: record.figma_seed_reference,
            original_design_intent: record.original_design_intent,
            registered_via: record.registered_via
          });
          eventId = event.event_id;
        }
        return {
          ok: true as const,
          record,
          event_id: eventId,
          reused: true as const
        };
      }

      const record: SeedReferenceRecord = {
        id: candidateId,
        figma_seed_reference: input.figmaSeedReference,
        original_design_intent: input.originalDesignIntent,
        created_at: createdAt,
        registered_via: registeredVia,
        file_key: identity.fileKey,
        node_id: identity.nodeId,
        current_surface_id: null
      };

      const event = logEventOnDb(db, "seed_reference_registered", {
        seed_reference_id: record.id,
        figma_seed_reference: record.figma_seed_reference,
        original_design_intent: record.original_design_intent,
        registered_via: record.registered_via
      });

      return { ok: true as const, record, event_id: event.event_id };
    });

    // Live invalidation only for newly created seeds (not identity reuse).
    if (result.ok && !("reused" in result && result.reused)) {
      emitRecordEvent({
        kind: "seed",
        action: "created",
        id: result.record.id,
        projectPath: path.resolve(projectPath)
      });
    }

    return result;
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

export function listSeedReferences(projectPath: string): SeedReferenceRecord[] {
  const db = openProjectDb(projectPath);
  try {
    const rows = db
      .prepare("SELECT * FROM seed_references ORDER BY created_at ASC")
      .all() as Array<Record<string, unknown>>;
    return rows.map(mapSeedRow);
  } finally {
    closeProjectDb(db);
  }
}
