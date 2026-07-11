// Ikran Runtime HTTP host — programmatic Next.js custom server in THIS process.
//
// Task 9: one-process Runtime. stdio MCP and HTTP/SSE share process.pid.
// No Next child spawn. stdout discipline: when stdoutDiscipline is true (MCP),
// Next/console noise is forced to stderr so JSON-RPC on stdout stays clean.
//
// Official Next 16.2 custom server: next({dev,dir,...}) → prepare() →
// getRequestHandler() + http.createServer. Loses Automatic Static Optimization;
// incompatible with output:standalone (this repo does not use standalone).

import { randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import http from "node:http";
import { createServer as createNetServer } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { assertProdBuildMatchesSource } from "./version-stamp.mjs";

const require = createRequire(import.meta.url);

const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** @type {import('./http-server.mjs').HttpServerHandle | null} */
let active = null;
/** @type {Promise<import('./http-server.mjs').HttpServerHandle> | null} */
let starting = null;
/** @type {Promise<void> | null} */
let closing = null;
let lifecycleGeneration = 0;
const nextStdoutContext = new AsyncLocalStorage();
let stdoutRouterInstalled = false;

/**
 * Strip RFC 3986 IPv6 brackets. Bind / http.hostname want bare `::1`;
 * URL / Host header need `[::1]`.
 * @param {string} host
 */
export function stripHostBrackets(host) {
  if (typeof host !== "string") return host;
  if (host.startsWith("[") && host.endsWith("]") && host.includes(":")) {
    return host.slice(1, -1);
  }
  return host;
}

/**
 * Canonical bind/listen host for localhost allowlist.
 * Accepts `::1` or `[::1]`; rejects anything else.
 * @param {string} host
 */
export function canonicalizeLocalhostHost(host) {
  const bare = stripHostBrackets(host);
  if (!LOCALHOST_HOSTS.has(bare)) {
    throw new Error(
      `Refusing to open the Ikran workbench on non-localhost host "${host}". Ikran binds localhost only.`
    );
  }
  return bare;
}

export function isLocalhostHost(host) {
  if (typeof host !== "string" || host.length === 0) return false;
  return LOCALHOST_HOSTS.has(stripHostBrackets(host));
}

/**
 * Host authority for URL composition / Host headers.
 * IPv6 must be bracketed (`[::1]`), otherwise `http://::1:port` is illegal.
 * @param {string} host
 */
export function formatHostForUrl(host) {
  const bare = stripHostBrackets(host);
  return bare.includes(":") ? `[${bare}]` : bare;
}

/**
 * @param {string} host
 * @param {number} port
 */
export function composeHostHeader(host, port) {
  return `${formatHostForUrl(host)}:${port}`;
}

export function pickFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
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

export function composeWorkbenchUrl(host, port, token) {
  return `http://${formatHostForUrl(host)}:${port}/?session=${encodeURIComponent(token)}`;
}

export function getActiveHttpServer() {
  return active;
}

/**
 * Keep `lib/runtime/session.ts` cache in sync with the live HTTP host token.
 * Uses the same `globalThis.__IKRAN_SESSION_TOKEN` key session.ts reads so
 * same-process close→restart does not leave a stale cached token.
 */
function adoptSessionToken(token) {
  process.env.IKRAN_SESSION_TOKEN = token;
  globalThis.__IKRAN_SESSION_TOKEN = token;
}

function invalidateSessionTokenCache() {
  delete globalThis.__IKRAN_SESSION_TOKEN;
}

/**
 * Patch console.* to stderr for MCP stdout discipline. Does NOT touch
 * process.stdout.write (MCP JSON-RPC needs it). Call once per MCP process.
 */
export function installStdoutDiscipline() {
  const sink = (...args) => {
    console.error(...args);
  };
  console.log = sink;
  console.info = sink;
  console.debug = sink;
  if (!stdoutRouterInstalled) {
    stdoutRouterInstalled = true;
    const writeToStdout = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk, encoding, callback) => {
      if (nextStdoutContext.getStore() === true) {
        return process.stderr.write(chunk, encoding, callback);
      }
      // MCP transport writes outside the Next AsyncLocalStorage context and
      // therefore always reaches the original stdout JSON-RPC channel.
      return writeToStdout(chunk, encoding, callback);
    };
  }
}

