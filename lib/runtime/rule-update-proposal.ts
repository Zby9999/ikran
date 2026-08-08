// Rule-update proposals (Issue 12 contract, Issue 29 chat-path shape).
//
// A proposal is proposal-first and durable: `proposeRuleUpdate` persists a
// `rule_update_proposals` row plus a `rule_update_proposal_created` event and
// never touches a source artifact. Only `confirmRuleUpdate` authorizes a
// later write, and `record_artifact_written` may be linked to that confirmed
// proposal id (see source-artifact.ts). `cancelRuleUpdate` closes a proposal
// without consuming evidence or changing any artifact.

import { randomUUID } from "node:crypto";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { withProjectTransaction } from "./db";
import { isCaptureBearingArtifactPath } from "./design-system-schema";
import { assertArtifactPathInProject } from "./evidence-package";
import { buildLoggedEvent, insertEvent } from "./events";
import { parseJsonStringArray } from "./json-columns";
import { canonicalizeArtifactPath } from "./source-artifact";

export const RULE_UPDATE_PROPOSAL_KINDS = ["new", "update", "move"] as const;

export type RuleUpdateProposalKind =
  (typeof RULE_UPDATE_PROPOSAL_KINDS)[number];

/** Issue 12 / workflow six-part disposition taxonomy. */
export const RULE_UPDATE_CLASSIFICATIONS = [
  "local_exception",
  "reusable_candidate",
  "rule_conflict",
  "open_gap",
  "proposed_update",
  "no_finding"
] as const;

export type RuleUpdateClassification =
  (typeof RULE_UPDATE_CLASSIFICATIONS)[number];

export type RuleUpdateProposalStatus =
  | "awaiting_confirmation"
  | "confirmed"
  | "canceled";

export interface ProposeRuleUpdateInput {
  /** Defaults to `move` so pre-Issue-29 move-only callers keep working. */
  kind?: string;
  /** Defaults to `proposed_update` for legacy move-only callers. */
  classification?: string;
  title?: string;
  changeDescription?: string;
  reason: string;
  affectedItems: string[];
  evidenceRecordIds: string[];
  /** Required for kind=move; optional context for new/update. */
  sourceArtifactPath?: string;
  entryId?: string;
  proposedTargetPath?: string;
}

export interface RuleUpdateProposal {
  proposal_id: string;
  kind: RuleUpdateProposalKind;
  classification: RuleUpdateClassification;
  title: string;
  change_description: string;
  reason: string;
  affected_items: string[];
  evidence_record_ids: string[];
  status: RuleUpdateProposalStatus;
  source_artifact_path: string | null;
  entry_id: string | null;
  proposed_target_path: string | null;
  created_at: string;
  decided_at: string | null;
}

export type ProposeRuleUpdateResult =
  | {
      ok: true;
      proposal: RuleUpdateProposal & { status: "awaiting_confirmation" };
      event_id: string;
    }
  | { ok: false; reason: string };

export interface RuleUpdateDecisionInput {
  proposalId: string;
}

export type ConfirmRuleUpdateResult =
  | {
      ok: true;
      proposal: RuleUpdateProposal & { status: "confirmed" };
      consumed_feedback_ids: string[];
      event_id: string;
      /**
       * Agent-facing capture guidance, present when the confirmed proposal
       * targets a design-system rule artifact (layout / components.spec) that
       * carries sourceCaptures. Null otherwise.
       */
      capture_guidance: string | null;
    }
  | { ok: false; reason: string };

/**
 * Shown on confirm for rule artifacts with sourceCaptures: fresh capture or
 * honest omission, never a reused file.
 */
export const RULE_UPDATE_CAPTURE_GUIDANCE =
  "If a preview surface is ready, capture a fresh screenshot with " +
  "capture_rule_screenshot and declare it in sourceCaptures; otherwise " +
  "capture via the host Figma MCP or omit the field (honest unavailable). " +
  "Never reuse another rule's existing capture file.";

/** Rule artifacts carrying sourceCaptures: layout rules + component specs. */
function targetsCaptureArtifact(proposal: RuleUpdateProposal): boolean {
  const paths = [proposal.proposed_target_path, proposal.source_artifact_path];
  return paths.some(
    (artifactPath) =>
      artifactPath !== null && isCaptureBearingArtifactPath(artifactPath)
  );
}

