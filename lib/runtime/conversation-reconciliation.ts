import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { withProjectTransaction } from "./db";
import { buildLoggedEvent, insertEvent } from "./events";

export type ConversationMessageRole = "designer" | "agent";
export type ConversationDecisionDisposition =
  | "final_decision"
  | "superseded"
  | "local_exception"
  | "open_gap";

export interface ConversationMessageInput {
  id: string;
  role: ConversationMessageRole;
  content: string;
}

export interface ConversationDecisionInput {
  summary: string;
  disposition: ConversationDecisionDisposition;
  sourceMessageIds: string[];
  evidenceSurfaceId?: string;
  prototypeSurfaceId?: string;
  regionAnnotationId?: string;
  seedReferenceId?: string;
  opaqueContext?: unknown;
}

export interface ReconcileDesignerConversationInput {
  reviewId: string;
  conversationId: string;
  runId: string;
  sessionId: string;
  startMessageId: string;
  endMessageId: string;
  messages: ConversationMessageInput[];
  decisions: ConversationDecisionInput[];
}

type NormalizedDecision = {
  summary: string;
  disposition: ConversationDecisionDisposition;
  sourceMessageIds: string[];
  evidenceSurfaceId: string | null;
  prototypeSurfaceId: string | null;
  regionAnnotationId: string | null;
  seedReferenceId: string | null;
  opaqueContext: unknown;
  opaqueContextStored: string | null;
};

type NormalizedInput = {
  reviewId: string;
  conversationId: string;
  runId: string;
  sessionId: string;
  startMessageId: string;
  endMessageId: string;
  messages: ConversationMessageInput[];
  decisions: NormalizedDecision[];
};

type ReconciliationRecord = {
  id: string;
  conversation_id: string;
  run_id: string;
  session_id: string;
  start_message_id: string;
  end_message_id: string;
  transcript_sha256: string;
  message_count: number;
  decision_count: number;
  completed_at: string;
};

type ReconciledFeedback = {
  id: string;
  summary: string;
  disposition: ConversationDecisionDisposition;
  source_message_ids: string[];
};

export type ReconcileDesignerConversationResult =
  | {
      ok: true;
      replayed: boolean;
      reconciliation: ReconciliationRecord;
      feedback: ReconciledFeedback[];
      event_id: string;
    }
  | { ok: false; reason: string };

type OptionalLinkage = {
  table: string;
  value: string | null;
};

const VALID_DISPOSITIONS = new Set<ConversationDecisionDisposition>([
  "final_decision",
  "superseded",
  "local_exception",
  "open_gap"
]);

function trimRequired(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function trimOptional(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return trimRequired(value);
}

function encodeOpaqueContext(value: unknown): string | null | "invalid" {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "invalid";
  }
}

function sortJsonObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonObjectKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJsonObjectKeys(item)])
  );
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeInput(
  input: ReconcileDesignerConversationInput
): NormalizedInput | "designer_source_required" | null {
  const reviewId = trimRequired(input.reviewId);
  const conversationId = trimRequired(input.conversationId);
  const runId = trimRequired(input.runId);
  const sessionId = trimRequired(input.sessionId);
  const startMessageId = trimRequired(input.startMessageId);
  const endMessageId = trimRequired(input.endMessageId);
  if (
    !reviewId ||
    !conversationId ||
    !runId ||
    !sessionId ||
    !startMessageId ||
    !endMessageId ||
    !Array.isArray(input.messages) ||
    input.messages.length === 0 ||
    !Array.isArray(input.decisions)
  ) {
    return null;
  }

  const messages: ConversationMessageInput[] = [];
  const messageRoles = new Map<string, ConversationMessageRole>();
  for (const message of input.messages) {
    const id = trimRequired(message?.id);
    const content =
      typeof message?.content === "string" ? message.content : null;
    if (
      !id ||
      content === null ||
      content.trim().length === 0 ||
      (message.role !== "designer" && message.role !== "agent") ||
      messageRoles.has(id)
    ) {
      return null;
    }
    messages.push({ id, role: message.role, content });
    messageRoles.set(id, message.role);
  }
  if (
    messages[0].id !== startMessageId ||
    messages[messages.length - 1].id !== endMessageId
  ) {
    return null;
  }

  const decisions: NormalizedDecision[] = [];
  for (const decision of input.decisions) {
    const summary = trimRequired(decision?.summary);
    if (
      !summary ||
      !VALID_DISPOSITIONS.has(decision.disposition) ||
      !Array.isArray(decision.sourceMessageIds) ||
      decision.sourceMessageIds.length === 0
    ) {
      return null;
    }
    const sourceMessageIds = decision.sourceMessageIds.map(trimRequired);
    if (
      sourceMessageIds.some((id) => id === null) ||
      new Set(sourceMessageIds).size !== sourceMessageIds.length
    ) {
      return null;
    }
    const sources = sourceMessageIds as string[];
    if (sources.some((id) => !messageRoles.has(id))) {
      return null;
    }
    if (!sources.some((id) => messageRoles.get(id) === "designer")) {
      return "designer_source_required";
    }
    let opaqueContext: unknown =
      decision.opaqueContext === undefined ? null : decision.opaqueContext;
    let opaqueContextStored = encodeOpaqueContext(opaqueContext);
    if (opaqueContextStored === "invalid") return null;
    if (opaqueContext !== null && typeof opaqueContext === "object") {
      if (opaqueContextStored === null) return null;
      opaqueContext = sortJsonObjectKeys(JSON.parse(opaqueContextStored));
      opaqueContextStored = JSON.stringify(opaqueContext);
    }
    decisions.push({
      summary,
      disposition: decision.disposition,
      sourceMessageIds: sources,
      evidenceSurfaceId: trimOptional(decision.evidenceSurfaceId),
      prototypeSurfaceId: trimOptional(decision.prototypeSurfaceId),
      regionAnnotationId: trimOptional(decision.regionAnnotationId),
      seedReferenceId: trimOptional(decision.seedReferenceId),
      opaqueContext,
      opaqueContextStored
    });
  }

  return {
    reviewId,
    conversationId,
    runId,
    sessionId,
    startMessageId,
    endMessageId,
    messages,
    decisions
  };
}

