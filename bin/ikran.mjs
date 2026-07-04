#!/usr/bin/env node
// Ikran launcher.
//
// Starts the local Ikran Runtime (the Next.js server) bound to 127.0.0.1,
// waits for it to serve the Browser UI, and opens a browser tab to the local
// origin. This is the `npx ikran` entrypoint (PRD user stories 76 + 77): a
// single local process that hosts the UI and the `/api/*` Runtime API on the
// same origin.
//
// The launcher deliberately separates two directories:
// - appDir: where the Next.js app lives (package-relative, fixed). Next is
//   launched with this as its working directory so `app/` is found regardless
//   of where the user invoked the command.
// - projectFolder: the local folder the designer wants to bind as their Ikran
//   project. Defaults to the user's current working directory, or the
//   `--folder <path>` value. It is forwarded to the Runtime via the `IKRAN_CWD`
//   environment variable so the Runtime can auto-bind it (Issue 2 supplement).
//   The Runtime must read `IKRAN_CWD` — not `process.cwd()` — because Next's
//   process working directory is `appDir`, not the user's project folder.
//
// Usage:
//   ikran                  # bind the current folder; dev server; auto-open
//   ikran --folder ~/proj  # bind a specific folder without cd-ing into it
//   ikran --prod           # `next start` (requires `npm run build` first)
//   ikran --port 4567      # custom port
//   ikran --no-open        # start without opening a browser (CI / smoke)
//   ikran --dev            # explicitly use the dev server (default)

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(name);
const option = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
};

// A required-value option: errors out if the flag is present without a value
// or its value looks like another flag. Returns null when the flag is absent.
// (Guards `--folder` so `ikran --folder` and `ikran --folder --no-open` fail
// fast with usage instead of silently falling back to cwd / treating the next
// flag as a path.)
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

  (default)          bind the current folder; dev server; auto-open browser
  --folder <path>    bind a specific folder without cd-ing into it
  --prod             use "next start" (requires "npm run build" first)
  --port <port>      custom port (default 3000)
  --host <host>      localhost only (default 127.0.0.1)
  --no-open          start without opening a browser (CI / smoke)
  --dev              explicitly use the dev server (default)`);
}

const mode = hasFlag("--prod") ? "start" : "dev";
const port = Number(option("--port", process.env.IKRAN_PORT || "3000"));
const host = option("--host", process.env.IKRAN_HOST || "127.0.0.1");
const autoOpen = !hasFlag("--no-open");
const folderFlag = requireOption("--folder");
const localHosts = new Set(["127.0.0.1", "localhost"]);

if (!localHosts.has(host)) {
  console.error(
    `[ikran] Refusing to bind to "${host}". Ikran only supports localhost or 127.0.0.1.`
  );
  process.exit(1);
}

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

let nextBin;
try {
  nextBin = require.resolve("next/dist/bin/next");
} catch {
  console.error(
    "[ikran] Could not locate the Next.js CLI. Run `npm install` first."
  );
  process.exit(1);
}

const origin = `http://${host}:${port}`;

const child = spawn(
  process.execPath,
  [nextBin, mode, "-H", host, "-p", String(port)],
  {
    cwd: appDir,
    env: {
      ...process.env,
      IKRAN_HOST: host,
      IKRAN_PORT: String(port),
      IKRAN_CWD: projectFolder
    },
    stdio: "inherit"
  }
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});

async function waitForReady(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status > 0 && res.status < 500) {
        return true;
      }
    } catch {
      // not ready yet
    }
    await sleep(500);
  }
  return false;
}

waitForReady(`${origin}/`, 60_000).then((ok) => {
  if (!ok) {
    console.error(`[ikran] Runtime did not become ready at ${origin}`);
    return;
  }
  console.log(`[ikran] Runtime ready at ${origin}`);
  if (autoOpen) {
    openBrowser(origin);
  }
});

function openBrowser(url) {
  const platform = os.platform();
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
    // Best-effort. The user can open the URL manually.
  }
}