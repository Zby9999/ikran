import { randomUUID } from "node:crypto";
import path from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import {
  closeProjectDb,
  openProjectDb,
  withProjectTransaction
} from "./db";
import { emitRecordEvent } from "./record-bus";

export type AgentCommandScope =
  | { kind: "alignment_attempt"; id: string }
  | { kind: "rule_update_review"; id: string };

export type DurableAgentCommandStatus =
  | "pending"
  | "claimed"
  | "completed"
  | "cancelled"
  | "failed";

export type DurableAgentCommand = {
  id: string;
  command_type: string;
  status: DurableAgentCommandStatus;
  scope: AgentCommandScope;
  /** Compatibility projection for established Alignment consumers. */
  alignment_attempt_id: string | null;
  payload: Record<string, unknown>;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
  claimed_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
};

export type RuleUpdateReviewWaitScope = {
  scope: { kind: "rule_update_review"; id: string };
  status: "active" | "closed";
  opened_at: string;
  closed_at: string | null;
};

type AgentCommandRow = {
  id: string;
  command_type: string;
  status: DurableAgentCommandStatus;
  scope_kind: AgentCommandScope["kind"];
  scope_id: string;
  alignment_attempt_id: string | null;
  payload_json: string;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
  claimed_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
};

export type PublishAgentCommandInput = {
  id?: string;
  commandType: string;
  scope: AgentCommandScope;
  payload: Record<string, unknown>;
  idempotencyKey: string;
};

type PublishAgentCommandFailure = {
  ok: false;
  reason: "invalid_command" | "idempotency_conflict" | "db_error";
};

function nonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function mapDurableAgentCommand(row: AgentCommandRow): DurableAgentCommand {
  return {
    id: row.id,
    command_type: row.command_type,
    status: row.status,
    scope: { kind: row.scope_kind, id: row.scope_id } as AgentCommandScope,
    alignment_attempt_id: row.alignment_attempt_id,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    idempotency_key: row.idempotency_key,
    created_at: row.created_at,
    updated_at: row.updated_at,
    claimed_at: row.claimed_at,
    completed_at: row.completed_at,
    cancelled_at: row.cancelled_at
  };
}

function readAgentCommandByIdempotencyKeyOnDb(
  db: DatabaseType,
  idempotencyKey: string
): DurableAgentCommand | null {
  const row = db
    .prepare(
      `SELECT id, command_type, status, scope_kind, scope_id,
              alignment_attempt_id, payload_json, idempotency_key,
              created_at, updated_at, claimed_at, completed_at, cancelled_at
       FROM agent_commands
       WHERE idempotency_key = ?`
    )
    .get(idempotencyKey) as AgentCommandRow | undefined;
  return row ? mapDurableAgentCommand(row) : null;
}

function samePublication(
  existing: DurableAgentCommand,
  input: PublishAgentCommandInput
): boolean {
  return (
    existing.command_type === input.commandType &&
    existing.scope.kind === input.scope.kind &&
    existing.scope.id === input.scope.id &&
    JSON.stringify(existing.payload) === JSON.stringify(input.payload)
  );
}

/**
 * The single durable publication interface used by Alignment and Rule Update
 * producers. Callers already inside a project transaction use this variant so
 * the command can commit atomically with its domain transition.
 */
