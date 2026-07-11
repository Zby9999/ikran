// Ikran Issue 02/01 + Task 9 — `open_workbench` MCP tool end-to-end.
//
// Spawns `bin/ikran-mcp.mjs` (stdio MCP), drives it with a real MCP client,
// calls `open_workbench`, and proves:
//   - the tool is discoverable (listTools);
//   - it returns a `http://127.0.0.1:{port}/?session={token}` URL;
//   - opening that URL in a browser renders the shell + Runtime health + SSE;
//   - a second call REUSES the already-running Runtime (same url, reused=true);
//   - the privileged /api/* surface still rejects a missing token (403);
//   - Task 9 one-process: endpoint.pid === MCP child pid; no Next child;
//   - stdout discipline: list/call still work after HTTP start (Next quiet);
//   - closing the transport releases the port and clears the endpoint file.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { expect, test } from "./fixtures";
import {
  killRecordedRuntime,
  readEndpointFile,
  spawnMcpClient
} from "./helpers/mcp";

const URL_RE = /^http:\/\/127\.0\.0\.1:\d+\/\?session=[a-f0-9]{32,}$/;

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
          const m = text.match(
            /http:\/\/127\.0\.0\.1:\d+\/\?session=[a-f0-9]{32,}/
          );
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

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ host: "127.0.0.1", port }, () => {
      sock.end();
      resolve(true);
    });
    sock.on("error", () => resolve(false));
  });
}

/** Best-effort: child command lines of mcpPid (macOS/Linux). */
function childCmdlines(mcpPid: number): string[] {
  try {
    const out = execFileSync(
      "ps",
      ["-o", "pid=,command=", "-g", String(mcpPid)],
      { encoding: "utf8" }
    );
    return out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => !l.startsWith(String(mcpPid) + " "));
  } catch {
    return [];
  }
}

test.describe("Ikran Issue 02/01 — open_workbench MCP tool", () => {
  // Canonical URL form is covered in Vitest (tests/unit/http-server-url-ready.test.ts).
  // Do NOT dynamically import lib/runtime/*.mjs from Playwright workers: full-suite
  // runs can hit ESM named-export resolution failures against adjacent .d.mts
  // (e.g. fileLockPath from file-lock.mjs) that do not reproduce in isolation.

  test(
    "first prepare does not steal concurrent MCP JSON-RPC responses",
    async () => {
      test.setTimeout(120_000);

      const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-mcp-concurrent-"));
      let client: Client | null = null;

      try {
        const handle = await spawnMcpClient(stateDir, {
          env: { IKRAN_CWD: process.cwd() }
        });
        client = handle.client;

        const firstOpen = client.callTool({
          name: "open_workbench",
          arguments: {}
        });
        // These requests execute while the first call is importing/preparing
        // Next. Their JSON-RPC replies must stay on stdout, never Next's
        // stderr-routed logging context.
        const concurrentRequests = Array.from({ length: 24 }, (_, index) =>
          index % 2 === 0
            ? client!.listTools()
            : client!.callTool({
                name: "list_working_folders",
                arguments: {}
              })
        );

        const results = await Promise.race([
          Promise.all([firstOpen, ...concurrentRequests]),
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    "concurrent MCP requests timed out during first Next prepare"
                  )
                ),
              30_000
            )
          )
        ]);

        expect(resultInfo(results[0]).url).toMatch(URL_RE);
        for (let index = 1; index < results.length; index += 1) {
          const result = results[index];
          if (index % 2 === 1) {
            expect(
              (result as Awaited<ReturnType<Client["listTools"]>>).tools.length
            ).toBeGreaterThan(0);
          } else {
            expect(result).toBeTruthy();
          }
        }
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
    "open_workbench returns a Workbench URL that opens the shell; reuse on second call",
    async ({ page }) => {
      test.setTimeout(120_000);

      const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-mcp-e2e-"));
      let client: Client | null = null;
      let transport: StdioClientTransport | null = null;
      let mcpPid = 0;

      try {
        const handle = await spawnMcpClient(stateDir);
        client = handle.client;
        transport = handle.transport;
        mcpPid = handle.pid;

        // stdout discipline + discoverability: listTools must succeed over
        // JSON-RPC even after we start the in-process Next HTTP surface.
        const tools = await client.listTools();
        const names = tools.tools.map((t) => t.name);
        expect(names).toContain("open_workbench");

        const first = await client.callTool({
          name: "open_workbench",
          arguments: {}
        });
        const info1 = resultInfo(first);
        expect(info1.url).toBeTruthy();
        expect(info1.url).toMatch(URL_RE);

        // One-process: endpoint pid === MCP child pid; owner=mcp.
        const ep = readEndpointFile(stateDir);
        expect(ep).not.toBeNull();
        expect(ep!.pid).toBe(mcpPid);
        expect(ep!.owner).toBe("mcp");

        // No second Next CLI child under the MCP process group.
        const kids = childCmdlines(mcpPid);
        const nextKids = kids.filter(
          (c) =>
            /\bnext(?:\/dist\/bin\/next)?\b/.test(c) &&
            /\b(?:dev|start)\b/.test(c)
        );
        expect(nextKids, `unexpected Next children:\n${kids.join("\n")}`).toEqual(
          []
        );

        // Protocol still intact after HTTP start (Next must stay quiet on stdout).
        const toolsAfter = await client.listTools();
        expect(toolsAfter.tools.map((t) => t.name)).toContain("open_workbench");

        await page.goto(info1.url);
        await expect(page.getByText("Project set up...")).toBeVisible();
        await expect(page.getByTestId("runtime-helper")).toContainText(
          "Local runtime connected"
        );
        await expect(page.getByTestId("runtime-service")).toHaveText(
          "ikran-runtime"
        );

        const second = await client.callTool({
          name: "open_workbench",
          arguments: {}
        });
        const info2 = resultInfo(second);
        expect(info2.url).toBe(info1.url);
        expect(info2.reused).toBe(true);

        const port = Number(info1.url.match(/127\.0\.0\.1:(\d+)\//)?.[1]);
        expect(port).toBeGreaterThan(0);
        const noToken = await fetch(`http://127.0.0.1:${port}/api/health`);
        expect(noToken.status).toBe(403);

        // Lifecycle: close transport → MCP async-closes HTTP → port free +
        // endpoint cleared.
        await client.close();
        client = null;
        transport = null;

        const deadline = Date.now() + 15_000;
        let released = false;
        while (Date.now() < deadline) {
          if (!(await portOpen(port)) && !existsSync(path.join(stateDir, "runtime-endpoint.json"))) {
            released = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 200));
        }
        expect(
          released,
          "HTTP port / endpoint file not released after MCP transport close"
        ).toBe(true);
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
});
