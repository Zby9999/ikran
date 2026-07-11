// Task 10 contract: one MCP-owned Runtime/project, real HTTP routes and real
// MCP tools must surface identical domain reasons for type-correct invalid
// payloads. The MCP child runs with global fetch disabled; successful semantic
// writes plus immediate HTTP GET visibility prove no loopback fetch is used.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { expect, test } from "./fixtures";
import {
  killRecordedRuntime,
  sc,
  spawnMcpClient
} from "./helpers/mcp";
import { rawGet, rawPost } from "./helpers/http";

type JsonBody = Record<string, unknown>;

function parse(body: string): JsonBody {
  return JSON.parse(body) as JsonBody;
}

test("HTTP and MCP share schemas + domain reasons; MCP writes without fetch", async () => {
  test.setTimeout(150_000);

  const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-parity-state-"));
  const projectDir = mkdtempSync(path.join(tmpdir(), "ikran-parity-project-"));
  const noFetchPreload = pathToFileURL(
    path.join(process.cwd(), "tests", "fixtures", "no-fetch-preload.mjs")
  ).href;
  let client: Client | null = null;

  try {
    const existingNodeOptions = process.env.NODE_OPTIONS?.trim();
    const handle = await spawnMcpClient(stateDir, {
      env: {
        NODE_OPTIONS: [
          existingNodeOptions,
          `--import=${noFetchPreload}`
        ]
          .filter(Boolean)
          .join(" ")
      }
    });
    client = handle.client;

    const create = await client.callTool({
      name: "create_or_open_project",
      arguments: { path: projectDir }
    });
    const created = sc(create);
    expect(created.ok).toBe(true);
    const token = String(created.session);
    const workbenchUrl = String(created.workbench_url);
    const port = Number(
      workbenchUrl.match(/127\.0\.0\.1:(\d+)\//)?.[1]
    );
    const headers = {
      host: `127.0.0.1:${port}`,
      "x-ikran-session": token
    };

    const tools = await client.listTools();
    const seedTool = tools.tools.find(
      (tool) => tool.name === "register_seed_reference"
    );
    const seedProperties =
      (seedTool?.inputSchema?.properties as Record<string, unknown>) ?? {};
    expect(seedProperties.registeredVia).toBeUndefined();

    const cases = [
      {
        route: "/api/seed-reference",
        tool: "register_seed_reference",
        payload: {
          figmaSeedReference: "https://example.com/design/abc/X",
          originalDesignIntent: "intent"
        },
        reason: "not_figma_host"
      },
      {
        route: "/api/evidence-package",
        tool: "record_evidence_package",
        payload: {
          figmaSeedReference:
            "https://www.figma.com/design/abc123/Parity?node-id=1:2",
          frame: { nodeId: "1:2", name: "Frame" },
          evidenceViews: { rawData: "invalid", screenshot: "available" }
        },
        reason: "invalid_evidence_views"
      },
      {
        route: "/api/region-annotation",
        tool: "create_region_annotation",
        payload: {
          author: "agent",
          body: "No surface",
          rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }
        },
        reason: "missing_surface_anchor"
      }
    ] as const;

    for (const contract of cases) {
      const http = await rawPost(
        port,
        contract.route,
        contract.payload,
        headers
      );
      expect(http.status, contract.tool).toBe(400);
      expect(parse(http.body).error, contract.tool).toBe(contract.reason);

      const mcp = await client.callTool({
        name: contract.tool,
        arguments: contract.payload
      });
      expect(sc(mcp).error, contract.tool).toBe(contract.reason);
    }

    // Structural errors are transport errors, consistently named by HTTP.
    const structural = await rawPost(
      port,
      "/api/seed-reference",
      {
        figmaSeedReference: 42,
        originalDesignIntent: "intent"
      },
      headers
    );
    expect(structural.status).toBe(400);
    expect(parse(structural.body).error).toBe("invalid_params");

    // MCP child has global fetch=throw from the preload. This semantic write
    // succeeds and the ordinary browser HTTP route sees it immediately.
    const goodUrl =
      "https://www.figma.com/design/noFetchParity001/Screen?node-id=7:8";
    const registered = await client.callTool({
      name: "register_seed_reference",
      arguments: {
        figmaSeedReference: goodUrl,
        originalDesignIntent: "No-loopback contract"
      }
    });
    expect(sc(registered).ok).toBe(true);

    const listed = await rawGet(port, "/api/seed-reference", headers);
    expect(listed.status).toBe(200);
    const records = parse(listed.body).records as Array<{
      figma_seed_reference: string;
    }>;
    expect(records.some((record) => record.figma_seed_reference === goodUrl)).toBe(
      true
    );
  } finally {
    try {
      await client?.close();
    } catch {
      /* ignore */
    }
    killRecordedRuntime(stateDir);
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  }
});
