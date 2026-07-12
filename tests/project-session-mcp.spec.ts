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

import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { expect, test } from "./fixtures";
import {
  killRecordedRuntime,
  sc,
  spawnMcpClient
} from "./helpers/mcp";

const URL_RE =
  /^http:\/\/127\.0\.0\.1:\d+\/\?session=[a-f0-9]{32,}&view=workbench$/;

function projectPath(s: Record<string, unknown>): string {
  const project = s.project as { path?: string } | null | undefined;
  return project?.path ?? "";
}

/** Compare paths after resolving macOS /var → /private/var symlinks. */
function samePath(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

test.describe("Ikran Issue 02/02 — create_or_open_project MCP tool", () => {
  test(
    "MCP and HTTP share one project/session; fail-closed on mismatch; no-token rejected; refresh recovers",
    async ({ page }) => {
      test.setTimeout(150_000);

      const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-mcp-proj-"));
      const dirA = mkdtempSync(path.join(tmpdir(), "ikran-proj-a-"));
      const dirB = mkdtempSync(path.join(tmpdir(), "ikran-proj-b-"));
      // MCP child cwd ≠ active project so empty-args must return active, not
      // treat discovered cwd as a bind target (regression for project_mismatch).
      const launchCwd = mkdtempSync(path.join(tmpdir(), "ikran-mcp-launch-"));
      let client: Client | null = null;
      let transport: StdioClientTransport | null = null;

      try {
        const handle = await spawnMcpClient(stateDir, {
          cwd: launchCwd,
          env: { IKRAN_CWD: "" }
        });
        client = handle.client;
        transport = handle.transport;

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

        // SQLite events table has the recorded events.
        const { DatabaseSync } = require("node:sqlite");
        const db = new DatabaseSync(path.join(dirA, ".ikran", "ikran.db"));
        const eventCount = db.prepare("SELECT COUNT(*) as c FROM events").get().c;
        expect(eventCount).toBeGreaterThanOrEqual(2);
        const types = (
          db.prepare("SELECT type FROM events ORDER BY id ASC").all() as Array<{
            type: string;
          }>
        ).map((r) => r.type);
        expect(types).toContain("project_created");
        expect(types).toContain("folder_selected");
        db.close();

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

        // 5. OPEN current (no path): returns the active project even when MCP
        // cwd (launchCwd) differs from dirA — must NOT project_mismatch.
        const openCurrent = await client.callTool({
          name: "create_or_open_project",
          arguments: {}
        });
        const openSc = sc(openCurrent);
        expect(openSc.ok).toBe(true);
        expect(openSc.error).toBeUndefined();
        expect(projectPath(openSc)).toBe(dirA);
        expect(openSc.active_project).toBe(dirA);
        expect(openSc.session).toBe(token);

        // 6. HTTP bind also fail-closes on a different path (same Runtime
        // binding as MCP — single-project-single-flow).
        const switchRes = await fetch(`http://127.0.0.1:${port}/api/project/bind`, {
          method: "POST",
          headers: {
            host: `127.0.0.1:${port}`,
            "x-ikran-session": token,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ path: dirB })
        });
        expect(switchRes.status).toBe(409);
        const switchBody = (await switchRes.json()) as {
          ok: boolean;
          error?: string;
        };
        expect(switchBody.ok).toBe(false);
        expect(switchBody.error).toBe("project_mismatch");
        expect(existsSync(path.join(dirB, ".ikran"))).toBe(false);

        // MCP still sees dirA (shared binding unchanged).
        const seeA = await client.callTool({
          name: "create_or_open_project",
          arguments: { path: dirA }
        });
        const seeASc = sc(seeA);
        expect(seeASc.ok).toBe(true);
        expect(projectPath(seeASc)).toBe(dirA);

        // Explicit path to dirB still mismatches while dirA is active.
        const mismatch2 = await client.callTool({
          name: "create_or_open_project",
          arguments: { path: dirB }
        });
        const mismatch2Sc = sc(mismatch2);
        expect(mismatch2Sc.ok).toBe(false);
        expect(mismatch2Sc.error).toBe("project_mismatch");
        expect(mismatch2Sc.active).toBe(dirA);
        expect(mismatch2Sc.expected).toBe(dirB);

        // 7. No-token requests are rejected at the HTTP boundary (403).
        const noTokenGet = await fetch(`http://127.0.0.1:${port}/api/project`);
        expect(noTokenGet.status).toBe(403);
        const noTokenBind = await fetch(`http://127.0.0.1:${port}/api/project/bind`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: dirA })
        });
        expect(noTokenBind.status).toBe(403);

        // 8. Refresh recovery through an MCP-initiated binding (active = dirA).
        await page.goto(workbenchUrl);
        await expect(page.getByText("Project set up...")).toBeVisible();
        await expect(page.getByTestId("runtime-label")).toContainText(
          "Runtime connected"
        );
        await page.reload();
        await expect(page.getByTestId("folder-label")).toContainText(
          `/${path.basename(dirA)} connected`
        );
        await expect(page.getByTestId("project-path")).toHaveText(dirA);
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
        rmSync(launchCwd, { recursive: true, force: true });
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
        const handle = await spawnMcpClient(stateDir, {
          rootsProvider: () => [
            { uri: pathToFileURL(dir).href, name: "ikran-test-workspace" }
          ]
        });
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
    "no roots, no IKRAN_CWD -> discover falls back to process.cwd(); create_or_open_project({}) binds that folder",
    async () => {
      test.setTimeout(150_000);

      const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-mcp-noroots-"));
      const launchCwd = mkdtempSync(path.join(tmpdir(), "ikran-mcp-launch-cwd-"));
      let client: Client | null = null;
      try {
        const handle = await spawnMcpClient(stateDir, {
          // Clear any parent IKRAN_CWD; no roots — discovery must use process.cwd().
          env: { IKRAN_CWD: "" },
          cwd: launchCwd
        });
        client = handle.client;

        const list = await client.callTool({
          name: "list_working_folders",
          arguments: {}
        });
        const listSc = sc(list);
        expect(listSc.ok).toBe(true);
        expect(samePath(String(listSc.folder), launchCwd)).toBe(true);
        expect(listSc.source).toBe("cwd");

        const res = await client.callTool({
          name: "create_or_open_project",
          arguments: {}
        });
        const resSc = sc(res);
        expect(resSc.ok).toBe(true);
        expect(
          samePath(
            (resSc.project as { path?: string } | null)?.path ?? "",
            launchCwd
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
        rmSync(launchCwd, { recursive: true, force: true });
      }
    }
  );

  test(
    "setup_workspace({ path }) returns the per-project MCP config snippet (cwd + IKRAN_CWD + IKRAN_STATE_DIR); does not write a file",
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
                env: {
                  IKRAN_HOST: string;
                  IKRAN_CWD: string;
                  IKRAN_STATE_DIR: string;
                };
              };
            };
          }
        ).mcpServers.ikran;
        expect(entry.cwd).toBe(dir);
        expect(entry.command).toBe("node");
        expect(entry.args[0]).toBe(path.join(process.cwd(), "bin", "ikran-mcp.mjs"));
        expect(entry.args).toContain("--prod"); // spawned with --prod
        expect(entry.env.IKRAN_HOST).toBe("127.0.0.1");
        expect(entry.env.IKRAN_CWD).toBe(dir);
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