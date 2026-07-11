// Project folder lifecycle: validation, `.ikran/` metadata creation, and the
// Runtime-global active-project pointer.
//
// All filesystem writes are restricted to the selected project folder (plus the
// Runtime-global `~/.ikran/runtime-state.json` pointer). The Browser UI never
// touches the filesystem directly.

import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  realpathSync
} from "node:fs";
import { stat, access } from "node:fs/promises";
import path from "node:path";
import { logEvent, type EventPayload } from "./events";
import { initializeProjectDb } from "./db";
import {
  fileLockPath,
  withFileLock
} from "./file-lock.mjs";
import {
  getArtifactsDir,
  getExportDir,
  getIkranDir,
  getProjectConfigPath,
  RUNTIME_STATE_DIR,
  RUNTIME_STATE_FILE
} from "./paths";

export interface ProjectConfig {
  path: string;
  name: string;
  created_at: string;
  updated_at: string;
}

// Extra keys in an older runtime-state.json (legacy agent-connection fields)
// are ignored — load/write only care about active_project / last_updated.
export interface RuntimeState {
  active_project?: string;
  last_updated?: string;
}

export interface ValidationResult {
  ok: true;
}

export interface ValidationError {
  ok: false;
  reason: string;
}

export type ValidationResponse = ValidationResult | ValidationError;

export async function validateProjectFolder(folderPath: string): Promise<ValidationResponse> {
  if (!folderPath || typeof folderPath !== "string") {
    return { ok: false, reason: "missing_path" };
  }

  let resolved: string;
  try {
    resolved = path.resolve(folderPath);
  } catch {
    return { ok: false, reason: "invalid_path" };
  }

  try {
    const info = await stat(resolved);
    if (!info.isDirectory()) {
      return { ok: false, reason: "not_a_directory" };
    }
  } catch {
    return { ok: false, reason: "path_not_found" };
  }

  try {
    await access(resolved);
  } catch {
    return { ok: false, reason: "not_accessible" };
  }

  return { ok: true };
}

export function isProjectFolder(folderPath: string): boolean {
  return existsSync(getProjectConfigPath(folderPath));
}

export interface BindResult {
  ok: true;
  config: ProjectConfig;
  events: { project_created: string; folder_selected: string };
}

export interface BindError {
  ok: false;
  reason: string;
  /** Present when reason is `project_mismatch` — the path that won the bind. */
  active?: string;
  /** Present when reason is `project_mismatch` — the path this call requested. */
  expected?: string;
}

export type BindResponse = BindResult | BindError;

/**
 * Cross-process exclusive lock for bind check-and-set.
 *
 * An in-process Promise queue is not enough: MCP and HTTP can run as separate
 * Node processes sharing the same `IKRAN_STATE_DIR` / `runtime-state.json`.
 * Without a filesystem lock, two processes can both observe "no active", both
 * return `ok: true`, and leave the pointer pointing at only one of them —
 * the other caller falsely believes it owns the Runtime.
 *
 * Uses the shared `file-lock.mjs` model (same as Runtime start lock):
 * O_EXCL + random ownerId + corrupt grace + compare-and-delete release.
 */
const PROJECT_BIND_LOCK_FILE = "project-bind.lock";

export function bindLockPath(stateDir: string = RUNTIME_STATE_DIR): string {
  return fileLockPath(stateDir, PROJECT_BIND_LOCK_FILE);
}

/**
 * Serialize bind across processes (and within one process via the file lock).
 * Losers wait, then re-enter so they re-read `runtime-state.json` and fail
 * closed with `project_mismatch` when another path already won.
 */
export async function withProjectBindLock<T>(
  fn: () => Promise<T>,
  {
    stateDir = RUNTIME_STATE_DIR,
    timeoutMs = 60_000,
    pollMs = 50
  }: { stateDir?: string; timeoutMs?: number; pollMs?: number } = {}
): Promise<T> {
  return withFileLock(bindLockPath(stateDir), fn, {
    timeoutMs,
    pollMs,
    label: "project bind"
  });
}

export async function bindProjectFolder(folderPath: string): Promise<BindResponse> {
  return withProjectBindLock(() => bindProjectFolderLocked(folderPath));
}

