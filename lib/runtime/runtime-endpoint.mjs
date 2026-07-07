// Ikran Runtime endpoint discovery + reuse-or-spawn.
//
// Shared by `bin/ikran.mjs` (the designer CLI) and `bin/ikran-mcp.mjs` (the
// `open_workbench` MCP stdio server), and by the Playwright e2e for Issue 02/01.
//
// This module is the core of Issue 02/01's "two-process coordinator + env-token
// bridge" (see ADR 0001 + docs/issue02-01-handoff.md). A coordinator process
// (launcher or MCP server):
//   1. tries to REUSE a live Runtime recorded in `runtime-endpoint.json` (probes
//      /api/health with the recorded token);
//   2. else SPAWNS a new Next HTTP surface as a child with
//      IKRAN_SESSION_TOKEN + IKRAN_HOST + IKRAN_PORT in env, on an auto free
//      port, waits for readiness, writes the user-only reuse state, and
//      composes the canonical Workbench URL `http://127.0.0.1:{port}/?session={token}`.
//
// The startup token is held in-memory only (env -> child process memory via
// lib/runtime/session.ts). It is never persisted except inside the user-only
// reuse state file below, which lets a later `open_workbench` call reuse the
// already-running Runtime instead of spawning a duplicate.
//
// One-process consolidation (a custom Next server where MCP tool handlers
// share in-memory record state with the HTTP API) is deliberate FOLLOW-UP work
// for Issue 02/03 (ADR "后续工作项 #2"). Do not collapse this into one process
// here.
//
// Plain JS ESM (.mjs) on purpose: tsconfig has allowJs:false so `tsc --noEmit`
// ignores this file, and both `bin/*.mjs` and Playwright `.ts` tests can import
// it via Node ESM resolution.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import http from "node:http";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

// Hostnames that count as "local". The Runtime must bind localhost only (PRD:
// never expose local filesystem / command-execution capabilities to arbitrary
// websites). The same set is used by lib/runtime/config.ts; mirrored here so
// this .mjs has no TS import dependency.
const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function isLocalhostHost(host) {
  return LOCALHOST_HOSTS.has(host);
}

// Pick a free TCP port on 127.0.0.1 by listening on port 0 and closing.
export function pickFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        resolve(addr.port);
      } else {
        reject(new Error("failed to pick a free port"));
      }
      srv.close();
    });
  });
}

// Compose the canonical Workbench URL. The token is hex so encodeURIComponent
// is a no-op, but kept for safety / robustness against future token shapes.
export function composeWorkbenchUrl(host, port, token) {
  return `http://${host}:${port}/?session=${encodeURIComponent(token)}`;
}

// User-only reuse state file: lets a second coordinator (or a second
// `open_workbench` call) reuse an already-running Runtime instead of spawning a
// duplicate. Shape: { host, port, token, pid, startedAt }.
export function endpointFilePath(stateDir) {
  return path.join(stateDir, "runtime-endpoint.json");
}

