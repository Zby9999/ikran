// Shared MCP client harness for Playwright MCP boundary specs.
// Spawns bin/ikran-mcp.mjs against the shared e2e build; cleans up only the
// Runtime PID recorded in the test's own stateDir (no global pkill).
//
// Task 9: the MCP child IS the Runtime (one process). Endpoint pid must equal
// the MCP child pid; killRecordedRuntime signals that single pid (not a
// detached Next process group).

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { SHARED_BUILD_DIR } from "../e2e-constants";

const MCP_BIN = path.join(process.cwd(), "bin", "ikran-mcp.mjs");

export type McpRoot = { uri: string; name?: string };

export type McpClientHandle = {
  client: Client;
  transport: StdioClientTransport;
  /** MCP server child pid (also the in-process Runtime pid after open_workbench). */
  pid: number;
};

export type SpawnMcpOptions = {
  /** When set, client declares roots capability and answers roots/list. */
  rootsProvider?: () => McpRoot[];
  /** Extra env merged into the MCP child (after IKRAN_* defaults). */
  env?: Record<string, string>;
  /** Child process cwd (mcp.json `cwd` / process.cwd() discovery). */
  cwd?: string;
};

export type RuntimeEndpointInfo = {
  host: string;
  port: number;
  token: string;
  pid: number;
  owner?: string;
  startedAt?: string;
};

/** Extract structuredContent from a CallToolResult as a loose record. */
export function structuredContent(res: unknown): Record<string, unknown> {
  if (typeof res === "object" && res !== null) {
    const r = res as { structuredContent?: unknown };
    if (r.structuredContent && typeof r.structuredContent === "object") {
      return r.structuredContent as Record<string, unknown>;
    }
  }
  return {};
}

/** @deprecated Prefer structuredContent — kept as a short alias used by specs. */
export const sc = structuredContent;

/** Read stateDir/runtime-endpoint.json; null if missing/corrupt. */
export function readEndpointFile(
  stateDir: string
): RuntimeEndpointInfo | null {
  try {
    const file = path.join(stateDir, "runtime-endpoint.json");
    if (!existsSync(file)) return null;
    const ep = JSON.parse(readFileSync(file, "utf-8")) as RuntimeEndpointInfo;
    if (
      !ep ||
      typeof ep.host !== "string" ||
      typeof ep.port !== "number" ||
      typeof ep.token !== "string" ||
      typeof ep.pid !== "number"
    ) {
      return null;
    }
    return ep;
  } catch {
    return null;
  }
}

/**
 * Kill the Runtime pid recorded in stateDir/runtime-endpoint.json.
 * One-process Runtime: pid is the MCP (or standalone launcher) process itself —
 * signal that pid, not a process-group leader of a Next child.
 */
export function killRecordedRuntime(stateDir: string): void {
  try {
    const ep = readEndpointFile(stateDir);
    if (ep && typeof ep.pid === "number") {
      try {
        process.kill(ep.pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
  } catch {
    /* no endpoint file */
  }
}

/**
 * Spawn ikran-mcp.mjs (--prod) with an isolated IKRAN_STATE_DIR and the shared
 * e2e Next build. Optionally simulate MCP Roots via rootsProvider.
 */
export async function spawnMcpClient(
  stateDir: string,
  options: SpawnMcpOptions = {}
): Promise<McpClientHandle> {
  const { rootsProvider, env = {}, cwd } = options;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_BIN, "--prod"],
    cwd,
    env: {
      ...process.env,
      IKRAN_STATE_DIR: stateDir,
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
