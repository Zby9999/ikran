// Task 9 — standalone launcher (`bin/ikran.mjs`) one-process smoke.
//
// Proves: launcher starts/reuses the detached persistent Runtime owner and
// exits without taking either the Workbench or MCP surface down.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "./fixtures";
import { SHARED_BUILD_DIR } from "./e2e-constants";
import {
  killRecordedRuntime,
  readEndpointFile,
  spawnMcpClient
} from "./helpers/mcp";

const IKRAN_BIN = path.join(process.cwd(), "bin", "ikran.mjs");

function runLauncher(
  stateDir: string,
  extraArgs: string[] = []
): Promise<{ code: number | null; stdout: string; stderr: string; pid: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [IKRAN_BIN, "--prod", "--no-open", ...extraArgs],
      {
        env: {
          ...process.env,
          IKRAN_STATE_DIR: stateDir,
          IKRAN_HOST: "127.0.0.1",
          IKRAN_NEXT_DIST_DIR: SHARED_BUILD_DIR
        },
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", reject);
    // Legacy launchers stayed alive; keep the timeout as a failure guard.
    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }, 20_000);
    const onReady = () => {
      if (stdout.includes("Workbench URL:")) {
        clearTimeout(timer);
        // The persistent launcher exits by itself after printing the URL.
      }
    };
    child.stdout?.on("data", onReady);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, pid: child.pid ?? 0 });
    });
  });
}

test.describe("Ikran persistent Runtime launcher", () => {
  test("launcher starts the detached Runtime owner and exits", async () => {
    test.setTimeout(90_000);
    const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-launcher-"));
    try {
      const r = await runLauncher(stateDir);
      expect(r.stdout).toMatch(/Workbench URL: http:\/\/127\.0\.0\.1:\d+\/\?session=/);
      expect(r.stdout).toMatch(/Runtime ready \(pid \d+\)/);
      const ep = readEndpointFile(stateDir);
      expect(ep?.owner).toBe("mcp");
      expect(ep?.pid).not.toBe(r.pid);
      expect(existsSync(path.join(stateDir, "runtime-mcp.sock"))).toBe(true);
    } finally {
      killRecordedRuntime(stateDir);
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("launcher reuses live MCP endpoint without becoming a second Runtime", async () => {
    test.setTimeout(120_000);
    const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-launcher-reuse-"));
    let mcpPid = 0;
    try {
      const handle = await spawnMcpClient(stateDir);
      mcpPid = handle.pid;
      const open = await handle.client.callTool({
        name: "open_workbench",
        arguments: {}
      });
      const sc = (open as { structuredContent?: { url?: string; port?: number } })
        .structuredContent;
      expect(sc?.url).toBeTruthy();
      const mcpEp = readEndpointFile(stateDir);
      expect(mcpEp?.pid).not.toBe(mcpPid);
      expect(mcpEp?.owner).toBe("mcp");
      const runtimePid = mcpEp?.pid;

      const r = await runLauncher(stateDir);
      expect(r.stdout).toMatch(/Runtime ready \(pid \d+\)/);
      expect(r.stdout).toContain(sc!.url!);
      // Endpoint remains the same persistent Runtime — bridge pid is irrelevant.
      const epAfter = readEndpointFile(stateDir);
      expect(epAfter?.pid).toBe(runtimePid);
      expect(epAfter?.owner).toBe("mcp");

      await handle.client.close();
    } finally {
      killRecordedRuntime(stateDir);
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
