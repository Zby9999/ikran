// Project folder lifecycle: validation, `.ikran/` metadata creation, and the
// Runtime-global active-project pointer.
//
// All filesystem writes are restricted to the selected project folder (plus the
// Runtime-global `~/.ikran/runtime-state.json` pointer). The Browser UI never
// touches the filesystem directly.

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { stat, access } from "node:fs/promises";
import path from "node:path";
import type { AgentId } from "./agent-types";
import { isAgentId } from "./agent-connect";
import { logEvent, type EventPayload } from "./events";
import { initializeProjectDb } from "./db";
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
  connected_agent?: AgentId;
}

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
}

export type BindResponse = BindResult | BindError;

export async function bindProjectFolder(folderPath: string): Promise<BindResponse> {
  const validation = await validateProjectFolder(folderPath);
  if (!validation.ok) {
    return { ok: false, reason: validation.reason };
  }

  const resolved = path.resolve(folderPath);
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

  // Re-binding the same project folder keeps a valid persisted agent connection.
  if (existing?.connected_agent && isAgentId(existing.connected_agent)) {
    config.connected_agent = existing.connected_agent;
  }

  writeFileSync(getProjectConfigPath(resolved), JSON.stringify(config, null, 2), "utf-8");

  // Initialize SQLite schema for this project (open + ensure schema + close,
  // so no better-sqlite3 handle is left open after binding).
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
  if (!existsSync(RUNTIME_STATE_FILE)) {
    return null;
  }
  try {
    const state = JSON.parse(readFileSync(RUNTIME_STATE_FILE, "utf-8")) as RuntimeState;
    if (state.active_project && isProjectFolder(state.active_project)) {
      return state.active_project;
    }
    return null;
  } catch {
    return null;
  }
}

export function setActiveProject(folderPath: string): void {
  mkdirSync(RUNTIME_STATE_DIR, { recursive: true });
  const state: RuntimeState = {
    active_project: path.resolve(folderPath),
    last_updated: new Date().toISOString()
  };
  writeFileSync(RUNTIME_STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

export function loadProjectConfig(folderPath: string): ProjectConfig | null {
  const configPath = getProjectConfigPath(folderPath);
  if (!existsSync(configPath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(configPath, "utf-8")) as ProjectConfig;
  } catch {
    return null;
  }
}

export function getActiveProjectState(): { ok: true; project: ProjectConfig } | { ok: false; reason: string } {
  const active = getActiveProject();
  if (!active) {
    return { ok: false, reason: "no_active_project" };
  }
  const config = loadProjectConfig(active);
  if (!config) {
    return { ok: false, reason: "missing_config" };
  }
  return { ok: true, project: config };
}

export function projectPathsMatch(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

export function getProjectConnectedAgent(folderPath: string): AgentId | null {
  const config = loadProjectConfig(folderPath);
  const agent = config?.connected_agent;
  return agent && isAgentId(agent) ? agent : null;
}

export function setProjectConnectedAgent(
  folderPath: string,
  agent: AgentId
): void {
  const resolved = path.resolve(folderPath);
  const config = loadProjectConfig(resolved);
  if (!config) {
    return;
  }

  const updated: ProjectConfig = {
    ...config,
    path: resolved,
    connected_agent: agent,
    updated_at: new Date().toISOString()
  };
  writeFileSync(
    getProjectConfigPath(resolved),
    JSON.stringify(updated, null, 2),
    "utf-8"
  );
}
