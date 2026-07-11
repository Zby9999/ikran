// Canonical Figma seed identity — parse / normalize / equality.
//
// DB-free module so migrations and seed-reference can share the same rules
// without creating migrations ↔ db ↔ seed-reference import cycles.

export interface FigmaSeedIdentity {
  fileKey: string;
  /** Normalized `node-id` with `:` separators; empty string if absent. */
  nodeId: string;
}

/** Normalize a raw Figma node-id query value (`0-81` → `0:81`). */
export function normalizeFigmaNodeId(raw: string): string {
  return raw.trim().replace(/-/g, ":");
}

/**
 * Parse fileKey + nodeId from a Figma design/file URL for local identity.
 * Does not rewrite the stored URL — only used for dedupe / migration backfill.
 * `node-id=0-81` and `node-id=0:81` normalize to the same `0:81`.
 */
export function parseFigmaSeedIdentity(
  rawUrl: string
): FigmaSeedIdentity | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.hostname !== "figma.com" && url.hostname !== "www.figma.com") {
    return null;
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (
    parts.length < 2 ||
    (parts[0] !== "design" && parts[0] !== "file") ||
    !parts[1]
  ) {
    return null;
  }
  const fileKey = parts[1];
  const rawNode =
    url.searchParams.get("node-id") ?? url.searchParams.get("nodeId") ?? "";
  const nodeId = normalizeFigmaNodeId(rawNode);
  return { fileKey, nodeId };
}

export function figmaSeedIdentitiesEqual(
  a: FigmaSeedIdentity,
  b: FigmaSeedIdentity
): boolean {
  return a.fileKey === b.fileKey && a.nodeId === b.nodeId;
}

/** Stable string key for Maps / error messages. */
export function figmaSeedIdentityKey(identity: FigmaSeedIdentity): string {
  return `${identity.fileKey}\0${identity.nodeId}`;
}
