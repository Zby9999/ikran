// Playwright fixtures: one isolated Ikran Runtime per worker.
//
// globalSetup (tests/global-setup.ts) produces a single `next build` into
// SHARED_BUILD_DIR. Each worker then runs a lightweight `next start` against
// that shared build, on its own port, with its own IKRAN_STATE_DIR
// (active-project pointer). This delivers real parallelism (workers>1) without:
//   - clobbering one another's active-project pointer (per-worker state dir),
//   - corrupting a shared `.next/` (each `next start` only READS the build),
//   - `next dev` auto-editing the committed tsconfig.json per worker.
// Production runtime code is unchanged; isolation lives entirely in the harness.
//
// Tests import { test, expect } from "./fixtures" and destructure `runtime`
// ({ baseURL, port, stateDir }) when they need the worker's server. Tests that
// don't reference `runtime` (e.g. pure unit tests of lib/* helpers) don't
// trigger a server spawn — Playwright fixtures are lazy, and `runtime` is
// worker-scoped so it's set up at most once per worker.

import { test as base, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { SHARED_BUILD_DIR } from "./e2e-constants";

export interface RuntimeHandle {
  /** Absolute origin, e.g. `http://localhost:54321`. Use for `page.goto`. */
  baseURL: string;
  /** The port the worker's Next server listens on. */
  port: number;
  /** Per-worker temp dir holding the isolated runtime-state.json. */
  stateDir: string;
}

function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        resolve((addr as { port: number }).port);
      } else {
        reject(new Error("failed to pick a free port"));
      }
      srv.close();
    });
  });
}

// Probe the root page (NOT /api/health — that requires a session token and
// returns 403 to an unauthenticated probe). `/` is the public HTML shell and
// returns 2xx once `next start` is listening.
function rootProbe(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/",
        method: "GET",
        headers: { host: `localhost:${port}` }
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve((res.statusCode ?? 0) > 0 && (res.statusCode ?? 0) < 400));
      }
    );
    req.on("error", () => resolve(false));
    req.end();
  });
}

async function waitForRuntime(port: number, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await rootProbe(port)) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `Ikran runtime on port ${port} did not become ready within ${timeoutMs}ms`
  );
}

// `runtime` is a WORKER-scoped fixture (one Ikran Runtime per worker). Per
// Playwright's Fixtures typing, worker-scoped fixtures must be declared in the
// `W` (second) generic of extend<T, W>, NOT in T — T only permits scope:'test'.
export const test = base.extend<{}, { runtime: RuntimeHandle }>({
  runtime: [
    async ({}, use) => {
      const port = await pickFreePort();
      const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-e2e-w-"));
      const nextBin = path.join(process.cwd(), "node_modules", ".bin", "next");

      const child = spawn(
        nextBin,
        ["start", "-H", "127.0.0.1", "-p", String(port)],
        {
          env: {
            ...process.env,
            IKRAN_STATE_DIR: stateDir,
            IKRAN_NEXT_DIST_DIR: SHARED_BUILD_DIR
          },
          stdio: ["ignore", "pipe", "pipe"],
          cwd: process.cwd(),
          // Detach so the child leads its own process group; `next start` may
          // fork a server worker (a grandchild), and tearing down the WHOLE
          // group via process.kill(-pid) is the only reliable way to not leak.
          detached: true,
          shell: process.platform === "win32"
        }
      );

      let stderrBuf = "";
      child.stdout?.on("data", () => {
        /* drop stdout */
      });
      child.stderr?.on("data", (d: Buffer) => {
        stderrBuf += d.toString();
        if (stderrBuf.length > 8000) stderrBuf = stderrBuf.slice(-8000);
      });

      try {
        await waitForRuntime(port);
        await use({ baseURL: `http://localhost:${port}`, port, stateDir });
      } finally {
        // Kill the whole process group (the next CLI + any server worker it
        // forked). Negative pid = signal the group.
        const killGroup = (sig: NodeJS.Signals) => {
          if (child.pid) {
            try { process.kill(-child.pid, sig); } catch { /* already gone */ }
          }
        };
        killGroup("SIGTERM");
        // Best-effort wait for exit, then hard-kill the group if it lingers.
        await Promise.race([
          new Promise<void>((r) => child.once("exit", () => r())),
          new Promise<void>((r) => setTimeout(() => r(), 3000))
        ]);
        killGroup("SIGKILL");
        rmSync(stateDir, { recursive: true, force: true });
        if (stderrBuf && process.env.IKRAN_E2E_DEBUG) {
          // eslint-disable-next-line no-console
          console.error(
            `[ikran e2e worker port=${port}] next start stderr:\n${stderrBuf}`
          );
        }
      }
    },
    { scope: "worker", timeout: 60_000 }
  ]
});

export { expect };