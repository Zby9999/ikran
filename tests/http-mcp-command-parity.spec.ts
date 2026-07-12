// Task 10 contract: one MCP-owned Runtime/project, real HTTP routes and real
// MCP tools must surface identical domain reasons for type-correct invalid
// payloads. The MCP child runs with global fetch disabled; successful semantic
// writes plus immediate HTTP GET visibility prove no loopback fetch is used.
//
// Active seed path: HTTP `/api/seed-capture` ↔ MCP `add_seed_reference`
// (Figma Connection Gate + mock API). Legacy register/record tools are not
// part of the Active MCP surface.

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
import { connectFigmaForTests } from "./helpers/figma-connection";

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
    const toolNames = tools.tools.map((t) => t.name);
    expect(toolNames).toContain("add_seed_reference");
    expect(toolNames).toContain("get_figma_connection_status");
    expect(toolNames).not.toContain("register_seed_reference");
    expect(toolNames).not.toContain("record_evidence_package");
    expect(toolNames).not.toContain("list_pending_seed_evidence");

    const seedTool = tools.tools.find(
      (tool) => tool.name === "add_seed_reference"
    );
    const seedProperties =
      (seedTool?.inputSchema?.properties as Record<string, unknown>) ?? {};
    expect(seedProperties.registeredVia).toBeUndefined();
    expect(seedProperties.initiator).toBeUndefined();
    expect(seedProperties.originalDesignIntent).toBeUndefined();

    const cases = [
      {
        route: "/api/seed-capture",
        tool: "add_seed_reference",
        payload: {
          figmaSeedReference: "https://example.com/design/abc/X?node-id=1:2"
        },
        // Gate checked before URL validation when disconnected.
        reason: "figma_connection_required",
        httpStatus: 403
      },
      {
        route: "/api/region-annotation",
        tool: "create_region_annotation",
        payload: {
          author: "agent",
          body: "No surface",
          rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }
        },
        reason: "missing_surface_anchor",
        httpStatus: 400
      }
    ] as const;

    for (const contract of cases) {
      const http = await rawPost(
        port,
        contract.route,
        contract.payload,
        headers
      );
      expect(http.status, contract.tool).toBe(contract.httpStatus);
      expect(parse(http.body).error, contract.tool).toBe(contract.reason);

      const mcp = await client.callTool({
        name: contract.tool,
        arguments: contract.payload
      });
      expect(sc(mcp).error, contract.tool).toBe(contract.reason);
    }

    await connectFigmaForTests(port, token);

    // After connect, same bad host surfaces the domain URL reason on both sides.
    const badHostPayload = {
      figmaSeedReference: "https://example.com/design/abc/X?node-id=1:2"
    };
    const httpBadHost = await rawPost(
      port,
      "/api/seed-capture",
      badHostPayload,
      headers
    );
    expect(httpBadHost.status).toBe(400);
    expect(parse(httpBadHost.body).error).toBe("not_figma_host");
    const mcpBadHost = await client.callTool({
      name: "add_seed_reference",
      arguments: badHostPayload
    });
    expect(sc(mcpBadHost).error).toBe("not_figma_host");

    // Structural errors are transport errors, consistently named by HTTP.
    const structural = await rawPost(
      port,
      "/api/seed-capture",
      {
        figmaSeedReference: 42
      },
      headers
    );
    expect(structural.status).toBe(400);
    expect(parse(structural.body).error).toBe("invalid_params");

    // MCP child has global fetch=throw from the preload. This semantic write
    // succeeds (mock Figma API) and the ordinary browser HTTP route sees it.
    const goodUrl =
      "https://www.figma.com/design/noFetchParity001/Screen?node-id=7:8";
    const captured = await client.callTool({
      name: "add_seed_reference",
      arguments: {
        figmaSeedReference: goodUrl,
        referenceNote: "No-loopback contract"
      }
    });
    expect(sc(captured).ok).toBe(true);

    const listed = await rawGet(port, "/api/seed-reference", headers);
    expect(listed.status).toBe(200);
    const records = parse(listed.body).records as Array<{
      figma_seed_reference: string;
    }>;
    expect(records.some((record) => record.figma_seed_reference === goodUrl)).toBe(
      true
    );

    // Active HTTP seed-reference uses the same capture kernel; evidence-package
    // POST is retired (Issue 05D).
    const seedRefCapture = await rawPost(
      port,
      "/api/seed-reference",
      {
        figmaSeedReference:
          "https://www.figma.com/design/paritySeedRef002/Screen?node-id=3:4"
      },
      headers
    );
    expect(seedRefCapture.status).toBe(200);
    expect(parse(seedRefCapture.body).ok).toBe(true);

    const evidenceRetired = await rawPost(
      port,
      "/api/evidence-package",
      {
        figmaSeedReference: goodUrl,
        frame: { nodeId: "7:8", name: "Frame" },
        evidenceViews: { rawData: "available", screenshot: "available" },
        screenshot: {
          dataUrl:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        }
      },
      headers
    );
    expect(evidenceRetired.status).toBe(410);
    expect(parse(evidenceRetired.body).error).toBe("endpoint_retired");
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
