// Fail-closed validation of `.ikran/config.json`: schema + path consistency.
// Tampered config.path must never redirect the active session.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
  vi.resetModules();
  delete process.env.IKRAN_STATE_DIR;
});

beforeEach(() => {
  vi.resetModules();
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function writeConfig(folder: string, body: unknown): void {
  mkdirSync(path.join(folder, ".ikran"), { recursive: true });
  writeFileSync(
    path.join(folder, ".ikran", "config.json"),
    JSON.stringify(body, null, 2),
    "utf-8"
  );
}

async function loadProjectModule(stateDir: string) {
  process.env.IKRAN_STATE_DIR = stateDir;
  vi.resetModules();
  return import("../../lib/runtime/project");
}

describe("parseProjectConfig / loadProjectConfig — fail-closed", () => {
  test("valid config matching folder path loads", async () => {
    const stateDir = tempDir("ikran-cfg-state-");
    const folder = tempDir("ikran-cfg-ok-");
    const now = "2026-01-01T00:00:00.000Z";
    writeConfig(folder, {
      path: folder,
      name: path.basename(folder),
      created_at: now,
      updated_at: now
    });

    const { loadProjectConfig, parseProjectConfig } =
      await loadProjectModule(stateDir);

    const loaded = loadProjectConfig(folder);
    expect(loaded).not.toBeNull();
    expect(loaded!.path).toBe(path.resolve(folder));
    expect(loaded!.name).toBe(path.basename(folder));
    expect(loaded!.created_at).toBe(now);

    expect(
      parseProjectConfig(
        {
          path: folder,
          name: "x",
          created_at: now,
          updated_at: now
        },
        folder
      )
    ).not.toBeNull();
  });

  test("tampered config.path pointing at another folder returns null", async () => {
    const stateDir = tempDir("ikran-cfg-tamper-state-");
    const folder = tempDir("ikran-cfg-tamper-");
    const other = tempDir("ikran-cfg-other-");
    const now = "2026-01-01T00:00:00.000Z";
    writeConfig(folder, {
      path: other,
      name: "hijacked",
      created_at: now,
      updated_at: now
    });

    const { loadProjectConfig, parseProjectConfig } =
      await loadProjectModule(stateDir);

    expect(loadProjectConfig(folder)).toBeNull();
    expect(
      parseProjectConfig(
        {
          path: other,
          name: "hijacked",
          created_at: now,
          updated_at: now
        },
        folder
      )
    ).toBeNull();
  });

  test("malformed schema (missing fields / wrong types) returns null", async () => {
    const stateDir = tempDir("ikran-cfg-schema-state-");
    const folder = tempDir("ikran-cfg-schema-");
    const { parseProjectConfig, loadProjectConfig } =
      await loadProjectModule(stateDir);

    expect(parseProjectConfig(null, folder)).toBeNull();
    expect(parseProjectConfig([], folder)).toBeNull();
    expect(parseProjectConfig("nope", folder)).toBeNull();
    expect(
      parseProjectConfig({ path: folder, name: "n" }, folder)
    ).toBeNull();
    expect(
      parseProjectConfig(
        {
          path: folder,
          name: "",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z"
        },
        folder
      )
    ).toBeNull();
    expect(
      parseProjectConfig(
        {
          path: 123,
          name: "n",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z"
        },
        folder
      )
    ).toBeNull();

    writeConfig(folder, { path: folder });
    expect(loadProjectConfig(folder)).toBeNull();

    writeFileSync(
      path.join(folder, ".ikran", "config.json"),
      "{not-json",
      "utf-8"
    );
    expect(loadProjectConfig(folder)).toBeNull();
  });
});

describe("getActiveProjectState — does not redirect via tampered path", () => {
  test("tampered active config yields invalid_config; pointer still blocks switch", async () => {
    const stateDir = tempDir("ikran-cfg-active-state-");
    const folderA = tempDir("ikran-cfg-active-a-");
    const folderB = tempDir("ikran-cfg-active-b-");
    const evil = tempDir("ikran-cfg-evil-");

    writeConfig(folderA, {
      path: evil,
      name: "evil",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z"
    });
    writeFileSync(
      path.join(stateDir, "runtime-state.json"),
      JSON.stringify({
        active_project: folderA,
        last_updated: new Date().toISOString()
      }),
      "utf-8"
    );

    const {
      getActiveProject,
      getActiveProjectState,
      bindProjectFolder,
      projectPathsMatch
    } = await loadProjectModule(stateDir);

    // Active pointer still recognizes folderA (bind mutex / mismatch intact).
    expect(projectPathsMatch(getActiveProject()!, folderA)).toBe(true);

    const state = getActiveProjectState();
    expect(state.ok).toBe(false);
    if (state.ok) return;
    expect(state.reason).toBe("invalid_config");

    // Must not switch away while pointer is set — even with invalid config.
    const switchAttempt = await bindProjectFolder(folderB);
    expect(switchAttempt.ok).toBe(false);
    if (switchAttempt.ok) return;
    expect(switchAttempt.reason).toBe("project_mismatch");
  });

  test("re-bind same folder rewrites tampered config and restores session", async () => {
    const stateDir = tempDir("ikran-cfg-rebind-state-");
    const folder = tempDir("ikran-cfg-rebind-");
    const evil = tempDir("ikran-cfg-rebind-evil-");

    writeConfig(folder, {
      path: evil,
      name: "evil",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z"
    });
    writeFileSync(
      path.join(stateDir, "runtime-state.json"),
      JSON.stringify({
        active_project: folder,
        last_updated: new Date().toISOString()
      }),
      "utf-8"
    );

    const {
      bindProjectFolder,
      getActiveProjectState,
      loadProjectConfig,
      projectPathsMatch
    } = await loadProjectModule(stateDir);

    const bind = await bindProjectFolder(folder);
    expect(bind.ok).toBe(true);
    if (!bind.ok) return;

    expect(projectPathsMatch(bind.config.path, folder)).toBe(true);
    expect(bind.config.path).not.toBe(evil);

    const state = getActiveProjectState();
    expect(state.ok).toBe(true);
    if (!state.ok) return;
    expect(projectPathsMatch(state.project.path, folder)).toBe(true);

    const onDisk = JSON.parse(
      readFileSync(path.join(folder, ".ikran", "config.json"), "utf-8")
    ) as { path: string };
    expect(projectPathsMatch(onDisk.path, folder)).toBe(true);
    expect(loadProjectConfig(folder)).not.toBeNull();
  });

  test("valid active config still surfaces project.path for callers", async () => {
    const stateDir = tempDir("ikran-cfg-valid-state-");
    const folder = tempDir("ikran-cfg-valid-");
    const now = "2026-01-02T00:00:00.000Z";
    writeConfig(folder, {
      path: folder,
      name: path.basename(folder),
      created_at: now,
      updated_at: now
    });
    writeFileSync(
      path.join(stateDir, "runtime-state.json"),
      JSON.stringify({
        active_project: folder,
        last_updated: now
      }),
      "utf-8"
    );

    const { getActiveProjectState, projectPathsMatch } =
      await loadProjectModule(stateDir);
    const state = getActiveProjectState();
    expect(state.ok).toBe(true);
    if (!state.ok) return;
    expect(projectPathsMatch(state.project.path, folder)).toBe(true);
    expect(existsSync(path.join(folder, ".ikran", "config.json"))).toBe(true);
  });
});
