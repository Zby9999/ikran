// Ikran Issue 02/02 — `create_or_open_project` MCP tool end-to-end.
//
// Proves the new project/session context: the Agent's MCP tool and the
// Workbench HTTP API operate on the SAME project (one Runtime-owned binding),
// the MCP tool FAILS CLOSED on project mismatch, the HTTP surface rejects a
// missing token, and a refresh recovers a binding that the Agent created via
// MCP.
//
// This test does NOT use the `runtime` fixture: the MCP server spawns its own
// Next HTTP surface (via lib/runtime/runtime-endpoint.mjs openWorkbench), like
// tests/open-workbench-mcp.spec.ts. It runs against the shared e2e build
// (SHARED_BUILD_DIR) in --prod mode so the first call is fast (global-setup
// builds once).

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { expect, test } from "./fixtures";
import { SHARED_BUILD_DIR } from "./e2e-constants";

const MCP_BIN = path.join(process.cwd(), "bin", "ikran-mcp.mjs");
const URL_RE = /^http:\/\/127\.0\.0\.1:\d+\/\?session=[a-f0-9]{32,}$/;

// Extract structuredContent from a CallToolResult as a loose record. The SDK
// result is a rich union; narrow loosely from `unknown` so this compiles without
// depending on the exact content-block type shape.
function sc(res: unknown): Record<string, unknown> {
  if (typeof res === "object" && res !== null) {
    const r = res as { structuredContent?: unknown };
    if (r.structuredContent && typeof r.structuredContent === "object") {
      return r.structuredContent as Record<string, unknown>;
    }
  }
  return {};
}

function projectPath(s: Record<string, unknown>): string {
  const project = s.project as { path?: string } | null | undefined;
  return project?.path ?? "";
}

// Kill a Runtime recorded in runtime-endpoint.json (best-effort group kill),
// so a leaked MCP-spawned Next does not outlive the test.
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

// Spawn the MCP server with a real stdio client. If `rootsProvider` is given,
// the client declares the `roots` capability and responds to `roots/list` with
// those roots (simulating Cursor exposing its workspace folders via MCP Roots).
async function spawnMcpClient(
  stateDir: string,
  rootsProvider?: () => { uri: string; name?: string }[]
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
    { capabilities: rootsProvider ? { roots: {} } : {} }
  );
  if (rootsProvider) {
    client.setRequestHandler(ListRootsRequestSchema, async () => ({
      roots: rootsProvider().map((r) => ({ uri: r.uri, name: r.name }))
    }));
  }
  await client.connect(transport);
  return { client, transport };
}

