// Task 10 contract: one MCP-owned Runtime/project, real HTTP routes and real
// MCP tools must surface identical domain reasons for type-correct invalid
// payloads. A focused second test runs the MCP child with global fetch disabled;
// successful semantic writes plus immediate HTTP GET visibility prove no
// loopback fetch is used.
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
import { openRecordSse } from "./helpers/sse";

type JsonBody = Record<string, unknown>;

function parse(body: string): JsonBody {
  return JSON.parse(body) as JsonBody;
}

test("one-process Workbench + HTTP + MCP + SSE vertical preserves parity", async ({
  page
}) => {
  test.setTimeout(150_000);

  const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-parity-state-"));
  const projectDir = mkdtempSync(path.join(tmpdir(), "ikran-parity-project-"));
  let client: Client | null = null;
  let sse: Awaited<ReturnType<typeof openRecordSse>> | null = null;

  try {
    const handle = await spawnMcpClient(stateDir, { cwd: projectDir });
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
    sse = await openRecordSse(port, token);

    const tools = await client.listTools();
    const toolNames = tools.tools.map((t) => t.name);
    expect(toolNames).toContain("add_seed_reference");
    expect(toolNames).toContain("get_figma_connection_status");
    expect(toolNames).toContain("get_project_readiness");
    expect(toolNames).toContain("set_design_language_description");
    expect(toolNames).toContain("update_seed_reference_note");
    expect(toolNames).toContain("declare_component_live_heroes");
    expect(toolNames).toContain("scaffold_component_harness");
    expect(toolNames).toContain("verify_component_live_heroes");
    expect(toolNames).not.toContain("capture_component_code_hero");
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
        tool: "create_annotation",
        payload: {
          target: {
            kind: "figma-region",
            rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }
          },
          author: "agent",
          body: "No surface"
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
    await page.goto(workbenchUrl);
    await expect(page.getByTestId("seed-workbench")).toBeVisible();
    await expect(page.getByTestId("seed-workbench")).toHaveAttribute(
      "data-figma-gate",
      "open"
    );

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

    // Workbench paste #1 enters through HTTP and emits an SSE projection.
    // Node 7:8 has a deterministic child frame in the mock positional index.
    const firstUrl =
      "https://www.figma.com/design/verticalParity001/Screen?node-id=7:8";
    const firstRecordEventPromise = sse.waitForRecord();
    const firstCaptureResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/seed-capture") &&
        response.request().method() === "POST"
    );
    await page.evaluate((url) => {
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: {
          getData: (type: string) => (type === "text/plain" ? url : "")
        }
      });
      window.dispatchEvent(event);
    }, firstUrl);
    const firstCaptureResponse = await firstCaptureResponsePromise;
    expect(firstCaptureResponse.status()).toBe(200);
    const firstBody = (await firstCaptureResponse.json()) as JsonBody;
    expect(firstBody.ok).toBe(true);
    const firstRecord = firstBody.record as {
      id: string;
      current_surface_id: string;
      registered_via: string;
    };
    const firstSurface = firstBody.surface as { id: string };
    expect(firstRecord.registered_via).toBe("ui");
    expect(firstRecord.current_surface_id).toBe(firstSurface.id);
    await expect(firstRecordEventPromise).resolves.toMatchObject({
      kind: "seed",
      action: "created",
      id: firstRecord.id
    });
    await expect(sse.waitForRecord()).resolves.toMatchObject({
      kind: "evidence",
      action: "created",
      id: firstSurface.id
    });
    await expect(page.getByTestId("seed-reference-projection")).toHaveCount(1);
    await expect(
      page.getByTestId("seed-reference-projection-screenshot")
    ).toHaveCount(1);

    // Workbench paste #2 captures a second independent Reference.
    const secondRecordEventPromise = sse.waitForRecord();
    const secondUrl =
      "https://www.figma.com/design/paritySeedRef002/Screen?node-id=3:4";
    const secondCaptureResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/seed-capture") &&
        response.request().method() === "POST"
    );
    await page.evaluate((url) => {
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: {
          getData: (type: string) => (type === "text/plain" ? url : "")
        }
      });
      window.dispatchEvent(event);
    }, secondUrl);
    const secondCaptureResponse = await secondCaptureResponsePromise;
    expect(secondCaptureResponse.status()).toBe(200);
    expect((await secondCaptureResponse.json()).ok).toBe(true);
    await expect(secondRecordEventPromise).resolves.toMatchObject({
      kind: "seed",
      action: "created"
    });
    await expect(sse.waitForRecord()).resolves.toMatchObject({
      kind: "evidence",
      action: "created"
    });
    await expect(page.getByTestId("seed-reference-projection")).toHaveCount(2);

    // Agent capture enters through MCP and the same Runtime projects the
    // durable commit over SSE to the already-open Workbench.
    const agentRecordEventPromise = sse.waitForRecord();
    const agentCapture = await client.callTool({
      name: "add_seed_reference",
      arguments: {
        figmaSeedReference:
          "https://www.figma.com/design/parityAgent003/Screen?node-id=9:9",
        referenceNote: "Agent vertical capture"
      }
    });
    const agentBody = sc(agentCapture);
    expect(agentBody.ok).toBe(true);
    expect((agentBody.record as { registered_via: string }).registered_via).toBe(
      "agent"
    );
    await expect(agentRecordEventPromise).resolves.toMatchObject({
      kind: "seed",
      action: "created"
    });
    await expect(sse.waitForRecord()).resolves.toMatchObject({
      kind: "evidence",
      action: "created"
    });
    await expect(page.getByTestId("seed-reference-projection")).toHaveCount(3);

    // Canonical duplicate reuse does not write or emit another record.
    const duplicate = await client.callTool({
      name: "add_seed_reference",
      arguments: {
        figmaSeedReference:
          "https://www.figma.com/design/verticalParity001/Screen?node-id=7-8&t=duplicate"
      }
    });
    const duplicateBody = sc(duplicate);
    expect(duplicateBody.ok).toBe(true);
    expect(duplicateBody.reused).toBe(true);
    expect((duplicateBody.record as { id: string }).id).toBe(firstRecord.id);
    expect((duplicateBody.surface as { id: string }).id).toBe(firstSurface.id);

    const candidates = await client.callTool({
      name: "get_annotation_node_candidates",
      arguments: {
        surfaceId: firstSurface.id,
        rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.4 }
      }
    });
    const candidateBody = sc(candidates);
    expect(candidateBody.ok).toBe(true);
    expect(candidateBody).not.toHaveProperty("primaryNodeId");
    expect(
      (candidateBody.candidates as Array<{ nodeId: string }>).map(
        (candidate) => candidate.nodeId
      )
    ).toEqual(["7:8:child-frame", "7:8"]);

    // Explicit Refresh appends a new Surface, preserves the previous one, and
    // advances the Reference atomically. It also projects an SSE update.
    const refreshEvidenceEventPromise = sse.waitForRecord();
    const refreshSeedEventPromise = sse.waitForRecord();
    const refresh = await client.callTool({
      name: "refresh_seed_reference",
      arguments: { seedReferenceId: firstRecord.id }
    });
    const refreshBody = sc(refresh);
    expect(refreshBody.ok).toBe(true);
    expect(refreshBody.previous_surface_id).toBe(firstSurface.id);
    const refreshedSurface = refreshBody.surface as { id: string };
    expect(refreshedSurface.id).not.toBe(firstSurface.id);
    await expect(refreshEvidenceEventPromise).resolves.toMatchObject({
      kind: "evidence",
      action: "created",
      id: refreshedSurface.id
    });
    await expect(refreshSeedEventPromise).resolves.toMatchObject({
      kind: "seed",
      action: "updated",
      id: firstRecord.id
    });

    const listed = await rawGet(port, "/api/seed-reference", headers);
    expect(listed.status).toBe(200);
    const records = parse(listed.body).records as Array<{
      figma_seed_reference: string;
    }>;
    expect(records.some((record) => record.figma_seed_reference === firstUrl)).toBe(
      true
    );

    // The committed state proves transaction/lineage invariants and that the
    // PAT never crossed responses, SQLite records, or event payloads.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require("node:sqlite");
    const database = new DatabaseSync(path.join(projectDir, ".ikran", "ikran.db"));
    const seedRows = database
      .prepare(
        "SELECT id, current_surface_id, registered_via FROM seed_references ORDER BY created_at"
      )
      .all() as Array<{
      id: string;
      current_surface_id: string;
      registered_via: string;
    }>;
    const surfaceRows = database
      .prepare(
        "SELECT id, seed_reference_id, superseded_by FROM figma_evidence_surfaces ORDER BY created_at"
      )
      .all() as Array<{
      id: string;
      seed_reference_id: string;
      superseded_by: string | null;
    }>;
    const eventRows = database
      .prepare("SELECT type, payload FROM events ORDER BY id")
      .all() as Array<{ type: string; payload: string }>;
    database.close();
    expect(seedRows).toHaveLength(3);
    expect(surfaceRows).toHaveLength(4);
    expect(seedRows.find((row) => row.id === firstRecord.id)).toMatchObject({
      current_surface_id: refreshedSurface.id,
      registered_via: "ui"
    });
    expect(surfaceRows.find((row) => row.id === firstSurface.id)).toMatchObject({
      seed_reference_id: firstRecord.id,
      superseded_by: refreshedSurface.id
    });
    expect(
      surfaceRows.find((row) => row.id === refreshedSurface.id)
    ).toMatchObject({
      seed_reference_id: firstRecord.id,
      superseded_by: null
    });
    expect(
      JSON.stringify({
        responses: {
          firstBody,
          agentBody,
          duplicateBody,
          candidateBody,
          refreshBody
        },
        seedRows,
        surfaceRows,
        eventRows
      })
    ).not.toContain("figd_ok_e2e");

    // Active HTTP seed-reference uses the same capture kernel;
    // evidence-package POST remains retired (Issue 05D).
    const evidenceRetired = await rawPost(
      port,
      "/api/evidence-package",
      {
        figmaSeedReference: firstUrl,
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
    sse?.close();
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

test("MCP semantic write uses the command kernel without HTTP loopback", async () => {
  test.setTimeout(150_000);

  const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-no-fetch-state-"));
  const projectDir = mkdtempSync(path.join(tmpdir(), "ikran-no-fetch-project-"));
  const noFetchPreload = pathToFileURL(
    path.join(process.cwd(), "tests", "fixtures", "no-fetch-preload.mjs")
  ).href;
  let client: Client | null = null;

  try {
    const existingNodeOptions = process.env.NODE_OPTIONS?.trim();
    const handle = await spawnMcpClient(stateDir, {
      env: {
        NODE_OPTIONS: [existingNodeOptions, `--import=${noFetchPreload}`]
          .filter(Boolean)
          .join(" ")
      }
    });
    client = handle.client;

    const create = sc(
      await client.callTool({
        name: "create_or_open_project",
        arguments: { path: projectDir }
      })
    );
    expect(create.ok).toBe(true);
    const token = String(create.session);
    const port = Number(
      String(create.workbench_url).match(/127\.0\.0\.1:(\d+)\//)?.[1]
    );
    await connectFigmaForTests(port, token);

    const figmaUrl =
      "https://www.figma.com/design/noFetchKernel004/Screen?node-id=11:12";
    const captured = sc(
      await client.callTool({
        name: "add_seed_reference",
        arguments: { figmaSeedReference: figmaUrl }
      })
    );
    expect(captured.ok).toBe(true);

    const listed = await rawGet(port, "/api/seed-reference", {
      host: `127.0.0.1:${port}`,
      "x-ikran-session": token
    });
    expect(listed.status).toBe(200);
    expect(
      (parse(listed.body).records as Array<{ figma_seed_reference: string }>).some(
        (record) => record.figma_seed_reference === figmaUrl
      )
    ).toBe(true);
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