// Read the reuse state. Tolerates a missing or corrupt file (returns null).
export function readRuntimeEndpoint(stateDir) {
  const file = endpointFilePath(stateDir);
  try {
    if (!existsSync(file)) return null;
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.host !== "string" ||
      typeof parsed.port !== "number" ||
      typeof parsed.token !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// Write the reuse state with user-only permissions (mode 0o600).
export function writeRuntimeEndpoint(stateDir, info) {
  mkdirSync(stateDir, { recursive: true });
  const payload = {
    host: info.host,
    port: info.port,
    token: info.token,
    pid: info.pid,
    startedAt: info.startedAt ?? new Date().toISOString()
  };
  writeFileSync(endpointFilePath(stateDir), JSON.stringify(payload, null, 2), {
    mode: 0o600
  });
  return payload;
}

export function removeRuntimeEndpoint(stateDir) {
  rmSync(endpointFilePath(stateDir), { force: true });
}

// Probe whether a Runtime recorded in the reuse state is still alive AND still
// answers with the same startup token. Uses raw node http (no fetch/EventSource)
// so it works without a browser. Resolves true iff /api/health returns 200 AND
// the body contains the service string "ikran-runtime" (proves the recorded
// token is still valid for that process).
export function probeRuntimeAlive(host, port, token, timeoutMs = 2000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const req = http.get(
      {
        hostname: host,
        port,
        path: "/api/health",
        headers: { host: `${host}:${port}`, "x-ikran-session": token },
        timeout: timeoutMs
      },
      (res) => {
        let body = "";
        res.setEncoding("utf-8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          finish(res.statusCode === 200 && body.includes("ikran-runtime"));
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      finish(false);
    });
    req.on("error", () => finish(false));
  });
}

// Locate the Next.js CLI. Resolves it as a JS module path so it can be run via
// `node <path>` cross-platform (the bare `node_modules/.bin/next` shim is a
// shell script on Windows and not runnable under `node`). This mirrors the
// existing `bin/ikran.mjs` launcher. Errors clearly if Next is missing.
export function resolveNextBin(cwd) {
  try {
    return require.resolve("next/dist/bin/next", { paths: [cwd] });
  } catch {
    throw new Error(
      "Could not locate the Next.js CLI. Run `npm install` first."
    );
  }
}

// Poll the public HTML shell (NOT /api/health, which requires a session token)
// until it returns 2xx. Rejects on timeout — mirrors the existing launcher /
// fixture readiness probe.
export function waitForReady(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const timeoutMessage = `Ikran Runtime at ${host}:${port} did not become ready within ${timeoutMs}ms`;
    const probe = () => {
      const req = http.get(
        {
          hostname: host,
          port,
          path: "/",
          headers: { host: `${host}:${port}` }
        },
        (res) => {
          res.resume();
          res.on("end", () => {
            const code = res.statusCode ?? 0;
            if (code > 0 && code < 300) {
              resolve();
            } else if (Date.now() >= deadline) {
              reject(new Error(timeoutMessage));
            } else {
              setTimeout(probe, 300);
            }
          });
        }
      );
      req.on("error", () => {
        if (Date.now() >= deadline) {
          reject(new Error(timeoutMessage));
        } else {
          setTimeout(probe, 300);
        }
      });
    };
    probe();
  });
}

