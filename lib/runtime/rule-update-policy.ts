import type { DatabaseSync as DatabaseType } from "node:sqlite";

const RULE_UPDATE_PROTECTED_PHASES: ReadonlySet<string> = new Set([
  "prototype_validation",
  "design_system_formal",
  "ready_for_new_design"
]);

/**
 * Initial extraction and Draft review may author the first Design System
 * directly. Once Prototype validation begins, every Agent-authored Design
 * System change must instead carry a confirmed Rule Update proposal.
 */
export function phaseRequiresRuleUpdateProposal(phase: string): boolean {
  return RULE_UPDATE_PROTECTED_PHASES.has(phase);
}

export function projectRequiresRuleUpdateProposalOnDb(
  db: DatabaseType
): boolean {
  const row = db
    .prepare(`SELECT phase FROM project_phase WHERE singleton = 1`)
    .get() as { phase: string } | undefined;
  return phaseRequiresRuleUpdateProposal(row?.phase ?? "seed");
}

type RuleUpdateProposalAuthorizationRow = {
  status: string;
  kind: string;
  source_artifact_path: string | null;
  proposed_target_path: string | null;
};

export type RuleUpdateProposalPathAuthorization =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "proposal_not_found"
        | "proposal_not_confirmed"
        | "proposal_already_consumed"
        | "proposal_not_current_rule_update_cycle"
        | "proposal_artifact_path_mismatch";
      details?: unknown;
    };

/**
 * A confirmed proposal authorizes one exact artifact write in the current
 * protected Rule Update cycle. Event row ids are the ordering source because
 * timestamps can collide inside one millisecond.
 */
export function authorizeRuleUpdateProposalPathOnDb(
  db: DatabaseType,
  proposalId: string,
  artifactPath: string,
  requireCurrentCycleAndPath: boolean
): RuleUpdateProposalPathAuthorization {
  const proposal = db
    .prepare(
      `SELECT status, kind, source_artifact_path, proposed_target_path
       FROM rule_update_proposals
       WHERE id = ?`
    )
    .get(proposalId) as RuleUpdateProposalAuthorizationRow | undefined;
  if (!proposal) return { ok: false, reason: "proposal_not_found" };
  if (proposal.status !== "confirmed") {
    return { ok: false, reason: "proposal_not_confirmed" };
  }
  if (!requireCurrentCycleAndPath) return { ok: true };

  const proposalEvents = db
    .prepare(
      `SELECT
         (
           SELECT id FROM events
           WHERE type = 'rule_update_proposal_created'
             AND json_extract(payload, '$.proposal_id') = ?
           ORDER BY id DESC LIMIT 1
         ) AS created_id,
         (
           SELECT id FROM events
           WHERE type = 'rule_update_confirmed'
             AND json_extract(payload, '$.proposal_id') = ?
           ORDER BY id DESC LIMIT 1
         ) AS confirmed_id`
    )
    .get(proposalId, proposalId) as {
    created_id: number | null;
    confirmed_id: number | null;
  };
  if (
    proposalEvents.created_id === null ||
    proposalEvents.confirmed_id === null ||
    proposalEvents.confirmed_id <= proposalEvents.created_id
  ) {
    return { ok: false, reason: "proposal_not_current_rule_update_cycle" };
  }

  const phase = (
    db
      .prepare("SELECT phase FROM project_phase WHERE singleton = 1")
      .get() as { phase: string } | undefined
  )?.phase;
  let belongsToCurrentCycle = false;
  if (phase === "design_system_formal") {
    const confirmation = db
      .prepare(
        `SELECT id, event_id FROM events
         WHERE type = 'project_phase_confirmed'
           AND json_extract(payload, '$.command') = 'confirm_prototype'
         ORDER BY id DESC LIMIT 1`
      )
      .get() as { id: number; event_id: string } | undefined;
    if (confirmation !== undefined) {
      const review = db
        .prepare(
          `SELECT review.id
           FROM events review
           WHERE review.type = 'consolidate_review_started'
             AND review.id > ?
             AND review.id < ?
             AND json_extract(review.payload, '$.prototype_confirmation_event_id') = ?
             AND EXISTS (
               SELECT 1 FROM events reconciliation
               WHERE reconciliation.type = 'conversation_reconciliation_completed'
                 AND reconciliation.id > ?
                 AND reconciliation.id < review.id
                 AND json_extract(reconciliation.payload, '$.reconciliation_id') =
                     json_extract(review.payload, '$.reconciliation_id')
             )
           ORDER BY review.id DESC
           LIMIT 1`
        )
        .get(
          confirmation.id,
          proposalEvents.created_id,
          confirmation.event_id,
          confirmation.id
        ) as { id: number } | undefined;
      belongsToCurrentCycle = review !== undefined;
    }
  } else if (phase === "prototype_validation") {
    const boundary = db
      .prepare(
        `SELECT id FROM events
         WHERE type = 'project_phase_confirmed'
           AND json_extract(payload, '$.command') = 'confirm_draft_design_system'
           AND json_extract(payload, '$.phase') = 'prototype_validation'
         ORDER BY id DESC LIMIT 1`
      )
      .get() as { id: number } | undefined;
    belongsToCurrentCycle =
      boundary !== undefined && proposalEvents.created_id > boundary.id;
  } else if (phase === "ready_for_new_design") {
    const boundary = db
      .prepare(
        `SELECT id FROM events
         WHERE type = 'design_system_formalized'
           AND json_extract(payload, '$.phase') = 'ready_for_new_design'
         ORDER BY id DESC LIMIT 1`
      )
      .get() as { id: number } | undefined;
    belongsToCurrentCycle =
      boundary !== undefined && proposalEvents.created_id > boundary.id;
  }
  if (!belongsToCurrentCycle) {
    return { ok: false, reason: "proposal_not_current_rule_update_cycle" };
  }

  const authorizedPaths =
    proposal.kind === "move"
      ? [proposal.source_artifact_path, proposal.proposed_target_path]
      : [proposal.source_artifact_path];
  if (!authorizedPaths.includes(artifactPath)) {
    return {
      ok: false,
      reason: "proposal_artifact_path_mismatch",
      details: {
        artifactPath,
        authorizedPaths: authorizedPaths.filter(
          (candidate): candidate is string => candidate !== null
        )
      }
    };
  }

  const alreadyDeclared = db
    .prepare(
      `SELECT 1 AS consumed FROM events
       WHERE type = 'source_artifact_declared'
         AND json_extract(payload, '$.proposal_id') = ?
         AND json_extract(payload, '$.path') = ?
       LIMIT 1`
    )
    .get(proposalId, artifactPath);
  if (alreadyDeclared !== undefined) {
    return { ok: false, reason: "proposal_already_consumed" };
  }
  return { ok: true };
}

/**
 * True only for a proposal that could successfully authorize this exact path
 * right now. Invalid/mismatched/old proposals cannot hold auto-convergence
 * open forever.
 */
export function hasPendingAuthorizedRuleUpdateProposalForPathOnDb(
  db: DatabaseType,
  artifactPath: string
): boolean {
  if (!projectRequiresRuleUpdateProposalOnDb(db)) return false;
  const proposals = db
    .prepare(
      `SELECT id FROM rule_update_proposals
       WHERE status = 'confirmed'
         AND (source_artifact_path = ? OR proposed_target_path = ?)`
    )
    .all(artifactPath, artifactPath) as unknown as Array<{ id: string }>;
  return proposals.some(
    ({ id }) =>
      authorizeRuleUpdateProposalPathOnDb(db, id, artifactPath, true).ok
  );
}
