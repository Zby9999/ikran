#!/usr/bin/env node
// Ikran launcher — the `npm start` / `ikran` designer entry.
//
// Starts (or reuses) the local Ikran Runtime HTTP surface bound to 127.0.0.1,
// picks an auto free port + startup-level session token, and prints the
// canonical Workbench URL:
//
//   http://127.0.0.1:{port}/?session={token}&view=workbench
//
// Per Issue 02/01, the Workbench URL returned by the Agent (via the
// `open_workbench` MCP tool) is the product entry. This standalone launcher
// remains only as a designer dev convenience: it prints the same Workbench URL
// and optionally auto-opens a browser. The printed URL is the source of truth;
// the auto-open is a secondary convenience, not this slice's product entry.
//
// Task 9: HTTP-only mode in THIS launcher process (no Next child spawn). If a
// live MCP-owned endpoint already exists, the launcher only prints/opens that
// URL — it does NOT become a second Runtime.
//
// Two directories, kept separate:
// - appDir: where the Next.js app lives (package-relative, fixed).
// - projectFolder: the folder the designer wants to bind as their Ikran
//   project. Defaults to cwd, or `--folder <path>`. Forwarded via IKRAN_CWD.
//
// Usage:
//   ikran                  # bind the current folder; dev server; auto port; auto-open
//   ikran --folder ~/proj  # bind a specific folder without cd-ing into it
//   ikran --prod           # production Next (requires `npm run build` first)
//   ikran --port 4567      # custom port (default: auto free port)
//   ikran --host 127.0.0.1 # localhost only (default 127.0.0.1)
//   ikran --no-open        # start without opening a browser (CI / smoke)
//   ikran --dev            # explicitly use the dev server (default)

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  closeHttpServer,
  openWorkbench,
  readRuntimeEndpoint,
  removeRuntimeEndpoint
} from "../lib/runtime/runtime-endpoint.mjs";

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(name);
const option = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
};

// A required-value option: errors out if the flag is present without a value
// or its value looks like another flag. Returns null when the flag is absent.
function requireOption(name) {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) {
    console.error(
      `[ikran] ${name} requires a value (got ${
        value === undefined ? "nothing" : `"${value}"`
      }).`
    );
    printUsage();
    process.exit(1);
  }
  return value;
}

function printUsage() {
  console.error(`Usage: ikran [options]

  (default)          bind the current folder; dev server; auto port; auto-open
  --folder <path>    bind a specific folder without cd-ing into it
  --prod             production mode (requires "npm run build" first)
  --port <port>      custom port (default: auto free port)
  --host <host>      localhost only (default 127.0.0.1)
  --no-open          start without opening a browser (CI / smoke)
  --dev              explicitly use the dev server (default)`);
}

const prod = hasFlag("--prod");
const host = option("--host", process.env.IKRAN_HOST || "127.0.0.1");
const autoOpen = !hasFlag("--no-open");
const folderFlag = requireOption("--folder");
const LOCALHOST_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const bareHost =
  host.startsWith("[") && host.endsWith("]") && host.includes(":")
    ? host.slice(1, -1)
    : host;

if (!LOCALHOST_HOSTS.has(bareHost)) {
  console.error(
    `[ikran] Refusing to bind to "${host}". Ikran only supports localhost (127.0.0.1 / localhost / ::1).`
  );
  process.exit(1);
}

// Port resolution: --port > IKRAN_PORT env > auto free port (picked inside
// openWorkbench when no explicit port is given).
const portArg = option("--port", null);
const explicitPort =
  portArg !== null ? Number(portArg) : process.env.IKRAN_PORT
    ? Number(process.env.IKRAN_PORT)
    : null;
const port = Number.isFinite(explicitPort) && explicitPort > 0 ? explicitPort : undefined;

// appDir = package root (the directory that contains `app/` and `package.json`).
// Resolved relative to this launcher so `npx ikran` works from any cwd.
const launcherDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(launcherDir, "..");
if (!existsSync(path.join(appDir, "app"))) {
  console.error(
    `[ikran] Could not locate the Ikran app directory at ${appDir}. The package layout may be broken.`
  );
  process.exit(1);
}

