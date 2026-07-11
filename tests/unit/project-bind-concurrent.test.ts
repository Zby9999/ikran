// Concurrent bind A/B must fail closed: only one path becomes active; the
// loser returns project_mismatch (not a false success for a non-active path).
// Cross-process: MCP/HTTP can be separate Node processes sharing state dir.

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const require = createRequire(import.meta.url);
const tsxCli = require.resolve("tsx/cli");

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

async function loadProjectModule(stateDir: string) {
  process.env.IKRAN_STATE_DIR = stateDir;
  vi.resetModules();
  return import("../../lib/runtime/project");
}

type BindOutcome = {
  ok: boolean;
  reason?: string;
  path?: string;
  active?: string;
  expected?: string;
  pid: number;
};

function spawnBindWorker(opts: {
  stateDir: string;
  folder: string;
  outFile: string;
  readyFile: string;
  holdMs?: number;
}): Promise<{ code: number | null; stderr: string }> {
  // Unique path per worker so concurrent spawns do not clobber each other's script.
  const workerPath = opts.outFile.replace(/\.json$/i, "-worker.mjs");
  writeFileSync(
    workerPath,
    `
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const projectUrl = pathToFileURL(${JSON.stringify(
      path.join(ROOT, "lib/runtime/project.ts")
    )}).href;
const { bindProjectFolder } = await import(projectUrl);
const outFile = process.env.IKRAN_BIND_OUT;
const readyFile = process.env.IKRAN_BIND_READY;
const folder = process.env.IKRAN_BIND_FOLDER;
const holdMs = Number(process.env.IKRAN_BIND_HOLD_MS || "0");
try {
  if (readyFile) writeFileSync(readyFile, "ready");
  // Brief yield so the sibling process can also reach the lock race.
  await new Promise((r) => setTimeout(r, 30));
  const result = await bindProjectFolder(folder);
  if (holdMs > 0) {
    await new Promise((r) => setTimeout(r, holdMs));
  }
  writeFileSync(
    outFile,
    JSON.stringify({
      ok: result.ok,
      reason: result.ok ? undefined : result.reason,
      path: result.ok ? result.config.path : undefined,
      active: result.ok ? undefined : result.active,
      expected: result.ok ? undefined : result.expected,
      pid: process.pid
    })
  );
  process.exit(0);
} catch (err) {
  writeFileSync(
    outFile,
    JSON.stringify({
      ok: false,
      reason: "worker_error",
      error: err instanceof Error ? err.message : String(err),
      pid: process.pid
    })
  );
  process.exit(1);
}
`
  );

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [tsxCli, workerPath], {
      env: {
        ...process.env,
        IKRAN_STATE_DIR: opts.stateDir,
        IKRAN_BIND_FOLDER: opts.folder,
        IKRAN_BIND_OUT: opts.outFile,
        IKRAN_BIND_READY: opts.readyFile,
        IKRAN_BIND_HOLD_MS: String(opts.holdMs ?? 0)
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

function waitForFile(filePath: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (existsSync(filePath)) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error(`timed out waiting for ${filePath}`));
        return;
      }
      setTimeout(tick, 20);
    };
    tick();
  });
}

