// .scratch/layout-live/declare-layout.ts
import path3 from "node:path";

// tests/helpers/mcp.ts
import path2 from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// tests/e2e-constants.ts
import path from "node:path";
var SHARED_BUILD_DIR = path.join(".next", "e2e-build");

// tests/helpers/mcp.ts
var MCP_BIN = path2.join(process.cwd(), "bin", "ikran-mcp.mjs");
function structuredContent(res2) {
  if (typeof res2 === "object" && res2 !== null) {
    const r = res2;
    if (r.structuredContent && typeof r.structuredContent === "object") {
      return r.structuredContent;
    }
  }
  return {};
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

// .scratch/layout-live/declare-layout.ts
var stateDir = path3.join(
  process.cwd(),
  ".scratch",
  "layout-live",
  "state-desktop"
);
var handle = await spawnMcpClient(stateDir);
var res = structuredContent(
  await handle.client.callTool({
    name: "record_artifact_written",
    arguments: {
      path: "design-system/layout-rules.json",
      artifactType: "layout-rules.json",
      semanticPurpose: "layout-rules.json source",
      relatedRecordIds: [
        "eb8e615d-313b-4644-8811-8bad758ed5dc",
        "1c9a67fa-1be4-405a-8959-ca9d341ef0bd",
        "d5e05c49-dcb8-421d-8304-e735b51dff25",
        "f168167a-ebda-4e14-8e0d-924eac94c255"
      ]
    }
  })
);
console.log(JSON.stringify(res));
process.exit(res.ok === true ? 0 : 1);
