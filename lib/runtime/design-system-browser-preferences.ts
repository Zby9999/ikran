// Design System Browser preferences — project-local `.ikran/design-system-browser.json`.
//
// Product state only (split-pane ratio). Not research source of truth and not
// MCP/export data. Plain last-write-wins: no writeRevision, no reconcile.
//
// Types + pure parse live in `design-system-browser-preferences-shared.ts`
// (client-safe). This module is Node-only (fs).

import { existsSync, readFileSync } from "node:fs";
import { atomicWriteJson } from "./atomic-write-json";
import {
  getDesignSystemBrowserPreferencesPath,
  getIkranDir
} from "./paths";
import {
  emptyDesignSystemBrowserPreferences,
  parseDesignSystemBrowserPreferences,
  type DesignSystemBrowserPreferencesDocument,
  type DesignSystemBrowserPreferencesErrorReason
} from "./design-system-browser-preferences-shared";

export {
  DESIGN_SYSTEM_BROWSER_PREFERENCES_VERSION,
  DEFAULT_DS_SPLIT_RATIO,
  emptyDesignSystemBrowserPreferences,
  parseDesignSystemBrowserPreferences,
  type DesignSystemBrowserPreferencesDocument,
  type DesignSystemBrowserPreferencesErrorReason
} from "./design-system-browser-preferences-shared";

export type DesignSystemBrowserPreferencesReadResult =
  | { ok: true; preferences: DesignSystemBrowserPreferencesDocument }
  | { ok: false; reason: DesignSystemBrowserPreferencesErrorReason };

/**
 * Read preferences from disk. A missing file yields defaults; nothing is
 * written back (no read-time cleanup).
 */
export function readDesignSystemBrowserPreferences(
  projectPath: string
): DesignSystemBrowserPreferencesReadResult {
  const filePath = getDesignSystemBrowserPreferencesPath(projectPath);

  if (!existsSync(filePath)) {
    return { ok: true, preferences: emptyDesignSystemBrowserPreferences() };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return { ok: false, reason: "read_failed" };
  }

  const parsed = parseDesignSystemBrowserPreferences(raw);
  if (!parsed) {
    return { ok: false, reason: "read_failed" };
  }

  return { ok: true, preferences: parsed };
}

export type DesignSystemBrowserPreferencesWriteResult =
  | { ok: true; preferences: DesignSystemBrowserPreferencesDocument }
  | { ok: false; reason: DesignSystemBrowserPreferencesErrorReason };

/**
 * Validate input and atomically write it (plain last-write-wins).
 */
export function writeDesignSystemBrowserPreferences(
  projectPath: string,
  raw: unknown
): DesignSystemBrowserPreferencesWriteResult {
  const parsed = parseDesignSystemBrowserPreferences(raw);
  if (!parsed) {
    return { ok: false, reason: "invalid_preferences" };
  }

  // Ensure .ikran exists (project must already be bound / initialized).
  if (!existsSync(getIkranDir(projectPath))) {
    return { ok: false, reason: "write_failed" };
  }

  try {
    atomicWriteJson(getDesignSystemBrowserPreferencesPath(projectPath), parsed);
  } catch {
    return { ok: false, reason: "write_failed" };
  }

  return { ok: true, preferences: parsed };
}
