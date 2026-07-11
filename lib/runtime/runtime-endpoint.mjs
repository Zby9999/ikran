// Ikran Runtime endpoint discovery + in-process HTTP host orchestration.
//
// Shared by `bin/ikran.mjs` (designer CLI) and `bin/ikran-mcp.mjs` (stdio MCP).
//
// Task 9: true one-process Runtime. This module no longer spawns Next. It:
//   1. discovers a live Runtime via user-only `runtime-endpoint.json` + health probe;
//   2. enforces owner mode (mcp | standalone) so MCP never attaches to a
//      standalone launcher HTTP surface (that would reintroduce two processes);
//   3. otherwise starts the HTTP surface in THIS process via http-server.mjs.
//
// Task 10: MCP semantic tools call the shared command kernel directly (no
// localhost HTTP loopback). Endpoint pid is always the actual Runtime process.pid.

import http from "node:http";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import {
  fileLockPath,
  releaseFileLock,
  tryAcquireFileLock,
  withFileLock
} from "./file-lock.mjs";
import {
  closeHttpServer,
  composeHostHeader,
  composeWorkbenchUrl as composeUrl,
  getActiveHttpServer,
  isLocalhostHost as isLocal,
  pickFreePort as pickPort,
  startHttpServer,
  stripHostBrackets,
  waitForReady as waitReady
} from "./http-server.mjs";

const START_LOCK_FILE = "runtime-start.lock";

export function isLocalhostHost(host) {
  return isLocal(host);
}

export function pickFreePort() {
  return pickPort();
}

export function composeWorkbenchUrl(host, port, token) {
  return composeUrl(host, port, token);
}

export function waitForReady(host, port, timeoutMs) {
  return waitReady(host, port, timeoutMs);
}

export function endpointFilePath(stateDir) {
  return path.join(stateDir, "runtime-endpoint.json");
}

function isValidEndpointPort(port) {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

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
    // Tampered state must not redirect health probes off loopback.
    if (!isLocalhostHost(parsed.host) || !isValidEndpointPort(parsed.port)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Write reuse state (mode 0o600). `owner` must be "mcp" | "standalone".
 * `pid` must be the actual Runtime process (this process when we host HTTP).
 * Uses temp + chmod + atomic rename so a pre-existing 0644 file cannot keep
 * world-readable perms (`mode` on writeFileSync only applies on create).
 */
export function writeRuntimeEndpoint(stateDir, info) {
  mkdirSync(stateDir, { recursive: true });
  const owner = info.owner === "standalone" ? "standalone" : "mcp";
  const payload = {
    host: info.host,
    port: info.port,
    token: info.token,
    pid: info.pid,
    owner,
    startedAt: info.startedAt ?? new Date().toISOString()
  };
  const file = endpointFilePath(stateDir);
  const tmp = path.join(
    stateDir,
    `.runtime-endpoint.${process.pid}.${randomBytes(8).toString("hex")}.tmp`
  );
  try {
    writeFileSync(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, file);
    chmodSync(file, 0o600);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // best-effort cleanup
    }
    throw err;
  }
  return payload;
}

export function removeRuntimeEndpoint(stateDir) {
  rmSync(endpointFilePath(stateDir), { force: true });
}

export function probeRuntimeAlive(host, port, token, timeoutMs = 2000) {
  const bareHost = stripHostBrackets(host);
  const hostHeader = composeHostHeader(bareHost, port);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      finish(false);
    }, timeoutMs);
    const req = http.get(
      {
        hostname: bareHost,
        port,
        path: "/api/health",
        headers: { host: hostHeader, "x-ikran-session": token },
        signal: controller.signal
      },
      (res) => {
        let body = "";
        res.setEncoding("utf-8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          clearTimeout(timer);
          finish(res.statusCode === 200 && body.includes("ikran-runtime"));
        });
      }
    );
    req.on("error", () => {
      clearTimeout(timer);
      finish(false);
    });
  });
}

function conflictPortMessage(existing, port) {
  return (
    `Ikran Runtime is already running on ${existing.host}:${existing.port}, but port ${port} was requested. ` +
    `Stop the running Runtime first (or drop --port / IKRAN_PORT to reuse it).`
  );
}

function conflictStandaloneForMcp(existing) {
  return (
    `Ikran Runtime conflict: a standalone launcher already owns the HTTP surface on ` +
    `${existing.host}:${existing.port} (pid ${existing.pid}, owner=standalone). ` +
    `Stop that launcher first. MCP refuses to attach to a standalone HTTP surface ` +
    `(that would reintroduce a two-process Runtime).`
  );
}

function conflictOtherMcp(existing) {
  return (
    `Ikran Runtime conflict: another MCP Runtime is already live on ` +
    `${existing.host}:${existing.port} (pid ${existing.pid}, owner=mcp). ` +
    `Stop it before starting a second MCP Runtime with the same IKRAN_STATE_DIR.`
  );
}

/** Cross-process exclusive lock file for first-start claim (atomic O_EXCL create). */
export function startLockPath(stateDir) {
  return fileLockPath(stateDir, START_LOCK_FILE);
}

/** @returns {string|null} ownerId on success, null if lock already held */
export function tryAcquireStartLock(stateDir) {
  return tryAcquireFileLock(startLockPath(stateDir));
}

/** Release only if `ownerId` still owns the lock (compare-and-delete). */
export function releaseStartLock(stateDir, ownerId) {
  releaseFileLock(startLockPath(stateDir), ownerId);
}

/**
 * Serialize discover → start → write across processes for one stateDir.
 * Losers wait, then re-enter the critical section (re-read / reuse).
 * Uses the shared file-lock model (ownerId + corrupt grace + compare-and-delete).
 */
