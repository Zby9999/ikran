// Filesystem path conventions for Ikran Runtime state.
//
// - Project-local metadata lives under `{projectPath}/.ikran/`.
// - Runtime-global state (e.g. the active project pointer) lives under the
//   user's home directory in `~/.ikran/` so it survives a Runtime restart.
//
// All paths are absolute and normalized. Functions in this module only
// *compute* paths; they never read or write files directly.

import { homedir } from "node:os";
import path from "node:path";

const HOME = homedir();

// Runtime-global state dir. Defaults to `~/.ikran` so the active-project
// pointer survives a Runtime restart and lives outside any one project.
// Overridable via `IKRAN_STATE_DIR` so parallel e2e workers can each get an
// isolated active-project pointer: the pointer is a process-global singleton
// (PRD's single-project-single-flow design), so test isolation is achieved by
// giving each worker its OWN runtime process + state dir, not by changing the
// production model. Production leaves this unset → `~/.ikran`.
const STATE_DIR_OVERRIDE = process.env.IKRAN_STATE_DIR;

export const RUNTIME_STATE_DIR = STATE_DIR_OVERRIDE
  ? path.resolve(STATE_DIR_OVERRIDE)
  : path.join(HOME, ".ikran");
export const RUNTIME_STATE_FILE = path.join(RUNTIME_STATE_DIR, "runtime-state.json");

export function getIkranDir(projectPath: string): string {
  return path.resolve(projectPath, ".ikran");
}

export function getProjectConfigPath(projectPath: string): string {
  return path.join(getIkranDir(projectPath), "config.json");
}

export function getProjectDbPath(projectPath: string): string {
  return path.join(getIkranDir(projectPath), "ikran.db");
}

export function getProjectEventsPath(projectPath: string): string {
  return path.join(getIkranDir(projectPath), "events.jsonl");
}

/** Workbench canvas UX layout (frame positions + camera) — not research data. */
export function getWorkbenchLayoutPath(projectPath: string): string {
  return path.join(getIkranDir(projectPath), "workbench-layout.json");
}

/** Design System Browser UX preferences (split ratio) — not research data. */
export function getDesignSystemBrowserPreferencesPath(
  projectPath: string
): string {
  return path.join(getIkranDir(projectPath), "design-system-browser.json");
}

export function getArtifactsDir(projectPath: string): string {
  return path.join(getIkranDir(projectPath), "artifacts");
}

export function getExportDir(projectPath: string): string {
  return path.join(getIkranDir(projectPath), "export");
}
