#!/usr/bin/env node
import { readFile, rm } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ReleasePolicyError } from "./policy.mjs";

/** Exercise the two public Product Kit surfaces through the extracted MCP bin. */
export async function smokeProductKit({ root, timeoutMs = 120_000 }) {
  const kitRoot = path.resolve(root);
  const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-release-state-"));
  const projectDir = mkdtempSync(path.join(tmpdir(), "ikran-release-project-"));
  const mcpBin = path.join(kitRoot, "bin", "ikran-mcp.mjs");
  let client;
  let transport;
  let workbenchUrl;

  try {
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [mcpBin, "--prod"],
      cwd: projectDir,
      env: {
        ...process.env,
        IKRAN_CWD: projectDir,
        IKRAN_STATE_DIR: stateDir,
        IKRAN_HOST: "127.0.0.1",
        IKRAN_IDLE_SHUTDOWN_MS: "5000",
        IKRAN_FIGMA_CREDENTIAL_STORE: "memory",
        IKRAN_FIGMA_API_MODE: "mock"
      },
      stderr: "pipe"
    });
    client = new Client(
      { name: "ikran-release-gate", version: "0.1.0" },
      { capabilities: {} }
    );
    await within(client.connect(transport), timeoutMs, "MCP connection");
    const tools = await within(client.listTools(), timeoutMs, "MCP tool discovery");
    if (!tools.tools.some((tool) => tool.name === "open_workbench")) {
      throw new ReleasePolicyError(
        "missing_product_tool",
        "Extracted Product Kit does not expose open_workbench"
      );
    }

    const first = await within(
      client.callTool({ name: "open_workbench", arguments: {} }),
      timeoutMs,
      "open_workbench"
    );
    workbenchUrl = resultUrl(first);
    const parsed = new URL(workbenchUrl);
    if (
      parsed.protocol !== "http:" ||
      parsed.hostname !== "127.0.0.1" ||
      !parsed.searchParams.get("session") ||
      parsed.searchParams.get("view") !== "workbench"
    ) {
      throw new ReleasePolicyError(
        "invalid_workbench_url",
        `Extracted Product Kit returned an invalid Workbench URL: ${workbenchUrl}`
      );
    }

    const shell = await within(
      fetch(workbenchUrl, { signal: AbortSignal.timeout(timeoutMs) }),
      timeoutMs,
      "Workbench shell"
    );
    if (!shell.ok || !(await shell.text()).includes("Ikran")) {
      throw new ReleasePolicyError(
        "workbench_shell_unavailable",
        `Workbench shell failed with HTTP ${shell.status}`
      );
    }
    const session = parsed.searchParams.get("session");
    const healthUrl = new URL("/api/health", parsed);
    const health = await within(
      fetch(healthUrl, {
        headers: { "x-ikran-session": session },
        signal: AbortSignal.timeout(timeoutMs)
      }),
      timeoutMs,
      "Runtime health"
    );
    const healthText = await health.text();
    if (!health.ok || !healthText.includes("ikran-runtime")) {
      throw new ReleasePolicyError(
        "runtime_health_unavailable",
        `Runtime health failed with HTTP ${health.status}`
      );
    }

    const second = await within(
      client.callTool({ name: "open_workbench", arguments: {} }),
      timeoutMs,
      "open_workbench reuse"
    );
    if (resultUrl(second) !== workbenchUrl) {
      throw new ReleasePolicyError(
        "runtime_not_reused",
        "A second MCP call did not reuse the Product Kit Runtime"
      );
    }

    return Object.freeze({
      kit: "product",
      tools: tools.tools.length,
      workbenchOrigin: parsed.origin,
      runtimeService: "ikran-runtime"
    });
  } finally {
    const bridgePid = transport?.pid;
    if (workbenchUrl) {
      await boundedCleanup(() => requestStop(workbenchUrl), 5_000);
    }
    const clientClosed = client
      ? await boundedCleanup(() => client.close(), 5_000)
      : false;
    const transportClosed = clientClosed || !transport
      ? clientClosed
      : await boundedCleanup(() => transport.close(), 5_000);
    await stopRecordedRuntime(stateDir);
    if (!transportClosed) await stopProcess(bridgePid, 2_000);
    await Promise.all([
      rm(stateDir, { recursive: true, force: true }),
      rm(projectDir, { recursive: true, force: true })
    ]);
  }
}

function resultUrl(result) {
  const structured = result?.structuredContent;
  if (structured && typeof structured.url === "string") return structured.url;
  for (const item of Array.isArray(result?.content) ? result.content : []) {
    if (item?.type !== "text" || typeof item.text !== "string") continue;
    const match = item.text.match(/http:\/\/127\.0\.0\.1:\d+\/\?session=[a-f0-9]{32,}&view=workbench/);
    if (match) return match[0];
  }
  throw new ReleasePolicyError("missing_workbench_url", "open_workbench returned no URL");
}

async function requestStop(workbenchUrl) {
  const parsed = new URL(workbenchUrl);
  const session = parsed.searchParams.get("session");
  const response = await fetch(new URL("/api/runtime/stop", parsed), {
    method: "POST",
    headers: { "x-ikran-session": session },
    signal: AbortSignal.timeout(5_000)
  });
  if (response.status !== 202) {
    throw new Error(`Runtime stop returned HTTP ${response.status}`);
  }
}

async function stopRecordedRuntime(stateDir) {
  let endpoint;
  try {
    endpoint = JSON.parse(await readFile(path.join(stateDir, "runtime-endpoint.json"), "utf8"));
  } catch {
    return;
  }
  const pid = Number(endpoint?.pid);
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // The isolated Runtime already exited.
  }
}

async function stopProcess(pid, timeoutMs) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // The exact bridge process already exited.
  }
}

async function boundedCleanup(task, timeoutMs) {
  try {
    await within(
      Promise.resolve().then(task),
      timeoutMs,
      "release smoke cleanup"
    );
    return true;
  } catch {
    return false;
  }
}

function within(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new ReleasePolicyError("smoke_timeout", `${label} timed out`)),
      timeoutMs
    );
    timer.unref?.();
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function parseArgs(argv) {
  const args = {};
  for (const token of argv) {
    const separator = token.indexOf("=");
    if (!token.startsWith("--") || separator < 3) {
      throw new Error(`Expected --key=value, received: ${token}`);
    }
    args[token.slice(2, separator)] = token.slice(separator + 1);
  }
  return args;
}

async function main(argv) {
  const args = parseArgs(argv);
  const result = await smokeProductKit({ root: path.resolve(args.root ?? process.cwd()) });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
