#!/usr/bin/env node
// Ikran launcher — the `npm start` / `ikran` designer entry.
//
// Starts (or reuses) the local Ikran Runtime (the Next.js HTTP surface) bound
// to 127.0.0.1, picks an auto free port + startup-level session token, and
// prints the canonical Workbench URL:
//
//   http://127.0.0.1:{port}/?session={token}
//
// Per Issue 02/01, the Workbench URL returned by the Agent (via the
// `open_workbench` MCP tool) is the product entry. This standalone launcher
// remains only as a designer dev convenience: it prints the same Workbench URL
// and optionally auto-opens a browser. The printed URL is the source of truth;
// the auto-open is a secondary convenience, not this slice's product entry.
//
// The Runtime itself is localhost-only and session-protected (lib/runtime/
// session.ts + config.ts). A coordinator process (this launcher or the MCP
// server in bin/ikran-mcp.mjs) generates the startup token and hands it to the
// Runtime via the IKRAN_SESSION_TOKEN env bridge, so it can compose the
// Workbench URL. See docs/issue02-01-handoff.md (two-process coordinator +
// env-token bridge; one-process consolidation is follow-up for Issue 02/03).
//
// Two directories, kept separate:
// - appDir: where the Next.js app lives (package-relative, fixed). Next runs
//   with this as cwd so `app/` is found regardless of where ikran was invoked.
// - projectFolder: the folder the designer wants to bind as their Ikran
//   project. Defaults to cwd, or `--folder <path>`. Forwarded to the Runtime
//   via IKRAN_CWD so the Runtime can auto-bind it (it must read IKRAN_CWD, not
//   process.cwd(), because Next's cwd is appDir).
//
// Usage:
//   ikran                  # bind the current folder; dev server; auto port; auto-open
//   ikran --folder ~/proj  # bind a specific folder without cd-ing into it
//   ikran --prod           # `next start` (requires `npm run build` first)
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
  --prod             use "next start" (requires "npm run build" first)
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

if (!LOCALHOST_HOSTS.has(host)) {
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
// Only tear down a Runtime THIS launcher spawned. If openWorkbench reused an
// already-running Runtime (spawned:false), we do NOT own it: leave it (and its
// endpoint file) alone on exit.
let result = null;
let cleaning = false;

function killChildGroup(sig = "SIGTERM") {
  if (result && result.spawned && result.child && result.child.pid) {
    try {
      process.kill(-result.child.pid, sig);
    } catch {
      /* already gone */
    }
  }
}

function cleanup() {
  if (cleaning) return;
  cleaning = true;
  if (result && result.spawned) {
    killChildGroup("SIGTERM");
    // Only remove the reuse file if it still points at THIS child's pid, so we
    // don't clobber a concurrently-started Runtime (best-effort).
    try {
      const ep = readRuntimeEndpoint(stateDir);
      if (ep && ep.pid === result.pid) {
        removeRuntimeEndpoint(stateDir);
      }
    } catch {
      /* ignore */
    }
  }
}

process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(143);
});

// ---- Spawn / reuse --------------------------------------------------------
openWorkbench({
  stateDir,
  host,
  prod,
  cwd: appDir,
  nextDistDir: process.env.IKRAN_NEXT_DIST_DIR,
  extraEnv: { IKRAN_CWD: projectFolder },
  timeoutMs: 60_000,
  port
})
  .then((r) => {
    result = r;

    // Forward the Next child's stdio to this terminal so the designer sees
    // runtime logs (compile-on-edit, request errors). This also drains the
    // pipes so the child never blocks on a full pipe buffer. The child's stdio
    // is piped (not inherited) by openWorkbench, so we own forwarding here.
    if (r.spawned && r.child) {
      r.child.stdout?.on("data", (d) => process.stdout.write(d));
      r.child.stderr?.on("data", (d) => process.stderr.write(d));
      r.child.on("exit", (code, signal) => {
        // The Runtime died on its own. Clean up our reuse file and mirror its
        // exit, so the launcher doesn't linger as a zombie parent.
        cleanup();
        if (signal) {
          process.kill(process.pid, signal);
        } else {
          process.exit(code ?? 0);
        }
      });
    }

    // The Workbench URL is the canonical product entry. Print it prominently.
    console.log(`[ikran] Workbench URL: ${r.url}`);
    console.log(
      `[ikran] Local-only. Open in any browser (ideal: your Agent host's embedded browser).`
    );
    if (r.spawned) {
      console.log(`[ikran] Runtime ready on 127.0.0.1:${r.port} (next ${prod ? "start" : "dev"}).`);
    } else {
      console.log(`[ikran] Reused an already-running Runtime on 127.0.0.1:${r.port}.`);
    }

    if (autoOpen) {
      openBrowser(r.url);
    }
  })
  .catch((err) => {
    console.error(`[ikran] ${err.message}`);
    cleanup();
    process.exit(1);
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