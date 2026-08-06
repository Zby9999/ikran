// Map Runtime command failure reasons → HTTP status for thin adapters.
//
// Client / validation / fail-closed domain errors stay 400 so callers do not
// retry bad input. Conflicts use 409. Missing resources use 404. Internal
// failures (`db_error` and other unexpected internals) use 500 so clients may
// retry.

const CONFLICT_REASONS = new Set([
  "project_mismatch",
  "alignment_attempt_active",
  "alignment_completed",
  "alignment_not_answering",
  "alignment_attempt_required",
  "alignment_command_not_claimed",
  "stale_alignment_attempt",
  "no_pending_alignment_command",
  "no_active_alignment_attempt",
  // Designer status write-back: stale target or source/DB drift.
  "already_formalized",
  "already_candidate",
  "already_exists",
  "entry_not_in_source_file",
  "concurrent_edit_superseded",
  "source_db_drift",
  "concurrent_source_changed",
  // Issue 28: illegal phase transition / formalize feedback gate.
  "phase_gate",
  "unreviewed_feedback",
  // Issue 29: proposal-first gate — decided proposal, or artifact declared
  // against a proposal the designer has not confirmed.
  "proposal_not_awaiting_confirmation",
  "proposal_not_confirmed"
]);
const NOT_FOUND_REASONS = new Set([
  "not_found",
  "proposal_not_found",
  "feedback_record_not_found"
]);
const GONE_REASONS = new Set(["endpoint_retired"]);
const GATEWAY_TIMEOUT_REASONS = new Set(["figma_api_timeout"]);
const INTERNAL_REASONS = new Set([
  "db_error",
  "read_failed",
  "write_failed",
  "figma_api_error"
]);
const UNAUTHORIZED_REASONS = new Set([
  "figma_connection_required",
  "invalid_token",
  "forbidden"
]);

/**
 * HTTP status for a command-layer `reason` string.
 * Unknown reasons default to 400 (fail-closed domain / client).
 */
export function commandErrorHttpStatus(reason: string): number {
  if (INTERNAL_REASONS.has(reason)) return 500;
  if (CONFLICT_REASONS.has(reason)) return 409;
  if (NOT_FOUND_REASONS.has(reason)) return 404;
  if (GONE_REASONS.has(reason)) return 410;
  if (GATEWAY_TIMEOUT_REASONS.has(reason)) return 504;
  if (UNAUTHORIZED_REASONS.has(reason)) return 403;
  return 400;
}
