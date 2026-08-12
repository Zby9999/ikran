import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { activateRuleUpdateReviewWaitOnDb } from "./agent-command";
import { withProjectTransaction } from "./db";
import { logEventOnDb } from "./events";

export function claimedRuleUpdateApplyIdentityOnDb(
  db: DatabaseType,
  proposalId: string,
  artifactPath: string
): { commandId: string; revision: number } | null {
  const row = db
    .prepare(
      `SELECT a.command_id, a.revision
       FROM rule_update_apply_attempts a
       JOIN rule_update_proposal_revisions r
         ON r.proposal_id = a.proposal_id AND r.revision = a.revision
       WHERE a.proposal_id = ? AND a.status = 'claimed'
         AND (r.source_artifact_path = ? OR r.proposed_target_path = ?)
       ORDER BY a.created_at DESC LIMIT 1`
    )
    .get(proposalId, artifactPath, artifactPath) as
    | { command_id: string; revision: number }
    | undefined;
  return row ? { commandId: row.command_id, revision: row.revision } : null;
}

export function markRuleUpdateDeclarationConflict(
  projectPath: string,
  proposalId: string,
  conflict: { path: string; expected: string | null; observed: string }
): void {
  withProjectTransaction(projectPath, (db) => {
    const attempt = db
      .prepare(
        `SELECT command_id, review_id, revision
         FROM rule_update_apply_attempts
         WHERE proposal_id = ? AND status = 'claimed'
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(proposalId) as
      | { command_id: string; review_id: string; revision: number }
      | undefined;
    if (!attempt) return;
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE rule_update_apply_attempts
       SET status = 'needs_revision', observed_digest = ?, error = ?, completed_at = ?
       WHERE command_id = ? AND status = 'claimed'`
    ).run(conflict.observed, "base_digest_conflict", now, attempt.command_id);
    db.prepare(
      `UPDATE agent_commands SET status = 'failed', updated_at = ?
       WHERE id = ? AND status = 'claimed'`
    ).run(now, attempt.command_id);
    activateRuleUpdateReviewWaitOnDb(db, attempt.review_id, now);
    logEventOnDb(db, "rule_update_apply_failed", {
      review_id: attempt.review_id,
      proposal_id: proposalId,
      revision: attempt.revision,
      command_id: attempt.command_id,
      error: "base_digest_conflict",
      conflict,
      failed_at: now
    });
  });
}

export function completeRuleUpdateApplyOnArtifactDeclaration(
  db: DatabaseType,
  proposalId: string,
  artifactPath: string,
  observedDigest: string | null,
  now: string
): { applied: boolean; reviewId: string | null } {
  const attempt = db
    .prepare(
      `SELECT a.id, a.command_id, a.review_id, a.revision,
              r.source_artifact_path, r.proposed_target_path
       FROM rule_update_apply_attempts a
       JOIN rule_update_proposal_revisions r
         ON r.proposal_id = a.proposal_id AND r.revision = a.revision
       WHERE a.proposal_id = ? AND a.status = 'claimed'
       ORDER BY a.created_at DESC LIMIT 1`
    )
    .get(proposalId) as
    | {
        id: string;
        command_id: string;
        review_id: string;
        revision: number;
        source_artifact_path: string | null;
        proposed_target_path: string | null;
      }
    | undefined;
  if (!attempt) return { applied: false, reviewId: null };
  const authorized = [attempt.source_artifact_path, attempt.proposed_target_path]
    .filter((value): value is string => value !== null);
  if (!authorized.includes(artifactPath)) {
    return { applied: false, reviewId: attempt.review_id };
  }
  const remaining = [...new Set(authorized)].filter((requiredPath) =>
    !db
      .prepare(
        `SELECT 1 FROM events
         WHERE type = 'source_artifact_declared'
           AND json_extract(payload, '$.proposal_id') = ?
           AND json_extract(payload, '$.path') = ?
           AND json_extract(payload, '$.rule_update_command_id') = ?
           AND json_extract(payload, '$.rule_update_revision') = ?
         LIMIT 1`
      )
      .get(proposalId, requiredPath, attempt.command_id, attempt.revision)
  );
  if (remaining.length > 0) {
    return { applied: false, reviewId: attempt.review_id };
  }
  const observedDigests: Record<string, string> = {};
  for (const requiredPath of [...new Set(authorized)]) {
    const row = db
      .prepare("SELECT content_digest FROM source_artifacts WHERE path = ?")
      .get(requiredPath) as { content_digest: string | null } | undefined;
    observedDigests[requiredPath] = row
      ? row.content_digest ?? "missing-digest"
      : "missing-source";
  }
  db.prepare(
    `UPDATE rule_update_apply_attempts
     SET status = 'applied', observed_digest = ?, completed_at = ?
     WHERE id = ?`
  ).run(observedDigest, now, attempt.id);
  db.prepare(
    `UPDATE agent_commands
     SET status = 'completed', completed_at = ?, updated_at = ?
     WHERE id = ? AND status IN ('pending', 'claimed')`
  ).run(now, now, attempt.command_id);
  logEventOnDb(db, "rule_update_applied", {
    review_id: attempt.review_id,
    proposal_id: proposalId,
    revision: attempt.revision,
    command_id: attempt.command_id,
    artifact_path: artifactPath,
    observed_digest: observedDigest,
    observed_digests: observedDigests,
    applied_at: now
  });
  settleOrRewaitReviewOnDb(db, attempt.review_id, now);
  return { applied: true, reviewId: attempt.review_id };
}

export function settleOrRewaitReviewOnDb(
  db: DatabaseType,
  reviewId: string,
  now: string
): void {
  const unfinished = (db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM rule_update_proposals p
       LEFT JOIN rule_update_designer_decisions d
         ON d.proposal_id = p.id AND d.revision = p.current_revision
       LEFT JOIN rule_update_apply_attempts a
         ON a.proposal_id = p.id AND a.revision = p.current_revision
       WHERE p.review_id = ?
         AND NOT (
           d.decision = 'rejected'
           OR (d.decision = 'accepted' AND a.status = 'applied')
         )`
    )
    .get(reviewId) as { count: number }).count;
  const queued = (db
    .prepare(
      `SELECT COUNT(*) AS count FROM agent_commands
       WHERE scope_kind = 'rule_update_review' AND scope_id = ?
         AND status IN ('pending', 'claimed')`
    )
    .get(reviewId) as { count: number }).count;
  if (queued > 0) return;
  if (unfinished > 0) {
    activateRuleUpdateReviewWaitOnDb(db, reviewId, now);
    return;
  }
  db.prepare(
    `UPDATE rule_update_reviews
     SET status = 'completed', completed_at = ? WHERE id = ?`
  ).run(now, reviewId);
  db.prepare(
    `UPDATE agent_command_wait_scopes
     SET status = 'closed', active_slot = NULL, closed_at = ?
     WHERE scope_kind = 'rule_update_review' AND scope_id = ?`
  ).run(now, reviewId);
}