describe("bindProjectFolder — concurrent fail-closed", () => {
  test("concurrent bind A then B: one succeeds, other returns project_mismatch; active matches winner", async () => {
    const stateDir = tempDir("ikran-bind-state-");
    const folderA = tempDir("ikran-bind-a-");
    const folderB = tempDir("ikran-bind-b-");

    const {
      bindProjectFolder,
      getActiveProject,
      projectPathsMatch
    } = await loadProjectModule(stateDir);

    const [resultA, resultB] = await Promise.all([
      bindProjectFolder(folderA),
      bindProjectFolder(folderB)
    ]);

    const outcomes = [resultA, resultB];
    const successes = outcomes.filter((r) => r.ok);
    const mismatches = outcomes.filter(
      (r) => !r.ok && r.reason === "project_mismatch"
    );

    expect(successes).toHaveLength(1);
    expect(mismatches).toHaveLength(1);

    const winner = successes[0];
    if (!winner.ok) throw new Error("expected success");
    const loser = mismatches[0];
    if (loser.ok) throw new Error("expected mismatch");

    const active = getActiveProject();
    expect(active).not.toBeNull();
    expect(projectPathsMatch(active!, winner.config.path)).toBe(true);
    expect(projectPathsMatch(active!, loser.expected!)).toBe(false);
    expect(projectPathsMatch(loser.active!, active!)).toBe(true);

    // Winner's .ikran exists; loser must not claim success for a non-active path.
    expect(existsSync(path.join(winner.config.path, ".ikran", "config.json"))).toBe(
      true
    );
  });

  test("second sequential bind to a different path returns project_mismatch", async () => {
    const stateDir = tempDir("ikran-bind-seq-state-");
    const folderA = tempDir("ikran-bind-seq-a-");
    const folderB = tempDir("ikran-bind-seq-b-");

    const { bindProjectFolder, getActiveProject, projectPathsMatch } =
      await loadProjectModule(stateDir);

    const first = await bindProjectFolder(folderA);
    expect(first.ok).toBe(true);

    const second = await bindProjectFolder(folderB);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe("project_mismatch");
    expect(projectPathsMatch(second.active!, folderA)).toBe(true);
    expect(projectPathsMatch(second.expected!, folderB)).toBe(true);

    const active = getActiveProject();
    expect(active).not.toBeNull();
    expect(projectPathsMatch(active!, folderA)).toBe(true);
  });

  test("concurrent bind to the same path: both succeed; active is that path", async () => {
    const stateDir = tempDir("ikran-bind-same-state-");
    const folder = tempDir("ikran-bind-same-");

    const { bindProjectFolder, getActiveProject, projectPathsMatch } =
      await loadProjectModule(stateDir);

    const [a, b] = await Promise.all([
      bindProjectFolder(folder),
      bindProjectFolder(folder)
    ]);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    const active = getActiveProject();
    expect(active).not.toBeNull();
    expect(projectPathsMatch(active!, folder)).toBe(true);
  });

  test("bind refuses switch even when runtime-state already points at another project", async () => {
    const stateDir = tempDir("ikran-bind-pre-state-");
    const folderA = tempDir("ikran-bind-pre-a-");
    const folderB = tempDir("ikran-bind-pre-b-");

    // Seed an active project pointer + minimal .ikran config so getActiveProject
    // treats folderA as bound before the module loads.
    mkdirSync(path.join(folderA, ".ikran"), { recursive: true });
    writeFileSync(
      path.join(folderA, ".ikran", "config.json"),
      JSON.stringify({
        path: folderA,
        name: path.basename(folderA),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }),
      "utf-8"
    );
    writeFileSync(
      path.join(stateDir, "runtime-state.json"),
      JSON.stringify({
        active_project: folderA,
        last_updated: new Date().toISOString()
      }),
      "utf-8"
    );

    const { bindProjectFolder, getActiveProject, projectPathsMatch } =
      await loadProjectModule(stateDir);

    const result = await bindProjectFolder(folderB);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("project_mismatch");
    expect(projectPathsMatch(getActiveProject()!, folderA)).toBe(true);
  });

  test("withProjectBindLock serializes waiters; stale lock is broken", async () => {
    const stateDir = tempDir("ikran-bind-lock-unit-");
    const { withProjectBindLock, bindLockPath } =
      await loadProjectModule(stateDir);

    const order: string[] = [];
    const held = withProjectBindLock(
      async () => {
        order.push("holder-enter");
        await new Promise((resolve) => setTimeout(resolve, 80));
        order.push("holder-exit");
        return "held";
      },
      { stateDir }
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(existsSync(bindLockPath(stateDir))).toBe(true);

    const waiter = withProjectBindLock(
      async () => {
        order.push("waiter");
        return "waited";
      },
      { stateDir }
    );

    const [a, b] = await Promise.all([held, waiter]);
    expect(a).toBe("held");
    expect(b).toBe("waited");
    expect(order).toEqual(["holder-enter", "holder-exit", "waiter"]);
    expect(existsSync(bindLockPath(stateDir))).toBe(false);

    writeFileSync(
      bindLockPath(stateDir),
      JSON.stringify({
        pid: 2_147_483_647,
        ownerId: "dead-owner",
        at: new Date().toISOString()
      })
    );
    const afterStale = await withProjectBindLock(async () => "ok", {
      stateDir
    });
    expect(afterStale).toBe("ok");
    expect(existsSync(bindLockPath(stateDir))).toBe(false);
  });

  test(
    "two processes binding different folders: at most one ok; loser project_mismatch; active matches winner",
    async () => {
      const stateDir = tempDir("ikran-bind-xproc-state-");
      const folderA = tempDir("ikran-bind-xproc-a-");
      const folderB = tempDir("ikran-bind-xproc-b-");
      const workDir = tempDir("ikran-bind-xproc-work-");
      const outA = path.join(workDir, "result-a.json");
      const outB = path.join(workDir, "result-b.json");
      const readyA = path.join(workDir, "ready-a");
      const readyB = path.join(workDir, "ready-b");

      const runA = spawnBindWorker({
        stateDir,
        folder: folderA,
        outFile: outA,
        readyFile: readyA,
        holdMs: 120
      });
      await waitForFile(readyA);
      const runB = spawnBindWorker({
        stateDir,
        folder: folderB,
        outFile: outB,
        readyFile: readyB
      });
      await waitForFile(readyB);

      const [exitA, exitB] = await Promise.all([runA, runB]);
      expect(exitA.code, exitA.stderr).toBe(0);
      expect(exitB.code, exitB.stderr).toBe(0);

      const resultA = JSON.parse(readFileSync(outA, "utf-8")) as BindOutcome;
      const resultB = JSON.parse(readFileSync(outB, "utf-8")) as BindOutcome;
      expect(resultA.pid).not.toBe(resultB.pid);

      const outcomes = [resultA, resultB];
      const successes = outcomes.filter((r) => r.ok);
      const mismatches = outcomes.filter(
        (r) => !r.ok && r.reason === "project_mismatch"
      );

      expect(successes).toHaveLength(1);
      expect(mismatches).toHaveLength(1);

      const winner = successes[0]!;
      const loser = mismatches[0]!;
      expect(winner.path).toBeTruthy();
      expect(loser.active).toBeTruthy();
      expect(loser.expected).toBeTruthy();

      const state = JSON.parse(
        readFileSync(path.join(stateDir, "runtime-state.json"), "utf-8")
      ) as { active_project?: string };
      expect(state.active_project).toBeTruthy();

      const { projectPathsMatch, bindLockPath } =
        await loadProjectModule(stateDir);
      expect(projectPathsMatch(state.active_project!, winner.path!)).toBe(true);
      expect(projectPathsMatch(loser.active!, state.active_project!)).toBe(true);
      expect(projectPathsMatch(state.active_project!, loser.expected!)).toBe(
        false
      );

      // Lock file must not be left behind after both processes exit.
      expect(existsSync(bindLockPath(stateDir))).toBe(false);
    },
    30_000
  );
});