// projectFolder = the folder the designer intends to bind as their Ikran
// project. `--folder` wins; otherwise use the cwd the command was invoked from.
let projectFolder;
if (folderFlag) {
  projectFolder = path.resolve(folderFlag);
  try {
    if (!statSync(projectFolder).isDirectory()) {
      console.error(`[ikran] --folder "${folderFlag}" is not a directory.`);
      process.exit(1);
    }
  } catch {
    console.error(`[ikran] --folder "${folderFlag}" does not exist.`);
    process.exit(1);
  }
} else {
  projectFolder = path.resolve(process.cwd());
}

// Reuse state dir: where runtime-endpoint.json lives so a later `open_workbench`
// call (or a second `ikran`) can reuse this Runtime. Defaults to the user's
// Ikran state dir (~/.ikran, the same convention as lib/runtime/paths.ts), so the
// endpoint file survives a launcher restart and lives outside any one project.
const stateDir =
  process.env.IKRAN_STATE_DIR || path.join(homedir(), ".ikran");

// ---- Lifecycle / cleanup -------------------------------------------------
// Only tear down HTTP THIS launcher owns. If openWorkbench reused a live MCP
// endpoint (owned:false), leave it alone on exit.
let result = null;
/** @type {Promise<void> | null} */
let cleanupPromise = null;

async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    if (result && result.owned) {
      try {
        await closeHttpServer();
      } catch (err) {
        console.error(`[ikran] cleanup error: ${err?.message || err}`);
      }
      try {
        const ep = readRuntimeEndpoint(stateDir);
        if (ep && ep.pid === process.pid) {
          removeRuntimeEndpoint(stateDir);
        }
      } catch {
        /* ignore */
      }
    }
  })();
  return cleanupPromise;
}

/** @type {Promise<void> | null} */
let shuttingDown = null;

async function shutdown(code) {
  if (shuttingDown) return shuttingDown;
  shuttingDown = (async () => {
    await cleanup();
    process.exit(code);
  })();
  return shuttingDown;
}

process.on("SIGINT", () => {
  void shutdown(130);
});
process.on("SIGTERM", () => {
  void shutdown(143);
});

// ---- Start / reuse --------------------------------------------------------
openWorkbench({
  stateDir,
  host,
  prod,
  cwd: appDir,
  nextDistDir: process.env.IKRAN_NEXT_DIST_DIR,
  extraEnv: { IKRAN_CWD: projectFolder },
  timeoutMs: 60_000,
  port,
  owner: "standalone"
})
  .then((r) => {
    result = r;

    // The Workbench URL is the canonical product entry. Print it prominently.
    console.log(`[ikran] Workbench URL: ${r.url}`);
    console.log(
      `[ikran] Local-only. Open in any browser (ideal: your Agent host's embedded browser).`
    );
    if (r.spawned) {
      console.log(
        `[ikran] Runtime ready on 127.0.0.1:${r.port} (in-process Next ${prod ? "prod" : "dev"}).`
      );
    } else if (r.owned === false) {
      console.log(
        `[ikran] Reused a live MCP-owned Runtime on 127.0.0.1:${r.port} (print/open only; not a second Runtime).`
      );
    } else {
      console.log(`[ikran] Reused an already-running Runtime on 127.0.0.1:${r.port}.`);
    }

    if (autoOpen) {
      openBrowser(r.url);
    }

    // When we only reused someone else's endpoint, exit after print/open —
    // we are not hosting HTTP.
    if (!r.owned) {
      // Give the browser-open spawn a tick, then exit cleanly.
      setTimeout(() => process.exit(0), 200);
    }
  })
  .catch((err) => {
    console.error(`[ikran] ${err.message}`);
    void cleanup().then(() => process.exit(1));
  });

function openBrowser(url) {
  const platform = process.platform;
  let command;
  if (platform === "darwin") {
    command = ["open", url];
  } else if (platform === "win32") {
    command = ["cmd", "/c", "start", "", url];
  } else {
    command = ["xdg-open", url];
  }
  try {
    spawn(command[0], command.slice(1), {
      detached: true,
      stdio: "ignore"
    }).unref();
  } catch {
    // Best-effort. The user can open the printed URL manually.
  }
}
