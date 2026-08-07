// Content digest for code-backed captures (Issue 32).
//
// A code-backed capture freezes the code files it was rendered from: the
// capture record carries this digest, and the Design System view recomputes
// it on read — a mismatch (or a file that no longer resolves) marks the
// capture stale, mirroring the D02 surface-superseded freshness verdict.
// Kept as a leaf module (no Runtime imports beyond node builtins) so both
// the capture write-back and the view can use it without an import cycle.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function resolveInsideProject(
  projectPath: string,
  relativePath: string
): string | null {
  const root = path.resolve(projectPath);
  const absolute = path.resolve(root, relativePath);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    return null;
  }
  return absolute;
}

/**
 * sha256 over the code files behind a code-backed capture: each link's
 * project-relative path plus its content hash, sorted by path so the digest
 * is order-independent. Returns null when any link escapes the project or is
 * missing/unreadable — the view treats null as stale (honest unknown).
 */
export function codeCaptureDigest(
  projectPath: string,
  codeLinks: readonly string[]
): string | null {
  if (codeLinks.length === 0) return null;
  const lines: string[] = [];
  for (const link of codeLinks) {
    const absolute = resolveInsideProject(projectPath, link);
    if (absolute === null || !existsSync(absolute)) return null;
    let content: Buffer;
    try {
      content = readFileSync(absolute);
    } catch {
      return null;
    }
    const fileHash = createHash("sha256").update(content).digest("hex");
    lines.push(`${link.split(path.sep).join("/")}:${fileHash}`);
  }
  lines.sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}
