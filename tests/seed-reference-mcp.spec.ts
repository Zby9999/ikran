// Active MCP seed path — `add_seed_reference` end-to-end (ADR 0003).
//
// Proves the semantic MCP tool boundary: an Agent adds a Figma Seed Reference
// via Runtime-owned positional evidence capture (shared with Workbench paste).
// Requires an active Figma Connection; uses deterministic mock Figma API.
//
// Coverage:
// - listTools: add_seed_reference + get_figma_connection_status; legacy tools absent
// - success: MCP registers; DB has seed_references + surface; seed_reference_registered
// - validation / gate failure: structured error and writes NO record/event
// - fail closed: no active project -> no_active_project; missing session token
//   at the HTTP seed-capture boundary -> 403
//
// Mirrors tests/project-session-mcp.spec.ts: spawns its own Next HTTP surface
// via the MCP server, runs against the shared e2e build in --prod mode.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
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

const URL_RE =
  /^http:\/\/127\.0\.0\.1:\d+\/\?session=[a-f0-9]{32,}&view=workbench$/;

const VALID_FIGMA_URL =
  "https://www.figma.com/design/abc123/My-Design?node-id=1:2";

const LEGACY_SEED_TOOLS = [
  "register_seed_reference",
  "list_pending_seed_evidence",
  "record_evidence_package"
] as const;

function listDbEvents(
  dir: string,
  type?: string
): Array<{ type: string; payload: Record<string, unknown> }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(path.join(dir, ".ikran", "ikran.db"));
  try {
    const rows = (
      type
        ? db
            .prepare(
              "SELECT type, payload FROM events WHERE type = ? ORDER BY id ASC"
            )
            .all(type)
        : db
            .prepare("SELECT type, payload FROM events ORDER BY id ASC")
            .all()
    ) as Array<{ type: string; payload: string }>;
    return rows.map((r) => ({
      type: r.type,
      payload: JSON.parse(r.payload) as Record<string, unknown>
    }));
  } finally {
    db.close();
  }
}

