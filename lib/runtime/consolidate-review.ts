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
import {
  ruleUpdateCategories,
  type RuleUpdateCategory
} from "./rule-update-category";

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
  dismissed_disposition: DesignerFeedbackDismissalDisposition | null;
  existing_rule_entry_id: string | null;
}

export type DesignerFeedbackDismissalDisposition =
  | "local_only"
  | "superseded"
  | "open_gap"
  | "process_only"
  | "covered_by_existing_rule";

export interface RuleUpdateReviewDraftContract {
  allowed_target_categories: RuleUpdateCategory[];
  required_feedback_ids: string[];
  final_decision_policy: "proposal_or_existing_rule_coverage";
  merge_policy: "related decisions may share one proposal when no meaningful boundary is lost";
  existing_rule_entries: Array<{
    entry_id: string;
    name: string;
    file_kind: string;
    source_artifact_path: string;
    rule_body: string;
  }>;
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
      review_draft_contract: RuleUpdateReviewDraftContract;
      event_id: string;
    }
  | { ok: false; reason: string };

export interface DismissDesignerFeedbackInput {
  feedbackIds: string[];
  disposition: DesignerFeedbackDismissalDisposition;
  reason: string;
  existingRuleEntryId?: string;
}

export type DismissDesignerFeedbackResult =
  | {
      ok: true;
      dismissed_feedback_ids: string[];
      disposition: DesignerFeedbackDismissalDisposition;
      reason: string;
      existing_rule_entry_id: string | null;
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
  dismissed_disposition: DesignerFeedbackDismissalDisposition | null;
  existing_rule_entry_id: string | null;
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
                    json_extract(payload, '$.run_id') AS run_id,
                    json_extract(payload, '$.designer_message_id') AS designer_message_id
             FROM events
             WHERE type = 'project_phase_confirmed'
               AND json_extract(payload, '$.command') = 'confirm_prototype'
             ORDER BY id DESC
             LIMIT 1`
          )
          .get() as
          | {
              id: number;
              event_id: string;
              run_id: unknown;
              designer_message_id: unknown;
            }
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
        if (
          typeof confirmation.designer_message_id === "string" &&
          confirmation.designer_message_id.length > 0
        ) {
          const confirmationMessage = db
            .prepare(
              `SELECT 1 AS ok
               FROM conversation_reconciliations reconciliation,
                    json_each(reconciliation.transcript_json) message
               WHERE reconciliation.id = ?
                 AND json_extract(message.value, '$.id') = ?
                 AND json_extract(message.value, '$.role') = 'designer'
               LIMIT 1`
            )
            .get(
              boundedReconciliationId,
              confirmation.designer_message_id
            ) as { ok: number } | undefined;
          if (!confirmationMessage) {
            return {
              ok: false as const,
              reason: "prototype_confirmation_message_not_in_reconciliation"
            };
          }
        }
        const postConfirmationMutation = db
          .prepare(
            `SELECT 1 AS ok
             FROM events
             WHERE id > ?
               AND (
                 type IN ('prototype_preview_declared', 'component_preview_registered')
                 OR (
                   type = 'source_artifact_declared'
                   AND json_extract(payload, '$.artifact_type') IN ('code', 'prototype')
                 )
               )
             LIMIT 1`
          )
          .get(confirmation.id) as { ok: number } | undefined;
        if (postConfirmationMutation) {
          return { ok: false as const, reason: "prototype_review_stale" };
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
                  d.reason AS dismissed_reason,
                  d.disposition AS dismissed_disposition,
                  d.existing_rule_entry_id
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
        dismissed_reason: row.dismissed_reason,
        dismissed_disposition: row.dismissed_disposition,
        existing_rule_entry_id: row.existing_rule_entry_id
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

      const componentCategories = (db
        .prepare(
          `SELECT DISTINCT entry_id
           FROM design_system_entries
           WHERE file_kind = 'component-list.json'
             AND status <> 'retired'
           ORDER BY position ASC, entry_id ASC`
        )
        .all() as Array<{ entry_id: string }>).map(
          (row) => `component:${row.entry_id}` as const
        );
      const existingRuleEntries = db
        .prepare(
          `SELECT entry_id, name, file_kind, source_artifact_path,
                  COALESCE(meaning, value_json) AS rule_body
           FROM design_system_entries
           WHERE file_kind IN (
             'design-system.json', 'layout-rules.json',
             'interaction-rules.json', 'components.spec.json'
           )
             AND status <> 'retired'
           ORDER BY file_kind ASC, position ASC, entry_id ASC`
        )
        .all() as RuleUpdateReviewDraftContract["existing_rule_entries"];

      return {
        ok: true as const,
        feedback,
        feedback_count: feedback.length,
        unreviewed_feedback_ids: unreviewedIds,
        unreviewed_feedback_count: unreviewedIds.length,
        reconciliation_id: boundedReconciliationId,
        prototype_confirmation_event_id: prototypeConfirmationEventId,
        review_draft_contract: {
          allowed_target_categories: ruleUpdateCategories(componentCategories),
          required_feedback_ids: unreviewedIds,
          final_decision_policy: "proposal_or_existing_rule_coverage",
          merge_policy:
            "related decisions may share one proposal when no meaningful boundary is lost",
          existing_rule_entries: existingRuleEntries
        },
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
  const disposition = input.disposition;
  const existingRuleEntryId = typeof input.existingRuleEntryId === "string"
    ? input.existingRuleEntryId.trim()
    : "";
  const validDispositions = new Set<DesignerFeedbackDismissalDisposition>([
    "local_only",
    "superseded",
    "open_gap",
    "process_only",
    "covered_by_existing_rule"
  ]);
  const feedbackIds = (input.feedbackIds ?? []).map((id) =>
    typeof id === "string" ? id.trim() : ""
  );
  if (
    reason.length === 0 ||
    !validDispositions.has(disposition) ||
    feedbackIds.length === 0 ||
    feedbackIds.some((id) => id.length === 0) ||
    (disposition === "covered_by_existing_rule") !==
      (existingRuleEntryId.length > 0)
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

      if (disposition === "covered_by_existing_rule") {
        const existingRule = db
          .prepare(
            `SELECT 1 FROM design_system_entries
             WHERE entry_id = ? AND status <> 'retired' LIMIT 1`
          )
          .get(existingRuleEntryId);
        if (!existingRule) {
          return { ok: false as const, reason: "existing_rule_entry_not_found" };
        }
      }

      const reconciledDisposition = db.prepare(
        `SELECT decision_disposition
         FROM conversation_reconciliation_feedback
         WHERE feedback_id = ?`
      );
      for (const id of uniqueIds) {
        const row = reconciledDisposition.get(id) as
          | { decision_disposition: ConsolidateReviewFeedback["decision_disposition"] }
          | undefined;
        if (
          row?.decision_disposition === "final_decision" &&
          disposition !== "covered_by_existing_rule"
        ) {
          return {
            ok: false as const,
            reason: "final_decision_requires_rule_coverage"
          };
        }
        if (
          row?.decision_disposition === "superseded" &&
          !["superseded", "covered_by_existing_rule"].includes(disposition)
        ) {
          return { ok: false as const, reason: "dismissal_disposition_mismatch" };
        }
        if (
          row?.decision_disposition === "local_exception" &&
          !["local_only", "covered_by_existing_rule"].includes(disposition)
        ) {
          return { ok: false as const, reason: "dismissal_disposition_mismatch" };
        }
        if (
          row?.decision_disposition === "open_gap" &&
          !["open_gap", "covered_by_existing_rule"].includes(disposition)
        ) {
          return { ok: false as const, reason: "dismissal_disposition_mismatch" };
        }
      }

      const dismissedAt = new Date().toISOString();
      const dismiss = db.prepare(
        `INSERT INTO designer_feedback_dismissals
           (feedback_id, reason, dismissed_at, disposition,
            existing_rule_entry_id)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(feedback_id) DO UPDATE SET
           reason = excluded.reason,
           dismissed_at = excluded.dismissed_at,
           disposition = excluded.disposition,
           existing_rule_entry_id = excluded.existing_rule_entry_id`
      );
      const eventIds: string[] = [];
      for (const id of uniqueIds) {
        dismiss.run(
          id,
          reason,
          dismissedAt,
          disposition,
          existingRuleEntryId || null
        );
        const event = buildLoggedEvent("designer_feedback_dismissed", {
          feedback_id: id,
          disposition,
          reason,
          existing_rule_entry_id: existingRuleEntryId || null,
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
      disposition,
      reason,
      existing_rule_entry_id: existingRuleEntryId || null,
      dismissed_at: transaction.dismissedAt,
      unreviewed_feedback_count: transaction.unreviewedCount,
      event_ids: transaction.eventIds
    };
  } catch {
    return { ok: false, reason: "db_error" };
  }
}
