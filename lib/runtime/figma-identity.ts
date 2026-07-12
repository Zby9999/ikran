// Canonical Figma seed identity — parse / normalize / equality + URL shape.
//
// DB-free module so migrations, seed-capture, seed-reference, and Workbench
// paste guards share the same host/path rules without UI ↔ Runtime cycles.

export interface FigmaSeedIdentity {
  fileKey: string;
  /** Normalized `node-id` with `:` separators; empty string if absent. */
  nodeId: string;
}

/** Normalize a raw Figma node-id query value (`0-81` → `0:81`). */
export function normalizeFigmaNodeId(raw: string): string {
  return raw.trim().replace(/-/g, ":");
}

export function isFigmaHostname(hostname: string): boolean {
  return hostname === "figma.com" || hostname === "www.figma.com";
}

/** True for `/design/<fileKey>/…` or `/file/<fileKey>/…` selection paths. */
export function hasFigmaDesignOrFilePath(pathname: string): boolean {
  const parts = pathname.split("/").filter(Boolean);
  return (
    parts.length >= 2 &&
    (parts[0] === "design" || parts[0] === "file") &&
    Boolean(parts[1])
  );
}

/**
 * Find a Figma design/file selection URL inside free text (clipboard paste).
 * Same host + path dialect as parseFigmaSeedIdentity (design|file only).
 */
const FIGMA_DESIGN_URL_IN_TEXT =
  /https:\/\/(?:www\.)?figma\.com\/(?:design|file)\/[^\s]+/i;

export function extractFigmaDesignUrl(text: string): string | null {
  const match = text.match(FIGMA_DESIGN_URL_IN_TEXT);
  return match ? match[0] : null;
}

export function isFigmaDesignUrl(text: string): boolean {
  return extractFigmaDesignUrl(text) != null;
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
  if (!isFigmaHostname(url.hostname)) return null;
  if (!hasFigmaDesignOrFilePath(url.pathname)) return null;
  const parts = url.pathname.split("/").filter(Boolean);
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