function runInNextStdoutContext(enabled, fn) {
  return enabled ? nextStdoutContext.run(true, fn) : fn();
}

/**
 * Poll until the HTTP surface answers 2xx, or abort when timeoutMs elapses.
 * Uses AbortController so a hung probe cannot outlive the readiness budget.
 * @param {string} host
 * @param {number} port
 * @param {number} timeoutMs
 */
export function waitForReady(host, port, timeoutMs) {
  const bareHost = stripHostBrackets(host);
  const hostHeader = composeHostHeader(bareHost, port);
  const timeoutMessage = `Ikran Runtime at ${hostHeader} did not become ready within ${timeoutMs}ms`;

  return new Promise((resolve, reject) => {
    let settled = false;
    const overall = new AbortController();
    const overallTimer = setTimeout(() => {
      overall.abort();
      finish(new Error(timeoutMessage));
    }, timeoutMs);

    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(overallTimer);
      if (!overall.signal.aborted) overall.abort();
      if (err) reject(err);
      else resolve();
    };

    const probe = () => {
      if (settled || overall.signal.aborted) return;

      const req = http.get(
        {
          hostname: bareHost,
          port,
          path: "/",
          headers: { host: hostHeader },
          signal: overall.signal
        },
        (res) => {
          res.resume();
          res.on("end", () => {
            if (settled) return;
            const code = res.statusCode ?? 0;
            if (code > 0 && code < 300) {
              finish(null);
            } else {
              setTimeout(probe, 300);
            }
          });
        }
      );
      req.on("error", () => {
        if (settled || overall.signal.aborted) {
          // Overall abort owns the rejection; ignore per-request abort noise.
          return;
        }
        setTimeout(probe, 300);
      });
    };

    probe();
  });
}

/**
 * Start (or reuse) the in-process Next HTTP surface.
 *
 * @param {object} opts
 * @param {string} opts.host
 * @param {boolean} opts.prod
 * @param {string} opts.dir package root (contains app/)
 * @param {string} [opts.nextDistDir]
 * @param {Record<string,string>} [opts.extraEnv] e.g. IKRAN_CWD
 * @param {number} [opts.port]
 * @param {string} [opts.token] startup session token; generated if omitted
 * @param {number} [opts.timeoutMs]
 * @param {boolean} [opts.stdoutDiscipline] MCP mode: quiet + console→stderr
 * @returns {Promise<{server,nextApp,host,port,token,url,pid,close,reused:boolean}>}
 */
export async function startHttpServer(opts) {
  // A start requested after close began belongs to the next lifecycle. Do not
  // let it race the close operation over `active` / the listening socket.
  if (closing) {
    await closing;
  }
  if (active) {
    assertCompatiblePort(active, opts.port);
    return { ...active, reused: true };
  }
  if (starting) {
    const h = await starting;
    assertCompatiblePort(h, opts.port);
    return { ...h, reused: true };
  }

  const generation = ++lifecycleGeneration;
  const operation = (async () => {
    const handle = await startHttpServerFresh(opts);
    if (generation !== lifecycleGeneration) {
      await handle.close();
      const error = new Error(
        "Ikran Runtime HTTP startup was cancelled by a close request."
      );
      error.code = "IKRAN_RUNTIME_START_CANCELLED";
      throw error;
    }
    active = handle;
    return handle;
  })();
  starting = operation;
  try {
    const handle = await operation;
    return { ...handle, reused: false };
  } finally {
    if (starting === operation) {
      starting = null;
    }
  }
}

function assertCompatiblePort(handle, requestedPort) {
  if (
    typeof requestedPort === "number" &&
    requestedPort > 0 &&
    handle.port !== requestedPort
  ) {
    throw new Error(
      `Ikran Runtime is already running on ${handle.host}:${handle.port}, but port ${requestedPort} was requested. ` +
        `Stop the running Runtime first (or drop --port / IKRAN_PORT to reuse it).`
    );
  }
}

