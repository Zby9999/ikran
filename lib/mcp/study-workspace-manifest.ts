import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

export type ResolvedStudyWorkspaceManifest = {
  ok: true;
  manifestPath: string;
  packageRoot: string;
  packageName: string;
  pluginVersion: string;
  workspace: {
    id: string;
    workspaceNumber: number;
    displayName: string;
    path: string;
    frame: {
      fileKey: string;
      nodeId: string;
    };
  };
};

export type StudyWorkspaceManifestFailure = {
  ok: false;
  reason: string;
  [key: string]: unknown;
};

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative.length > 0 && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function resolveStudyWorkspaceManifest({
  manifestPath,
  workspaceId,
  runtimePluginVersion
}: {
  manifestPath: string;
  workspaceId: string;
  runtimePluginVersion: string;
}): Promise<ResolvedStudyWorkspaceManifest | StudyWorkspaceManifestFailure> {
  const requestedManifest = manifestPath.trim();
  const requestedWorkspaceId = workspaceId.trim();
  if (
    !path.isAbsolute(requestedManifest) ||
    path.basename(requestedManifest) !== "STUDY-KIT-MANIFEST.json"
  ) {
    return { ok: false, reason: "invalid_study_manifest_path" };
  }
  if (!requestedWorkspaceId) {
    return { ok: false, reason: "missing_study_workspace_id" };
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(requestedManifest, "utf8"));
  } catch {
    return { ok: false, reason: "study_manifest_unreadable" };
  }
  if (
    !isObject(manifest) ||
    manifest.schemaVersion !== 1 ||
    manifest.host !== "codex" ||
    typeof manifest.package !== "string" ||
    !isObject(manifest.plugin) ||
    manifest.plugin.name !== "ikran" ||
    typeof manifest.plugin.version !== "string" ||
    !Array.isArray(manifest.workspaces)
  ) {
    return { ok: false, reason: "invalid_study_manifest" };
  }
  if (manifest.plugin.version !== runtimePluginVersion) {
    return {
      ok: false,
      reason: "study_plugin_version_mismatch",
      expected: manifest.plugin.version,
      active: runtimePluginVersion
    };
  }

  const matches = manifest.workspaces.filter(
    (workspace) => isObject(workspace) && workspace.id === requestedWorkspaceId
  );
  if (matches.length === 0) {
    return {
      ok: false,
      reason: "study_workspace_not_found",
      workspaceId: requestedWorkspaceId
    };
  }
  if (matches.length !== 1) {
    return {
      ok: false,
      reason: "duplicate_study_workspace_id",
      workspaceId: requestedWorkspaceId
    };
  }

  const workspace = matches[0];
  if (
    !isObject(workspace) ||
    typeof workspace.path !== "string" ||
    !Number.isInteger(workspace.workspaceNumber) ||
    typeof workspace.displayName !== "string" ||
    !isObject(workspace.frame) ||
    typeof workspace.frame.fileKey !== "string" ||
    typeof workspace.frame.nodeId !== "string"
  ) {
    return {
      ok: false,
      reason: "invalid_study_workspace",
      workspaceId: requestedWorkspaceId
    };
  }

  const packageRoot = path.dirname(path.resolve(requestedManifest));
  const unresolvedWorkspace = path.resolve(packageRoot, workspace.path);
  if (path.isAbsolute(workspace.path) || !isInside(packageRoot, unresolvedWorkspace)) {
    return {
      ok: false,
      reason: "invalid_study_workspace_path",
      workspaceId: requestedWorkspaceId
    };
  }

  let realPackageRoot: string;
  let realWorkspace: string;
  try {
    [realPackageRoot, realWorkspace] = await Promise.all([
      realpath(packageRoot),
      realpath(unresolvedWorkspace)
    ]);
    if (!(await stat(realWorkspace)).isDirectory()) throw new Error("not a directory");
  } catch {
    return {
      ok: false,
      reason: "study_workspace_unavailable",
      workspaceId: requestedWorkspaceId
    };
  }
  if (!isInside(realPackageRoot, realWorkspace)) {
    return {
      ok: false,
      reason: "invalid_study_workspace_path",
      workspaceId: requestedWorkspaceId
    };
  }

  return {
    ok: true,
    manifestPath: path.resolve(requestedManifest),
    packageRoot: realPackageRoot,
    packageName: manifest.package,
    pluginVersion: manifest.plugin.version,
    workspace: {
      id: requestedWorkspaceId,
      workspaceNumber: workspace.workspaceNumber as number,
      displayName: workspace.displayName,
      path: realWorkspace,
      frame: {
        fileKey: workspace.frame.fileKey,
        nodeId: workspace.frame.nodeId
      }
    }
  };
}
