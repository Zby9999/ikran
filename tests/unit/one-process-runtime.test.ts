// Architecture + owner-mode guards for Task 9 (true one-process Runtime).
// Production must not spawn a Next child; endpoint records must carry owner.

import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

const PROD_SCAN = ["bin", "lib/runtime"] as const;

function walkFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkFiles(full, out);
    else if (/\.(mjs|js|ts)$/.test(name)) out.push(full);
  }
  return out;
}

describe("architecture — one-process Runtime (no Next child spawn)", () => {
  test("http-server.mjs exists as the in-process Next host", () => {
    expect(existsSync(path.join(ROOT, "lib/runtime/http-server.mjs"))).toBe(
      true
    );
  });

  test("stdout routing is async-context scoped and Next loads next.config normally", () => {
    const text = readFileSync(
      path.join(ROOT, "lib/runtime/http-server.mjs"),
      "utf8"
    );
    expect(text).toMatch(/AsyncLocalStorage/);
    expect(text).not.toMatch(/withStdoutRedirectedToStderr/);
    expect(text).not.toMatch(/\bconf\s*:/);
    expect(text).not.toMatch(/const conf\s*=/);
  });

  test("runtime-endpoint.mjs does not spawn next / detached process groups", () => {
    const text = readFileSync(
      path.join(ROOT, "lib/runtime/runtime-endpoint.mjs"),
      "utf8"
    );
    expect(text).not.toMatch(/\bspawn\s*\(/);
    expect(text).not.toMatch(/detached:\s*true/);
    expect(text).not.toMatch(/next\/dist\/bin\/next/);
    expect(text).not.toMatch(/resolveNextBin/);
  });

  test("bin entrypoints do not spawn next children", () => {
    for (const rel of ["bin/ikran-mcp.mjs", "bin/ikran.mjs"]) {
      const text = readFileSync(path.join(ROOT, rel), "utf8");
      expect(text, rel).not.toMatch(/next\/dist\/bin\/next/);
      expect(text, rel).not.toMatch(/process\.kill\s*\(\s*-/);
    }
    // The stdio bridge may detach the persistent Runtime owner. The owner still
    // hosts Next in-process and never spawns a Next CLI child.
    const mcp = readFileSync(path.join(ROOT, "bin/ikran-mcp.mjs"), "utf8");
    expect(mcp).toMatch(/ikran-runtime\.mjs/);
  });

  test("the CLI launcher starts the same persistent Runtime owner", () => {
    const launcher = readFileSync(path.join(ROOT, "bin/ikran.mjs"), "utf8");
    expect(launcher).toMatch(/ikran-runtime\.mjs/);
    expect(launcher).not.toMatch(/openWorkbench\s*\(/);
  });

  test("shared seed capture commands acquire the graceful-shutdown job lease", () => {
    const commands = readFileSync(path.join(ROOT, "lib/runtime/commands/seed-capture.ts"), "utf8");
    expect(commands).toMatch(/withRuntimeJob/);
  });

  test("production runtime surface does not import child_process spawn for Next", () => {
    const hits: string[] = [];
    for (const dir of PROD_SCAN) {
      for (const file of walkFiles(path.join(ROOT, dir))) {
        const rel = path.relative(ROOT, file);
        // Launcher opens a browser; the stdio bridge starts the persistent
        // Runtime owner; the preview supervisor owns the designer's prototype
        // dev server (Issue 30). None of those children is a Next CLI process.
        if (rel === "bin/ikran.mjs" || rel === "bin/ikran-mcp.mjs") continue;
        if (rel === "lib/runtime/preview-server.ts") continue;
        const text = readFileSync(file, "utf8");
        if (
          /from\s+["']node:child_process["']/.test(text) &&
          /\bspawn\s*\(/.test(text)
        ) {
          hits.push(rel);
        }
      }
    }
    expect(hits, `unexpected spawn usage:\n${hits.join("\n")}`).toEqual([]);
  });

  test("the preview supervisor spawns prototype dev servers, never Next", () => {
    const supervisor = readFileSync(
      path.join(ROOT, "lib/runtime/preview-server.ts"),
      "utf8"
    );
    expect(supervisor).not.toMatch(/next\/dist\/bin\/next/);
    expect(supervisor).not.toMatch(/detached:\s*true/);
    // Every host effect stays injectable so tests never spawn a real process.
    expect(supervisor).toMatch(/PreviewSupervisorDeps/);
  });
});

describe("runtime-endpoint owner mode", () => {
  test("writeRuntimeEndpoint persists owner (mcp|standalone)", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const {
      writeRuntimeEndpoint,
      readRuntimeEndpoint,
      removeRuntimeEndpoint
    } = await import("../../lib/runtime/runtime-endpoint.mjs");

    const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-owner-"));
    try {
      writeRuntimeEndpoint(stateDir, {
        host: "127.0.0.1",
        port: 39999,
        token: "a".repeat(64),
        pid: process.pid,
        owner: "mcp"
      });
      const ep = readRuntimeEndpoint(stateDir);
      expect(ep).not.toBeNull();
      expect(ep?.owner).toBe("mcp");
      expect(ep?.pid).toBe(process.pid);
    } finally {
      removeRuntimeEndpoint(stateDir);
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});

function listen(server: ReturnType<typeof createServer>, port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("missing test server address"));
        return;
      }
      resolve(address.port);
    });
  });
}

function closeNetServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function makeFakeNextApp(): {
  appDir: string;
  stateDir: string;
  closeMarker: string;
  prepareMarker: string;
  prepareRelease: string;
  cleanup: () => void;
} {
  const root = mkdtempSync(path.join(tmpdir(), "ikran-fake-next-"));
  const appDir = path.join(root, "app");
  const stateDir = path.join(root, "state");
  const packageDir = path.join(appDir, "node_modules", "next");
  const closeMarker = path.join(root, "next-close.log");
  const prepareMarker = path.join(root, "next-prepare-started");
  const prepareRelease = path.join(root, "next-prepare-release");
  mkdirSync(packageDir, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    path.join(packageDir, "package.json"),
    JSON.stringify({
      name: "next",
      version: "0.0.0-test",
      type: "module",
      exports: "./index.js"
    })
  );
  writeFileSync(
    path.join(packageDir, "index.js"),
    `
      import { appendFileSync, existsSync } from "node:fs";
      import { setTimeout as delay } from "node:timers/promises";
      export default function createNext(options) {
        if (Object.prototype.hasOwnProperty.call(options, "conf")) {
          throw new Error("custom server must not override next config");
        }
        return {
          async prepare() {
            const marker = process.env.IKRAN_FAKE_NEXT_PREPARE_MARKER;
            const release = process.env.IKRAN_FAKE_NEXT_PREPARE_RELEASE;
            if (marker && release) {
              appendFileSync(marker, "started\\n");
              while (!existsSync(release)) await delay(5);
            }
          },
          getRequestHandler() {
            return async (req, res) => {
              const url = typeof req.url === "string" ? req.url : "";
              if (url.startsWith("/api/health")) {
                res.statusCode = 200;
                res.end("ikran-runtime");
                return;
              }
              res.statusCode = 200;
              res.end("ok");
            };
          },
          async close() {
            appendFileSync(process.env.IKRAN_FAKE_NEXT_CLOSE_MARKER, "closed\\n");
          }
        };
      }
    `
  );
  return {
    appDir,
    stateDir,
    closeMarker,
    prepareMarker,
    prepareRelease,
    cleanup: () => rmSync(root, { recursive: true, force: true })
  };
}

async function waitForFile(file: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(file)) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${file}`);
}

describe.sequential("in-process HTTP startup lifecycle", () => {
  test("listen failure closes Next and a later start can reuse the port", async () => {
    const fake = makeFakeNextApp();
    const occupied = createServer();
    const port = await listen(occupied);
    process.env.IKRAN_FAKE_NEXT_CLOSE_MARKER = fake.closeMarker;
    const runtime = await import("../../lib/runtime/runtime-endpoint.mjs");

    try {
      await expect(
        runtime.openWorkbench({
          stateDir: fake.stateDir,
          host: "127.0.0.1",
          prod: false,
          cwd: fake.appDir,
          port,
          owner: "standalone"
        })
      ).rejects.toMatchObject({ code: "EADDRINUSE" });

      expect(readFileSync(fake.closeMarker, "utf8")).toContain("closed");
      await closeNetServer(occupied);

      const started = await runtime.openWorkbench({
        stateDir: fake.stateDir,
        host: "127.0.0.1",
        prod: false,
        cwd: fake.appDir,
        port,
        owner: "standalone"
      });
      expect(started.port).toBe(port);
      await runtime.closeHttpServer();
    } finally {
      if (occupied.listening) await closeNetServer(occupied);
      await runtime.closeHttpServer();
      delete process.env.IKRAN_FAKE_NEXT_CLOSE_MARKER;
      fake.cleanup();
    }
  });

  test("openWorkbench active branch rejects a different explicit port", async () => {
    const fake = makeFakeNextApp();
    process.env.IKRAN_FAKE_NEXT_CLOSE_MARKER = fake.closeMarker;
    const runtime = await import("../../lib/runtime/runtime-endpoint.mjs");

    try {
      const started = await runtime.openWorkbench({
        stateDir: fake.stateDir,
        host: "127.0.0.1",
        prod: false,
        cwd: fake.appDir,
        owner: "standalone"
      });
      expect(runtime.getActiveHttpServer()).not.toBeNull();

      await expect(
        runtime.openWorkbench({
          stateDir: fake.stateDir,
          host: "127.0.0.1",
          prod: false,
          cwd: fake.appDir,
          port: started.port + 1,
          owner: "standalone"
        })
      ).rejects.toThrow(/already running.*but port .* was requested/i);
    } finally {
      await runtime.closeHttpServer();
      delete process.env.IKRAN_FAKE_NEXT_CLOSE_MARKER;
      fake.cleanup();
    }
  });

  test("close during delayed prepare cancels startup and leaves no active server", async () => {
    const fake = makeFakeNextApp();
    const portProbe = createServer();
    const port = await listen(portProbe);
    await closeNetServer(portProbe);
    process.env.IKRAN_FAKE_NEXT_CLOSE_MARKER = fake.closeMarker;
    process.env.IKRAN_FAKE_NEXT_PREPARE_MARKER = fake.prepareMarker;
    process.env.IKRAN_FAKE_NEXT_PREPARE_RELEASE = fake.prepareRelease;
    const runtime = await import("../../lib/runtime/runtime-endpoint.mjs");

    try {
      const startResult = runtime
        .openWorkbench({
          stateDir: fake.stateDir,
          host: "127.0.0.1",
          prod: false,
          cwd: fake.appDir,
          port,
          owner: "standalone"
        })
        .then(
          (handle) => ({ handle, error: null }),
          (error: Error) => ({ handle: null, error })
        );

      await waitForFile(fake.prepareMarker);
      const closePromise = runtime.closeHttpServer();
      writeFileSync(fake.prepareRelease, "release");

      await closePromise;
      const result = await startResult;
      expect(result.handle).toBeNull();
      expect(result.error?.message).toMatch(/startup.*cancel/i);
      expect(runtime.getActiveHttpServer()).toBeNull();
      expect(readFileSync(fake.closeMarker, "utf8")).toContain("closed");

      // Port is truly released after close completes.
      const rebound = createServer();
      await listen(rebound, port);
      await closeNetServer(rebound);
    } finally {
      await runtime.closeHttpServer();
      delete process.env.IKRAN_FAKE_NEXT_CLOSE_MARKER;
      delete process.env.IKRAN_FAKE_NEXT_PREPARE_MARKER;
      delete process.env.IKRAN_FAKE_NEXT_PREPARE_RELEASE;
      fake.cleanup();
    }
  });

  test("concurrent openWorkbench in one process: only one spawns", async () => {
    const fake = makeFakeNextApp();
    process.env.IKRAN_FAKE_NEXT_CLOSE_MARKER = fake.closeMarker;
    process.env.IKRAN_FAKE_NEXT_PREPARE_MARKER = fake.prepareMarker;
    process.env.IKRAN_FAKE_NEXT_PREPARE_RELEASE = fake.prepareRelease;
    const runtime = await import("../../lib/runtime/runtime-endpoint.mjs");

    try {
      const first = runtime.openWorkbench({
        stateDir: fake.stateDir,
        host: "127.0.0.1",
        prod: false,
        cwd: fake.appDir,
        owner: "standalone"
      });
      await waitForFile(fake.prepareMarker);

      const second = runtime.openWorkbench({
        stateDir: fake.stateDir,
        host: "127.0.0.1",
        prod: false,
        cwd: fake.appDir,
        owner: "standalone"
      });

      // Second call must be blocked on the start lock (not a second prepare).
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(readFileSync(fake.prepareMarker, "utf8").trim().split("\n")).toEqual([
        "started"
      ]);

      writeFileSync(fake.prepareRelease, "release");
      const [a, b] = await Promise.all([first, second]);
      const spawned = [a, b].filter((r) => r.spawned);
      expect(spawned).toHaveLength(1);
      expect(a.port).toBe(b.port);
      expect(a.token).toBe(b.token);
      expect(a.owned || b.owned).toBe(true);
    } finally {
      await runtime.closeHttpServer();
      delete process.env.IKRAN_FAKE_NEXT_CLOSE_MARKER;
      delete process.env.IKRAN_FAKE_NEXT_PREPARE_MARKER;
      delete process.env.IKRAN_FAKE_NEXT_PREPARE_RELEASE;
      fake.cleanup();
    }
  });

  test("close→restart refreshes session token cache to the new host token", async () => {
    const fake = makeFakeNextApp();
    process.env.IKRAN_FAKE_NEXT_CLOSE_MARKER = fake.closeMarker;
    const runtime = await import("../../lib/runtime/runtime-endpoint.mjs");
    const {
      getSessionToken,
      invalidateSessionTokenCache,
      isValidSession
    } = await import("../../lib/runtime/session");

    try {
      const first = await runtime.openWorkbench({
        stateDir: fake.stateDir,
        host: "127.0.0.1",
        prod: false,
        cwd: fake.appDir,
        owner: "standalone"
      });
      expect(first.token.length).toBeGreaterThan(0);
      expect(process.env.IKRAN_SESSION_TOKEN).toBe(first.token);
      expect(
        (globalThis as { __IKRAN_SESSION_TOKEN?: string }).__IKRAN_SESSION_TOKEN
      ).toBe(first.token);
      expect(getSessionToken()).toBe(first.token);
      expect(isValidSession(first.token)).toBe(true);

      await runtime.closeHttpServer();
      expect(runtime.getActiveHttpServer()).toBeNull();
      expect(
        (globalThis as { __IKRAN_SESSION_TOKEN?: string }).__IKRAN_SESSION_TOKEN
      ).toBeUndefined();

      // Simulate a stale cache that somehow survived (pre-fix behavior).
      (
        globalThis as { __IKRAN_SESSION_TOKEN?: string }
      ).__IKRAN_SESSION_TOKEN = first.token;

      const second = await runtime.openWorkbench({
        stateDir: fake.stateDir,
        host: "127.0.0.1",
        prod: false,
        cwd: fake.appDir,
        owner: "standalone"
      });

      expect(second.token).not.toBe(first.token);
      expect(process.env.IKRAN_SESSION_TOKEN).toBe(second.token);
      expect(
        (globalThis as { __IKRAN_SESSION_TOKEN?: string }).__IKRAN_SESSION_TOKEN
      ).toBe(second.token);
      expect(getSessionToken()).toBe(second.token);
      expect(isValidSession(second.token)).toBe(true);
      expect(isValidSession(first.token)).toBe(false);
      expect(second.url).toContain(`session=${encodeURIComponent(second.token)}`);
    } finally {
      await runtime.closeHttpServer();
      invalidateSessionTokenCache();
      delete process.env.IKRAN_SESSION_TOKEN;
      delete process.env.IKRAN_FAKE_NEXT_CLOSE_MARKER;
      fake.cleanup();
    }
  });
});

describe("runtime-start cross-process lock", () => {
  test("withRuntimeStartLock serializes two waiters; stale lock is broken", async () => {
    const {
      withRuntimeStartLock,
      startLockPath
    } = await import("../../lib/runtime/runtime-endpoint.mjs");
    const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-start-lock-"));
    const order: string[] = [];
    try {
      const held = withRuntimeStartLock(stateDir, async () => {
        order.push("holder-enter");
        await new Promise((resolve) => setTimeout(resolve, 80));
        order.push("holder-exit");
        return "held";
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(existsSync(startLockPath(stateDir))).toBe(true);

      const waiter = withRuntimeStartLock(stateDir, async () => {
        order.push("waiter");
        return "waited";
      });

      const [a, b] = await Promise.all([held, waiter]);
      expect(a).toBe("held");
      expect(b).toBe("waited");
      expect(order).toEqual(["holder-enter", "holder-exit", "waiter"]);
      expect(existsSync(startLockPath(stateDir))).toBe(false);

      // Stale lock from a dead pid must not block a new claim.
      writeFileSync(
        startLockPath(stateDir),
        JSON.stringify({
          pid: 2_147_483_647,
          ownerId: "dead-owner",
          at: new Date().toISOString()
        })
      );
      const afterStale = await withRuntimeStartLock(stateDir, async () => "ok");
      expect(afterStale).toBe("ok");
      expect(existsSync(startLockPath(stateDir))).toBe(false);
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test(
    "two processes: start lock serializes; loser reuses live endpoint",
    async () => {
      const { spawn } = await import("node:child_process");
      const fake = makeFakeNextApp();
      const workerPath = path.join(fake.appDir, "..", "race-worker.mjs");
      const resultA = path.join(fake.appDir, "..", "result-a.json");
      const resultB = path.join(fake.appDir, "..", "result-b.json");
      const readyA = path.join(fake.appDir, "..", "ready-a");

      writeFileSync(
        workerPath,
        `
        import { writeFileSync } from "node:fs";
        import { pathToFileURL } from "node:url";
        const endpointUrl = pathToFileURL(${JSON.stringify(
          path.join(ROOT, "lib/runtime/runtime-endpoint.mjs")
        )}).href;
        const { openWorkbench, closeHttpServer } = await import(endpointUrl);
        const outFile = process.env.IKRAN_RACE_OUT;
        const readyFile = process.env.IKRAN_RACE_READY;
        const holdMs = Number(process.env.IKRAN_RACE_HOLD_MS || "0");
        try {
          if (readyFile) writeFileSync(readyFile, "ready");
          const r = await openWorkbench({
            stateDir: process.env.IKRAN_RACE_STATE_DIR,
            host: "127.0.0.1",
            prod: false,
            cwd: process.env.IKRAN_RACE_APP_DIR,
            owner: "standalone",
            timeoutMs: 30_000
          });
          writeFileSync(
            outFile,
            JSON.stringify({
              ok: true,
              spawned: r.spawned,
              port: r.port,
              token: r.token,
              pid: process.pid
            })
          );
          if (r.owned && holdMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, holdMs));
          }
          if (r.owned && typeof r.close === "function") await r.close();
          else await closeHttpServer();
        } catch (err) {
          writeFileSync(
            outFile,
            JSON.stringify({
              ok: false,
              error: err instanceof Error ? err.message : String(err)
            })
          );
          process.exitCode = 1;
        }
      `
      );

      const envBase = { ...process.env };
      for (const key of Object.keys(envBase)) {
        if (
          key.startsWith("VITEST") ||
          key.startsWith("VITE_") ||
          key === "NODE_OPTIONS"
        ) {
          delete envBase[key];
        }
      }
      Object.assign(envBase, {
        IKRAN_FAKE_NEXT_CLOSE_MARKER: fake.closeMarker,
        IKRAN_RACE_STATE_DIR: fake.stateDir,
        IKRAN_RACE_APP_DIR: fake.appDir
      });

      const logs: string[] = [];
      const spawnWorker = (outFile: string, extraEnv: Record<string, string>) => {
        const child = spawn(process.execPath, [workerPath], {
          env: { ...envBase, IKRAN_RACE_OUT: outFile, ...extraEnv },
          stdio: ["ignore", "pipe", "pipe"]
        });
        child.stderr?.on("data", (chunk: Buffer) => {
          logs.push(String(chunk));
        });
        child.stdout?.on("data", (chunk: Buffer) => {
          logs.push(String(chunk));
        });
        return child;
      };

      // Stagger: A starts first and holds the HTTP surface; B starts while A is live.
      const childA = spawnWorker(resultA, {
        IKRAN_RACE_READY: readyA,
        IKRAN_RACE_HOLD_MS: "1500"
      });
      const exitA = new Promise<number>((resolve) =>
        childA.on("exit", (c) => resolve(c ?? 1))
      );
      let childB: ReturnType<typeof spawnWorker> | null = null;

      try {
        await waitForFile(readyA, 5_000);
        await waitForFile(resultA, 10_000);
        childB = spawnWorker(resultB, { IKRAN_RACE_HOLD_MS: "0" });
        const exitB = new Promise<number>((resolve) =>
          childB!.on("exit", (c) => resolve(c ?? 1))
        );

        const [codeA, codeB] = await Promise.all([exitA, exitB]);
        expect(codeA, `childA logs:\n${logs.join("")}`).toBe(0);
        expect(codeB, `childB logs:\n${logs.join("")}`).toBe(0);

        const a = JSON.parse(readFileSync(resultA, "utf8")) as {
          ok: boolean;
          spawned: boolean;
          port: number;
          token: string;
        };
        const b = JSON.parse(readFileSync(resultB, "utf8")) as {
          ok: boolean;
          spawned: boolean;
          port: number;
          token: string;
        };
        expect(a.ok).toBe(true);
        expect(b.ok).toBe(true);
        expect(a.spawned).toBe(true);
        expect(b.spawned).toBe(false);
        expect(a.port).toBe(b.port);
        expect(a.token).toBe(b.token);
      } finally {
        childA.kill("SIGKILL");
        childB?.kill("SIGKILL");
        fake.cleanup();
      }
    },
    20_000
  );

  test(
    "two processes concurrent first-start: only one spawns",
    async () => {
      const { spawn } = await import("node:child_process");
      const fake = makeFakeNextApp();
      const workerPath = path.join(fake.appDir, "..", "race-worker.mjs");
      const resultA = path.join(fake.appDir, "..", "result-a.json");
      const resultB = path.join(fake.appDir, "..", "result-b.json");

      writeFileSync(
        workerPath,
        `
        import { writeFileSync } from "node:fs";
        import { pathToFileURL } from "node:url";
        const endpointUrl = pathToFileURL(${JSON.stringify(
          path.join(ROOT, "lib/runtime/runtime-endpoint.mjs")
        )}).href;
        const { openWorkbench, closeHttpServer } = await import(endpointUrl);
        const outFile = process.env.IKRAN_RACE_OUT;
        const holdMs = Number(process.env.IKRAN_RACE_HOLD_MS || "0");
        try {
          const r = await openWorkbench({
            stateDir: process.env.IKRAN_RACE_STATE_DIR,
            host: "127.0.0.1",
            prod: false,
            cwd: process.env.IKRAN_RACE_APP_DIR,
            owner: "standalone",
            timeoutMs: 30_000
          });
          writeFileSync(
            outFile,
            JSON.stringify({
              ok: true,
              spawned: r.spawned,
              port: r.port,
              token: r.token,
              pid: process.pid
            })
          );
          if (r.owned && holdMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, holdMs));
          }
          if (r.owned && typeof r.close === "function") await r.close();
          else await closeHttpServer();
        } catch (err) {
          writeFileSync(
            outFile,
            JSON.stringify({
              ok: false,
              error: err instanceof Error ? err.message : String(err)
            })
          );
          process.exitCode = 1;
        }
      `
      );

      const envBase = { ...process.env };
      for (const key of Object.keys(envBase)) {
        if (
          key.startsWith("VITEST") ||
          key.startsWith("VITE_") ||
          key === "NODE_OPTIONS"
        ) {
          delete envBase[key];
        }
      }
      Object.assign(envBase, {
        IKRAN_FAKE_NEXT_CLOSE_MARKER: fake.closeMarker,
        IKRAN_RACE_STATE_DIR: fake.stateDir,
        IKRAN_RACE_APP_DIR: fake.appDir,
        // Winner keeps HTTP up long enough for the loser to probe+reuse.
        IKRAN_RACE_HOLD_MS: "2000"
      });

      const logs: string[] = [];
      const spawnWorker = (outFile: string) => {
        const child = spawn(process.execPath, [workerPath], {
          env: { ...envBase, IKRAN_RACE_OUT: outFile },
          stdio: ["ignore", "pipe", "pipe"]
        });
        child.stderr?.on("data", (chunk: Buffer) => {
          logs.push(String(chunk));
        });
        return child;
      };

      const childA = spawnWorker(resultA);
      const childB = spawnWorker(resultB);
      const exitA = new Promise<number>((resolve) =>
        childA.on("exit", (c) => resolve(c ?? 1))
      );
      const exitB = new Promise<number>((resolve) =>
        childB.on("exit", (c) => resolve(c ?? 1))
      );

      try {
        await new Promise<void>((resolve, reject) => {
          const deadline = Date.now() + 15_000;
          const tick = () => {
            if (existsSync(resultA) && existsSync(resultB)) {
              resolve();
              return;
            }
            if (Date.now() >= deadline) {
              reject(
                new Error(
                  `results missing; logs:\n${logs.join("")}\n` +
                    `a=${existsSync(resultA)} b=${existsSync(resultB)}`
                )
              );
              return;
            }
            setTimeout(tick, 50);
          };
          tick();
        });

        const a = JSON.parse(readFileSync(resultA, "utf8")) as {
          ok: boolean;
          spawned: boolean;
          port: number;
          token: string;
        };
        const b = JSON.parse(readFileSync(resultB, "utf8")) as {
          ok: boolean;
          spawned: boolean;
          port: number;
          token: string;
        };
        expect(a.ok, JSON.stringify(a)).toBe(true);
        expect(b.ok, JSON.stringify(b)).toBe(true);
        expect([a.spawned, b.spawned].filter(Boolean)).toHaveLength(1);
        expect(a.port).toBe(b.port);
        expect(a.token).toBe(b.token);

        const [codeA, codeB] = await Promise.all([exitA, exitB]);
        expect(codeA).toBe(0);
        expect(codeB).toBe(0);
      } finally {
        childA.kill("SIGKILL");
        childB.kill("SIGKILL");
        fake.cleanup();
      }
    },
    25_000
  );
});
