import { randomUUID } from "node:crypto";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { withProjectTransaction } from "./db";
import { buildLoggedEvent, insertEvent } from "./events";

export interface RecordDesignerFeedbackInput {
  summary: string;
  runId: string;
  sessionId: string;
  evidenceSurfaceId?: string;
  prototypeSurfaceId?: string;
  regionAnnotationId?: string;
  seedReferenceId?: string;
  /** Opaque host context (e.g. DOM selector). Stored as-is; never validated. */
  opaqueContext?: unknown;
}

export type RecordDesignerFeedbackResult =
  | {
      ok: true;
      feedback: {
        id: string;
        summary: string;
        run_id: string;
        session_id: string;
        evidence_surface_id: string | null;
        prototype_surface_id: string | null;
        region_annotation_id: string | null;
        seed_reference_id: string | null;
        opaque_context: unknown;
        created_at: string;
      };
      event_id: string;
    }
  | { ok: false; reason: string };

type OptionalLinkage = {
  column: string;
  table: string;
  value: string | null;
};

/**
 * Declares one designer modification conclusion. Write-only: records the
 * feedback row and a designer_feedback_recorded event in one SQLite
 * transaction. Does not expose a read path (Issue 29 owns Consolidate reads).
 */
export function recordDesignerFeedback(
  projectPath: string,
  input: RecordDesignerFeedbackInput
): RecordDesignerFeedbackResult {
  const summary = input.summary.trim();
  const runId = input.runId.trim();
  const sessionId = input.sessionId.trim();
  if (summary.length === 0 || runId.length === 0 || sessionId.length === 0) {
    return { ok: false, reason: "invalid_feedback" };
  }

  const evidenceSurfaceId = trimOptional(input.evidenceSurfaceId);
  const prototypeSurfaceId = trimOptional(input.prototypeSurfaceId);
  const regionAnnotationId = trimOptional(input.regionAnnotationId);
  const seedReferenceId = trimOptional(input.seedReferenceId);

  const linkages: OptionalLinkage[] = [
    {
      column: "evidence_surface_id",
      table: "figma_evidence_surfaces",
      value: evidenceSurfaceId
    },
    {
      column: "region_annotation_id",
      table: "region_annotations",
      value: regionAnnotationId
    },
    {
      column: "seed_reference_id",
      table: "seed_references",
      value: seedReferenceId
    },
    // Issue 30 owns the prototype_surfaces table. Until it exists, any
    // provided prototypeSurfaceId fails closed as linkage_record_not_found.
    {
      column: "prototype_surface_id",
      table: "prototype_surfaces",
      value: prototypeSurfaceId
    }
  ];

  const opaqueContext =
    input.opaqueContext === undefined ? null : input.opaqueContext;
  const opaqueStored = encodeOpaqueContext(opaqueContext);
  if (opaqueStored === "invalid") {
    return { ok: false, reason: "invalid_feedback" };
  }

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const feedback = {
    id,
    summary,
    run_id: runId,
    session_id: sessionId,
    evidence_surface_id: evidenceSurfaceId,
    prototype_surface_id: prototypeSurfaceId,
    region_annotation_id: regionAnnotationId,
    seed_reference_id: seedReferenceId,
    opaque_context: opaqueContext,
    created_at: createdAt
  };

  try {
    const transaction = withProjectTransaction(projectPath, (db) => {
      for (const linkage of linkages) {
        if (linkage.value === null) continue;
        if (!tableExists(db, linkage.table)) {
          return { ok: false as const, reason: "linkage_record_not_found" };
        }
        const found = db
          .prepare(`SELECT 1 FROM ${linkage.table} WHERE id = ?`)
          .get(linkage.value);
        if (!found) {
          return { ok: false as const, reason: "linkage_record_not_found" };
        }
      }

      db.prepare(
        `INSERT INTO designer_feedback (
           id, summary, run_id, session_id,
           evidence_surface_id, prototype_surface_id,
           region_annotation_id, seed_reference_id,
           opaque_context_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        feedback.id,
        feedback.summary,
        feedback.run_id,
        feedback.session_id,
        feedback.evidence_surface_id,
        feedback.prototype_surface_id,
        feedback.region_annotation_id,
        feedback.seed_reference_id,
        opaqueStored,
        feedback.created_at
      );

      const event = buildLoggedEvent("designer_feedback_recorded", {
        feedback_id: feedback.id,
        summary: feedback.summary,
        run_id: feedback.run_id,
        session_id: feedback.session_id,
        evidence_surface_id: feedback.evidence_surface_id,
        prototype_surface_id: feedback.prototype_surface_id,
        region_annotation_id: feedback.region_annotation_id,
        seed_reference_id: feedback.seed_reference_id,
        opaque_context: feedback.opaque_context,
        created_at: feedback.created_at
      });
      insertEvent(db, event);
      return { ok: true as const, event };
    });

    if (!transaction.ok) return transaction;
    return {
      ok: true,
      feedback,
      event_id: transaction.event.event_id
    };
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

function trimOptional(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Strings stay verbatim; structured values are JSON text for SQLite TEXT. */
function encodeOpaqueContext(
  value: unknown
): string | null | "invalid" {
  if (value === null) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "invalid";
  }
}

function tableExists(db: DatabaseType, table: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?`
    )
    .get(table);
  return Boolean(row);
}
