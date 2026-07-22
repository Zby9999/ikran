import path from "node:path";

import { withProjectTransaction } from "./db";
import { ALIGNMENT_SECTIONS } from "./design-intent-alignment";
import { logEventOnDb } from "./events";
import { getAlignmentPreparationOnDb } from "./alignment-preparation";
import { emitRecordEvent } from "./record-bus";

type CommandFailureReason =
  | "no_pending_alignment_command"
  | "stale_alignment_attempt"
  | "alignment_command_not_claimed"
  | "coverage_incomplete"
  | "db_error";

type CommandFailure = { ok: false; reason: CommandFailureReason };

export function claimAlignmentPreparationCommand(projectPath: string) {
  try {
    const result = withProjectTransaction(projectPath, (db) => {
      const state = getAlignmentPreparationOnDb(db);
      const attempt = state.current_attempt;
      const command = state.commands.find(
        (candidate) =>
          candidate.command_type === "prepare_design_intent_alignment"
      );
      if (
        state.workflow.stage !== "alignment-preparing" ||
        attempt?.status !== "preparing" ||
        !state.input_snapshot ||
        !command ||
        (command.status !== "pending" && command.status !== "claimed")
      ) {
        return {
          ok: false,
          reason: "no_pending_alignment_command"
        } as CommandFailure;
      }
      if (command.status === "claimed") {
        return {
          ok: true as const,
          reused: true,
          command,
          attempt,
          input_snapshot: state.input_snapshot,
          event_id: null
        };
      }
      const now = new Date().toISOString();
      db.prepare(
        `UPDATE agent_commands
         SET status = 'claimed', claimed_at = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`
      ).run(now, now, command.id);
      const event = logEventOnDb(db, "agent_command_claimed", {
        agent_command_id: command.id,
        command_type: command.command_type,
        alignment_attempt_id: attempt.id,
        input_snapshot_id: state.input_snapshot.id
      });
      const claimed = getAlignmentPreparationOnDb(db);
      return {
        ok: true as const,
        reused: false,
        command: claimed.commands.find(
          (candidate) => candidate.id === command.id
        )!,
        attempt: claimed.current_attempt!,
        input_snapshot: claimed.input_snapshot!,
        event_id: event.event_id
      };
    });
    if (result.ok && !result.reused) {
      emitRecordEvent({
        kind: "alignment",
        action: "updated",
        id: result.attempt.id,
        projectPath: path.resolve(projectPath)
      });
    }
    return result;
  } catch {
    return { ok: false, reason: "db_error" } as CommandFailure;
  }
}

function preparationCoverageComplete(
  rows: Array<{ section: string; proposed_answer: string | null }>
): boolean {
  return ALIGNMENT_SECTIONS.every((section) => {
    const cards = rows.filter((row) => row.section === section);
    return (
      cards.length >= 2 &&
      cards.length <= 5 &&
      cards.every(
        (card) =>
          typeof card.proposed_answer === "string" &&
          card.proposed_answer.trim().length > 0
      )
    );
  });
}

export function finalizeAlignmentPreparation(
  projectPath: string,
  alignmentAttemptId: string
) {
  try {
    const result = withProjectTransaction(projectPath, (db) => {
      const state = getAlignmentPreparationOnDb(db);
      const attempt = state.current_attempt;
      const command = state.commands.find(
        (candidate) =>
          candidate.command_type === "prepare_design_intent_alignment"
      );
      if (!attempt || attempt.id !== alignmentAttemptId || !command) {
        return {
          ok: false,
          reason: "stale_alignment_attempt"
        } as CommandFailure;
      }
      if (
        state.workflow.stage === "alignment-answering" &&
        attempt.status === "answering" &&
        command.status === "completed"
      ) {
        return {
          ok: true as const,
          reused: true,
          workflow: state.workflow,
          attempt,
          command,
          event_id: null
        };
      }
      if (
        state.workflow.stage !== "alignment-preparing" ||
        attempt.status !== "preparing" ||
        command.status !== "claimed"
      ) {
        return command.status === "pending"
          ? {
              ok: false,
              reason: "alignment_command_not_claimed"
            } as CommandFailure
          : {
              ok: false,
              reason: "stale_alignment_attempt"
            } as CommandFailure;
      }
      const cards = db
        .prepare(
          `SELECT section, proposed_answer
           FROM alignment_question_cards
           WHERE alignment_attempt_id = ?`
        )
        .all(alignmentAttemptId) as Array<{
        section: string;
        proposed_answer: string | null;
      }>;
      if (!preparationCoverageComplete(cards)) {
        return { ok: false, reason: "coverage_incomplete" } as CommandFailure;
      }
      const now = new Date().toISOString();
      db.prepare(
        `UPDATE alignment_attempts
         SET status = 'answering', updated_at = ?
         WHERE id = ? AND status = 'preparing'`
      ).run(now, alignmentAttemptId);
      db.prepare(
        `UPDATE agent_commands
         SET status = 'completed', completed_at = ?, updated_at = ?
         WHERE id = ?`
      ).run(now, now, command.id);
      db.prepare(
        `UPDATE project_workflow
         SET stage = 'alignment-answering', updated_at = ?
         WHERE singleton = 1`
      ).run(now);
      const event = logEventOnDb(db, "alignment_preparation_completed", {
        agent_command_id: command.id,
        alignment_attempt_id: alignmentAttemptId,
        question_count: cards.length
      });
      const completed = getAlignmentPreparationOnDb(db);
      return {
        ok: true as const,
        reused: false,
        workflow: completed.workflow,
        attempt: completed.current_attempt!,
        command: completed.commands.find(
          (candidate) => candidate.id === command.id
        )!,
        event_id: event.event_id
      };
    });
    if (result.ok && !result.reused) {
      emitRecordEvent({
        kind: "alignment",
        action: "updated",
        id: result.attempt.id,
        projectPath: path.resolve(projectPath)
      });
    }
    return result;
  } catch {
    return { ok: false, reason: "db_error" } as CommandFailure;
  }
}