test.describe("Ikran Issue 02/02 — create_or_open_project MCP tool", () => {
  test(
    "MCP and HTTP share one project/session; fail-closed on mismatch; no-token rejected; refresh recovers",
    async ({ page }) => {
      test.setTimeout(150_000);

      const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-mcp-proj-"));
      const dirA = mkdtempSync(path.join(tmpdir(), "ikran-proj-a-"));
      const dirB = mkdtempSync(path.join(tmpdir(), "ikran-proj-b-"));
      let client: Client | null = null;
      let transport: StdioClientTransport | null = null;

      try {
        transport = new StdioClientTransport({
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
        client = new Client(
          { name: "ikran-e2e", version: "0.0.0" },
          { capabilities: {} }
        );
        await client.connect(transport);

        // 1. Both tools are discoverable.
        const tools = await client.listTools();
        const names = tools.tools.map((t) => t.name);
        expect(names).toContain("open_workbench");
        expect(names).toContain("create_or_open_project");

        // 2. CREATE: bind dirA (no active project). The MCP tool proxies to the
        // HTTP /api/project/bind route, which creates .ikran/ + SQLite + events
        // and sets the active-project pointer.
        const create = await client.callTool({
          name: "create_or_open_project",
          arguments: { path: dirA }
        });
        const createSc = sc(create);
        expect(createSc.ok).toBe(true);
        expect(projectPath(createSc)).toBe(dirA);
        const events = createSc.events as { project_created: string; folder_selected: string };
        expect(events.project_created).toBeTruthy();
        expect(events.folder_selected).toBeTruthy();
        expect(typeof createSc.session).toBe("string");
        expect(String(createSc.workbench_url)).toMatch(URL_RE);
        const token = createSc.session as string;
        const workbenchUrl = createSc.workbench_url as string;
        const port = Number(workbenchUrl.match(/127\.0\.0\.1:(\d+)\//)?.[1]);
        expect(port).toBeGreaterThan(0);

        // .ikran basis was created.
        expect(existsSync(path.join(dirA, ".ikran", "config.json"))).toBe(true);
        expect(existsSync(path.join(dirA, ".ikran", "ikran.db"))).toBe(true);
        expect(existsSync(path.join(dirA, ".ikran", "events.jsonl"))).toBe(true);

        // SQLite events table has the recorded events.
        const { DatabaseSync } = require("node:sqlite");
        const db = new DatabaseSync(path.join(dirA, ".ikran", "ikran.db"));
        const eventCount = db.prepare("SELECT COUNT(*) as c FROM events").get().c;
        expect(eventCount).toBeGreaterThanOrEqual(2);
        db.close();

        // events.jsonl contains project_created + folder_selected.
        const jsonl = readFileSync(path.join(dirA, ".ikran", "events.jsonl"), "utf-8");
        const types = jsonl
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => (JSON.parse(line) as { type: string }).type);
        expect(types).toContain("project_created");
        expect(types).toContain("folder_selected");

        // 3. OPEN idempotent: binding the SAME folder again succeeds (open).
        const reopen = await client.callTool({
          name: "create_or_open_project",
          arguments: { path: dirA }
        });
        const reopenSc = sc(reopen);
        expect(reopenSc.ok).toBe(true);
        expect(projectPath(reopenSc)).toBe(dirA);

        // 4. FAIL CLOSED: a different project (dirB) is requested while dirA is
        // active. The MCP tool must NOT switch and must NOT create dirB/.ikran.
        const mismatch = await client.callTool({
          name: "create_or_open_project",
          arguments: { path: dirB }
        });
        const mismatchSc = sc(mismatch);
        expect(mismatchSc.ok).toBe(false);
        expect(mismatchSc.error).toBe("project_mismatch");
        expect(mismatchSc.expected).toBe(dirB);
        expect(mismatchSc.active).toBe(dirA);
        expect(existsSync(path.join(dirB, ".ikran"))).toBe(false);

        // 5. OPEN current (no path): read-only, returns the active project +
        // the same session.
        const openCurrent = await client.callTool({
          name: "create_or_open_project",
          arguments: {}
        });
        const openSc = sc(openCurrent);
        expect(openSc.ok).toBe(true);
        expect(projectPath(openSc)).toBe(dirA);
        expect(openSc.session).toBe(token);

        // 6. HTTP-side switch still works (the designer's path) and the MCP tool
        // follows the SAME binding. Switch to dirB via the HTTP API directly.
        const switchRes = await fetch(`http://127.0.0.1:${port}/api/project/bind`, {
          method: "POST",
          headers: {
            host: `127.0.0.1:${port}`,
            "x-ikran-session": token,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ path: dirB })
        });
        expect(switchRes.status).toBe(200);
        const switchBody = (await switchRes.json()) as { ok: boolean; project: { path: string } };
        expect(switchBody.ok).toBe(true);
        expect(switchBody.project.path).toBe(dirB);

        // The MCP tool now sees dirB (the shared binding) — OPEN idempotent.
        const seeB = await client.callTool({
          name: "create_or_open_project",
          arguments: { path: dirB }
        });
        const seeBSc = sc(seeB);
        expect(seeBSc.ok).toBe(true);
        expect(projectPath(seeBSc)).toBe(dirB);

        // Mismatch now goes the other way (active is dirB; requesting dirA fails).
        const mismatch2 = await client.callTool({
          name: "create_or_open_project",
          arguments: { path: dirA }
        });
        const mismatch2Sc = sc(mismatch2);
        expect(mismatch2Sc.ok).toBe(false);
        expect(mismatch2Sc.error).toBe("project_mismatch");
        expect(mismatch2Sc.active).toBe(dirB);
        expect(mismatch2Sc.expected).toBe(dirA);

        // 7. No-token requests are rejected at the HTTP boundary (403).
        const noTokenGet = await fetch(`http://127.0.0.1:${port}/api/project`);
        expect(noTokenGet.status).toBe(403);
        const noTokenBind = await fetch(`http://127.0.0.1:${port}/api/project/bind`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: dirA })
        });
        expect(noTokenBind.status).toBe(403);

        // 8. Refresh recovery through an MCP-initiated binding (active = dirB):
        // opening the Workbench URL and reloading recovers the bound project.
        await page.goto(workbenchUrl);
        await expect(page.getByText("Project set up...")).toBeVisible();
        await expect(page.getByTestId("runtime-helper")).toContainText(
          "Local runtime connected"
        );
        await page.reload();
        await expect(page.getByTestId("folder-helper")).toContainText(
          `Complete! ${dirB}`
        );
        await expect(page.getByTestId("project-path")).toHaveText(dirB);
      } finally {
        try {
          await client?.close();
        } catch {
          /* ignore */
        }
        killRecordedRuntime(stateDir);
        rmSync(stateDir, { recursive: true, force: true });
        rmSync(dirA, { recursive: true, force: true });
        rmSync(dirB, { recursive: true, force: true });
      }
    }
  );

  test(
    "roots/list discovery: create_or_open_project({}) binds the client's workspace root; list_working_folders reports it",
    async () => {
      test.setTimeout(150_000);

      const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-mcp-roots-"));
      const dir = mkdtempSync(path.join(tmpdir(), "ikran-roots-ws-"));
      let client: Client | null = null;
      try {
        const handle = await spawnMcpClient(stateDir, () => [
          { uri: pathToFileURL(dir).href, name: "ikran-test-workspace" }
        ]);
        client = handle.client;

        const names = (await client.listTools()).tools.map((t) => t.name);
        expect(names).toContain("list_working_folders");

        // list_working_folders reports the discovered root BEFORE binding.
        const list = await client.callTool({
          name: "list_working_folders",
          arguments: {}
        });
        const listSc = sc(list);
        expect(listSc.ok).toBe(true);
        expect(listSc.folder).toBe(dir);
        expect(listSc.source).toBe("roots");
        expect(Array.isArray(listSc.roots)).toBe(true);

        // create_or_open_project({}) with no path -> discovers the root -> CREATE.
        const created = await client.callTool({
          name: "create_or_open_project",
          arguments: {}
        });
        const createdSc = sc(created);
        expect(createdSc.ok).toBe(true);
        expect(projectPath(createdSc)).toBe(dir);
        expect(
          (createdSc.events as { project_created: string }).project_created
        ).toBeTruthy();

        // .ikran created in the discovered workspace folder.
        expect(existsSync(path.join(dir, ".ikran", "config.json"))).toBe(true);
        expect(existsSync(path.join(dir, ".ikran", "ikran.db"))).toBe(true);
        expect(existsSync(path.join(dir, ".ikran", "events.jsonl"))).toBe(true);

        // A second no-path call now OPENs idempotently (active == discovered).
        const reopened = await client.callTool({
          name: "create_or_open_project",
          arguments: {}
        });
        expect(sc(reopened).ok).toBe(true);
        expect(projectPath(sc(reopened))).toBe(dir);
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
    "no roots, no env, no active -> create_or_open_project({}) returns no_working_folder; list_working_folders reports none",
    async () => {
      test.setTimeout(150_000);

      const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-mcp-noroots-"));
      let client: Client | null = null;
      try {
        const handle = await spawnMcpClient(stateDir); // no roots provider
        client = handle.client;

        const list = await client.callTool({
          name: "list_working_folders",
          arguments: {}
        });
        const listSc = sc(list);
        expect(listSc.ok).toBe(true);
        expect(listSc.folder).toBeNull();
        expect(listSc.source).toBe("none");

        const res = await client.callTool({
          name: "create_or_open_project",
          arguments: {}
        });
        const resSc = sc(res);
        expect(resSc.ok).toBe(false);
        expect(resSc.error).toBe("no_working_folder");
      } finally {
        try {
          await client?.close();
        } catch {
          /* ignore */
        }
        killRecordedRuntime(stateDir);
        rmSync(stateDir, { recursive: true, force: true });
      }
    }
  );

  test(
    "setup_workspace({ path }) returns the per-project MCP config snippet (cwd + IKRAN_STATE_DIR); does not write a file",
    async () => {
      const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-mcp-setup-"));
      const dir = mkdtempSync(path.join(tmpdir(), "ikran-setup-ws-"));
      let client: Client | null = null;
      try {
        const handle = await spawnMcpClient(stateDir); // no roots needed; no Runtime spawn
        client = handle.client;

        const names = (await client.listTools()).tools.map((t) => t.name);
        expect(names).toContain("setup_workspace");

        const res = await client.callTool({
          name: "setup_workspace",
          arguments: { path: dir }
        });
        const r = sc(res);
        expect(r.ok).toBe(true);
        expect(r.path).toBe(dir);
        expect(r.exists).toBe(true);
        expect(r.mcp_json_path).toBe(path.join(dir, ".cursor", "mcp.json"));

        const entry = (
          r.config as {
            mcpServers: {
              ikran: {
                cwd: string;
                command: string;
                args: string[];
                env: { IKRAN_HOST: string; IKRAN_STATE_DIR: string };
              };
            };
          }
        ).mcpServers.ikran;
        expect(entry.cwd).toBe(dir);
        expect(entry.command).toBe("node");
        expect(entry.args[0]).toBe(path.join(process.cwd(), "bin", "ikran-mcp.mjs"));
        expect(entry.args).toContain("--prod"); // spawned with --prod
        expect(entry.env.IKRAN_HOST).toBe("127.0.0.1");
        expect(entry.env.IKRAN_STATE_DIR).toBe(path.join(dir, ".ikran"));

        // The tool does NOT write the file (the Agent writes it).
        expect(existsSync(path.join(dir, ".cursor", "mcp.json"))).toBe(false);
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