// Shared JSON column decoders for record tables.
//
// Record rows store list/opaque payloads as JSON text. These decoders are the
// single tolerant entry point — malformed or non-string input degrades to an
// empty array / the raw value instead of throwing inside a read path.

/** Decode a JSON-text string array column. Non-array or invalid JSON → []. */
export function parseJsonStringArray(value: unknown): string[] {
  if (typeof value !== "string" || value.trim().length === 0) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [];
  } catch {
    return [];
  }
}

/**
 * Decode an opaque-context column. Mirrors designer-feedback.ts encoding:
 * strings are stored verbatim and structured values as JSON text, so only
 * structured payloads are decoded — a verbatim selector string round-trips
 * unchanged.
 */
export function decodeOpaqueJson(value: string | null | undefined): unknown {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed !== null && typeof parsed === "object" ? parsed : value;
  } catch {
    return value;
  }
}
