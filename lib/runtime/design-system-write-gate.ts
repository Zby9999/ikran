import { getAlignmentPreparationOnDb } from "./alignment-preparation";
import { closeProjectDb, openProjectDb } from "./db";

/**
 * Initial extraction owns the Design System source while its durable command
 * is pending or claimed. The Browser may read the in-progress artifacts, but
 * designer edits and approvals must wait until finalize completes.
 */
export function isInitialDesignSystemWriteBlocked(projectPath: string): boolean {
  const db = openProjectDb(projectPath);
  try {
    const state = getAlignmentPreparationOnDb(db);
    const command = state.commands.find(
      (candidate) =>
        candidate.command_type === "prepare_initial_design_system"
    );
    return command?.status === "pending" || command?.status === "claimed";
  } finally {
    closeProjectDb(db);
  }
}
