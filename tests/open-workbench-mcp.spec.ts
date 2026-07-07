// Ikran Issue 02/01 — `open_workbench` MCP tool end-to-end.
//
// Spawns `bin/ikran-mcp.mjs` (the minimal MCP stdio server Cursor/Codex would
// spawn), drives it with a real MCP client over stdio, calls `open_workbench`,
// and proves:
//   - the tool is discoverable (listTools);
//   - it returns a `http://127.0.0.1:{port}/?session={token}` URL;
//   - opening that URL in a browser renders the shell + Runtime health + SSE;
//   - a second call REUSES the already-running Runtime (same url, reused=true);
//   - the privileged /api/* surface still rejects a missing token (403).
//
// This test does NOT use the `runtime` fixture: the MCP server spawns its own
// Next HTTP surface (via lib/runtime/runtime-endpoint.mjs openWorkbench). It
// runs against the shared e2e build (SHARED_BUILD_DIR) in --prod mode so the
// first call is fast (the build is produced once by global-setup).

import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { expect, test } from "./fixtures";
import { SHARED_BUILD_DIR } from "./e2e-constants";

const MCP_BIN = path.join(process.cwd(), "bin", "ikran-mcp.mjs");
const URL_RE = /^http:\/\/127\.0\.0\.1:\d+\/\?session=[a-f0-9]{32,}$/;

// Extract { url, reused } from a CallToolResult. The SDK result is a rich
// union; narrow loosely from `unknown` so this compiles without depending on
// the exact content-block type shape. Prefer structuredContent, fall back to a
// regex on the text content block.
function resultInfo(res: unknown): { url: string; reused: boolean } {
  let url = "";
  let reused = false;
  if (typeof res === "object" && res !== null) {
    const r = res as { structuredContent?: unknown; content?: unknown };
    const sc = r.structuredContent;
    if (sc && typeof sc === "object") {
      const s = sc as { url?: unknown; reused?: unknown };
      if (typeof s.url === "string") url = s.url;
      if (typeof s.reused === "boolean") reused = s.reused;
    }
    if (!url && Array.isArray(r.content)) {
      for (const c of r.content) {
        const text = (c as { type?: string; text?: unknown }).text;
        if (typeof text === "string") {
          const m = text.match(/http:\/\/127\.0\.0\.1:\d+\/\?session=[a-f0-9]{32,}/);
          if (m) {
            url = m[0];
            break;
          }
        }
      }
    }
  }
  return { url, reused };
}

// Kill a Runtime recorded in runtime-endpoint.json (best-effort group kill),
// so a leaked MCP-spawned Next does not outlive the test.
function killRecordedRuntime(stateDir: string) {
  try {
    const file = path.join(stateDir, "runtime-endpoint.json");
    const ep = JSON.parse(readFileSync(file, "utf-8")) as {
      pid?: number;
      port?: number;
    };
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

test.describe("Ikran Issue 02/01 — open_workbench MCP tool", () => {
  // Form check (no server spawn): the Workbench URL must be the PRD form.
  // Mirrors lib/runtime/runtime-endpoint.mjs composeWorkbenchUrl, which is
  // also exercised end-to-end below (the returned URL must match URL_RE).
  test("the Workbench URL has the canonical form", async () => {
    // Dynamic-import the REAL composeWorkbenchUrl from the ESM .mjs. A static
    // import would be compiled to require() by the CJS test runner and fail on
    // the .mjs's import.meta; a dynamic import always uses ESM resolution. This
    // guards the actual implementation against regression (not a local copy).
    const { composeWorkbenchUrl } = await import(
      "../lib/runtime/runtime-endpoint.mjs"
    );
    expect(composeWorkbenchUrl("127.0.0.1", 54321, "deadbeef")).toBe(
      "http://127.0.0.1:54321/?session=deadbeef"
    );
    // encodeURIComponent is a no-op on hex tokens today, but assert a non-hex
    // token is still encoded - guards a future token-shape change.
    expect(composeWorkbenchUrl("127.0.0.1", 54321, "a b/c")).toBe(
      "http://127.0.0.1:54321/?session=a%20b%2Fc"
    );
  });

  test(
    "open_workbench returns a Workbench URL that opens the shell; reuse on second call",
    async ({ page }) => {
      test.setTimeout(120_000);

      const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-mcp-e2e-"));
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
          // Capture stderr so the MCP server's [ikran-mcp] logs do not pollute
          // test output. Do NOT inherit stdout (that is the MCP channel).
          stderr: "pipe"
        });
        client = new Client(
          { name: "ikran-e2e", version: "0.0.0" },
          { capabilities: {} }
        );
        await client.connect(transport);

        // The tool is discoverable.
        const tools = await client.listTools();
        const names = tools.tools.map((t) => t.name);
        expect(names).toContain("open_workbench");

        // First call: starts the Runtime and returns a Workbench URL.
        const first = await client.callTool({
          name: "open_workbench",
          arguments: {}
        });
        const info1 = resultInfo(first);
        expect(info1.url).toBeTruthy();
        expect(info1.url).toMatch(URL_RE);

        // Opening the returned URL in a browser renders the session shell and
        // reaches the same-origin Runtime health + SSE.
        await page.goto(info1.url);
        await expect(page.getByText("Project set up...")).toBeVisible();
        await expect(page.getByTestId("runtime-helper")).toContainText(
          "Local runtime connected"
        );
        await expect(page.getByTestId("runtime-service")).toHaveText(
          "ikran-runtime"
        );

        // Second call: reuses the already-running Runtime (same URL, reused=true).
        const second = await client.callTool({
          name: "open_workbench",
          arguments: {}
        });
        const info2 = resultInfo(second);
        expect(info2.url).toBe(info1.url);
        expect(info2.reused).toBe(true);

        // Session enforcement at the API boundary: a request with no token is
        // rejected (403). Parse the port out of the URL for a direct API call.
        const port = Number(info1.url.match(/127\.0\.0\.1:(\d+)\//)?.[1]);
        expect(port).toBeGreaterThan(0);
        const noToken = await fetch(`http://127.0.0.1:${port}/api/health`);
        expect(noToken.status).toBe(403);
      } finally {
        // Tear down: close the client (closes stdio → the MCP server sees stdin
        // end and shuts down, killing the Runtime it spawned). Then best-effort
        // kill any recorded Runtime, and remove the temp state dir.
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
});