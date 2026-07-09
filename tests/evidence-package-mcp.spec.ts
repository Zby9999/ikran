// Ikran Issue 05 — `record_evidence_package` MCP tool (Task 3 skeleton).
//
// Minimal smoke: tool is registered and discoverable via listTools.
// Full valid/invalid/no-Figma-network e2e coverage is Task 5.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { expect, test } from "./fixtures";
import { SHARED_BUILD_DIR } from "./e2e-constants";

const MCP_BIN = path.join(process.cwd(), "bin", "ikran-mcp.mjs");

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

test.describe("Ikran Issue 05 — record_evidence_package MCP tool", () => {
  test("tool is registered and discoverable via listTools", async () => {
    test.setTimeout(60_000);

    const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-mcp-evidence-"));
    let client: Client | null = null;
    try {
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
      client = new Client(
        { name: "ikran-e2e", version: "0.0.0" },
        { capabilities: {} }
      );
      await client.connect(transport);

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
});
