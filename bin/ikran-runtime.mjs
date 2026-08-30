#!/usr/bin/env node
import "tsx";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { chmodSync, existsSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  closeHttpServer,
  openWorkbench,
  readRuntimeEndpoint,
  removeRuntimeEndpoint
} from "../lib/runtime/runtime-endpoint.mjs";
import { importTsxModule } from "../lib/runtime/tsx-module-interop.mjs";
import { assertProdBuildMatchesSource } from "../lib/runtime/version-stamp.mjs";
import {
  readIkranPackageVersion,
  resolveRuntimeStateDir
} from "../lib/runtime/runtime-state-dir.mjs";
import { resolveRuntimeSocketPath } from "../lib/runtime/runtime-socket-path.mjs";

const argv = process.argv.slice(2);
if (argv.includes("--study")) process.env.IKRAN_STUDY_MODE = "1";
const prod = argv.includes("--prod");
const option = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
};
const host = option("--host", process.env.IKRAN_HOST || "127.0.0.1");
const requestedPort = Number(option("--port", process.env.IKRAN_PORT || ""));
const port = Number.isFinite(requestedPort) && requestedPort > 0 ? requestedPort : undefined;
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageVersion = readIkranPackageVersion(appDir);
const stateDir = resolveRuntimeStateDir({ appDir });
// Runtime modules read this during dynamic import. Make the resolved default
// explicit so the HTTP command kernel and the socket/endpoint share one state.
process.env.IKRAN_STATE_DIR = stateDir;
const socketPath = resolveRuntimeSocketPath(stateDir);
const nextDistDir = process.env.IKRAN_NEXT_DIST_DIR || undefined;
if (!existsSync(path.join(appDir, "app"))) process.exit(1);
if (prod) assertProdBuildMatchesSource({ appDir, prod, nextDistDir });

const mcpLibDir = path.join(appDir, "lib/mcp");
const { registerIkranTools, resolveMcpInstructions } = await importTsxModule(
  pathToFileURL(path.join(mcpLibDir, "register-tools.ts")).href
);
const { resolveWorkingFolder } = await importTsxModule(
  pathToFileURL(path.join(mcpLibDir, "discover-working-folder.ts")).href
);
const { createRuntimeLifecycle, registerRuntimeControl } = await importTsxModule(
  pathToFileURL(path.join(appDir, "lib/runtime/runtime-lifecycle.ts")).href
);

let runtimeResult;
let stopping = false;
let socketServer;
const sockets = new Set();
const idleMs = Number(process.env.IKRAN_IDLE_SHUTDOWN_MS || 15 * 60_000);

async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  // Preview cleanup: park every live surface as stale ("runtime_shutdown")
  // first — synchronously, so a killed child's exit handler can only ever see
  // an already-stale row — then kill the Runtime-owned dev servers. The next
  // launch restores the parked surfaces from their persisted run records.
  try {
    const { killAllPreviewServers } = await importTsxModule(
      pathToFileURL(path.join(appDir, "lib/runtime/preview-server.ts")).href
    );
    const { markPrototypeSurfacesStaleForShutdown } = await importTsxModule(
      pathToFileURL(path.join(appDir, "lib/runtime/prototype-surface.ts")).href
    );
    const { getActiveProject } = await importTsxModule(
      pathToFileURL(path.join(appDir, "lib/runtime/project.ts")).href
    );
    const activeProject = getActiveProject();
    if (activeProject) markPrototypeSurfacesStaleForShutdown(activeProject);
    killAllPreviewServers();
  } catch {
    // Preview cleanup is best-effort; shutdown must never hang on it.
  }
  // Stop admitting new bridge connections, then let already-started command
  // writes finish before closing transports and the HTTP surface.
  const socketServerClosed = socketServer
    ? new Promise((resolve) => socketServer.close(() => resolve()))
    : Promise.resolve();
  const drainDeadline = Date.now() + 10_000;
  while (lifecycle.activeLeaseCount("job") > 0 && Date.now() < drainDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  lifecycle.dispose();
  for (const socket of sockets) socket.destroy();
  await socketServerClosed;
  rmSync(socketPath, { force: true });
  await closeHttpServer();
  const ep = readRuntimeEndpoint(stateDir);
  if (ep?.pid === process.pid) removeRuntimeEndpoint(stateDir);
  process.exit(code);
}

const lifecycle = createRuntimeLifecycle({
  idleMs: Number.isFinite(idleMs) && idleMs >= 0 ? idleMs : 15 * 60_000,
  onIdle: () => shutdown(0)
});
registerRuntimeControl({
  lifecycle,
  requestShutdown: () => shutdown(0),
  acceptingJobs: () => !stopping
});

runtimeResult = await openWorkbench({
  stateDir,
  host,
  prod,
  cwd: appDir,
  nextDistDir,
  extraEnv: process.env.IKRAN_CWD ? { IKRAN_CWD: process.env.IKRAN_CWD } : {},
  timeoutMs: 60_000,
  port,
  owner: "mcp"
});

rmSync(socketPath, { force: true });
socketServer = createServer((socket) => {
  sockets.add(socket);
  const release = lifecycle.acquire("mcp");
  const mcp = new McpServer(
    { name: "ikran", version: packageVersion },
    { instructions: resolveMcpInstructions(process.env) }
  );
  const registerTool = mcp.registerTool.bind(mcp);
  mcp.registerTool = (name, config, callback) => registerTool(
    name,
    config,
    async (...args) => {
      if (stopping) throw new Error("Ikran Runtime is shutting down.");
      const releaseJob = lifecycle.acquire("job");
      try {
        return await callback(...args);
      } finally {
        releaseJob();
      }
    }
  );
  let discovered;
  const discoverWorkingFolder = async () => {
    if (discovered) return discovered;
    let roots = [];
    try {
      const res = await mcp.server.listRoots();
      roots = Array.isArray(res?.roots) ? res.roots : [];
    } catch {}
    discovered = resolveWorkingFolder({
      envCwd: process.env.IKRAN_CWD,
      roots,
      processCwd: process.cwd(),
      excludedFolders: [appDir]
    });
    return discovered;
  };
  registerIkranTools(mcp, {
    ensureRuntime: async () => ({
      host: runtimeResult.host,
      port: runtimeResult.port,
      token: runtimeResult.token,
      url: runtimeResult.url,
      spawned: false
    }),
    discoverWorkingFolder,
    host,
    prod,
    studyMode: process.env.IKRAN_STUDY_MODE === "1",
    mcpEntryPath: path.join(appDir, "bin/ikran-mcp.mjs")
  });
  const transport = new StdioServerTransport(socket, socket);
  socket.once("close", () => {
    sockets.delete(socket);
    release();
  });
  socket.once("error", release);
  void mcp.connect(transport).catch(() => socket.destroy());
});

await new Promise((resolve, reject) => {
  socketServer.once("error", reject);
  socketServer.listen(socketPath, resolve);
});
chmodSync(socketPath, 0o600);
process.on("SIGINT", () => void shutdown(130));
process.on("SIGTERM", () => void shutdown(143));