export async function withRuntimeStartLock(
  stateDir,
  fn,
  { timeoutMs = 60_000, pollMs = 50 } = {}
) {
  return withFileLock(startLockPath(stateDir), fn, {
    timeoutMs,
    pollMs,
    label: "Runtime start"
  });
}

function reuseActiveHandle(active, port) {
  const wantsSpecificPort = typeof port === "number" && port > 0;
  if (wantsSpecificPort && active.port !== port) {
    throw new Error(conflictPortMessage(active, port));
  }
  return {
    url: active.url,
    host: active.host,
    port: active.port,
    token: active.token,
    pid: process.pid,
    spawned: false,
    owned: true,
    close: active.close,
    child: null
  };
}

/**
 * Apply owner / port conflict rules for a live on-disk endpoint.
 * @returns {object|null} reuse result, or null if not alive (caller should start)
 */
async function tryReuseLiveEndpoint(stateDir, owner, port) {
  const existing = readRuntimeEndpoint(stateDir);
  if (!existing) return null;
  const alive = await probeRuntimeAlive(
    existing.host,
    existing.port,
    existing.token,
    10_000
  );
  if (!alive) return null;

  const wantsSpecificPort = typeof port === "number" && port > 0;
  if (wantsSpecificPort && existing.port !== port) {
    throw new Error(conflictPortMessage(existing, port));
  }

  if (owner === "mcp") {
    if (existing.owner === "standalone") {
      throw new Error(conflictStandaloneForMcp(existing));
    }
    // owner mcp (or legacy missing owner treated as foreign if other pid)
    if (existing.pid !== process.pid) {
      throw new Error(conflictOtherMcp(existing));
    }
    // Same pid, alive, but no active handle — unusual; treat as reuse without
    // claiming a new close (HTTP already up in this process somehow).
    return {
      url: composeWorkbenchUrl(existing.host, existing.port, existing.token),
      host: existing.host,
      port: existing.port,
      token: existing.token,
      pid: existing.pid,
      spawned: false,
      owned: true,
      close: closeHttpServer,
      child: null
    };
  }

  // standalone: reuse any live endpoint for print/open only — do NOT become
  // a second Runtime.
  return {
    url: composeWorkbenchUrl(existing.host, existing.port, existing.token),
    host: existing.host,
    port: existing.port,
    token: existing.token,
    pid: existing.pid,
    spawned: false,
    owned: false,
    close: null,
    child: null
  };
}

/**
 * Reuse-or-start the local Ikran Runtime HTTP surface in-process.
 *
 * @param {object} opts
 * @param {string} opts.stateDir
 * @param {string} opts.host
 * @param {boolean} opts.prod
 * @param {string} opts.cwd package root
 * @param {string} [opts.nextDistDir]
 * @param {Record<string,string>} [opts.extraEnv]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.port]
 * @param {"mcp"|"standalone"} opts.owner
 *
 * Returns { url, host, port, token, pid, spawned, owned, close }:
 *   - spawned:true  → this call started HTTP in-process; caller owns lifecycle
 *   - spawned:false → reused live endpoint or in-process active handle
 *   - owned:true    → caller should close HTTP + clear endpoint on exit
 *   - owned:false   → print/open only (e.g. standalone reusing live MCP)
 */
export async function openWorkbench({
  stateDir,
  host,
  prod,
  cwd,
  nextDistDir,
  extraEnv,
  timeoutMs = 60_000,
  port,
  owner
}) {
  if (!isLocalhostHost(host)) {
    throw new Error(
      `Refusing to open the Ikran workbench on non-localhost host "${host}". Ikran binds localhost only.`
    );
  }
  if (owner !== "mcp" && owner !== "standalone") {
    throw new Error(`openWorkbench requires owner "mcp" or "standalone" (got ${owner})`);
  }

  // 1. Already hosting HTTP in this process → idempotent reuse (no re-prepare).
  const active = getActiveHttpServer();
  if (active) {
    return reuseActiveHandle(active, port);
  }

  // 2. Fast path: live endpoint on disk (no lock — read-only reuse / conflict).
  const fastReuse = await tryReuseLiveEndpoint(stateDir, owner, port);
  if (fastReuse) return fastReuse;

  // 3. First-start claim: exclusive lock covers re-discover → start → write so
  //    two processes with the same stateDir cannot both spawn HTTP.
  return withRuntimeStartLock(
    stateDir,
    async () => {
      // Same-process concurrent loser: winner may have become active while we waited.
      const activeAfterLock = getActiveHttpServer();
      if (activeAfterLock) {
        return reuseActiveHandle(activeAfterLock, port);
      }

      // Cross-process loser: winner wrote a live endpoint while we waited.
      const reuseAfterLock = await tryReuseLiveEndpoint(stateDir, owner, port);
      if (reuseAfterLock) return reuseAfterLock;

      const handle = await startHttpServer({
        host,
        prod,
        dir: cwd,
        nextDistDir,
        extraEnv,
        port,
        timeoutMs,
        stdoutDiscipline: owner === "mcp"
      });

      writeRuntimeEndpoint(stateDir, {
        host: handle.host,
        port: handle.port,
        token: handle.token,
        pid: process.pid,
        owner
      });

      return {
        url: handle.url,
        host: handle.host,
        port: handle.port,
        token: handle.token,
        pid: process.pid,
        spawned: true,
        owned: true,
        close: handle.close,
        child: null
      };
    },
    { timeoutMs }
  );
}

export { closeHttpServer, getActiveHttpServer, startHttpServer };