async function bindProjectFolderLocked(folderPath: string): Promise<BindResponse> {
  const validation = await validateProjectFolder(folderPath);
  if (!validation.ok) {
    return { ok: false, reason: validation.reason };
  }

  const resolved = path.resolve(folderPath);

  // Atomic check-and-set: refuse to switch away from an already-active project.
  const active = getActiveProject();
  if (active && !projectPathsMatch(active, resolved)) {
    return {
      ok: false,
      reason: "project_mismatch",
      active,
      expected: resolved
    };
  }

  const now = new Date().toISOString();
  const existing = loadProjectConfig(resolved);

  // Initialize project-local metadata.
  mkdirSync(getIkranDir(resolved), { recursive: true });
  mkdirSync(getArtifactsDir(resolved), { recursive: true });
  mkdirSync(getExportDir(resolved), { recursive: true });

  const config: ProjectConfig = {
    path: resolved,
    name: path.basename(resolved),
    created_at: existing?.created_at ?? now,
    updated_at: now
  };

  writeFileSync(getProjectConfigPath(resolved), JSON.stringify(config, null, 2), "utf-8");

  // Initialize SQLite schema for this project (open + ensure schema + close,
  // so no SQLite handle is left open after binding).
  initializeProjectDb(resolved);

  // Record semantic events.
  const payload: EventPayload = { path: resolved, name: config.name };
  const projectCreated = logEvent(resolved, "project_created", payload);
  const folderSelected = logEvent(resolved, "folder_selected", payload);

  // Update the Runtime-global active project pointer.
  setActiveProject(resolved);

  return {
    ok: true,
    config,
    events: {
      project_created: projectCreated.event_id,
      folder_selected: folderSelected.event_id
    }
  };
}

export function getActiveProject(): string | null {
  const state = loadRuntimeState();
  if (state.active_project && isProjectFolder(state.active_project)) {
    return state.active_project;
  }
  return null;
}

function loadRuntimeState(): RuntimeState {
  if (!existsSync(RUNTIME_STATE_FILE)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(RUNTIME_STATE_FILE, "utf-8")) as RuntimeState;
  } catch {
    return {};
  }
}

function writeRuntimeState(state: RuntimeState): void {
  mkdirSync(RUNTIME_STATE_DIR, { recursive: true });
  writeFileSync(RUNTIME_STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

export function setActiveProject(folderPath: string): void {
  // Persist only known fields so legacy agent-connection keys are dropped on
  // the next write without a dedicated migration.
  writeRuntimeState({
    active_project: path.resolve(folderPath),
    last_updated: new Date().toISOString()
  });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Fail-closed parse of `.ikran/config.json`.
 * Requires the known schema and that `config.path` matches the folder being
 * opened (resolved real-path equality). Tampered or malformed configs return
 * null so callers never redirect the session via a forged `path`.
 */
export function parseProjectConfig(
  raw: unknown,
  folderPath: string
): ProjectConfig | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  if (
    !isNonEmptyString(obj.path) ||
    !isNonEmptyString(obj.name) ||
    !isNonEmptyString(obj.created_at) ||
    !isNonEmptyString(obj.updated_at)
  ) {
    return null;
  }
  if (!projectPathsMatch(obj.path, folderPath)) {
    return null;
  }
  // Return the opened folder's resolved path — never the (possibly differently
  // spelled) string from disk, even when realpaths match.
  return {
    path: path.resolve(folderPath),
    name: obj.name,
    created_at: obj.created_at,
    updated_at: obj.updated_at
  };
}

export function loadProjectConfig(folderPath: string): ProjectConfig | null {
  const configPath = getProjectConfigPath(folderPath);
  if (!existsSync(configPath)) {
    return null;
  }
  try {
    const raw: unknown = JSON.parse(readFileSync(configPath, "utf-8"));
    return parseProjectConfig(raw, folderPath);
  } catch {
    return null;
  }
}

export function getActiveProjectState(): { ok: true; project: ProjectConfig } | { ok: false; reason: string } {
  const active = getActiveProject();
  if (!active) {
    return { ok: false, reason: "no_active_project" };
  }
  if (!existsSync(getProjectConfigPath(active))) {
    return { ok: false, reason: "missing_config" };
  }
  const config = loadProjectConfig(active);
  if (!config) {
    // File exists but schema/path checks failed — fail closed.
    return { ok: false, reason: "invalid_config" };
  }
  return { ok: true, project: config };
}

export function canonicalPath(folderPath: string): string {
  try {
    return realpathSync(folderPath);
  } catch {
    return path.resolve(folderPath);
  }
}

export function projectPathsMatch(left: string, right: string): boolean {
  return canonicalPath(left) === canonicalPath(right);
}