export type CancelRuleUpdateResult =
  | {
      ok: true;
      proposal: RuleUpdateProposal & { status: "canceled" };
      event_id: string;
    }
  | { ok: false; reason: string };

type ProposalRow = {
  id: string;
  kind: string;
  classification: string;
  title: string;
  change_description: string;
  reason: string;
  affected_items_json: string;
  evidence_record_ids_json: string;
  status: string;
  source_artifact_path: string | null;
  entry_id: string | null;
  proposed_target_path: string | null;
  created_at: string;
  decided_at: string | null;
};

const EVIDENCE_TABLES = [
  "alignment_question_cards",
  "agent_alignment_annotations",
  "region_annotations",
  "figma_evidence_surfaces",
  "seed_references",
  "designer_feedback"
] as const;

function isKind(value: string): value is RuleUpdateProposalKind {
  return (RULE_UPDATE_PROPOSAL_KINDS as readonly string[]).includes(value);
}

function isClassification(value: string): value is RuleUpdateClassification {
  return (RULE_UPDATE_CLASSIFICATIONS as readonly string[]).includes(value);
}

function trimmed(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Concise fallback title for legacy move-only callers that send none. */
function deriveTitle(entryId: string, reason: string): string {
  if (entryId.length > 0) return `Move ${entryId}`;
  return reason.length > 120 ? `${reason.slice(0, 117)}...` : reason;
}

/** Canonical project-relative path; `value: null` when the input is absent. */
function canonicalProjectPath(
  projectPath: string,
  rawPath: string
): { ok: true; value: string | null } | { ok: false } {
  if (rawPath.length === 0) return { ok: true, value: null };
  if (assertArtifactPathInProject(projectPath, rawPath) !== null) {
    return { ok: false };
  }
  const canonical = canonicalizeArtifactPath(projectPath, rawPath);
  return canonical === null ? { ok: false } : { ok: true, value: canonical };
}

function mapProposalRow(row: ProposalRow): RuleUpdateProposal {
  return {
    proposal_id: row.id,
    kind: row.kind as RuleUpdateProposalKind,
    classification: row.classification as RuleUpdateClassification,
    title: row.title,
    change_description: row.change_description,
    reason: row.reason,
    affected_items: parseJsonStringArray(row.affected_items_json),
    evidence_record_ids: parseJsonStringArray(row.evidence_record_ids_json),
    status: row.status as RuleUpdateProposalStatus,
    source_artifact_path: row.source_artifact_path,
    entry_id: row.entry_id,
    proposed_target_path: row.proposed_target_path,
    created_at: row.created_at,
    decided_at: row.decided_at
  };
}

export function readRuleUpdateProposalOnDb(
  db: DatabaseType,
  proposalId: string
): RuleUpdateProposal | null {
  const row = db
    .prepare(`SELECT * FROM rule_update_proposals WHERE id = ?`)
    .get(proposalId) as ProposalRow | undefined;
  return row ? mapProposalRow(row) : null;
}

/**
 * Records one proposal. This command deliberately does not edit any artifact:
 * confirmation / cancel remains a separate designer-owned flow.
 */
export function proposeRuleUpdate(
  projectPath: string,
  input: ProposeRuleUpdateInput
): ProposeRuleUpdateResult {
  const kindInput = trimmed(input.kind);
  const kind: RuleUpdateProposalKind =
    kindInput.length === 0 ? "move" : (kindInput as RuleUpdateProposalKind);
  if (!isKind(kind)) return { ok: false, reason: "invalid_proposal_kind" };

  const classificationInput = trimmed(input.classification);
  const classification: RuleUpdateClassification =
    classificationInput.length === 0
      ? "proposed_update"
      : (classificationInput as RuleUpdateClassification);
  if (!isClassification(classification)) {
    return { ok: false, reason: "invalid_proposal_classification" };
  }

  const reason = trimmed(input.reason);
  const affectedItems = (input.affectedItems ?? []).map((item) =>
    typeof item === "string" ? item.trim() : ""
  );
  const evidenceRecordIds = (input.evidenceRecordIds ?? []).map((id) =>
    typeof id === "string" ? id.trim() : ""
  );
  if (
    reason.length === 0 ||
    affectedItems.length === 0 ||
    evidenceRecordIds.length === 0 ||
    affectedItems.some((item) => item.length === 0) ||
    evidenceRecordIds.some((id) => id.length === 0)
  ) {
    return { ok: false, reason: "invalid_proposal" };
  }

  const entryId = trimmed(input.entryId);
  const rawSourcePath = trimmed(input.sourceArtifactPath);
  const rawTargetPath = trimmed(input.proposedTargetPath);

  if (
    kind === "move" &&
    (entryId.length === 0 ||
      rawSourcePath.length === 0 ||
      rawTargetPath.length === 0)
  ) {
    return { ok: false, reason: "invalid_proposal" };
  }

  const title = trimmed(input.title) || deriveTitle(entryId, reason);
  const changeDescription = trimmed(input.changeDescription) || reason;
  if (kind !== "move" && (title.length === 0 || changeDescription.length === 0)) {
    return { ok: false, reason: "invalid_proposal" };
  }

  const sourcePath = canonicalProjectPath(projectPath, rawSourcePath);
  const targetPath = canonicalProjectPath(projectPath, rawTargetPath);
  if (!sourcePath.ok || !targetPath.ok) {
    return { ok: false, reason: "artifact_path_escape" };
  }

  const proposal: RuleUpdateProposal & { status: "awaiting_confirmation" } = {
    proposal_id: randomUUID(),
    kind,
    classification,
    title,
    change_description: changeDescription,
    reason,
    affected_items: affectedItems,
    evidence_record_ids: evidenceRecordIds,
    status: "awaiting_confirmation",
    source_artifact_path: sourcePath.value,
    entry_id: entryId.length === 0 ? null : entryId,
    proposed_target_path: targetPath.value,
    created_at: new Date().toISOString(),
    decided_at: null
  };

  try {
    const transaction = withProjectTransaction(projectPath, (db) => {
      if (kind === "move") {
        const entry = db
          .prepare(
            `SELECT 1 FROM design_system_entries
             WHERE source_artifact_path = ? AND entry_id = ?`
          )
          .get(proposal.source_artifact_path, proposal.entry_id);
        if (!entry) {
          return { ok: false as const, reason: "rule_entry_not_found" };
        }
      }

      const evidenceStatements = EVIDENCE_TABLES.map((table) =>
        db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`)
      );
      const reconciliationDisposition = db.prepare(
        `SELECT decision_disposition
         FROM conversation_reconciliation_feedback
         WHERE feedback_id = ?`
      );
      for (const recordId of proposal.evidence_record_ids) {
        if (!evidenceStatements.some((statement) => statement.get(recordId))) {
          return { ok: false as const, reason: "evidence_record_not_found" };
        }
        const reconciled = reconciliationDisposition.get(recordId) as
          | { decision_disposition: string }
          | undefined;
        if (
          reconciled !== undefined &&
          reconciled.decision_disposition !== "final_decision"
        ) {
          return {
            ok: false as const,
            reason: "non_final_reconciliation_evidence"
          };
        }
      }

      db.prepare(
        `INSERT INTO rule_update_proposals (
           id, kind, classification, title, change_description, reason,
           affected_items_json, evidence_record_ids_json, status,
           source_artifact_path, entry_id, proposed_target_path,
           created_at, decided_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
      ).run(
        proposal.proposal_id,
        proposal.kind,
        proposal.classification,
        proposal.title,
        proposal.change_description,
        proposal.reason,
        JSON.stringify(proposal.affected_items),
        JSON.stringify(proposal.evidence_record_ids),
        proposal.status,
        proposal.source_artifact_path,
        proposal.entry_id,
        proposal.proposed_target_path,
        proposal.created_at
      );

      const event = buildLoggedEvent("rule_update_proposal_created", {
        proposal_id: proposal.proposal_id,
        kind: proposal.kind,
        classification: proposal.classification,
        title: proposal.title,
        change_description: proposal.change_description,
        reason: proposal.reason,
        affected_items: proposal.affected_items,
        evidence_record_ids: proposal.evidence_record_ids,
        source_artifact_path: proposal.source_artifact_path,
        entry_id: proposal.entry_id,
        proposed_target_path: proposal.proposed_target_path,
        status: proposal.status,
        created_at: proposal.created_at
      });
      insertEvent(db, event);
      return { ok: true as const, event };
    });
    if (!transaction.ok) return transaction;
    return {
      ok: true,
      proposal,
      event_id: transaction.event.event_id
    };
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

/**
 * Confirms one awaiting proposal. Confirmation is the only authorization for a
 * later source-artifact write, and it records every designer_feedback evidence
 * id as consumed so the formalize gate can see its disposition.
 */
export function confirmRuleUpdate(
  projectPath: string,
  input: RuleUpdateDecisionInput
): ConfirmRuleUpdateResult {
  const proposalId = trimmed(input.proposalId);
  if (proposalId.length === 0) {
    return { ok: false, reason: "invalid_proposal_id" };
  }

  try {
    const transaction = withProjectTransaction(projectPath, (db) => {
      const proposal = readRuleUpdateProposalOnDb(db, proposalId);
      if (proposal === null) {
        return { ok: false as const, reason: "proposal_not_found" };
      }
      if (proposal.status !== "awaiting_confirmation") {
        return {
          ok: false as const,
          reason: "proposal_not_awaiting_confirmation"
        };
      }

      const decidedAt = new Date().toISOString();
      db.prepare(
        `UPDATE rule_update_proposals
         SET status = 'confirmed', decided_at = ?
         WHERE id = ?`
      ).run(decidedAt, proposalId);

      const isFeedback = db.prepare(
        `SELECT 1 FROM designer_feedback WHERE id = ?`
      );
      const consume = db.prepare(
        `INSERT OR IGNORE INTO designer_feedback_review_consumption
           (feedback_id, proposal_id, consumed_at)
         VALUES (?, ?, ?)`
      );
      const consumedFeedbackIds: string[] = [];
      for (const recordId of proposal.evidence_record_ids) {
        if (!isFeedback.get(recordId)) continue;
        consume.run(recordId, proposalId, decidedAt);
        consumedFeedbackIds.push(recordId);
      }

      const event = buildLoggedEvent("rule_update_confirmed", {
        proposal_id: proposalId,
        kind: proposal.kind,
        classification: proposal.classification,
        title: proposal.title,
        consumed_feedback_ids: consumedFeedbackIds,
        status: "confirmed",
        decided_at: decidedAt
      });
      insertEvent(db, event);

      return {
        ok: true as const,
        proposal: {
          ...proposal,
          status: "confirmed" as const,
          decided_at: decidedAt
        },
        consumedFeedbackIds,
        event
      };
    });
    if (!transaction.ok) return transaction;
    return {
      ok: true,
      proposal: transaction.proposal,
      consumed_feedback_ids: transaction.consumedFeedbackIds,
      event_id: transaction.event.event_id,
      capture_guidance: targetsCaptureArtifact(transaction.proposal)
        ? RULE_UPDATE_CAPTURE_GUIDANCE
        : null
    };
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

/** Cancels one awaiting proposal: no artifact change, no evidence consumption. */
export function cancelRuleUpdate(
  projectPath: string,
  input: RuleUpdateDecisionInput
): CancelRuleUpdateResult {
  const proposalId = trimmed(input.proposalId);
  if (proposalId.length === 0) {
    return { ok: false, reason: "invalid_proposal_id" };
  }

  try {
    const transaction = withProjectTransaction(projectPath, (db) => {
      const proposal = readRuleUpdateProposalOnDb(db, proposalId);
      if (proposal === null) {
        return { ok: false as const, reason: "proposal_not_found" };
      }
      if (proposal.status !== "awaiting_confirmation") {
        return {
          ok: false as const,
          reason: "proposal_not_awaiting_confirmation"
        };
      }

      const decidedAt = new Date().toISOString();
      db.prepare(
        `UPDATE rule_update_proposals
         SET status = 'canceled', decided_at = ?
         WHERE id = ?`
      ).run(decidedAt, proposalId);

      const event = buildLoggedEvent("rule_update_canceled", {
        proposal_id: proposalId,
        kind: proposal.kind,
        classification: proposal.classification,
        title: proposal.title,
        status: "canceled",
        decided_at: decidedAt
      });
      insertEvent(db, event);

      return {
        ok: true as const,
        proposal: {
          ...proposal,
          status: "canceled" as const,
          decided_at: decidedAt
        },
        event
      };
    });
    if (!transaction.ok) return transaction;
    return {
      ok: true,
      proposal: transaction.proposal,
      event_id: transaction.event.event_id
    };
  } catch {
    return { ok: false, reason: "db_error" };
  }
}
