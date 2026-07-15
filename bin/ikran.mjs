#!/usr/bin/env node
// User-facing launcher for the persistent Ikran Runtime. The launcher itself
// exits after printing/opening the Workbench; Runtime + MCP stay co-owned by
// bin/ikran-runtime.mjs until explicit or idle shutdown.

import { spawn } from "node:child_process";
import http from "node:http";
import { closeSync, existsSync, mkdirSync, openSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  probeRuntimeAlive,
  readRuntimeEndpoint
} from "../lib/runtime/runtime-endpoint.mjs";

const argv = process.argv.slice(2);
const command = ["status", "stop", "restart"].includes(argv[0]) ? argv.shift() : "start";
const hasFlag = (name) => argv.includes(name);
const option = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
};
function requireOption(name) {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) {
    console.error(`[ikran] ${name} requires a value.`);
    printUsage();
    process.exit(1);
  }
  return value;
}
function printUsage() {
  console.error(`Usage: ikran [start|status|stop|restart] [options]

  --folder <path>    bind a project folder
  --prod             production mode
  --port <port>      custom port
  --host <host>      localhost only (default 127.0.0.1)
  --no-open          do not open a browser`);
}

const prod = hasFlag("--prod");
const host = option("--host", process.env.IKRAN_HOST || "127.0.0.1");
const autoOpen = !hasFlag("--no-open");
const folderFlag = requireOption("--folder");
const bareHost = host.startsWith("[") && host.endsWith("]") && host.includes(":")
  ? host.slice(1, -1)
  : host;
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(bareHost)) {
  console.error(`[ikran] Refusing to bind to "${host}". Ikran is localhost-only.`);
  process.exit(1);
}

const portArg = option("--port", null);
const explicitPort = portArg !== null
  ? Number(portArg)
  : process.env.IKRAN_PORT ? Number(process.env.IKRAN_PORT) : undefined;
const port = Number.isFinite(explicitPort) && explicitPort > 0 ? explicitPort : undefined;
const launcherDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(launcherDir, "..");
const runtimeBin = path.join(launcherDir, "ikran-runtime.mjs");
if (!existsSync(path.join(appDir, "app"))) {
  console.error(`[ikran] Could not locate the Ikran app directory at ${appDir}.`);
  process.exit(1);
}

const projectFolder = folderFlag ? path.resolve(folderFlag) : path.resolve(process.cwd());
try {
  if (!statSync(projectFolder).isDirectory()) throw new Error("not_directory");
} catch {
  console.error(`[ikran] Project folder "${projectFolder}" does not exist or is not a directory.`);
  process.exit(1);
}
const stateDir = process.env.IKRAN_STATE_DIR || path.join(homedir(), ".ikran");

function requestRuntimeStop(endpoint) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: endpoint.host,
      port: endpoint.port,
      path: "/api/runtime/stop",
      method: "POST",
      headers: { host: `${endpoint.host}:${endpoint.port}`, "x-ikran-session": endpoint.token }
    }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode === 202));
    });
    req.on("error", reject);
    req.end();
  });
}

async function liveEndpoint() {
  const endpoint = readRuntimeEndpoint(stateDir);
  if (!endpoint) return null;
  return await probeRuntimeAlive(endpoint.host, endpoint.port, endpoint.token) ? endpoint : null;
}

if (command === "status") {
  const endpoint = await liveEndpoint();
  if (!endpoint) {
    console.log("[ikran] Runtime is not running.");
    process.exit(1);
  }
  console.log(`[ikran] Runtime is running (pid ${endpoint.pid}) at ${endpoint.host}:${endpoint.port}.`);
  process.exit(0);
}

if (command === "stop" || command === "restart") {
  const endpoint = await liveEndpoint();
  if (endpoint) {
    const accepted = await requestRuntimeStop(endpoint).catch(() => false);
    if (!accepted) {
      console.error("[ikran] Runtime did not accept the shutdown request.");
      process.exit(1);
    }
    const deadline = Date.now() + 10_000;
    while (await liveEndpoint() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (await liveEndpoint()) {
      console.error("[ikran] Runtime did not stop within 10 seconds.");
      process.exit(1);
    }
    console.log("[ikran] Runtime stopped.");
  } else if (command === "stop") {
    console.log("[ikran] Runtime is not running.");
  }
  if (command === "stop") process.exit(0);
}

let endpoint = await liveEndpoint();
if (endpoint && port && endpoint.port !== port) {
  console.error(`[ikran] Runtime is already running on port ${endpoint.port}, not requested port ${port}.`);
  process.exit(1);
}
if (!endpoint) {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const logPath = path.join(stateDir, "runtime.log");
  const logFd = openSync(logPath, "a", 0o600);
  const runtimeArgs = [runtimeBin, "--host", host];
  if (prod) runtimeArgs.push("--prod");
  if (port) runtimeArgs.push("--port", String(port));
  const child = spawn(process.execPath, runtimeArgs, {
    cwd: appDir,
    env: { ...process.env, IKRAN_CWD: projectFolder },
    detached: true,
    stdio: ["ignore", "ignore", logFd]
  });
  closeSync(logFd);
  let startupError;
  let startupExit;
  child.once("error", (error) => { startupError = error; });
  child.once("exit", (code) => { startupExit = code; });
  const deadline = Date.now() + 60_000;
  while (!endpoint && !startupError && startupExit === undefined && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    endpoint = await liveEndpoint();
  }
  child.unref();
  if (!endpoint) {
    const detail = startupError?.message || (startupExit !== undefined ? `exit ${startupExit}` : "startup timeout");
    console.error(`[ikran] Runtime failed to start (${detail}). See ${logPath}.`);
    process.exit(1);
  }
}

const url = `http://${endpoint.host}:${endpoint.port}/?session=${encodeURIComponent(endpoint.token)}&view=workbench`;
console.log(`[ikran] Workbench URL: ${url}`);
console.log(`[ikran] Runtime ready (pid ${endpoint.pid}); use \`ikran stop\` or the Workbench Shutdown control to stop it.`);
if (autoOpen) openBrowser(url);

function openBrowser(url) {
  const command = process.platform === "darwin"
    ? ["open", url]
    : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
  try {
    spawn(command[0], command.slice(1), { detached: true, stdio: "ignore" }).unref();
  } catch {
    // Best-effort: the canonical URL is printed above.
  }
}
