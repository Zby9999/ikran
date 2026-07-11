// Working-folder discovery for the Ikran MCP server.
//
// Order (first match wins):
//   1. IKRAN_CWD env — explicit mcp.json / launcher override
//   2. MCP Roots — first file:// root from the client
//   3. process.cwd() — mcp.json `cwd` or host launch directory
//   4. none
//
// Pure resolver is unit-tested; bin/ikran-mcp.mjs supplies env/roots/cwd.

import path from "node:path";
import { fileURLToPath } from "node:url";

export type WorkingFolderSource = "env" | "roots" | "cwd" | "none";

export type DiscoveredWorkingFolder = {
  folder: string | null;
  source: WorkingFolderSource;
  roots: unknown[];
};

export type ResolveWorkingFolderInput = {
  /** Raw `process.env.IKRAN_CWD` (may be unset). */
  envCwd?: string | null;
  /** MCP `roots/list` entries (may be empty). */
  roots?: unknown[];
  /** `process.cwd()` of the MCP server process (may be omitted to skip). */
  processCwd?: string | null;
};

/**
 * Resolve the Agent host working folder from env, Roots, or process cwd.
 * Does not touch the filesystem or MCP transport — pure input → result.
 */
export function resolveWorkingFolder(
  input: ResolveWorkingFolderInput = {}
): DiscoveredWorkingFolder {
  const envCwd = input.envCwd;
  if (typeof envCwd === "string" && envCwd.trim().length > 0) {
    return {
      folder: path.resolve(envCwd.trim()),
      source: "env",
      roots: []
    };
  }

  const roots = Array.isArray(input.roots) ? input.roots : [];
  for (const r of roots) {
    if (
      r &&
      typeof r === "object" &&
      "uri" in r &&
      typeof (r as { uri: unknown }).uri === "string"
    ) {
      const uri = (r as { uri: string }).uri;
      if (!uri.startsWith("file://")) continue;
      try {
        const p = fileURLToPath(uri);
        if (p) {
          return {
            folder: path.resolve(p),
            source: "roots",
            roots
          };
        }
      } catch {
        /* malformed file URI — skip */
      }
    }
  }

  const processCwd = input.processCwd;
  if (typeof processCwd === "string" && processCwd.trim().length > 0) {
    return {
      folder: path.resolve(processCwd.trim()),
      source: "cwd",
      roots
    };
  }

  return { folder: null, source: "none", roots };
}
