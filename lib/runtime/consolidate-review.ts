// Consolidate review (Issue 29 MVP chat path).
//
// The designer-feedback library is write-only during design generation
// (Issue 27). `claimConsolidateReview` is its ONLY read path: the designer
// starts a review in chat, the Agent claims it once, and Runtime returns the
// whole library with each row's disposition so the Agent can aggregate and
// draft proposals. Nothing here proposes or writes on its own.
//
// Every feedback row must end with a disposition: consumed by a confirmed
// rule-update proposal (rule-update-proposal.ts) or explicitly dismissed with
// a reason here. The formalize gate (Issue 28) reads exactly that invariant.

import { withProjectTransaction } from "./db";
import { buildLoggedEvent, insertEvent } from "./events";
import { decodeOpaqueJson } from "./json-columns";
import {
  listUnreviewedDesignerFeedbackOnDb,
  readProjectPhaseOnDb
} from "./project-phase";

export type DesignerFeedbackReviewState =
  | "unreviewed"
  | "consumed"
  | "dismissed";

export interface ConsolidateReviewFeedback {
  id: string;
  summary: string;
  run_id: string;
  session_id: string;
  evidence_surface_id: string | null;
  prototype_surface_id: string | null;
  region_annotation_id: string | null;
  seed_reference_id: string | null;
  opaque_context: unknown;
  reconciliation_id: string | null;
  decision_disposition:
    | "final_decision"
    | "superseded"
    | "local_exception"
    | "open_gap"
    | null;
  source_message_ids: string[];
  created_at: string;
  review_state: DesignerFeedbackReviewState;
  consumed_by_proposal_id: string | null;
  dismissed_reason: string | null;
}

export type ClaimConsolidateReviewResult =
  | {
      ok: true;
      feedback: ConsolidateReviewFeedback[];
      feedback_count: number;
      unreviewed_feedback_ids: string[];
      unreviewed_feedback_count: number;
      reconciliation_id: string | null;
      prototype_confirmation_event_id: string | null;
      event_id: string;
    }
  | { ok: false; reason: string };

export interface DismissDesignerFeedbackInput {
  feedbackIds: string[];
  reason: string;
}

export type DismissDesignerFeedbackResult =
  | {
      ok: true;
      dismissed_feedback_ids: string[];
      reason: string;
      dismissed_at: string;
      unreviewed_feedback_count: number;
      event_ids: string[];
    }
  | { ok: false; reason: string };

type FeedbackJoinRow = {
  id: string;
  summary: string;
  run_id: string;
  session_id: string;
  evidence_surface_id: string | null;
  prototype_surface_id: string | null;
  region_annotation_id: string | null;
  seed_reference_id: string | null;
  opaque_context_json: string | null;
  reconciliation_id: string | null;
  decision_disposition: ConsolidateReviewFeedback["decision_disposition"];
  source_message_ids_json: string | null;
  created_at: string;
  consumed_by_proposal_id: string | null;
  dismissed_reason: string | null;
};

function reviewStateOf(row: FeedbackJoinRow): DesignerFeedbackReviewState {
  if (row.consumed_by_proposal_id !== null) return "consumed";
  if (row.dismissed_reason !== null) return "dismissed";
  return "unreviewed";
}

/**
 * Starts one designer-initiated Consolidate review. Returns the full feedback
 * library (with linkage ids and disposition) and records
 * `consolidate_review_started`. Runtime never triggers this on its own.
 */
