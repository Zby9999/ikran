import { getAlignmentPreparationOnDb } from "./alignment-preparation";
import { closeProjectDb, openProjectDb } from "./db";

/**
 * How long a pending/claimed Initial Design System command without any
 * extraction activity still counts as "in progress" for the write gate.
 *
 * The durable command has no timeout of its own — an interrupted extraction
 * leaves it pending/claimed forever, and the agent can always re-claim it
 * later — so the gate must stop treating stale commands as live, or designer
 * approvals and edits stay blocked indefinitely.
 */
export const INITIAL_DESIGN_SYSTEM_WRITE_GATE_STALE_MS = 24 * 60 * 60 * 1000;

/**
 * Initial extraction owns the Design System source while its durable command
 * is actively in flight. The Browser may read the in-progress artifacts, but
 * designer edits and approvals must wait until finalize completes.
 *
 * Liveness: the command row moves on claim/finalize, and every recorded
 * extraction manifest bumps its own updated_at. A command whose latest
 * activity on either is older than the stale window is an interrupted run,
 * not an in-flight one — it can still be re-claimed later, but it must not
 * keep designer writes locked.
 */
export function isInitialDesignSystemWriteBlocked(
  projectPath: string,
  now: Date = new Date()
): boolean {
  const db = openProjectDb(projectPath);
  try {
    const state = getAlignmentPreparationOnDb(db);
    const command = state.commands.find(
      (candidate) =>
        candidate.command_type === "prepare_initial_design_system"
    );
    if (command?.status !== "pending" && command?.status !== "claimed") {
      return false;
    }
    const latestManifest = db
      .prepare(
        `SELECT MAX(updated_at) AS latest
         FROM design_system_extraction_manifests
         WHERE agent_command_id = ?`
      )
      .get(command.id) as { latest: string | null } | undefined;
    // Liveness is the LATEST activity on either side: the command row moves
    // on claim/re-claim/finalize, manifests move as the extraction records
    // work units. A stale manifest must not mask a fresh re-claim, and a
    // stale command row must not mask a live manifest stream.
    const commandMs = Date.parse(command.updated_at);
    const manifestMs = latestManifest?.latest
      ? Date.parse(latestManifest.latest)
      : Number.NaN;
    const activityMs = Number.isNaN(manifestMs)
      ? commandMs
      : Math.max(commandMs, manifestMs);
    // Unparseable activity timestamp: fail closed, keep the gate locked.
    if (Number.isNaN(activityMs)) return true;
    return (
      now.getTime() - activityMs <= INITIAL_DESIGN_SYSTEM_WRITE_GATE_STALE_MS
    );
  } finally {
    closeProjectDb(db);
  }
}
