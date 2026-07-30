// Workbench canvas UX layout — project-local `.ikran/workbench-layout.json`.
//
// Product state only (frame page geometry + camera). Not research source of
// truth and not MCP/export data. Seed delete / reconcile drops orphan frames.
//
// Types + pure parse live in `workbench-layout-shared.ts` (client-safe).
// This module is Node-only (fs + seed list for reconcile).

import { existsSync, readFileSync } from "node:fs";
import { atomicWriteJson } from "./atomic-write-json";
import {
  getIkranDir,
  getWorkbenchLayoutPath
} from "./paths";
import { listSeedReferences } from "./seed-reference";
import {
  WORKBENCH_LAYOUT_VERSION,
  emptyWorkbenchLayout,
  parseWorkbenchLayout,
  reconcileWorkbenchLayout,
  type WorkbenchLayoutDocument,
  type WorkbenchLayoutErrorReason
} from "./workbench-layout-shared";

export {
  WORKBENCH_LAYOUT_VERSION,
  emptyWorkbenchLayout,
  parseWorkbenchLayout,
  reconcileWorkbenchLayout,
  type WorkbenchCameraLayout,
  type WorkbenchFrameLayout,
  type WorkbenchLayoutDocument,
  type WorkbenchLayoutErrorReason
} from "./workbench-layout-shared";

function seedFrameKeepIds(projectPath: string): Set<string> {
  return new Set(listSeedReferences(projectPath).map((s) => s.id));
}

export type WorkbenchLayoutReadResult =
  | { ok: true; layout: WorkbenchLayoutDocument; pruned: boolean }
  | { ok: false; reason: WorkbenchLayoutErrorReason };

/**
 * Read layout from disk, reconcile against current seed ids, and rewrite when
 * orphans were dropped (read-time cleanup).
 */
export function readWorkbenchLayout(
  projectPath: string
): WorkbenchLayoutReadResult {
  const filePath = getWorkbenchLayoutPath(projectPath);
  const keep = seedFrameKeepIds(projectPath);

  if (!existsSync(filePath)) {
    return { ok: true, layout: emptyWorkbenchLayout(), pruned: false };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return { ok: false, reason: "read_failed" };
  }

  const parsed = parseWorkbenchLayout(raw);
  if (!parsed) {
    return { ok: false, reason: "read_failed" };
  }

  const reconciled = reconcileWorkbenchLayout(parsed, keep);
  const pruned =
    Object.keys(reconciled.frames).length !== Object.keys(parsed.frames).length;

  if (pruned) {
    try {
      const writeRevision =
        raw !== null &&
        typeof raw === "object" &&
        typeof (raw as { writeRevision?: unknown }).writeRevision === "number"
          ? (raw as { writeRevision: number }).writeRevision
          : undefined;
      atomicWriteJson(
        filePath,
        Number.isFinite(writeRevision)
          ? { ...reconciled, writeRevision }
          : reconciled
      );
    } catch {
      // Reconcile is best-effort UX cleanup. The usable in-memory layout must
      // not fail because a disposable layout file could not be rewritten.
    }
  }

  return { ok: true, layout: reconciled, pruned };
}

export type WorkbenchLayoutWriteResult =
  | { ok: true; layout: WorkbenchLayoutDocument }
  | { ok: false; reason: WorkbenchLayoutErrorReason };

/**
 * Validate input, prune to current seeds, atomically write.
 */
export function writeWorkbenchLayout(
  projectPath: string,
  raw: unknown,
  writeRevision?: number
): WorkbenchLayoutWriteResult {
  const keep = seedFrameKeepIds(projectPath);
  const parsed = parseWorkbenchLayout(raw, keep);
  if (!parsed) {
    return { ok: false, reason: "invalid_layout" };
  }

  // Ensure .ikran exists (project must already be bound / initialized).
  if (!existsSync(getIkranDir(projectPath))) {
    return { ok: false, reason: "write_failed" };
  }

  try {
    const filePath = getWorkbenchLayoutPath(projectPath);
    if (Number.isFinite(writeRevision) && existsSync(filePath)) {
      try {
        const currentRaw = JSON.parse(readFileSync(filePath, "utf8")) as Record<
          string,
          unknown
        >;
        const currentRevision = currentRaw.writeRevision;
        if (
          typeof currentRevision === "number" &&
          currentRevision > (writeRevision as number)
        ) {
          const currentLayout = parseWorkbenchLayout(currentRaw, keep);
          return { ok: true, layout: currentLayout ?? parsed };
        }
      } catch {
        // A valid incoming write replaces unreadable disposable UX state.
      }
    }
    atomicWriteJson(
      filePath,
      Number.isFinite(writeRevision)
        ? { ...parsed, writeRevision }
        : parsed
    );
  } catch {
    return { ok: false, reason: "write_failed" };
  }

  return { ok: true, layout: parsed };
}
