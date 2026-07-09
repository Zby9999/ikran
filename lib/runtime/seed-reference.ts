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
// ORIGINAL URL is stored verbatim (never rewritten/normalized), per the
// Issue 02/03 decision. Real Figma evidence ingestion is Agent-host-side
// (Issue 02/05 `record_evidence_package`); Runtime stays zero-Figma-contact.
//
// On validation failure the handler returns a structured error and writes NO
// record and NO event (no half-written state).
//
// Record vs event semantics (deliberate, NOT transactionalized — see Issue
// 02/03): the `seed_references` row is the SOURCE OF TRUTH (current fact
// state); the `seed_reference_registered` event is a best-effort AUDIT log. The
// record is inserted and committed FIRST; the event is appended afterwards. If
// the event append throws (SQLite/JSONL I/O failure), the call STILL returns
// `ok: true` with `event_id: null` + `audit_warning: "event_write_failed"` — the
// record (source of truth) is saved, and callers must NOT retry (retrying would
// duplicate the record). The reverse — event without record — CANNOT occur,
// because the event is only written after the record INSERT succeeds. This
// matches the issue's "专用表 = 当前事实, event = 审计" split and is an accepted
// trade-off for this slice.
//
// (Net effect of best-effort: an extreme I/O failure may leave a record without
// its audit event — an audit gap, NOT a source-of-truth violation. The current
// fact is still intact and queryable.)

import { randomUUID } from "node:crypto";
import { openProjectDb, closeProjectDb } from "./db";
import { logEvent } from "./events";

export interface SeedReferenceInput {
  /** Raw Figma URL, stored verbatim. */
  figmaSeedReference: string;
  /** Designer's original design intent (free text). */
  originalDesignIntent: string;
}

export interface SeedReferenceRecord {
  id: string;
  /** The original figmaSeedReference input, stored verbatim (not rewritten). */
  figma_seed_reference: string;
  original_design_intent: string;
  created_at: string;
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
  /** The audit event id, or null when the best-effort audit write failed. */
  event_id: string | null;
  /** Present iff the best-effort audit event could not be written. The record
   *  (source of truth) is still saved and the call still succeeds — callers must
   *  NOT retry on this (retrying would duplicate the record). */
  audit_warning?: "event_write_failed";
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

export function registerSeedReference(
  projectPath: string,
  input: SeedReferenceInput
): SeedReferenceResponse {
  const validationError = validateSeedReferenceInput(input);
  if (validationError) {
    return { ok: false, reason: validationError };
  }

  const record: SeedReferenceRecord = {
    id: randomUUID(),
    // Store the ORIGINAL input verbatim — do not rewrite/normalize the URL.
    figma_seed_reference: input.figmaSeedReference,
    original_design_intent: input.originalDesignIntent,
    created_at: new Date().toISOString()
  };

  const db = openProjectDb(projectPath);
  try {
    const stmt = db.prepare(
      `INSERT INTO seed_references (id, figma_seed_reference, original_design_intent, created_at)
       VALUES (?, ?, ?, ?)`
    );
    stmt.run(
      record.id,
      record.figma_seed_reference,
      record.original_design_intent,
      record.created_at
    );
  } catch {
    return { ok: false, reason: "db_error" };
  } finally {
    closeProjectDb(db);
  }

  // Audit log (best-effort): the record above is already committed as the
  // source of truth. If this throws (SQLite/JSONL I/O failure) we still return
  // ok:true with event_id:null + audit_warning — callers must NOT retry
  // (retrying would duplicate the record). See file header.
  let event_id: string | null = null;
  let audit_warning: "event_write_failed" | undefined;
  try {
    const event = logEvent(projectPath, "seed_reference_registered", {
      seed_reference_id: record.id,
      figma_seed_reference: record.figma_seed_reference,
      original_design_intent: record.original_design_intent
    });
    event_id = event.event_id;
  } catch {
    audit_warning = "event_write_failed";
  }

  const result: SeedReferenceResult = { ok: true, record, event_id };
  if (audit_warning) result.audit_warning = audit_warning;
  return result;
}

export function listSeedReferences(projectPath: string): SeedReferenceRecord[] {
  const db = openProjectDb(projectPath);
  try {
    return db
      .prepare("SELECT * FROM seed_references ORDER BY created_at ASC")
      .all() as unknown as SeedReferenceRecord[];
  } finally {
    closeProjectDb(db);
  }
}