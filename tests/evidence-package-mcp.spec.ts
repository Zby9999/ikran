// Ikran Issue 05 — `record_evidence_package` MCP tool end-to-end (Task 5).
//
// Coverage:
// - listTools: tool is registered
// - success: valid minimal package → surface row + evidence_package_recorded;
//   uses a valid-format Figma URL that is NOT a real reachable file (proves
//   Runtime never needs Figma network contact)
// - invalid: structured error + invalid_output + NO surface row
//
// Mirrors tests/seed-reference-mcp.spec.ts: spawns its own Next HTTP surface
// via the MCP server against the shared e2e build in --prod mode.

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { expect, test } from "./fixtures";
import { SHARED_BUILD_DIR } from "./e2e-constants";

const MCP_BIN = path.join(process.cwd(), "bin", "ikran-mcp.mjs");

/** Valid-format Figma URL that is NOT a real reachable file — success proves no fetch. */
const FAKE_FIGMA_URL =
  "https://www.figma.com/design/NOTAREALFILEKEY000/Issue05-E2E-Fake?node-id=9:9";

function sc(res: unknown): Record<string, unknown> {
  if (typeof res === "object" && res !== null) {
    const r = res as { structuredContent?: unknown };
    if (r.structuredContent && typeof r.structuredContent === "object") {
      return r.structuredContent as Record<string, unknown>;
    }
  }
  return {};
}

function killRecordedRuntime(stateDir: string) {
  try {
    const file = path.join(stateDir, "runtime-endpoint.json");
    const ep = JSON.parse(readFileSync(file, "utf-8")) as { pid?: number };
    if (ep && typeof ep.pid === "number") {
      try {
        process.kill(-ep.pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
  } catch {
    /* no endpoint file */
  }
}

async function spawnMcpClient(
  stateDir: string
): Promise<{ client: Client; transport: StdioClientTransport }> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_BIN, "--prod"],
    env: {
      ...process.env,
      IKRAN_STATE_DIR: stateDir,
      IKRAN_HOST: "127.0.0.1",
      IKRAN_NEXT_DIST_DIR: SHARED_BUILD_DIR
    },
    stderr: "pipe"
  });
  const client = new Client(
    { name: "ikran-e2e", version: "0.0.0" },
    { capabilities: {} }
  );
  await client.connect(transport);
  return { client, transport };
}

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
  const file = path.join(dir, ".ikran", "events.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; payload?: Record<string, unknown> });
}

test.describe("Ikran Issue 05 — record_evidence_package MCP tool", () => {
  test("tool is registered and discoverable via listTools", async () => {
    test.setTimeout(60_000);

    const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-mcp-evidence-"));
    let client: Client | null = null;
    try {
      const handle = await spawnMcpClient(stateDir);
      client = handle.client;

      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toContain("record_evidence_package");
      expect(names).toContain("register_seed_reference");
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

  test("success: records surface + evidence_package_recorded; fake Figma URL proves zero network", async () => {
    test.setTimeout(150_000);

    const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-mcp-evidence-ok-"));
    const dir = mkdtempSync(path.join(tmpdir(), "ikran-evidence-ok-proj-"));
    let client: Client | null = null;
    try {
      const handle = await spawnMcpClient(stateDir);
      client = handle.client;

      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toContain("record_evidence_package");
      expect(names).toContain("create_or_open_project");

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

      // Optional: register seed first, then record package linked by seed id.
      const seedRes = await client.callTool({
        name: "register_seed_reference",
        arguments: {
          figmaSeedReference: FAKE_FIGMA_URL,
          originalDesignIntent: "Issue 05 MCP e2e: fake file, no Figma contact."
        }
      });
      const seedSc = sc(seedRes);
      expect(seedSc.ok).toBe(true);
      const seedRecord = seedSc.record as { id: string };

      const res = await client.callTool({
        name: "record_evidence_package",
        arguments: {
          figmaSeedReference: FAKE_FIGMA_URL,
          seedReferenceId: seedRecord.id,
          frame: { nodeId: "9:9", name: "Fake Checkout" },
          evidenceViews: { rawData: "available", screenshot: "missing" }
        }
      });
      const r = sc(res);
      expect(r.ok).toBe(true);
      expect(r.session).toBe(token);
      const record = r.record as {
        id: string;
        figma_seed_reference: string;
        frame_node_id: string;
        frame_name: string;
        seed_reference_id: string | null;
      };
      expect(record.id).toBeTruthy();
      expect(record.figma_seed_reference).toBe(FAKE_FIGMA_URL);
      expect(record.frame_node_id).toBe("9:9");
      expect(record.frame_name).toBe("Fake Checkout");
      expect(record.seed_reference_id).toBe(seedRecord.id);
      expect(typeof r.event_id).toBe("string");
      expect(r.event_id).toBeTruthy();

      // SQLite figma_evidence_surfaces has the row.
      const rows = readSurfaceRows(dir);
      expect(rows.length).toBe(1);
      expect(rows[0].id).toBe(record.id);
      expect(rows[0].figma_seed_reference).toBe(FAKE_FIGMA_URL);

      // GET /api/evidence-package also returns the surface (session-authenticated).
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
      expect(listBody.records.map((x) => x.id)).toContain(record.id);

      // events.jsonl contains evidence_package_recorded.
      const events = readEventLines(dir);
      const recorded = events.find((e) => e.type === "evidence_package_recorded");
      expect(recorded).toBeTruthy();
      expect(recorded?.payload?.surface_id).toBe(record.id);

      // Zero Figma contact: FAKE_FIGMA_URL is not a real file. If Runtime had
      // fetched figma.com / oEmbed / /api/figma/*, this success path would fail.
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

  test("invalid: structured error + invalid_output + NO surface row", async () => {
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
      expect(sc(create).ok).toBe(true);

      // Case 1: screenshot available without payload.
      const noShot = await client.callTool({
        name: "record_evidence_package",
        arguments: {
          figmaSeedReference: FAKE_FIGMA_URL,
          frame: { nodeId: "1:1", name: "Frame" },
          evidenceViews: { rawData: "available", screenshot: "available" }
        }
      });
      const noShotSc = sc(noShot);
      expect(noShotSc.ok).toBe(false);
      expect(noShotSc.error).toBe("screenshot_required_when_available");

      // Case 2: bad Figma URL host.
      const badUrl = await client.callTool({
        name: "record_evidence_package",
        arguments: {
          figmaSeedReference: "https://example.com/design/abc/X",
          frame: { nodeId: "1:1", name: "Frame" },
          evidenceViews: { rawData: "available", screenshot: "missing" }
        }
      });
      const badUrlSc = sc(badUrl);
      expect(badUrlSc.ok).toBe(false);
      expect(badUrlSc.error).toBe("not_figma_host");

      // No surface rows written.
      expect(countSurfaces(dir)).toBe(0);

      // invalid_output events present; no evidence_package_recorded.
      const events = readEventLines(dir);
      const invalids = events.filter((e) => e.type === "invalid_output");
      expect(invalids.length).toBeGreaterThanOrEqual(2);
      const reasons = invalids.map((e) => e.payload?.reason);
      expect(reasons).toContain("screenshot_required_when_available");
      expect(reasons).toContain("not_figma_host");
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
