// .scratch/layout-live/open-desktop.ts
import path3 from "node:path";

// tests/helpers/mcp.ts
import { existsSync, readFileSync } from "node:fs";
import path2 from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// tests/e2e-constants.ts
import path from "node:path";
var SHARED_BUILD_DIR = path.join(".next", "e2e-build");

// tests/helpers/mcp.ts
var MCP_BIN = path2.join(process.cwd(), "bin", "ikran-mcp.mjs");
function structuredContent(res) {
  if (typeof res === "object" && res !== null) {
    const r = res;
    if (r.structuredContent && typeof r.structuredContent === "object") {
      return r.structuredContent;
    }
  }
  return {};
}
function readEndpointFile(stateDir2) {
  try {
    const file = path2.join(stateDir2, "runtime-endpoint.json");
    if (!existsSync(file)) return null;
    const ep = JSON.parse(readFileSync(file, "utf-8"));
    if (!ep || typeof ep.host !== "string" || typeof ep.port !== "number" || typeof ep.token !== "string" || typeof ep.pid !== "number") {
      return null;
    }
    return ep;
  } catch {
    return null;
  }
}
function killRecordedRuntime(stateDir2) {
  try {
    const ep = readEndpointFile(stateDir2);
    if (ep && typeof ep.pid === "number") {
      try {
        process.kill(ep.pid, "SIGKILL");
      } catch {
      }
    }
  } catch {
  }
}
async function spawnMcpClient(stateDir2, options = {}) {
  const { rootsProvider, env = {}, cwd } = options;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_BIN, "--prod"],
    cwd,
    env: {
      ...process.env,
      IKRAN_STATE_DIR: stateDir2,
      IKRAN_HOST: "127.0.0.1",
      IKRAN_NEXT_DIST_DIR: SHARED_BUILD_DIR,
      // Issue 05A/05D: MCP e2e never touches real Keychain / Figma network.
      IKRAN_FIGMA_CREDENTIAL_STORE: "memory",
      IKRAN_FIGMA_API_MODE: "mock",
      ...env
    },
    stderr: "pipe"
  });
  const client = new Client(
    { name: "ikran-e2e", version: "0.0.0" },
    { capabilities: rootsProvider ? { roots: {} } : {} }
  );
  if (rootsProvider) {
    client.setRequestHandler(ListRootsRequestSchema, async () => ({
      roots: rootsProvider().map((r) => ({ uri: r.uri, name: r.name }))
    }));
  }
  await client.connect(transport);
  const pid = transport.pid;
  if (typeof pid !== "number" || pid <= 0) {
    throw new Error("MCP StdioClientTransport did not expose a child pid");
  }
  return { client, transport, pid };
}

// .scratch/layout-live/open-desktop.ts
var stateDir = "/tmp/ikran-layout-live-state";
var PROJECT = "/Users/bingyizhang/Desktop/ikran test 7";
var handle = await spawnMcpClient(stateDir);
var opened = structuredContent(
  await handle.client.callTool({
    name: "create_or_open_project",
    arguments: { path: PROJECT }
  })
);
if (opened.ok !== true) {
  throw new Error(`create_or_open_project failed: ${JSON.stringify(opened)}`);
}
console.log(`WORKBENCH_URL=${String(opened.workbench_url)}`);
console.log("runtime stays up; Ctrl+C to stop.");
var shutdown = () => {
  killRecordedRuntime(stateDir);
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
setInterval(() => {
}, 1 << 30);
