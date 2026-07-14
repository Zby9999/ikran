// Map Runtime command failure reasons → HTTP status for thin adapters.
//
// Client / validation / fail-closed domain errors stay 400 so callers do not
// retry bad input. Conflicts use 409. Missing resources use 404. Internal
// failures (`db_error` and other unexpected internals) use 500 so clients may
// retry.

const CONFLICT_REASONS = new Set(["project_mismatch"]);
const NOT_FOUND_REASONS = new Set(["not_found"]);
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
