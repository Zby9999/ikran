// cwd project candidate: resolve the folder the designer launched Ikran from
// (forwarded by the launcher or the MCP server as `IKRAN_CWD`) and decide
// whether it can be auto-bound or should wait for a one-click "Initialize here".
//
// The Runtime reads `IKRAN_CWD` — not `process.cwd()` — because the launcher
// starts the Next.js process with its working directory set to the app package
// directory, not the user's project folder (see `bin/ikran.mjs` and
// `bin/ikran-mcp.mjs`).
//
// Kinds:
// - "resume": the folder already has `.ikran/config.json` → auto-bind, no
//   confirm (recover an active project / a previously-initialized folder).
// - "init":   the folder is effectively empty (only OS noise like .DS_Store)
//   → NOT auto-bound; the UI offers a one-click "Initialize here" (the user's
//   click is what creates `.ikran/`).
// - "manual": the folder is valid, non-empty, and not an Ikran project → NOT
//   auto-bound; the UI offers a one-click "Initialize here" (creates `.ikran/`
//   alongside the existing files).

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { getProjectConfigPath } from "./paths";
import { validateProjectFolder } from "./project";

export type CwdCandidateKind = "resume" | "init" | "manual";

export interface CwdCandidate {
  path: string;
  kind: CwdCandidateKind;
}

export function isAutoBindable(candidate: CwdCandidate): boolean {
  // Issue 02/02: only a folder that already has .ikran auto-binds (resume). An
  // empty folder (init) now waits for a one-click "Initialize here" so the
  // user's click — not a silent auto-bind — is what creates `.ikran/`.
  return candidate.kind === "resume";
}

// OS-level noise entries that do not count as "content" when deciding whether a
// folder is empty enough to auto-initialize.
const IGNORED_EMPTY_ENTRIES = new Set([".DS_Store", "Thumbs.db"]);

export async function getCwdCandidate(): Promise<CwdCandidate | null> {
  const raw = process.env.IKRAN_CWD;
  if (!raw || typeof raw !== "string") {
    return null;
  }

  let resolved: string;
  try {
    resolved = path.resolve(raw);
  } catch {
    return null;
  }

  const validation = await validateProjectFolder(resolved);
  if (!validation.ok) {
    return null;
  }

  if (existsSync(getProjectConfigPath(resolved))) {
    return { path: resolved, kind: "resume" };
  }

  let entries: string[];
  try {
    entries = readdirSync(resolved);
  } catch {
    return null;
  }
  const significant = entries.filter((name) => !IGNORED_EMPTY_ENTRIES.has(name));
  if (significant.length === 0) {
    return { path: resolved, kind: "init" };
  }

  return { path: resolved, kind: "manual" };
}