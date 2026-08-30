import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";

import { resolveStudyWorkspaceManifest } from "../../lib/mcp/study-workspace-manifest";

const cleanup: string[] = [];

afterEach(() => {
  for (const directory of cleanup.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createPackage({
  workspaceId = "kit-2",
  workspacePath = "workspace-2",
  pluginVersion = "0.1.0-alpha.22"
}: {
  workspaceId?: string;
  workspacePath?: string;
  pluginVersion?: string;
} = {}) {
  const packageRoot = mkdtempSync(path.join(tmpdir(), "ikran-study-manifest-"));
  cleanup.push(packageRoot);
  const workspace = path.join(packageRoot, "workspace-2");
  mkdirSync(path.join(workspace, ".ikran"), { recursive: true });
  writeFileSync(path.join(workspace, ".ikran", "ikran.db"), "");
  const manifestPath = path.join(packageRoot, "STUDY-KIT-MANIFEST.json");
  writeFileSync(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      package: "ikran-study-kit-2",
      host: "codex",
      plugin: { name: "ikran", version: pluginVersion },
      workspaces: [
        {
          id: workspaceId,
          workspaceNumber: 2,
          displayName: "Workspace 2",
          path: workspacePath,
          frame: { fileKey: "figma-file-2", nodeId: "22:44" }
        }
      ]
    })
  );
  return { manifestPath, packageRoot, workspace };
}

test("resolves the assigned workspace from the exact Study Kit manifest", async () => {
  const fixture = createPackage();
  const result = await resolveStudyWorkspaceManifest({
    manifestPath: fixture.manifestPath,
    workspaceId: "kit-2",
    runtimePluginVersion: "0.1.0-alpha.22"
  });

  expect(result).toMatchObject({
    ok: true,
    manifestPath: fixture.manifestPath,
    packageRoot: realpathSync(fixture.packageRoot),
    packageName: "ikran-study-kit-2",
    pluginVersion: "0.1.0-alpha.22",
    workspace: {
      id: "kit-2",
      workspaceNumber: 2,
      displayName: "Workspace 2",
      path: realpathSync(fixture.workspace),
      frame: { fileKey: "figma-file-2", nodeId: "22:44" }
    }
  });
});

test("rejects a manifest for a different installed plugin version", async () => {
  const fixture = createPackage({ pluginVersion: "0.1.0-alpha.21" });
  const result = await resolveStudyWorkspaceManifest({
    manifestPath: fixture.manifestPath,
    workspaceId: "kit-2",
    runtimePluginVersion: "0.1.0-alpha.22"
  });

  expect(result).toEqual({
    ok: false,
    reason: "study_plugin_version_mismatch",
    expected: "0.1.0-alpha.21",
    active: "0.1.0-alpha.22"
  });
});

test("does not use a same-version package that lacks the assigned workspace ID", async () => {
  const fixture = createPackage({ workspaceId: "kit-1" });
  const result = await resolveStudyWorkspaceManifest({
    manifestPath: fixture.manifestPath,
    workspaceId: "kit-2",
    runtimePluginVersion: "0.1.0-alpha.22"
  });

  expect(result).toEqual({
    ok: false,
    reason: "study_workspace_not_found",
    workspaceId: "kit-2"
  });
});

test("rejects workspace paths that escape the Study Kit", async () => {
  const fixture = createPackage({ workspacePath: "../workspace-2" });
  const result = await resolveStudyWorkspaceManifest({
    manifestPath: fixture.manifestPath,
    workspaceId: "kit-2",
    runtimePluginVersion: "0.1.0-alpha.22"
  });

  expect(result).toEqual({
    ok: false,
    reason: "invalid_study_workspace_path",
    workspaceId: "kit-2"
  });
});