export function claimConsolidateReview(
  projectPath: string,
  reconciliationId: string
): ClaimConsolidateReviewResult {
  try {
    return withProjectTransaction(projectPath, (db) => {
      const boundedReconciliationId = reconciliationId.trim();
      const reconciliation = db
        .prepare(
          "SELECT run_id FROM conversation_reconciliations WHERE id = ?"
        )
        .get(boundedReconciliationId) as { run_id: string } | undefined;
      if (
        boundedReconciliationId.length === 0 ||
        reconciliation === undefined
      ) {
        return {
          ok: false as const,
          reason: "conversation_reconciliation_not_found"
        };
      }

      // A formal Design System pass is a new review cycle. Bind the claim to
      // the latest Prototype confirmation by durable event order so an older
      // reconciliation cannot accidentally authorize the current cycle.
      let prototypeConfirmationEventId: string | null = null;
      if (readProjectPhaseOnDb(db) === "design_system_formal") {
        const confirmation = db
          .prepare(
            `SELECT id, event_id,
                    json_extract(payload, '$.run_id') AS run_id
             FROM events
             WHERE type = 'project_phase_confirmed'
               AND json_extract(payload, '$.command') = 'confirm_prototype'
             ORDER BY id DESC
             LIMIT 1`
          )
          .get() as
          | { id: number; event_id: string; run_id: unknown }
          | undefined;
        if (!confirmation) {
          return {
            ok: false as const,
            reason: "prototype_confirmation_not_found"
          };
        }

        const reconciliationCompleted = db
          .prepare(
            `SELECT id
             FROM events
             WHERE type = 'conversation_reconciliation_completed'
               AND json_extract(payload, '$.reconciliation_id') = ?
             ORDER BY id DESC
             LIMIT 1`
          )
          .get(boundedReconciliationId) as { id: number } | undefined;
        if (!reconciliationCompleted) {
          return {
            ok: false as const,
            reason: "conversation_reconciliation_completion_not_found"
          };
        }
        if (reconciliationCompleted.id <= confirmation.id) {
          return {
            ok: false as const,
            reason: "conversation_reconciliation_before_prototype_confirmation"
          };
        }
        if (
          typeof confirmation.run_id === "string" &&
          confirmation.run_id.length > 0 &&
          reconciliation.run_id !== confirmation.run_id
        ) {
          return {
            ok: false as const,
            reason: "conversation_reconciliation_prototype_run_mismatch"
          };
        }
        prototypeConfirmationEventId = confirmation.event_id;
      }

      const rows = db
        .prepare(
          `SELECT f.id, f.summary, f.run_id, f.session_id,
                  f.evidence_surface_id, f.prototype_surface_id,
                  f.region_annotation_id, f.seed_reference_id,
                  f.opaque_context_json, f.created_at,
                  rf.reconciliation_id, rf.decision_disposition,
                  rf.source_message_ids_json,
                  c.proposal_id AS consumed_by_proposal_id,
                  d.reason AS dismissed_reason
           FROM designer_feedback f
           LEFT JOIN conversation_reconciliation_feedback rf
             ON rf.feedback_id = f.id
           LEFT JOIN designer_feedback_review_consumption c
             ON c.feedback_id = f.id
           LEFT JOIN designer_feedback_dismissals d
             ON d.feedback_id = f.id
           WHERE rf.reconciliation_id = ? OR rf.reconciliation_id IS NULL
           ORDER BY f.created_at ASC,
                    COALESCE(rf.position, 2147483647) ASC,
                    f.id ASC`
        )
        .all(boundedReconciliationId) as FeedbackJoinRow[];

      const feedback: ConsolidateReviewFeedback[] = rows.map((row) => ({
        id: row.id,
        summary: row.summary,
        run_id: row.run_id,
        session_id: row.session_id,
        evidence_surface_id: row.evidence_surface_id,
        prototype_surface_id: row.prototype_surface_id,
        region_annotation_id: row.region_annotation_id,
        seed_reference_id: row.seed_reference_id,
        opaque_context: decodeOpaqueJson(row.opaque_context_json),
        reconciliation_id: row.reconciliation_id,
        decision_disposition: row.decision_disposition,
        source_message_ids: row.source_message_ids_json === null
          ? []
          : JSON.parse(row.source_message_ids_json) as string[],
        created_at: row.created_at,
        review_state: reviewStateOf(row),
        consumed_by_proposal_id: row.consumed_by_proposal_id,
        dismissed_reason: row.dismissed_reason
      }));

      const unreviewedIds = feedback
        .filter((item) => item.review_state === "unreviewed")
        .map((item) => item.id);
      const event = buildLoggedEvent("consolidate_review_started", {
        reconciliation_id: boundedReconciliationId,
        prototype_confirmation_event_id: prototypeConfirmationEventId,
        feedback_count: feedback.length,
        unreviewed_feedback_count: unreviewedIds.length,
        unreviewed_feedback_ids: unreviewedIds
      });
      insertEvent(db, event);

      return {
        ok: true as const,
        feedback,
        feedback_count: feedback.length,
        unreviewed_feedback_ids: unreviewedIds,
        unreviewed_feedback_count: unreviewedIds.length,
        reconciliation_id: boundedReconciliationId,
        prototype_confirmation_event_id: prototypeConfirmationEventId,
        event_id: event.event_id
      };
    });
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

/**
 * Records the "no rule change" disposition for feedback the designer decided
 * against acting on. Requires an explicit reason so the audit trail keeps the
 * decision, not just its absence.
 */
export function dismissDesignerFeedback(
  projectPath: string,
  input: DismissDesignerFeedbackInput
): DismissDesignerFeedbackResult {
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  const feedbackIds = (input.feedbackIds ?? []).map((id) =>
    typeof id === "string" ? id.trim() : ""
  );
  if (
    reason.length === 0 ||
    feedbackIds.length === 0 ||
    feedbackIds.some((id) => id.length === 0)
  ) {
    return { ok: false, reason: "invalid_dismissal" };
  }
  const uniqueIds = [...new Set(feedbackIds)];

  try {
    const transaction = withProjectTransaction(projectPath, (db) => {
      const exists = db.prepare(`SELECT 1 FROM designer_feedback WHERE id = ?`);
      for (const id of uniqueIds) {
        if (!exists.get(id)) {
          return { ok: false as const, reason: "feedback_record_not_found" };
        }
      }

      const dismissedAt = new Date().toISOString();
      const dismiss = db.prepare(
        `INSERT OR IGNORE INTO designer_feedback_dismissals
           (feedback_id, reason, dismissed_at)
         VALUES (?, ?, ?)`
      );
      const eventIds: string[] = [];
      for (const id of uniqueIds) {
        dismiss.run(id, reason, dismissedAt);
        const event = buildLoggedEvent("designer_feedback_dismissed", {
          feedback_id: id,
          reason,
          dismissed_at: dismissedAt
        });
        insertEvent(db, event);
        eventIds.push(event.event_id);
      }

      return {
        ok: true as const,
        dismissedAt,
        eventIds,
        unreviewedCount: listUnreviewedDesignerFeedbackOnDb(db).length
      };
    });
    if (!transaction.ok) return transaction;
    return {
      ok: true,
      dismissed_feedback_ids: uniqueIds,
      reason,
      dismissed_at: transaction.dismissedAt,
      unreviewed_feedback_count: transaction.unreviewedCount,
      event_ids: transaction.eventIds
    };
  } catch {
    return { ok: false, reason: "db_error" };
  }
}