export function publishAgentCommandOnDb(
  db: DatabaseType,
  input: PublishAgentCommandInput,
  now = new Date().toISOString()
):
  | { ok: true; reused: boolean; command: DurableAgentCommand }
  | PublishAgentCommandFailure {
  if (
    !nonEmpty(input.commandType) ||
    !nonEmpty(input.scope.id) ||
    !nonEmpty(input.idempotencyKey)
  ) {
    return { ok: false, reason: "invalid_command" };
  }

  const existing = readAgentCommandByIdempotencyKeyOnDb(
    db,
    input.idempotencyKey
  );
  if (existing) {
    return samePublication(existing, input)
      ? { ok: true, reused: true, command: existing }
      : { ok: false, reason: "idempotency_conflict" };
  }

  const id = input.id ?? randomUUID();
  const alignmentAttemptId =
    input.scope.kind === "alignment_attempt" ? input.scope.id : null;
  db.prepare(
    `INSERT INTO agent_commands
       (id, command_type, status, scope_kind, scope_id,
        alignment_attempt_id, payload_json, idempotency_key,
        created_at, updated_at)
     VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.commandType,
    input.scope.kind,
    input.scope.id,
    alignmentAttemptId,
    JSON.stringify(input.payload),
    input.idempotencyKey,
    now,
    now
  );

  if (input.scope.kind === "rule_update_review") {
    db.prepare(
      `UPDATE agent_command_wait_scopes
       SET status = 'closed', active_slot = NULL, closed_at = ?
       WHERE scope_kind = 'rule_update_review' AND scope_id = ?
         AND status = 'active'`
    ).run(now, input.scope.id);
  }

  return {
    ok: true,
    reused: false,
    command: readAgentCommandByIdempotencyKeyOnDb(db, input.idempotencyKey)!
  };
}

/**
 * Public transaction boundary for producers that do not have another domain
 * write to commit. Rule Update publication also closes that review's wait
 * scope in the same transaction; the pending command remains recoverable.
 */
export function publishAgentCommand(
  projectPath: string,
  input: PublishAgentCommandInput
):
  | { ok: true; reused: boolean; command: DurableAgentCommand }
  | PublishAgentCommandFailure {
  try {
    const result = withProjectTransaction(projectPath, (db) =>
      publishAgentCommandOnDb(db, input)
    );
    if (result.ok && !result.reused) {
      emitRecordEvent({
        kind: "agent-command",
        action: "created",
        id: result.command.id,
        projectPath: path.resolve(projectPath)
      });
    }
    return result;
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

export function findEarliestPendingAgentCommand(
  projectPath: string
): DurableAgentCommand | null {
  const db = openProjectDb(projectPath);
  try {
    const row = db
      .prepare(
        `SELECT id, command_type, status, scope_kind, scope_id,
                alignment_attempt_id, payload_json, idempotency_key,
                created_at, updated_at, claimed_at, completed_at, cancelled_at
         FROM agent_commands
         WHERE status = 'pending'
         ORDER BY created_at ASC, id ASC
         LIMIT 1`
      )
      .get() as AgentCommandRow | undefined;
    return row ? mapDurableAgentCommand(row) : null;
  } finally {
    closeProjectDb(db);
  }
}

export function readActiveRuleUpdateReviewWaitScope(
  projectPath: string
): RuleUpdateReviewWaitScope | null {
  const db = openProjectDb(projectPath);
  try {
    const row = db
      .prepare(
        `SELECT scope_id, status, opened_at, closed_at
         FROM agent_command_wait_scopes
         WHERE scope_kind = 'rule_update_review' AND status = 'active'
         LIMIT 1`
      )
      .get() as
      | {
          scope_id: string;
          status: "active";
          opened_at: string;
          closed_at: string | null;
        }
      | undefined;
    return row
      ? {
          scope: { kind: "rule_update_review", id: row.scope_id },
          status: row.status,
          opened_at: row.opened_at,
          closed_at: row.closed_at
        }
      : null;
  } finally {
    closeProjectDb(db);
  }
}

export function activateRuleUpdateReviewWait(
  projectPath: string,
  reviewId: string
):
  | { ok: true; reused: boolean; wait_scope: RuleUpdateReviewWaitScope }
  | {
      ok: false;
      reason: "review_id_required" | "another_review_wait_active" | "db_error";
    } {
  if (!nonEmpty(reviewId)) {
    return { ok: false, reason: "review_id_required" };
  }
  try {
    const result = withProjectTransaction(projectPath, (db) => {
      const active = db
        .prepare(
          `SELECT scope_id, opened_at
           FROM agent_command_wait_scopes
           WHERE scope_kind = 'rule_update_review' AND status = 'active'
           LIMIT 1`
        )
        .get() as { scope_id: string; opened_at: string } | undefined;
      if (active?.scope_id === reviewId) {
        return {
          ok: true as const,
          reused: true,
          wait_scope: {
            scope: { kind: "rule_update_review" as const, id: reviewId },
            status: "active" as const,
            opened_at: active.opened_at,
            closed_at: null
          }
        };
      }
      if (active) {
        return {
          ok: false as const,
          reason: "another_review_wait_active" as const
        };
      }
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO agent_command_wait_scopes
           (scope_kind, scope_id, status, active_slot, opened_at, closed_at)
         VALUES ('rule_update_review', ?, 'active', 1, ?, NULL)
         ON CONFLICT(scope_kind, scope_id) DO UPDATE SET
           status = 'active', active_slot = 1, opened_at = excluded.opened_at,
           closed_at = NULL`
      ).run(reviewId, now);
      return {
        ok: true as const,
        reused: false,
        wait_scope: {
          scope: { kind: "rule_update_review" as const, id: reviewId },
          status: "active" as const,
          opened_at: now,
          closed_at: null
        }
      };
    });
    if (result.ok && !result.reused) {
      emitRecordEvent({
        kind: "agent-command",
        action: "updated",
        id: reviewId,
        projectPath: path.resolve(projectPath)
      });
    }
    return result;
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

export function closeRuleUpdateReviewWait(
  projectPath: string,
  reviewId: string
): { ok: true; reused: boolean } | { ok: false; reason: "db_error" } {
  try {
    const changed = withProjectTransaction(projectPath, (db) => {
      const now = new Date().toISOString();
      return Number(
        db
          .prepare(
            `UPDATE agent_command_wait_scopes
             SET status = 'closed', active_slot = NULL, closed_at = ?
             WHERE scope_kind = 'rule_update_review' AND scope_id = ?
               AND status = 'active'`
          )
          .run(now, reviewId).changes
      );
    });
    if (changed > 0) {
      emitRecordEvent({
        kind: "agent-command",
        action: "updated",
        id: reviewId,
        projectPath: path.resolve(projectPath)
      });
    }
    return { ok: true, reused: changed === 0 };
  } catch {
    return { ok: false, reason: "db_error" };
  }
}
