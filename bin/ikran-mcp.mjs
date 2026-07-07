#!/usr/bin/env node
// ikran-mcp — the minimal MCP stdio server an Agent host (Cursor / Codex)
// spawns to "open Ikran".
//
// Issue 02/01 tracer bullet: ONE tool — `open_workbench` — that starts (or
// reuses) the local Ikran Runtime HTTP surface on 127.0.0.1 (auto port) and
// returns a localhost Workbench URL containing a startup-level session token:
//
//   http://127.0.0.1:{port}/?session={token}
//
// The URL is local-only and is NOT a public/remote link. Open it in any browser;
// the ideal target is this Agent host's embedded browser.
//
// The full MCP tool boundary (create_or_open_project, register_seed_reference,
// record_evidence_package, …) is Issue 02/03 — do NOT add it here.
//
// CRITICAL — stdout discipline: MCP stdio uses stdout as the JSON-RPC channel.
// This server MUST NEVER write to stdout except via the transport. All logging
// goes to stderr (console.error). The spawned Next child uses piped stdio
// (handled inside openWorkbench) so Next's stdout never reaches this process's
// stdout; we additionally drain the child's stdout (drop) here.
//
// Architecture: two-process coordinator + env-token bridge (ADR 0001). This MCP
// server is the coordinator: it generates the startup token, spawns the Next
// HTTP surface as a child with IKRAN_SESSION_TOKEN in env, waits for readiness,
// writes a user-only runtime-endpoint.json (for reuse), and returns the
// Workbench URL. One-process consolidation (MCP tool handlers sharing
// in-memory record state with the HTTP API in a single custom Next server) is
// deliberate follow-up work for Issue 02/03.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync } from "node:fs";
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

const LOCALHOST_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const prod = hasFlag("--prod");
const host = option("--host", process.env.IKRAN_HOST || "127.0.0.1");

if (!LOCALHOST_HOSTS.has(host)) {
  console.error(
    `[ikran-mcp] Refusing to bind to "${host}". Ikran only supports localhost (127.0.0.1 / localhost / ::1).`
  );
  process.exit(1);
}

// appDir = package root (contains `app/` and `package.json`), resolved relative
// to this file so the MCP server works regardless of the host's cwd.
const launcherDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(launcherDir, "..");
if (!existsSync(path.join(appDir, "app"))) {
  console.error(
    `[ikran-mcp] Could not locate the Ikran app directory at ${appDir}. The package layout may be broken.`
  );
  process.exit(1);
}

// Reuse state dir + Next dist dir (env-driven; the e2e sets these for --prod
// against the shared build). Default to the user's Ikran state dir (~/.ikran).
const stateDir =
  process.env.IKRAN_STATE_DIR || path.join(homedir(), ".ikran");
const nextDistDir = process.env.IKRAN_NEXT_DIST_DIR || undefined;

// ---- Lifecycle / cleanup --------------------------------------------------
// Only tear down a Runtime THIS server spawned. If openWorkbench reused an
// already-running Runtime (spawned:false), we do NOT own it: leave it (and its
// endpoint file) alone on exit.
let lastResult = null;
let spawnedChild = null;
let cleaning = false;

function cleanup() {
  if (cleaning) return;
  cleaning = true;
  if (lastResult && lastResult.spawned && spawnedChild && spawnedChild.pid) {
    try {
      process.kill(-spawnedChild.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
    // Only remove the reuse file if it still points at THIS child's pid, so we
    // don't clobber a concurrently-started Runtime (best-effort).
    try {
      const ep = readRuntimeEndpoint(stateDir);
      if (ep && ep.pid === lastResult.pid) {
        removeRuntimeEndpoint(stateDir);
      }
    } catch {
      /* ignore */
    }
  }
}

function shutdown(code) {
  cleanup();
  process.exit(code);
}

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));
process.on("exit", cleanup);
// When the Agent host closes the MCP stdio transport (client disconnect), our
// stdin ends. Treat that as a shutdown so we don't leak the spawned Runtime.
process.stdin.on("end", () => shutdown(0));
process.stdin.on("close", () => shutdown(0));

// ---- MCP server -----------------------------------------------------------
const mcp = new McpServer(
  { name: "ikran", version: "0.1.0" },
  {
    instructions:
      "Ikran local research workbench. open_workbench starts (or reuses) the local HTTP Workbench and returns a localhost URL with a startup-level session token. The URL is local-only; open it in any browser, ideally this Agent host's embedded browser."
  }
);

// ONE zero-arg tool. registerTool(name, { description }, cb) with no inputSchema
// registers a zero-argument tool. The callback returns { content, structuredContent }.
mcp.registerTool(
  "open_workbench",
  {
    description:
      "Open the Ikran workbench. Starts or reuses the local Runtime HTTP surface on 127.0.0.1 (auto port) and returns a localhost Workbench URL containing a startup-level session token. Open it in any browser; ideal target is this Agent host's embedded browser. The URL is local-only and is not a public/remote link."
  },
  async () => {
    const r = await openWorkbench({
      stateDir,
      host,
      prod,
      cwd: appDir,
      nextDistDir,
      extraEnv: {},
      timeoutMs: 60_000
    });
    lastResult = r;
    if (r.spawned && r.child) {
      spawnedChild = r.child;
      // Drain the Next child's stdout (drop) so it NEVER reaches this
      // process's stdout (stdout is the MCP JSON-RPC channel). Forward the
      // child's stderr to our stderr for debuggability (stderr is NOT the MCP
      // channel). Draining also prevents the child from blocking on a full
      // pipe buffer during long sessions.
      r.child.stdout?.on("data", () => {});
      r.child.stderr?.on("data", (d) => process.stderr.write(d));
    }
    return {
      content: [
        {
          type: "text",
          text: `Ikran Workbench URL:\n${r.url}\n\nLocal-only. Open in any browser (ideal: this Agent host's embedded browser).`
        }
      ],
      structuredContent: {
        url: r.url,
        host: r.host,
        port: r.port,
        session: r.token,
        reused: !r.spawned
      }
    };
  }
);

const transport = new StdioServerTransport();
mcp
  .connect(transport)
  .then(() => {
    console.error(`[ikran-mcp] ready (open_workbench, host=${host}, prod=${prod})`);
  })
  .catch((err) => {
    console.error(`[ikran-mcp] failed to connect transport: ${err.message}`);
    shutdown(1);
  });