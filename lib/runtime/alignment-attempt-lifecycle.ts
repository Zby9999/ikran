import path from "node:path";

import { withProjectTransaction } from "./db";
import { getAlignmentPreparationOnDb } from "./alignment-preparation";
import { logEventOnDb } from "./events";
import { emitRecordEvent } from "./record-bus";

type AbandonFailureReason =
  | "no_active_alignment_attempt"
  | "alignment_completed"
  | "db_error";

type AbandonFailure = { ok: false; reason: AbandonFailureReason };

export function abandonCurrentAlignmentAttempt(projectPath: string) {
  try {
    const result = withProjectTransaction(projectPath, (db) => {
      const alignment = db
        .prepare("SELECT status FROM design_intent_alignment WHERE singleton = 1")
        .get() as { status: string } | undefined;
      if (alignment?.status === "completed") {
        return { ok: false, reason: "alignment_completed" } as AbandonFailure;
      }
      const current = getAlignmentPreparationOnDb(db);
      const attempt = current.current_attempt;
      if (
        !attempt ||
        (attempt.status !== "preparing" && attempt.status !== "answering") ||
        (current.workflow.stage !== "alignment-preparing" &&
          current.workflow.stage !== "alignment-answering")
      ) {
        return {
          ok: false,
          reason: "no_active_alignment_attempt"
        } as AbandonFailure;
      }
      const now = new Date().toISOString();
      db.prepare(
        `UPDATE alignment_attempts
         SET status = 'abandoned', abandoned_at = ?, updated_at = ?
         WHERE id = ?`
      ).run(now, now, attempt.id);
      const cancelled = db.prepare(
        `UPDATE agent_commands
         SET status = 'cancelled', cancelled_at = ?, updated_at = ?
         WHERE alignment_attempt_id = ? AND status IN ('pending', 'claimed')`
      ).run(now, now, attempt.id);
      db.prepare(
        `UPDATE project_workflow
         SET stage = 'seed-reference-registration',
             current_alignment_attempt_id = NULL,
             updated_at = ?
         WHERE singleton = 1`
      ).run(now);
      const event = logEventOnDb(db, "alignment_attempt_abandoned", {
        alignment_attempt_id: attempt.id,
        input_snapshot_id: attempt.input_snapshot_id,
        cancelled_command_count: Number(cancelled.changes)
      });
      return {
        ok: true as const,
        reused: false,
        attempt: { ...attempt, status: "abandoned" as const, updated_at: now, abandoned_at: now },
        workflow: {
          stage: "seed-reference-registration" as const,
          current_alignment_attempt_id: null,
          updated_at: now
        },
        input_snapshot_id: attempt.input_snapshot_id,
        cancelled_command_count: Number(cancelled.changes),
        event_id: event.event_id
      };
    });
    if (result.ok) {
      emitRecordEvent({
        kind: "alignment",
        action: "updated",
        id: result.attempt.id,
        projectPath: path.resolve(projectPath)
      });
    }
    return result;
  } catch {
    return { ok: false, reason: "db_error" } as AbandonFailure;
  }
}
