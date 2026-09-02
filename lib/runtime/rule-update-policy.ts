import type { DatabaseSync as DatabaseType } from "node:sqlite";
import type { DesignSystemIngestPlan } from "./design-system-ingest";
import { sortKeysDeep } from "./design-system-entry-provenance";

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
  current_revision: number;
  review_id: string | null;
};

export type RuleUpdateProposalPathAuthorization =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "proposal_not_found"
        | "proposal_not_confirmed"
        | "proposal_apply_not_claimed"
        | "proposal_already_consumed"
        | "proposal_not_current_rule_update_cycle"
        | "proposal_artifact_path_mismatch"
        | "proposal_base_digest_conflict";
      details?: unknown;
    };

type StoredRuleRow = {
  entry_id: string;
  file_kind: string;
  section: string;
  name: string | null;
  kind: string | null;
  domain: string | null;
  value_json: string;
  source_captures_json: string | null;
  meaning: string;
  status: string;
  links_json: string;
};

function parsedJson(raw: string | null, fallback: unknown): unknown {
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return fallback;
  }
}

function semanticRuleRow(row: StoredRuleRow): unknown {
  return sortKeysDeep({
    entry_id: row.entry_id,
    section: row.section,
    name: row.name,
    kind: row.kind,
    domain: row.domain,
    value: parsedJson(row.value_json, null),
    source_captures: parsedJson(row.source_captures_json, []),
    meaning: row.meaning,
    status: row.status,
    links: parsedJson(row.links_json, [])
  });
}

/**
 * Retire is deliberately narrower than a general artifact write: the staged
 * ingest must equal the current source with exactly the accepted entry gone.
 * Reordering is ignored because removing a row necessarily shifts positions.
 */
