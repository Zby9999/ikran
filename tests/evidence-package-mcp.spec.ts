// Active MCP seed evidence — `add_seed_reference` + connection status (ADR 0003).
//
// Coverage:
// - listTools: Active tools present; legacy Agent evidence tools absent
// - get_figma_connection_status: disconnected then connected after HTTP connect
// - success: connect → add_seed_reference → seed + surface + events (mock Figma)
// - invalid / gate closed: structured error + NO surface/seed rows
//
// Mirrors tests/seed-reference-mcp.spec.ts: spawns its own Next HTTP surface
// via the MCP server against the shared e2e build in --prod mode.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { expect, test } from "./fixtures";
import {
  killRecordedRuntime,
  sc,
  spawnMcpClient
} from "./helpers/mcp";
import { connectFigmaForTests } from "./helpers/figma-connection";

const MOCK_FIGMA_URL =
  "https://www.figma.com/design/NOTAREALFILEKEY000/Issue05-E2E-Fake?node-id=9:9";

const LEGACY_SEED_TOOLS = [
  "register_seed_reference",
  "list_pending_seed_evidence",
  "record_evidence_package"
] as const;

function countSurfaces(dir: string): number {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(path.join(dir, ".ikran", "ikran.db"));
  try {
    return (
      db
        .prepare("SELECT COUNT(*) as c FROM figma_evidence_surfaces")
        .get() as { c: number }
    ).c;
  } finally {
    db.close();
  }
}

function countSeeds(dir: string): number {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(path.join(dir, ".ikran", "ikran.db"));
  try {
    return (
      db.prepare("SELECT COUNT(*) as c FROM seed_references").get() as {
        c: number;
      }
    ).c;
  } finally {
    db.close();
  }
}

function readSurfaceRows(dir: string): Array<{
  id: string;
  figma_seed_reference: string;
  frame_node_id: string;
  frame_name: string;
}> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(path.join(dir, ".ikran", "ikran.db"));
  try {
    return db
      .prepare(
        "SELECT id, figma_seed_reference, frame_node_id, frame_name FROM figma_evidence_surfaces ORDER BY created_at ASC"
      )
      .all() as Array<{
      id: string;
      figma_seed_reference: string;
      frame_node_id: string;
      frame_name: string;
    }>;
  } finally {
    db.close();
  }
}

function readEventLines(
  dir: string
): Array<{ type: string; payload?: Record<string, unknown> }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(path.join(dir, ".ikran", "ikran.db"));
  try {
    return (
      db
        .prepare("SELECT type, payload FROM events ORDER BY id ASC")
        .all() as Array<{ type: string; payload: string }>
    ).map((r) => ({
      type: r.type,
      payload: JSON.parse(r.payload) as Record<string, unknown>
    }));
  } finally {
    db.close();
  }
}

