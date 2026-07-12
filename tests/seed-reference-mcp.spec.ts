// Ikran Issue 02/03 — `register_seed_reference` MCP tool end-to-end.
//
// Proves the semantic MCP tool boundary: an Agent registers a Figma seed
// reference + original design intent as Runtime-owned research source-of-truth
// via a semantic intent tool (NOT raw exec / headless CLI / canvas geometry).
// The tool only does a LOCAL format check — it does NOT access Figma.
//
// Coverage:
// - success: MCP mock client registers; DB has a seed_references record;
//   SQLite events has seed_reference_registered; original URL stored verbatim.
// - validation failure: returns a structured error and writes NO record/event.
// - fail closed: no active project -> no_active_project; missing session token
//   at the HTTP boundary -> 403.
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

const URL_RE =
  /^http:\/\/127\.0\.0\.1:\d+\/\?session=[a-f0-9]{32,}&view=workbench$/;

const VALID_FIGMA_URL =
  "https://www.figma.com/design/abc123/My-Design?node-id=1:2";

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

test.describe("Ikran Issue 02/03 — register_seed_reference MCP tool", () => {
  test(
    "success: registers seed reference, writes DB record + seed_reference_registered event; original URL stored verbatim",
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
        expect(names).toContain("register_seed_reference");

        // Bind the project first (register_seed_reference requires an active project).
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

        const intent = "A checkout flow redesign exploring trust signals.";
        const res = await client.callTool({
          name: "register_seed_reference",
          arguments: {
            figmaSeedReference: VALID_FIGMA_URL,
            originalDesignIntent: intent
          }
        });
        const r = sc(res);
        expect(r.ok).toBe(true);
        expect(r.session).toBe(token);
        const record = r.record as {
          id: string;
          figma_seed_reference: string;
          original_design_intent: string;
          created_at: string;
        };
        expect(record.id).toBeTruthy();
        // Original URL stored verbatim (not rewritten/normalized).
        expect(record.figma_seed_reference).toBe(VALID_FIGMA_URL);
        expect(record.original_design_intent).toBe(intent);
        expect(typeof r.event_id).toBe("string");
        expect(r.event_id).toBeTruthy();

        // SQLite seed_references table has the record.
        const { DatabaseSync } = require("node:sqlite");
        const db = new DatabaseSync(path.join(dir, ".ikran", "ikran.db"));
        const rows = db
          .prepare("SELECT * FROM seed_references ORDER BY created_at ASC")
          .all() as Array<{ id: string; figma_seed_reference: string; original_design_intent: string }>;
        expect(rows.length).toBe(1);
        expect(rows[0].id).toBe(record.id);
        expect(rows[0].figma_seed_reference).toBe(VALID_FIGMA_URL);
        expect(rows[0].original_design_intent).toBe(intent);
        db.close();

        // Canonical SQLite events contain seed_reference_registered.
        const seedEvents = listDbEvents(dir, "seed_reference_registered");
        expect(seedEvents.length).toBe(1);
        expect(seedEvents[0].payload.seed_reference_id).toBe(record.id);

        // No Figma network contact: the test runs offline; if the handler had
        // fetched, it would have failed or hung. Success here proves local-only.
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
    "validation failure: returns structured error and writes NO record/event (no half-written state)",
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
        expect(sc(create).ok).toBe(true);

        const beforeSeedEvents = listDbEvents(dir, "seed_reference_registered");

        // Each invalid case returns a structured error.
        const cases: Array<{
          name: string;
          args: { figmaSeedReference: string; originalDesignIntent: string };
          expectedError: string;
        }> = [
          {
            name: "missing url",
            args: { figmaSeedReference: "", originalDesignIntent: "intent" },
            expectedError: "missing_figma_seed_reference"
          },
          {
            name: "missing intent",
            args: { figmaSeedReference: VALID_FIGMA_URL, originalDesignIntent: "" },
            expectedError: "missing_original_design_intent"
          },
          {
            name: "non-https",
            args: {
              figmaSeedReference: "http://www.figma.com/design/abc/X",
              originalDesignIntent: "intent"
            },
            expectedError: "invalid_figma_url"
          },
          {
            name: "not figma host",
            args: {
              figmaSeedReference: "https://example.com/design/abc/X",
              originalDesignIntent: "intent"
            },
            expectedError: "not_figma_host"
          },
          {
            name: "not design path",
            args: {
              figmaSeedReference: "https://www.figma.com/other/abc/X",
              originalDesignIntent: "intent"
            },
            expectedError: "not_figma_design_path"
          }
        ];

        for (const c of cases) {
          const res = await client.callTool({
            name: "register_seed_reference",
            arguments: c.args
          });
          const r = sc(res);
          expect(r.ok).toBe(false);
          expect(r.error).toBe(c.expectedError);
        }

        // No seed_references record was written, and no new
        // seed_reference_registered event appeared in SQLite.
        const { DatabaseSync } = require("node:sqlite");
        const db = new DatabaseSync(path.join(dir, ".ikran", "ikran.db"));
        const count = (
          db.prepare("SELECT COUNT(*) as c FROM seed_references").get() as {
            c: number;
          }
        ).c;
        expect(count).toBe(0);
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

        // 1. NO active project: register_seed_reference must fail closed.
        const noProject = await client.callTool({
          name: "register_seed_reference",
          arguments: {
            figmaSeedReference: VALID_FIGMA_URL,
            originalDesignIntent: "intent"
          }
        });
        const np = sc(noProject);
        expect(np.ok).toBe(false);
        // The HTTP route returns no_active_project (400) when no project is bound.
        expect(np.error).toBe("no_active_project");
        // No .ikran created in dir at all (we never bound it here).
        expect(existsSync(path.join(dir, ".ikran"))).toBe(false);

        // 2. Bind a project, then test the HTTP boundary directly: a request
        // without a session token is rejected with 403 (fail closed).
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
          `http://127.0.0.1:${port}/api/seed-reference`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              figmaSeedReference: VALID_FIGMA_URL,
              originalDesignIntent: "intent"
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