export function validateRuleUpdateIngestPlanOnDb(
  db: DatabaseType,
  proposalId: string,
  plan: DesignSystemIngestPlan
):
  | { ok: true }
  | {
      ok: false;
      reason: "retire_semantic_diff_mismatch" | "rule_update_semantic_diff_mismatch";
      details: unknown;
    } {
  const proposal = db
    .prepare(
      `SELECT p.kind, p.evidence_record_ids_json, r.full_rule_body,
              r.target_category, r.source_artifact_path, r.proposed_target_path,
              r.entry_id
       FROM rule_update_proposals p
       JOIN rule_update_proposal_revisions r
         ON r.proposal_id = p.id AND r.revision = p.current_revision
       WHERE p.id = ?`
    )
    .get(proposalId) as
    | {
        kind: string;
        evidence_record_ids_json: string;
        full_rule_body: string;
        target_category: string;
        source_artifact_path: string | null;
        proposed_target_path: string | null;
        entry_id: string | null;
      }
    | undefined;
  if (!proposal) return { ok: true };

  if (proposal.kind !== "retire") {
    const destination = proposal.proposed_target_path ?? proposal.source_artifact_path;
    const semanticFail = (details: unknown) => ({
      ok: false as const,
      reason: "rule_update_semantic_diff_mismatch" as const,
      details
    });
    if (destination !== plan.sourcePath) {
      return semanticFail({ expected_source: destination, observed_source: plan.sourcePath });
    }
    const currentIds = new Set(
      (db.prepare(
        "SELECT entry_id FROM design_system_entries WHERE source_artifact_path = ?"
      ).all(plan.sourcePath) as Array<{ entry_id: string }>).map((row) => row.entry_id)
    );
    const targetRows = proposal.target_category.startsWith("component:")
      ? plan.rows
      : proposal.entry_id
        ? plan.rows.filter((row) => row.entry_id === proposal.entry_id)
        : proposal.kind === "new"
          ? plan.rows.filter((row) => !currentIds.has(row.entry_id))
          : [];
    if (targetRows.length !== 1) {
      return semanticFail({
        expected_entry_id: proposal.entry_id,
        observed_entry_ids: targetRows.map((row) => row.entry_id)
      });
    }
    const target = targetRows[0]!;
    let bodyMatches = false;
    try {
      const parsed = JSON.parse(proposal.full_rule_body) as unknown;
      if (
        proposal.target_category.startsWith("component:") &&
        parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ) {
        const record = parsed as Record<string, unknown>;
        bodyMatches =
          record.id === target.entry_id &&
          JSON.stringify(sortKeysDeep(record.value)) ===
            JSON.stringify(sortKeysDeep(target.value)) &&
          record.status === target.status &&
          JSON.stringify(sortKeysDeep(record.links)) ===
            JSON.stringify(sortKeysDeep(target.links));
      } else {
        bodyMatches =
          JSON.stringify(sortKeysDeep(parsed)) ===
          JSON.stringify(sortKeysDeep(target.value));
      }
    } catch {
      bodyMatches =
        (typeof target.value === "string" && target.value === proposal.full_rule_body) ||
        target.meaning === proposal.full_rule_body ||
        (target.value !== null && typeof target.value === "object" &&
          !Array.isArray(target.value) &&
          (target.value as { description?: unknown }).description === proposal.full_rule_body);
    }
    if (!bodyMatches) {
      return semanticFail({
        entry_id: target.entry_id,
        expected_full_rule_body: proposal.full_rule_body
      });
    }
    let evidenceIds: string[] = [];
    try {
      const parsed = JSON.parse(proposal.evidence_record_ids_json) as unknown;
      if (Array.isArray(parsed)) {
        evidenceIds = parsed.filter((value): value is string => typeof value === "string");
      }
    } catch {
      return semanticFail({ invalid_proposal_evidence: true });
    }
    const sourceEvidence = evidenceIds.filter((id) =>
      db.prepare(
        `SELECT 1 FROM designer_feedback WHERE id = ?
         UNION ALL
         SELECT 1 FROM agent_alignment_annotations WHERE id = ?
         UNION ALL
         SELECT 1 FROM alignment_question_cards
          WHERE id = ? AND final_answer IS NOT NULL AND TRIM(final_answer) <> ''
         LIMIT 1`
      ).get(id, id, id) !== undefined
    );
    if (
      sourceEvidence.length === 0 ||
      !sourceEvidence.some((id) => target.links.includes(id))
    ) {
      return semanticFail({
        entry_id: target.entry_id,
        required_evidence_record_ids: sourceEvidence,
        observed_links: target.links
      });
    }
    return { ok: true };
  }

  const fail = (details: unknown) => ({
    ok: false as const,
    reason: "retire_semantic_diff_mismatch" as const,
    details
  });
  if (
    proposal.source_artifact_path !== plan.sourcePath ||
    proposal.entry_id === null
  ) {
    return fail({
      expected_source: proposal.source_artifact_path,
      observed_source: plan.sourcePath,
      entry_id: proposal.entry_id
    });
  }

  const current = db
    .prepare(
      `SELECT entry_id, file_kind, section, name, kind, domain, value_json,
              source_captures_json, meaning, status, links_json
       FROM design_system_entries
       WHERE source_artifact_path = ?`
    )
    .all(plan.sourcePath) as unknown as StoredRuleRow[];
  const target = current.find((row) => row.entry_id === proposal.entry_id);
  if (!target) return fail({ missing_target: proposal.entry_id });
  const source = db
    .prepare("SELECT artifact_type FROM source_artifacts WHERE path = ?")
    .get(plan.sourcePath) as { artifact_type: string } | undefined;
  if (
    source?.artifact_type !== plan.fileKind ||
    current.some((row) => row.file_kind !== plan.fileKind)
  ) {
    return fail({
      retired_entry_id: proposal.entry_id,
      expected_file_kind: source?.artifact_type ?? target.file_kind,
      observed_file_kind: plan.fileKind
    });
  }
  if (plan.fileKind === "design-system.json") {
    const meta = db
      .prepare("SELECT name FROM design_system_meta WHERE singleton = 1")
      .get() as { name: string } | undefined;
    if ((meta?.name ?? "") !== (plan.systemName ?? "")) {
      return fail({
        retired_entry_id: proposal.entry_id,
        changed_file_field: "name"
      });
    }
  }

  const expected = new Map(
    current
      .filter((row) => row.entry_id !== proposal.entry_id)
      .map((row) => [row.entry_id, JSON.stringify(semanticRuleRow(row))])
  );
  const observed = new Map(
    plan.rows.map((row) => [
      row.entry_id,
      JSON.stringify(sortKeysDeep({
        entry_id: row.entry_id,
        section: row.section,
        name: row.name,
        kind: row.kind,
        domain: row.domain,
        value: row.value,
        source_captures: row.source_captures,
        meaning: row.meaning,
        status: row.status,
        links: row.links
      }))
    ])
  );
  const expectedIds = [...expected.keys()].sort();
  const observedIds = [...observed.keys()].sort();
  if (JSON.stringify(expectedIds) !== JSON.stringify(observedIds)) {
    return fail({
      retired_entry_id: proposal.entry_id,
      expected_entry_ids: expectedIds,
      observed_entry_ids: observedIds
    });
  }
  for (const entryId of expectedIds) {
    if (expected.get(entryId) !== observed.get(entryId)) {
      return fail({ retired_entry_id: proposal.entry_id, changed_entry_id: entryId });
    }
  }
  return { ok: true };
}

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
      `SELECT status, kind, source_artifact_path, proposed_target_path,
              current_revision, review_id
       FROM rule_update_proposals
       WHERE id = ?`
    )
    .get(proposalId) as RuleUpdateProposalAuthorizationRow | undefined;
  if (!proposal) return { ok: false, reason: "proposal_not_found" };
  if (proposal.status !== "confirmed") {
    return { ok: false, reason: "proposal_not_confirmed" };
  }
  if (!requireCurrentCycleAndPath) return { ok: true };

  if (proposal.review_id !== null) {
    const revision = db
      .prepare(
        `SELECT base_digest, base_digests_json, source_artifact_path, proposed_target_path
         FROM rule_update_proposal_revisions
         WHERE proposal_id = ? AND revision = ?`
      )
      .get(proposalId, proposal.current_revision) as
      | {
          base_digest: string | null;
          base_digests_json: string;
          source_artifact_path: string | null;
          proposed_target_path: string | null;
        }
      | undefined;
    const decision = db
      .prepare(
        `SELECT decision FROM rule_update_designer_decisions
         WHERE proposal_id = ? AND revision = ?`
      )
      .get(proposalId, proposal.current_revision) as
      | { decision: string }
      | undefined;
    if (!revision || decision?.decision !== "accepted") {
      return { ok: false, reason: "proposal_not_confirmed" };
    }
    const attempt = db
      .prepare(
        `SELECT status, claimed_base_digests_json
         FROM rule_update_apply_attempts
         WHERE proposal_id = ? AND revision = ?
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(proposalId, proposal.current_revision) as
      | { status: string; claimed_base_digests_json: string | null }
      | undefined;
    if (attempt?.status !== "claimed" || !attempt.claimed_base_digests_json) {
      return { ok: false, reason: "proposal_apply_not_claimed" };
    }
    const authorizedPaths = [
      revision.source_artifact_path,
      revision.proposed_target_path
    ];
    if (!authorizedPaths.includes(artifactPath)) {
      return {
        ok: false,
        reason: "proposal_artifact_path_mismatch",
        details: { artifactPath, authorizedPaths: authorizedPaths.filter(Boolean) }
      };
    }
    const current = db
      .prepare("SELECT content_digest FROM source_artifacts WHERE path = ?")
      .get(artifactPath) as { content_digest: string | null } | undefined;
    const observed = current ? current.content_digest ?? "missing-digest" : "missing-source";
    let expected = revision.base_digest;
    try {
      const digests = JSON.parse(
        attempt.claimed_base_digests_json
      ) as Record<string, string>;
      expected = digests[artifactPath] ?? expected;
    } catch {
      // Legacy row: fall back to the single digest projection.
    }
    if (expected !== observed) {
      const now = new Date().toISOString();
      db.prepare(
        `UPDATE rule_update_apply_attempts
         SET status = 'needs_revision', observed_digest = ?, error = ?, completed_at = ?
         WHERE proposal_id = ? AND revision = ? AND status IN ('pending', 'claimed')`
      ).run(
        observed,
        "base_digest_conflict",
        now,
        proposalId,
        proposal.current_revision
      );
      return {
        ok: false,
        reason: "proposal_base_digest_conflict",
        details: { expected, observed, path: artifactPath }
      };
    }
    return { ok: true };
  }

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