function tableExists(db: DatabaseType, table: string): boolean {
  return Boolean(
    db
      .prepare(
        `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?`
      )
      .get(table)
  );
}

function linkagesFor(decision: NormalizedDecision): OptionalLinkage[] {
  return [
    { table: "figma_evidence_surfaces", value: decision.evidenceSurfaceId },
    { table: "prototype_surfaces", value: decision.prototypeSurfaceId },
    { table: "region_annotations", value: decision.regionAnnotationId },
    { table: "seed_references", value: decision.seedReferenceId }
  ];
}

function loadReplay(
  db: DatabaseType,
  normalized: NormalizedInput,
  payloadSha256: string
): ReconcileDesignerConversationResult | null {
  const row = db
    .prepare(
      `SELECT id, conversation_id, run_id, session_id,
              start_message_id, end_message_id, transcript_sha256,
              payload_sha256, message_count, decision_count, completed_at
       FROM conversation_reconciliations WHERE id = ?`
    )
    .get(normalized.reviewId) as
    | (ReconciliationRecord & { payload_sha256: string })
    | undefined;
  if (!row) return null;
  if (row.payload_sha256 !== payloadSha256) {
    return { ok: false, reason: "reconciliation_conflict" };
  }

  const feedback = db
    .prepare(
      `SELECT f.id, f.summary, rf.decision_disposition, rf.source_message_ids_json
       FROM conversation_reconciliation_feedback rf
       JOIN designer_feedback f ON f.id = rf.feedback_id
       WHERE rf.reconciliation_id = ?
       ORDER BY rf.position ASC`
    )
    .all(normalized.reviewId) as Array<{
    id: string;
    summary: string;
    decision_disposition: ConversationDecisionDisposition;
    source_message_ids_json: string;
  }>;

  const event = db
    .prepare(
      `SELECT event_id FROM events
       WHERE type = 'conversation_reconciliation_completed'
         AND json_extract(payload, '$.reconciliation_id') = ?
       ORDER BY id ASC LIMIT 1`
    )
    .get(normalized.reviewId) as { event_id: string };

  return {
    ok: true,
    replayed: true,
    reconciliation: {
      id: row.id,
      conversation_id: row.conversation_id,
      run_id: row.run_id,
      session_id: row.session_id,
      start_message_id: row.start_message_id,
      end_message_id: row.end_message_id,
      transcript_sha256: row.transcript_sha256,
      message_count: row.message_count,
      decision_count: row.decision_count,
      completed_at: row.completed_at
    },
    feedback: feedback.map((item) => ({
      id: item.id,
      summary: item.summary,
      disposition: item.decision_disposition,
      source_message_ids: JSON.parse(item.source_message_ids_json) as string[]
    })),
    event_id: event.event_id
  };
}

