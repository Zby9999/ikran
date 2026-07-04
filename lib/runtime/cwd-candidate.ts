// cwd project candidate: resolve the folder the designer launched Ikran from
// (forwarded by the launcher as `IKRAN_CWD`) and decide whether it can be
// auto-bound without a manual folder-picker step.
//
// The Runtime reads `IKRAN_CWD` — not `process.cwd()` — because the launcher
// starts the Next.js process with its working directory set to the app package
// directory, not the user's project folder (see `bin/ikran.mjs`).
//
// Kinds:
// - "resume": the folder already has `.ikran/config.json` → auto-bind, no
//   confirm (same posture as recovering an active project after refresh).
// - "init":   the folder is effectively empty (only OS noise like .DS_Store)
//   → auto-bind, no confirm (we only write `.ikran/`, nothing to clobber).
// - "manual": the folder is valid, non-empty, and not an Ikran project → do
//   NOT auto-bind; the UI offers a one-click "use current folder" confirm.

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
  return candidate.kind === "resume" || candidate.kind === "init";
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