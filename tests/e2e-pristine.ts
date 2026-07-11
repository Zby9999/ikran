// Helpers for Playwright globalSetup: keep committed workspace files pristine
// after `next build` rewrites them for the e2e distDir.
//
// Policy:
//   - Snapshot the REAL on-disk files at setup start; teardown restores that
//     snapshot (preserves uncommitted developer edits to tsconfig.json).
//   - Never maintain a full tsconfig.json string copy in test code.
//   - If next-env.d.ts already points at the tear-down-deleted e2e-build path,
//     surgically rewrite only that file to the normal Next routes import
//     BEFORE snapshotting — so teardown cannot re-pollute the workspace.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Normal Next routes types path (dev). Never the e2e-build dist. */
export const NEXT_ENV_D_TS_BASELINE = `/// <reference types="next" />
/// <reference types="next/image-types/global" />
import "./.next/dev/types/routes.d.ts";

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
`;

const TRACKED_RELATIVE = ["next-env.d.ts", "tsconfig.json"] as const;

export type WorkspaceFileSnapshot = {
  path: string;
  /** null when the file did not exist at snapshot time */
  content: string | null;
};

export function nextEnvHasE2eBuildRef(content: string): boolean {
  return content.includes("e2e-build");
}

/**
 * If next-env.d.ts references the e2e-build dist (often left behind after a
 * failed prior run), rewrite it to the normal Next routes import. Does not
 * touch tsconfig.json.
 * @returns true if the file was rewritten
 */
export function sanitizeNextEnvIfPolluted(cwd: string = process.cwd()): boolean {
  const filePath = path.join(cwd, "next-env.d.ts");
  if (!existsSync(filePath)) {
    writeFileSync(filePath, NEXT_ENV_D_TS_BASELINE, "utf-8");
    return true;
  }
  const current = readFileSync(filePath, "utf-8");
  if (!nextEnvHasE2eBuildRef(current)) return false;
  writeFileSync(filePath, NEXT_ENV_D_TS_BASELINE, "utf-8");
  return true;
}

/** Capture current on-disk contents of files `next build` may rewrite. */
export function snapshotWorkspaceFiles(
  cwd: string = process.cwd()
): WorkspaceFileSnapshot[] {
  return TRACKED_RELATIVE.map((rel) => {
    const filePath = path.join(cwd, rel);
    return {
      path: filePath,
      content: existsSync(filePath) ? readFileSync(filePath, "utf-8") : null
    };
  });
}

/** Restore files to a prior snapshot (verbatim). */
export function restoreWorkspaceFiles(snapshots: WorkspaceFileSnapshot[]): void {
  for (const snap of snapshots) {
    if (snap.content === null) continue;
    writeFileSync(snap.path, snap.content, "utf-8");
  }
}

/**
 * Prepare for e2e build: sanitize polluted next-env, then snapshot real files.
 * Call restoreWorkspaceFiles(snapshots) on teardown / failure.
 */
export function beginE2eWorkspaceGuard(cwd: string = process.cwd()): {
  snapshots: WorkspaceFileSnapshot[];
  sanitizedNextEnv: boolean;
} {
  const sanitizedNextEnv = sanitizeNextEnvIfPolluted(cwd);
  const snapshots = snapshotWorkspaceFiles(cwd);
  return { snapshots, sanitizedNextEnv };
}