// Core reuse-or-spawn routine. Used by BOTH bin files and the MCP e2e test.
//
// Returns { url, host, port, token, pid, spawned, child }:
//   - spawned:true  -> a NEW Runtime was spawned; `child` is the ChildHandle the
//                      caller MUST tear down (process group) on exit.
//   - spawned:false -> a live Runtime was reused; `child` is null and the
//                      caller MUST NOT kill it on exit (it does not own it).
//
// `host` MUST be localhost. Validated here (reject non-localhost with a clear
// error) so callers can't accidentally bind a broad interface.
//
// The child is spawned with `stdio: ["ignore","pipe","pipe"]` so the Next
// child's stdout NEVER reaches this process's stdout (critical for the MCP
// server, whose stdout is the JSON-RPC channel). The caller is responsible for
// reading/forwarding `child.stdout` / `child.stderr` to avoid pipe-buffer
// block; this routine does not forward them.
//
// `detached: true` is used so the child leads its OWN process group —
// `process.kill(-child.pid, sig)` is the only reliable way to reap `next start`'s
// forked server worker on shutdown (see tests/fixtures.ts). The handoff for
// Issue 02/01 specifies "kill the child process group" in the lifecycle, which
// requires the child to be a group leader, so `detached: true` is used (not
// `false`) to make that group teardown reliable.
export async function openWorkbench({
  stateDir,
  host,
  prod,
  cwd,
  nextDistDir,
  extraEnv,
  timeoutMs = 60_000,
  port
}) {
  if (!isLocalhostHost(host)) {
    throw new Error(
      `Refusing to open the Ikran workbench on non-localhost host "${host}". Ikran binds localhost only.`
    );
  }

  // 1. Reuse a live Runtime if one is recorded and still answers with its token.
  // The probe timeout is generous (10s) to accommodate `next dev`'s first-request
  // compile of /api/health on a cold start (in `--prod` mode the route is
  // pre-compiled and returns in well under the default 2000ms).
  const existing = readRuntimeEndpoint(stateDir);
  if (existing) {
    const alive = await probeRuntimeAlive(
      existing.host,
      existing.port,
      existing.token,
      10_000
    );
    if (alive) {
      const wantsSpecificPort = typeof port === "number" && port > 0;
      // Reuse when the caller didn't pin a port (auto port), or pinned the same
      // port the live Runtime is on. host is always localhost (validated at
      // entry; the recorded endpoint was validated when it was spawned), so the
      // only real discriminator is the port.
      if (!wantsSpecificPort || existing.port === port) {
        return {
          url: composeWorkbenchUrl(existing.host, existing.port, existing.token),
          host: existing.host,
          port: existing.port,
          token: existing.token,
          pid: existing.pid,
          spawned: false,
          child: null
        };
      }
      // The caller asked for a specific port that differs from the live
      // Runtime's. Don't silently return the old port's URL (which would ignore
      // --port / IKRAN_PORT), and don't orphan the running Runtime by spawning a
      // second one on the requested port (the shared endpoint file would be
      // overwritten, leaking the first). Surface the conflict so the user stops
      // the running Runtime first.
      throw new Error(
        `Ikran Runtime is already running on ${existing.host}:${existing.port}, but port ${port} was requested. ` +
          `Stop the running Runtime first (or drop --port / IKRAN_PORT to reuse it).`
      );
    }
  }

  // 2. Spawn a new Runtime. Use the caller-provided port when given (the
  // launcher's `--port` / `IKRAN_PORT`), else pick an auto free port.
  const boundPort =
    typeof port === "number" && port > 0 ? port : await pickFreePort();
  const token = randomBytes(32).toString("hex");
  const nextBin = resolveNextBin(cwd);
  const mode = prod ? "start" : "dev";
  const args = [mode, "-H", host, "-p", String(boundPort)];
  const env = {
    ...process.env,
    IKRAN_HOST: host,
    IKRAN_PORT: String(boundPort),
    IKRAN_SESSION_TOKEN: token,
    ...(nextDistDir ? { IKRAN_NEXT_DIST_DIR: nextDistDir } : {}),
    ...(extraEnv || {})
  };

  const child = spawn(process.execPath, [nextBin, ...args], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true
  });

  // Wait for readiness, but fail fast if the child exits or errors before it is
  // ready (instead of waiting the full timeout).
  try {
    await new Promise((resolve, reject) => {
      let done = false;
      const fail = (err) => {
        if (!done) {
          done = true;
          reject(err);
        }
      };
      child.on("error", (err) =>
        fail(
          new Error(
            `Failed to spawn the Ikran Runtime (next ${mode}): ${err.message}`
          )
        )
      );
      child.on("exit", (code, signal) => {
        if (!done) {
          fail(
            new Error(
              `Ikran Runtime (next ${mode}) exited early with code ${code} signal ${signal} before becoming ready.`
            )
          );
        }
      });
      waitForReady(host, boundPort, timeoutMs).then(resolve, fail);
    });
  } catch (err) {
    // Best-effort cleanup of the half-spawned child before rethrowing.
    try {
      if (child.pid) process.kill(-child.pid, "SIGKILL");
    } catch {
      /* already gone */
    }
    removeRuntimeEndpoint(stateDir);
    throw err;
  }

  writeRuntimeEndpoint(stateDir, {
    host,
    port: boundPort,
    token,
    pid: child.pid,
    startedAt: new Date().toISOString()
  });

  return {
    url: composeWorkbenchUrl(host, boundPort, token),
    host,
    port: boundPort,
    token,
    pid: child.pid,
    spawned: true,
    child
  };
}