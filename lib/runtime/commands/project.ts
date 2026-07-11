// Shared project commands — single source for HTTP + MCP.

import {
  bindProjectFolder,
  getActiveProjectState,
  projectPathsMatch,
  type BindResponse,
  type ProjectConfig
} from "../project";
import { getCwdCandidate, type CwdCandidate } from "../cwd-candidate";

export type ProjectStateOk = {
  ok: true;
  project: ProjectConfig | null;
  cwd_candidate: CwdCandidate | null;
  cwd_matches_active: boolean;
};

export type ProjectStateError = {
  ok: false;
  reason: string;
};

export type ProjectStateResult = ProjectStateOk | ProjectStateError;

/** Active project + cwd candidate (mirrors GET /api/project body). */
export async function getProjectStateCommand(): Promise<ProjectStateOk> {
  const cwdCandidate = await getCwdCandidate();
  const state = getActiveProjectState();
  const project = state.ok ? state.project : null;
  const cwd_matches_active =
    project && cwdCandidate
      ? projectPathsMatch(cwdCandidate.path, project.path)
      : false;

  return {
    ok: true,
    project,
    cwd_candidate: cwdCandidate,
    cwd_matches_active
  };
}

export type RequireActiveProjectResult =
  | { ok: true; project: ProjectConfig }
  | { ok: false; reason: string };

export function requireActiveProjectCommand(): RequireActiveProjectResult {
  return getActiveProjectState();
}

export async function bindProjectCommand(
  folderPath: string
): Promise<BindResponse> {
  return bindProjectFolder(folderPath);
}

export { projectPathsMatch };
