#!/usr/bin/env node
// ikran-mcp — MCP stdio server bootstrap (Task 10).
//
// Owns: argv/localhost validation, one-process HTTP lifecycle (ensureRuntime),
// MCP server/transport, roots discovery, and tsx TS loader bootstrap.
// Tool handlers live in lib/mcp/register-tools.ts and call the shared command
// kernel directly (no localhost HTTP fetch).
//
// CRITICAL — stdout discipline: MCP stdio uses stdout as the JSON-RPC channel.
// This server MUST NEVER write to stdout except via the transport. All logging
// goes to stderr (console.error).

// Official tsx entry: enables subsequent dynamic TypeScript imports and both
// ESM/CJS interop needed by this package's extensionless TS imports.
import "tsx";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  closeHttpServer,
  openWorkbench,
  readRuntimeEndpoint,
  removeRuntimeEndpoint
} from "../lib/runtime/runtime-endpoint.mjs";
import { assertProdBuildMatchesSource } from "../lib/runtime/version-stamp.mjs";

const mcpLibDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../lib/mcp"
);
const { registerIkranTools, IKRAN_MCP_INSTRUCTIONS } = await import(
  pathToFileURL(path.join(mcpLibDir, "register-tools.ts")).href
);
const { resolveWorkingFolder } = await import(
  pathToFileURL(path.join(mcpLibDir, "discover-working-folder.ts")).href
);

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(name);
const option = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
};

const LOCALHOST_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const prod = hasFlag("--prod");
const host = option("--host", process.env.IKRAN_HOST || "127.0.0.1");
const bareHost =
  host.startsWith("[") && host.endsWith("]") && host.includes(":")
    ? host.slice(1, -1)
    : host;

if (!LOCALHOST_HOSTS.has(bareHost)) {
  console.error(
    `[ikran-mcp] Refusing to bind to "${host}". Ikran only supports localhost (127.0.0.1 / localhost / ::1).`
  );
  process.exit(1);
}

const launcherDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(launcherDir, "..");
if (!existsSync(path.join(appDir, "app"))) {
  console.error(
    `[ikran-mcp] Could not locate the Ikran app directory at ${appDir}. The package layout may be broken.`
  );
  process.exit(1);
}

const stateDir =
  process.env.IKRAN_STATE_DIR || path.join(homedir(), ".ikran");
const nextDistDir = process.env.IKRAN_NEXT_DIST_DIR || undefined;
const mcpEntryPath = fileURLToPath(import.meta.url);

// Fail closed early under --prod (before tool registration / ensureRuntime) so
// a stale `.next` cannot pair with current MCP TypeScript + schema migrations.
if (prod) {
  try {
    assertProdBuildMatchesSource({ appDir, prod, nextDistDir });
  } catch (err) {
    console.error(`[ikran-mcp] ${err?.message || err}`);
    process.exit(1);
  }
}

// ---- Lifecycle / cleanup --------------------------------------------------
let lastResult = null;
/** @type {Promise<void> | null} */
let cleanupPromise = null;

async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    try {
      if (lastResult && lastResult.owned) {
        await closeHttpServer();
        try {
          const ep = readRuntimeEndpoint(stateDir);
          if (ep && ep.pid === process.pid) {
            removeRuntimeEndpoint(stateDir);
          }
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      console.error(`[ikran-mcp] cleanup error: ${err?.message || err}`);
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
process.stdin.on("end", () => {
  void shutdown(0);
});
process.stdin.on("close", () => {
  void shutdown(0);
});

// ---- Working-folder discovery (IKRAN_CWD > Roots > process.cwd()) ---------
// Order: explicit IKRAN_CWD env → MCP Roots file:// → process.cwd() (mcp.json
// `cwd` / host launch dir) → none. setup_workspace writes IKRAN_CWD so reload
// without Roots still auto-discovers; cwd fallback covers configs that only set cwd.
let discoveredWorkingFolder = null;
async function discoverWorkingFolder() {
  if (discoveredWorkingFolder) return discoveredWorkingFolder;
  let roots = [];
  try {
    const res = await mcp.server.listRoots();
    roots = Array.isArray(res && res.roots) ? res.roots : [];
  } catch {
    roots = [];
  }
  discoveredWorkingFolder = resolveWorkingFolder({
    envCwd: process.env.IKRAN_CWD,
    roots,
    processCwd: process.cwd()
  });
  return discoveredWorkingFolder;
}

async function ensureRuntime() {
  const discovered = await discoverWorkingFolder();
  const ikranCwd = discovered.folder;
  const r = await openWorkbench({
    stateDir,
    host,
    prod,
    cwd: appDir,
    nextDistDir,
    extraEnv: ikranCwd ? { IKRAN_CWD: ikranCwd } : {},
    timeoutMs: 60_000,
    owner: "mcp"
  });
  lastResult = r;
  return {
    host: r.host,
    port: r.port,
    token: r.token,
    url: r.url,
    spawned: r.spawned
  };
}

// ---- MCP server -----------------------------------------------------------
const mcp = new McpServer(
  { name: "ikran", version: "0.1.0" },
  { instructions: IKRAN_MCP_INSTRUCTIONS }
);

registerIkranTools(mcp, {
  ensureRuntime,
  discoverWorkingFolder,
  host,
  prod,
  mcpEntryPath
});

const transport = new StdioServerTransport();
mcp
  .connect(transport)
  .then(() => {
    console.error(
      `[ikran-mcp] ready (open_workbench, create_or_open_project, register_seed_reference, list_pending_seed_evidence, record_evidence_package, create_region_annotation, list_region_annotations, list_working_folders, setup_workspace, host=${host}, prod=${prod})`
    );
  })
  .catch((err) => {
    console.error(`[ikran-mcp] failed to connect transport: ${err.message}`);
    void shutdown(1);
  });