test.describe("Active MCP — seed evidence tools", () => {
  test("Active tools registered; legacy Agent evidence tools absent", async () => {
    test.setTimeout(60_000);

    const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-mcp-evidence-"));
    let client: Client | null = null;
    try {
      const handle = await spawnMcpClient(stateDir);
      client = handle.client;

      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toContain("add_seed_reference");
      expect(names).toContain("get_figma_connection_status");
      for (const legacy of LEGACY_SEED_TOOLS) {
        expect(names).not.toContain(legacy);
      }
    } finally {
      if (client) {
        try {
          await client.close();
        } catch {
          /* ignore */
        }
      }
      killRecordedRuntime(stateDir);
      try {
        rmSync(stateDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  test("get_figma_connection_status: disconnected then connected after HTTP connect", async () => {
    test.setTimeout(150_000);

    const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-mcp-conn-"));
    const dir = mkdtempSync(path.join(tmpdir(), "ikran-conn-proj-"));
    let client: Client | null = null;
    try {
      const handle = await spawnMcpClient(stateDir);
      client = handle.client;

      const create = await client.callTool({
        name: "create_or_open_project",
        arguments: { path: dir }
      });
      const createSc = sc(create);
      expect(createSc.ok).toBe(true);
      const token = createSc.session as string;
      const workbenchUrl = createSc.workbench_url as string;
      const port = Number(workbenchUrl.match(/127\.0\.0\.1:(\d+)\//)?.[1]);
      expect(port).toBeGreaterThan(0);

      const closed = await client.callTool({
        name: "get_figma_connection_status",
        arguments: {}
      });
      const closedSc = sc(closed);
      expect(closedSc.ok).toBe(true);
      expect(closedSc.connected).toBe(false);
      expect(closedSc.session).toBe(token);

      await connectFigmaForTests(port, token);

      const open = await client.callTool({
        name: "get_figma_connection_status",
        arguments: {}
      });
      const openSc = sc(open);
      expect(openSc.ok).toBe(true);
      expect(openSc.connected).toBe(true);
      expect(openSc.session).toBe(token);
      const account = openSc.account as { handle?: string } | undefined;
      expect(account?.handle).toBe("mock-designer");
      // Never expose the PAT.
      expect(JSON.stringify(openSc)).not.toMatch(/figd_/);
    } finally {
      try {
        await client?.close();
      } catch {
        /* ignore */
      }
      killRecordedRuntime(stateDir);
      rmSync(stateDir, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("success: connect → add_seed_reference creates seed + surface + events", async () => {
    test.setTimeout(150_000);

    const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-mcp-evidence-ok-"));
    const dir = mkdtempSync(path.join(tmpdir(), "ikran-evidence-ok-proj-"));
    let client: Client | null = null;
    try {
      const handle = await spawnMcpClient(stateDir);
      client = handle.client;

      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toContain("add_seed_reference");
      expect(names).toContain("create_or_open_project");
      expect(names).not.toContain("record_evidence_package");

      const create = await client.callTool({
        name: "create_or_open_project",
        arguments: { path: dir }
      });
      const createSc = sc(create);
      expect(createSc.ok).toBe(true);
      const token = createSc.session as string;
      const workbenchUrl = createSc.workbench_url as string;
      const port = Number(workbenchUrl.match(/127\.0\.0\.1:(\d+)\//)?.[1]);
      expect(port).toBeGreaterThan(0);

      await connectFigmaForTests(port, token);

      const res = await client.callTool({
        name: "add_seed_reference",
        arguments: {
          figmaSeedReference: MOCK_FIGMA_URL,
          referenceNote: "Issue 05 MCP e2e: mock capture"
        }
      });
      const r = sc(res);
      expect(r.ok).toBe(true);
      expect(r.session).toBe(token);
      const record = r.record as {
        id: string;
        figma_seed_reference: string;
        current_surface_id: string | null;
      };
      expect(record.id).toBeTruthy();
      expect(record.figma_seed_reference).toBe(MOCK_FIGMA_URL);
      const surface = r.surface as {
        id: string;
        frame_node_id: string;
        frame_name: string;
        seed_reference_id?: string | null;
      };
      expect(surface.id).toBe(record.current_surface_id);
      expect(surface.frame_node_id).toBe("9:9");
      expect(surface.frame_name).toBe("Mock Frame");
      expect(typeof r.event_id).toBe("string");
      expect(r.event_id).toBeTruthy();

      const rows = readSurfaceRows(dir);
      expect(rows.length).toBe(1);
      expect(rows[0].id).toBe(surface.id);
      expect(rows[0].figma_seed_reference).toBe(MOCK_FIGMA_URL);

      const listRes = await fetch(
        `http://127.0.0.1:${port}/api/evidence-package`,
        { headers: { "x-ikran-session": token } }
      );
      expect(listRes.status).toBe(200);
      const listBody = (await listRes.json()) as {
        ok: boolean;
        records: Array<{ id: string }>;
      };
      expect(listBody.ok).toBe(true);
      expect(listBody.records.map((x) => x.id)).toContain(surface.id);

      const retiredWrite = await fetch(
        `http://127.0.0.1:${port}/api/evidence-package`,
        {
          method: "POST",
          headers: {
            "x-ikran-session": token,
            "content-type": "application/json"
          },
          body: JSON.stringify({
            figmaSeedReference: MOCK_FIGMA_URL,
            frame: { nodeId: "9:9", name: "Should Not Write" },
            evidenceViews: { rawData: "available", screenshot: "available" },
            screenshot: {
              dataUrl:
                "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
            }
          })
        }
      );
      expect(retiredWrite.status).toBe(410);
      expect(await retiredWrite.json()).toMatchObject({
        ok: false,
        error: "endpoint_retired"
      });

      const events = readEventLines(dir);
      expect(
        events.some((e) => e.type === "seed_reference_registered")
      ).toBe(true);
      expect(
        events.some((e) => e.type === "evidence_package_recorded")
      ).toBe(true);
    } finally {
      try {
        await client?.close();
      } catch {
        /* ignore */
      }
      killRecordedRuntime(stateDir);
      rmSync(stateDir, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("invalid: gate closed / bad URL → error + NO seed or surface row", async () => {
    test.setTimeout(150_000);

    const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-mcp-evidence-bad-"));
    const dir = mkdtempSync(path.join(tmpdir(), "ikran-evidence-bad-proj-"));
    let client: Client | null = null;
    try {
      const handle = await spawnMcpClient(stateDir);
      client = handle.client;

      const create = await client.callTool({
        name: "create_or_open_project",
        arguments: { path: dir }
      });
      const createSc = sc(create);
      expect(createSc.ok).toBe(true);
      const token = createSc.session as string;
      const workbenchUrl = createSc.workbench_url as string;
      const port = Number(workbenchUrl.match(/127\.0\.0\.1:(\d+)\//)?.[1]);
      expect(port).toBeGreaterThan(0);

      const closed = await client.callTool({
        name: "add_seed_reference",
        arguments: { figmaSeedReference: MOCK_FIGMA_URL }
      });
      const closedSc = sc(closed);
      expect(closedSc.ok).toBe(false);
      expect(closedSc.error).toBe("figma_connection_required");

      await connectFigmaForTests(port, token);

      const badUrl = await client.callTool({
        name: "add_seed_reference",
        arguments: {
          figmaSeedReference: "https://example.com/design/abc/X?node-id=1:1"
        }
      });
      const badUrlSc = sc(badUrl);
      expect(badUrlSc.ok).toBe(false);
      expect(badUrlSc.error).toBe("not_figma_host");

      expect(countSurfaces(dir)).toBe(0);
      expect(countSeeds(dir)).toBe(0);

      const events = readEventLines(dir);
      expect(
        events.some((e) => e.type === "seed_reference_registered")
      ).toBe(false);
      expect(
        events.some((e) => e.type === "evidence_package_recorded")
      ).toBe(false);
    } finally {
      try {
        await client?.close();
      } catch {
        /* ignore */
      }
      killRecordedRuntime(stateDir);
      rmSync(stateDir, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