test.describe("Active MCP — add_seed_reference", () => {
  test(
    "success: captures seed + surface, writes DB record + seed_reference_registered",
    async () => {
      test.setTimeout(150_000);

      const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-mcp-seed-"));
      const dir = mkdtempSync(path.join(tmpdir(), "ikran-seed-proj-"));
      let client: Client | null = null;
      try {
        const handle = await spawnMcpClient(stateDir);
        client = handle.client;

        const names = (await client.listTools()).tools.map((t) => t.name);
        expect(names).toContain("open_workbench");
        expect(names).toContain("create_or_open_project");
        expect(names).toContain("add_seed_reference");
        expect(names).toContain("get_figma_connection_status");
        expect(names).toContain("get_project_readiness");
        expect(names).toContain("set_design_language_description");
        expect(names).toContain("update_seed_reference_note");
        for (const legacy of LEGACY_SEED_TOOLS) {
          expect(names).not.toContain(legacy);
        }

        const create = await client.callTool({
          name: "create_or_open_project",
          arguments: { path: dir }
        });
        const createSc = sc(create);
        expect(createSc.ok).toBe(true);
        const token = createSc.session as string;
        const workbenchUrl = createSc.workbench_url as string;
        expect(workbenchUrl).toMatch(URL_RE);
        const port = Number(workbenchUrl.match(/127\.0\.0\.1:(\d+)\//)?.[1]);
        expect(port).toBeGreaterThan(0);

        await connectFigmaForTests(port, token);

        const note = "A checkout flow redesign exploring trust signals.";
        const res = await client.callTool({
          name: "add_seed_reference",
          arguments: {
            figmaSeedReference: VALID_FIGMA_URL,
            referenceNote: note
          }
        });
        const r = sc(res);
        expect(r.ok).toBe(true);
        expect(r.session).toBe(token);
        const record = r.record as {
          id: string;
          figma_seed_reference: string;
          file_key: string;
          node_id: string;
          current_surface_id: string | null;
        };
        expect(record.id).toBeTruthy();
        expect(record.figma_seed_reference).toBe(VALID_FIGMA_URL);
        expect(record.file_key).toBe("abc123");
        expect(record.node_id).toBe("1:2");
        expect(record.current_surface_id).toBeTruthy();
        const surface = r.surface as {
          id: string;
          frame_name: string;
          frame_node_id: string;
        };
        expect(surface.id).toBe(record.current_surface_id);
        expect(surface.frame_name).toBe("Mock Frame");
        expect(surface.frame_node_id).toBe("1:2");
        expect(typeof r.event_id).toBe("string");
        expect(r.event_id).toBeTruthy();

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { DatabaseSync } = require("node:sqlite");
        const db = new DatabaseSync(path.join(dir, ".ikran", "ikran.db"));
        const rows = db
          .prepare("SELECT * FROM seed_references ORDER BY created_at ASC")
          .all() as Array<{
          id: string;
          figma_seed_reference: string;
          current_surface_id: string | null;
        }>;
        expect(rows.length).toBe(1);
        expect(rows[0].id).toBe(record.id);
        expect(rows[0].figma_seed_reference).toBe(VALID_FIGMA_URL);
        expect(rows[0].current_surface_id).toBe(surface.id);
        const surfaces = db
          .prepare("SELECT COUNT(*) as c FROM figma_evidence_surfaces")
          .get() as { c: number };
        expect(surfaces.c).toBe(1);
        db.close();

        const seedEvents = listDbEvents(dir, "seed_reference_registered");
        expect(seedEvents.length).toBe(1);
        expect(seedEvents[0].payload.seed_reference_id).toBe(record.id);
        const evidenceEvents = listDbEvents(dir, "evidence_package_recorded");
        expect(evidenceEvents.length).toBe(1);
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
    }
  );

  test(
    "validation / gate failure: structured error and writes NO record/event",
    async () => {
      test.setTimeout(150_000);

      const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-mcp-seed-val-"));
      const dir = mkdtempSync(path.join(tmpdir(), "ikran-seed-val-proj-"));
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

        const beforeSeedEvents = listDbEvents(dir, "seed_reference_registered");

        // Gate closed: capture fails before URL validation side effects.
        const closed = await client.callTool({
          name: "add_seed_reference",
          arguments: { figmaSeedReference: VALID_FIGMA_URL }
        });
        expect(sc(closed).ok).toBe(false);
        expect(sc(closed).error).toBe("figma_connection_required");

        await connectFigmaForTests(port, token);

        const cases: Array<{
          name: string;
          args: { figmaSeedReference: string; referenceNote?: string };
          expectedError: string;
        }> = [
          {
            name: "missing url",
            args: { figmaSeedReference: "" },
            expectedError: "missing_figma_seed_reference"
          },
          {
            name: "non-https",
            args: {
              figmaSeedReference: "http://www.figma.com/design/abc/X?node-id=1:2"
            },
            expectedError: "invalid_figma_url"
          },
          {
            name: "not figma host",
            args: {
              figmaSeedReference: "https://example.com/design/abc/X?node-id=1:2"
            },
            expectedError: "not_figma_host"
          },
          {
            name: "not design path",
            args: {
              figmaSeedReference: "https://www.figma.com/other/abc/X?node-id=1:2"
            },
            expectedError: "not_figma_design_path"
          },
          {
            name: "missing node-id",
            args: {
              figmaSeedReference: "https://www.figma.com/design/abc123/Checkout"
            },
            expectedError: "missing_node_id"
          }
        ];

        for (const c of cases) {
          const res = await client.callTool({
            name: "add_seed_reference",
            arguments: c.args
          });
          const r = sc(res);
          expect(r.ok, c.name).toBe(false);
          expect(r.error, c.name).toBe(c.expectedError);
        }

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { DatabaseSync } = require("node:sqlite");
        const db = new DatabaseSync(path.join(dir, ".ikran", "ikran.db"));
        const count = (
          db.prepare("SELECT COUNT(*) as c FROM seed_references").get() as {
            c: number;
          }
        ).c;
        expect(count).toBe(0);
        const surfaces = (
          db
            .prepare("SELECT COUNT(*) as c FROM figma_evidence_surfaces")
            .get() as { c: number }
        ).c;
        expect(surfaces).toBe(0);
        db.close();

        expect(listDbEvents(dir, "seed_reference_registered")).toEqual(
          beforeSeedEvents
        );
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
    }
  );

  test(
    "fail closed: no active project -> no_active_project; missing session token at HTTP boundary -> 403",
    async () => {
      test.setTimeout(150_000);

      const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-mcp-seed-fail-"));
      const dir = mkdtempSync(path.join(tmpdir(), "ikran-seed-fail-proj-"));
      let client: Client | null = null;
      try {
        const handle = await spawnMcpClient(stateDir);
        client = handle.client;

        const noProject = await client.callTool({
          name: "add_seed_reference",
          arguments: { figmaSeedReference: VALID_FIGMA_URL }
        });
        const np = sc(noProject);
        expect(np.ok).toBe(false);
        expect(np.error).toBe("no_active_project");
        expect(existsSync(path.join(dir, ".ikran"))).toBe(false);

        const create = await client.callTool({
          name: "create_or_open_project",
          arguments: { path: dir }
        });
        const createSc = sc(create);
        expect(createSc.ok).toBe(true);
        const workbenchUrl = createSc.workbench_url as string;
        const port = Number(workbenchUrl.match(/127\.0\.0\.1:(\d+)\//)?.[1]);
        expect(port).toBeGreaterThan(0);

        const noToken = await fetch(
          `http://127.0.0.1:${port}/api/seed-capture`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              figmaSeedReference: VALID_FIGMA_URL
            })
          }
        );
        expect(noToken.status).toBe(403);
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
    }
  );
});
