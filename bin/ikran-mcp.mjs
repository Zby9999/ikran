#!/usr/bin/env node
// Cursor-owned stdio bridge. The MCP server and Workbench remain together in
// the persistent Runtime process; closing this bridge only drops one MCP lease.
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { connect } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRuntimeSocketPath } from "../lib/runtime/runtime-socket-path.mjs";
import { resolveRuntimeStateDir } from "../lib/runtime/runtime-state-dir.mjs";

const argv = process.argv.slice(2);
if (argv.includes("--study")) process.env.IKRAN_STUDY_MODE = "1";
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stateDir = resolveRuntimeStateDir({ appDir });
const socketPath = resolveRuntimeSocketPath(stateDir);
const runtimeBin = path.join(path.dirname(fileURLToPath(import.meta.url)), "ikran-runtime.mjs");

function tryConnect() {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

let socket;
try {
  socket = await tryConnect();
} catch {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const logPath = path.join(stateDir, "runtime.log");
  const logFd = openSync(logPath, "a", 0o600);
  const child = spawn(process.execPath, [runtimeBin, ...argv], {
    cwd: process.cwd(),
    env: { ...process.env, IKRAN_STATE_DIR: stateDir },
    detached: true,
    stdio: ["ignore", "ignore", logFd]
  });
  closeSync(logFd);
  let startupError;
  let startupExit;
  child.once("error", (error) => { startupError = error; });
  child.once("exit", (code) => { startupExit = code; });
  const deadline = Date.now() + 60_000;
  while (!socket && !startupError && startupExit === undefined && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (!existsSync(socketPath)) continue;
    try { socket = await tryConnect(); } catch {}
  }
  child.unref();
  if (!socket) {
    const detail = startupError?.message || (startupExit !== undefined ? `exit ${startupExit}` : "startup timeout");
    console.error(`[ikran-mcp] Runtime failed to start (${detail}). See ${logPath}.`);
    process.exit(1);
  }
}

process.stdin.pipe(socket);
socket.pipe(process.stdout);
const close = () => socket.end();
process.stdin.once("end", close);
process.stdin.once("close", close);
socket.once("close", () => process.exit(0));
socket.once("error", (error) => {
  console.error(`[ikran-mcp] bridge error: ${error.message}`);
  process.exit(1);
});
