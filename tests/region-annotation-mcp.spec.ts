// Ikran Issue 06 — `create_region_annotation` MCP tool (HTTP + MCP wiring).
//
// Coverage (always):
// - listTools: create_region_annotation + list_region_annotations registered
//
// Full create/list e2e (success + invalid) is gated on
// `lib/runtime/region-annotation.ts` existing in the build. When that Runtime
// foundation file is mid-flight / missing, those cases are skipped with a note
// so this wiring slice can land independently.

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { expect, test } from "./fixtures";
import { SHARED_BUILD_DIR } from "./e2e-constants";

const MCP_BIN = path.join(process.cwd(), "bin", "ikran-mcp.mjs");
const RUNTIME_MODULE = path.join(
  process.cwd(),
  "lib",
  "runtime",
  "region-annotation.ts"
);

/** Valid-format Figma URL that is NOT a real reachable file — success proves no fetch. */
const FAKE_FIGMA_URL =
  "https://www.figma.com/design/NOTAREALFILEKEY000/Issue06-E2E-Fake?node-id=9:9";

const RUNTIME_READY = existsSync(RUNTIME_MODULE);

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

test.describe("Ikran Issue 06 — create_region_annotation MCP tool", () => {
  test("tool is registered and discoverable via listTools", async () => {
    test.setTimeout(60_000);

    const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-mcp-region-"));
    let client: Client | null = null;
    try {
      const handle = await spawnMcpClient(stateDir);
      client = handle.client;

      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toContain("create_region_annotation");
      expect(names).toContain("list_region_annotations");
      expect(names).toContain("record_evidence_package");
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

  test("success: creates annotation + annotation_created; list returns it", async () => {
    test.skip(
      !RUNTIME_READY,
      "lib/runtime/region-annotation.ts missing mid-flight — skip full MCP e2e until Runtime foundation lands"
    );
    test.setTimeout(150_000);

    const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-mcp-region-ok-"));
    const dir = mkdtempSync(path.join(tmpdir(), "ikran-region-ok-proj-"));
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

      const seedRes = await client.callTool({
        name: "register_seed_reference",
        arguments: {
          figmaSeedReference: FAKE_FIGMA_URL,
          originalDesignIntent: "Issue 06 MCP e2e: fake file, no Figma contact."
        }
      });
      expect(sc(seedRes).ok).toBe(true);
      const seedRecord = sc(seedRes).record as { id: string };

      const surfaceRes = await client.callTool({
        name: "record_evidence_package",
        arguments: {
          figmaSeedReference: FAKE_FIGMA_URL,
          seedReferenceId: seedRecord.id,
          frame: { nodeId: "9:9", name: "Fake Checkout" },
          evidenceViews: { rawData: "available", screenshot: "missing" }
        }
      });
      const surfaceSc = sc(surfaceRes);
      expect(surfaceSc.ok).toBe(true);
      const surface = surfaceSc.record as { id: string; frame_node_id: string };

      const annRes = await client.callTool({
        name: "create_region_annotation",
        arguments: {
          author: "agent",
          surfaceArtifactId: surface.id,
          rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.15 },
          body: "Placeholder annotation",
          primaryNodeId: "12:34"
        }
      });
      const annSc = sc(annRes);
      expect(annSc.ok).toBe(true);
      expect(annSc.session).toBe(token);
      const record = annSc.record as {
        id: string;
        author: string;
        type: string;
        surface_artifact_id?: string | null;
        surface_id?: string | null;
      };
      expect(record.id).toBeTruthy();
      expect(record.author).toBe("agent");
      expect(record.type).toBe("assumption");
      expect(typeof annSc.event_id).toBe("string");

      const listTool = await client.callTool({
        name: "list_region_annotations",
        arguments: {}
      });
      const listToolSc = sc(listTool);
      expect(listToolSc.ok).toBe(true);
      const listed = listToolSc.records as Array<{ id: string }>;
      expect(listed.map((r) => r.id)).toContain(record.id);

      const listRes = await fetch(
        `http://127.0.0.1:${port}/api/region-annotation`,
        { headers: { "x-ikran-session": token } }
      );
      expect(listRes.status).toBe(200);
      const listBody = (await listRes.json()) as {
        ok: boolean;
        records: Array<{ id: string }>;
      };
      expect(listBody.ok).toBe(true);
      expect(listBody.records.map((x) => x.id)).toContain(record.id);

      const events = readEventLines(dir);
      const created = events.find((e) => e.type === "annotation_created");
      expect(created).toBeTruthy();
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

  test("invalid: structured error + NO annotation when missing surface anchor", async () => {
    test.skip(
      !RUNTIME_READY,
      "lib/runtime/region-annotation.ts missing mid-flight — skip full MCP e2e until Runtime foundation lands"
    );
    test.setTimeout(150_000);

    const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-mcp-region-bad-"));
    const dir = mkdtempSync(path.join(tmpdir(), "ikran-region-bad-proj-"));
    let client: Client | null = null;
    try {
      const handle = await spawnMcpClient(stateDir);
      client = handle.client;

      const create = await client.callTool({
        name: "create_or_open_project",
        arguments: { path: dir }
      });
      expect(sc(create).ok).toBe(true);

      const bad = await client.callTool({
        name: "create_region_annotation",
        arguments: {
          author: "agent",
          rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.15 },
          body: "no surface"
        }
      });
      const badSc = sc(bad);
      expect(badSc.ok).toBe(false);
      expect(badSc.error).toBe("missing_surface_anchor");

      const listTool = await client.callTool({
        name: "list_region_annotations",
        arguments: {}
      });
      const listToolSc = sc(listTool);
      expect(listToolSc.ok).toBe(true);
      expect((listToolSc.records as unknown[]).length).toBe(0);
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