async function startHttpServerFresh({
  host: hostOpt,
  prod,
  dir,
  nextDistDir,
  extraEnv,
  port,
  token: tokenOpt,
  timeoutMs = 60_000,
  stdoutDiscipline = false
}) {
  // Canonical bare form (`::1`, not `[::1]`) for listen / Next hostname /
  // endpoint records. URL + Host header composition re-brackets IPv6.
  const host = canonicalizeLocalhostHost(hostOpt);

  // Prod fail-closed: MCP loads current TS; HTTP serves `.next`. Refuse stale builds.
  assertProdBuildMatchesSource({
    appDir: path.resolve(dir),
    prod,
    nextDistDir
  });

  if (stdoutDiscipline) {
    installStdoutDiscipline();
  }

  const boundPort =
    typeof port === "number" && port > 0 ? port : await pickFreePort();
  const token =
    typeof tokenOpt === "string" && tokenOpt.length > 0
      ? tokenOpt
      : randomBytes(32).toString("hex");

  // Startup injection (same process): session + bind + distDir before Next loads.
  // adoptSessionToken refreshes env + globalThis so a prior close→restart does
  // not leave session.ts validating against a stale cached token.
  process.env.IKRAN_HOST = host;
  process.env.IKRAN_PORT = String(boundPort);
  adoptSessionToken(token);
  if (nextDistDir) {
    process.env.IKRAN_NEXT_DIST_DIR = nextDistDir;
  }
  if (extraEnv) {
    for (const [k, v] of Object.entries(extraEnv)) {
      if (typeof v === "string") process.env[k] = v;
    }
  }

  let nextApp = null;
  let server = null;
  let startupComplete = false;
  try {
    const nextPath = require.resolve("next", { paths: [dir] });
    const nextMod = await import(pathToFileURL(nextPath).href);
    const createNext = nextMod.default;

    // IKRAN_NEXT_DIST_DIR is already injected before Next loads. Do not pass a
    // partial `conf`: Next must load the repository's complete next.config.ts.
    nextApp = createNext({
      dev: !prod,
      dir: path.resolve(dir),
      hostname: host,
      port: boundPort,
      quiet: true
    });

    await runInNextStdoutContext(stdoutDiscipline, () => nextApp.prepare());

    const handle = nextApp.getRequestHandler();
    server = http.createServer((req, res) => {
      runInNextStdoutContext(stdoutDiscipline, () => handle(req, res)).catch(
        (err) => {
          console.error("[ikran-http] request handler error:", err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.end("Internal Server Error");
          }
        }
      );
    });

    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(boundPort, host, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });

    await waitForReady(host, boundPort, timeoutMs);

    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      if (active && active.server === server) {
        active = null;
      }
      // Drop the startup token cache so a later in-process restart can mint a
      // fresh token without session.ts keeping the old one.
      invalidateSessionTokenCache();
      await closeHandle({ server, nextApp });
    };

    const handleObj = {
      server,
      nextApp,
      host,
      port: boundPort,
      token,
      url: composeWorkbenchUrl(host, boundPort, token),
      pid: process.pid,
      close
    };
    startupComplete = true;
    return handleObj;
  } finally {
    // prepare(), listen(), and readiness failures all converge here. The
    // original startup error is preserved while every created resource closes.
    if (!startupComplete) {
      invalidateSessionTokenCache();
      await closeHandle({ server, nextApp });
    }
  }
}

async function closeHandle({ server, nextApp }) {
  if (server?.listening) {
    await new Promise((resolve) => {
      server.close(() => resolve());
      // Force-close lingering keep-alive sockets so the port releases promptly.
      if (typeof server.closeAllConnections === "function") {
        try {
          server.closeAllConnections();
        } catch {
          /* ignore */
        }
      }
    });
  }
  if (nextApp) {
    try {
      await nextApp.close();
    } catch (err) {
      console.error("[ikran-http] nextApp.close error:", err?.message || err);
    }
  }
}

/** Close the active in-process HTTP surface (if any). Safe to call repeatedly. */
export async function closeHttpServer() {
  if (closing) return closing;

  // Invalidate any startup currently preparing/listening. Its coordinated
  // promise closes the produced handle and rejects instead of publishing it.
  lifecycleGeneration += 1;
  const pendingStart = starting;
  const operation = (async () => {
    if (pendingStart) {
      try {
        await pendingStart;
      } catch {
        // Startup failed or was cancelled; startup cleanup owns its resources.
      }
    }
    const handle = active;
    active = null;
    if (handle) {
      await handle.close();
    } else {
      // No published handle (cancelled/failed start) — still clear any token
      // that may have been injected during prepare.
      invalidateSessionTokenCache();
    }
  })();
  const tracked = operation.finally(() => {
    if (closing === tracked) {
      closing = null;
    }
  });
  closing = tracked;
  return tracked;
}