export function reconcileDesignerConversation(
  projectPath: string,
  input: ReconcileDesignerConversationInput
): ReconcileDesignerConversationResult {
  const normalized = normalizeInput(input);
  if (normalized === "designer_source_required") {
    return { ok: false, reason: normalized };
  }
  if (!normalized) {
    return { ok: false, reason: "invalid_conversation_reconciliation" };
  }

  const transcript = normalized.messages;
  const transcriptJson = JSON.stringify(transcript);
  const transcriptSha256 = digest(transcript);
  const payloadSha256 = digest({
    ...normalized,
    decisions: normalized.decisions.map(({ opaqueContextStored: _, ...item }) => item)
  });

  try {
    return withProjectTransaction(projectPath, (db) => {
      const replay = loadReplay(db, normalized, payloadSha256);
      if (replay) return replay;

      const scope = db
        .prepare(
          `SELECT id FROM conversation_reconciliations
           WHERE conversation_id = ? AND start_message_id = ? AND end_message_id = ?`
        )
        .get(
          normalized.conversationId,
          normalized.startMessageId,
          normalized.endMessageId
        );
      if (scope) {
        return { ok: false as const, reason: "reconciliation_scope_conflict" };
      }

      for (const decision of normalized.decisions) {
        for (const linkage of linkagesFor(decision)) {
          if (linkage.value === null) continue;
          if (
            !tableExists(db, linkage.table) ||
            !db
              .prepare(`SELECT 1 FROM ${linkage.table} WHERE id = ?`)
              .get(linkage.value)
          ) {
            return { ok: false as const, reason: "linkage_record_not_found" };
          }
        }
      }

      const completedAt = new Date().toISOString();
      const reconciliation: ReconciliationRecord = {
        id: normalized.reviewId,
        conversation_id: normalized.conversationId,
        run_id: normalized.runId,
        session_id: normalized.sessionId,
        start_message_id: normalized.startMessageId,
        end_message_id: normalized.endMessageId,
        transcript_sha256: transcriptSha256,
        message_count: transcript.length,
        decision_count: normalized.decisions.length,
        completed_at: completedAt
      };
      db.prepare(
        `INSERT INTO conversation_reconciliations (
           id, conversation_id, run_id, session_id,
           start_message_id, end_message_id, transcript_json,
           transcript_sha256, payload_sha256, message_count,
           decision_count, completed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        reconciliation.id,
        reconciliation.conversation_id,
        reconciliation.run_id,
        reconciliation.session_id,
        reconciliation.start_message_id,
        reconciliation.end_message_id,
        transcriptJson,
        reconciliation.transcript_sha256,
        payloadSha256,
        reconciliation.message_count,
        reconciliation.decision_count,
        reconciliation.completed_at
      );

      const feedback: ReconciledFeedback[] = [];
      const feedbackIds: string[] = [];
      const insertFeedback = db.prepare(
        `INSERT INTO designer_feedback (
           id, summary, run_id, session_id,
           evidence_surface_id, prototype_surface_id,
           region_annotation_id, seed_reference_id,
           opaque_context_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const linkFeedback = db.prepare(
        `INSERT INTO conversation_reconciliation_feedback (
           reconciliation_id, feedback_id, decision_disposition,
           source_message_ids_json, position
         ) VALUES (?, ?, ?, ?, ?)`
      );
      normalized.decisions.forEach((decision, position) => {
        const feedbackId = randomUUID();
        insertFeedback.run(
          feedbackId,
          decision.summary,
          normalized.runId,
          normalized.sessionId,
          decision.evidenceSurfaceId,
          decision.prototypeSurfaceId,
          decision.regionAnnotationId,
          decision.seedReferenceId,
          decision.opaqueContextStored,
          completedAt
        );
        linkFeedback.run(
          reconciliation.id,
          feedbackId,
          decision.disposition,
          JSON.stringify(decision.sourceMessageIds),
          position
        );
        const feedbackEvent = buildLoggedEvent("designer_feedback_recorded", {
          feedback_id: feedbackId,
          summary: decision.summary,
          run_id: normalized.runId,
          session_id: normalized.sessionId,
          reconciliation_id: reconciliation.id,
          decision_disposition: decision.disposition,
          source_message_ids: decision.sourceMessageIds,
          evidence_surface_id: decision.evidenceSurfaceId,
          prototype_surface_id: decision.prototypeSurfaceId,
          region_annotation_id: decision.regionAnnotationId,
          seed_reference_id: decision.seedReferenceId,
          opaque_context: decision.opaqueContext,
          created_at: completedAt
        });
        insertEvent(db, feedbackEvent);
        feedbackIds.push(feedbackId);
        feedback.push({
          id: feedbackId,
          summary: decision.summary,
          disposition: decision.disposition,
          source_message_ids: decision.sourceMessageIds
        });
      });

      const event = buildLoggedEvent("conversation_reconciliation_completed", {
        reconciliation_id: reconciliation.id,
        conversation_id: reconciliation.conversation_id,
        run_id: reconciliation.run_id,
        session_id: reconciliation.session_id,
        start_message_id: reconciliation.start_message_id,
        end_message_id: reconciliation.end_message_id,
        transcript_sha256: reconciliation.transcript_sha256,
        message_count: reconciliation.message_count,
        decision_count: reconciliation.decision_count,
        feedback_ids: feedbackIds,
        completed_at: reconciliation.completed_at
      });
      insertEvent(db, event);

      return {
        ok: true as const,
        replayed: false,
        reconciliation,
        feedback,
        event_id: event.event_id
      };
    });
  } catch {
    return { ok: false, reason: "db_error" };
  }
}
