#!/usr/bin/env node

import fs from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const HASHED_EXTERNAL_PATTERN = /require\(["']([^"']+-[a-f0-9]{12,})["']\)/g;

/**
 * Fail when a portable Next build references a Turbopack external alias that
 * is absent or resolves outside the packaged plugin.
 */
export function assertPortableNextExternals(root) {
  const pluginRoot = fs.realpathSync(path.resolve(root));
  const nextRoot = path.join(pluginRoot, ".next");
  const nextModules = path.join(nextRoot, "node_modules");
  const referencedAliases = new Set();

  for (const file of walkFiles(path.join(nextRoot, "server"))) {
    if (!file.endsWith(".js")) continue;
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(HASHED_EXTERNAL_PATTERN)) {
      referencedAliases.add(match[1]);
    }
  }

  for (const alias of referencedAliases) {
    const candidate = path.join(nextModules, alias);
    const stat = fs.lstatSync(candidate, { throwIfNoEntry: false });
    if (!stat) {
      throw new Error(`Packaged Next build is missing external alias: ${alias}`);
    }
    const resolved = fs.realpathSync(candidate);
    if (resolved !== pluginRoot && !resolved.startsWith(`${pluginRoot}${path.sep}`)) {
      throw new Error(`Packaged Next external alias escapes plugin root: ${alias}`);
    }
  }

  return Object.freeze({ aliases: [...referencedAliases].sort() });
}

/** Exercise the installed-plugin path, including the dynamic project route. */
export async function smokeStudyPlugin({ root, timeoutMs = 30_000 }) {
  const pluginRoot = path.resolve(root);
  const portability = assertPortableNextExternals(pluginRoot);
  const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-study-smoke-state-"));
  const packageDir = fs.realpathSync(
    mkdtempSync(path.join(tmpdir(), "ikran-study-smoke-package-"))
  );
  const projectDir = path.join(packageDir, "workspace-2");
  const wrongProjectDir = fs.realpathSync(
    mkdtempSync(path.join(tmpdir(), "ikran-study-smoke-wrong-"))
  );
  const manifestPath = path.join(packageDir, "STUDY-KIT-MANIFEST.json");
  const mcpBin = path.join(pluginRoot, "bin", "ikran-mcp.mjs");
  let client;
  let transport;
  let workbenchUrl;

  try {
    // Match the packaged Study Kit contract: the portable workspace retains
    // its DB, while machine-specific config.json is intentionally omitted.
    for (const directory of [projectDir, wrongProjectDir]) {
      const projectStateDir = path.join(directory, ".ikran");
      fs.mkdirSync(projectStateDir, { recursive: true });
      fs.writeFileSync(path.join(projectStateDir, "ikran.db"), "");
    }
    const pluginVersion = JSON.parse(
      fs.readFileSync(path.join(pluginRoot, "package.json"), "utf8")
    ).version;
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        package: "ikran-study-plugin-smoke",
        host: "codex",
        plugin: { name: "ikran", version: pluginVersion },
        workspaces: [
          {
            id: "kit-2",
            workspaceNumber: 2,
            displayName: "Workspace 2",
            path: "workspace-2",
            frame: { fileKey: "smoke-file", nodeId: "2:2" }
          }
        ]
      })
    );

    transport = new StdioClientTransport({
      command: process.execPath,
      args: [mcpBin, "--prod", "--study"],
      // Match an installed plugin: the process runs from the plugin cache,
      // and Codex does not expose the user's task workspace through MCP Roots.
      cwd: pluginRoot,
      env: {
        ...process.env,
        // Reproduce a previously selected/wrong Study Kit. The manifest
        // activation below must outrank this stale host workspace.
        IKRAN_CWD: wrongProjectDir,
        IKRAN_STATE_DIR: stateDir,
        IKRAN_HOST: "127.0.0.1",
        IKRAN_IDLE_SHUTDOWN_MS: "5000",
        IKRAN_FIGMA_CREDENTIAL_STORE: "memory",
        IKRAN_FIGMA_API_MODE: "mock"
      },
      stderr: "pipe"
    });
    client = new Client(
      { name: "ikran-study-plugin-smoke", version: "0.1.0" },
      { capabilities: {} }
    );
    await within(client.connect(transport), timeoutMs, "MCP connection");
    const listed = await within(client.listTools(), timeoutMs, "MCP tool list");
    const toolNames = new Set((listed?.tools ?? []).map((tool) => tool.name));
    for (const forbidden of [
      "get_figma_connection_status",
      "connect_figma",
      "disconnect_figma",
      "add_seed_reference",
      "refresh_seed_reference",
      "abandon_project_phase"
    ]) {
      if (toolNames.has(forbidden)) {
        throw new Error(`Study MCP exposed forbidden tool: ${forbidden}`);
      }
    }
    for (const required of [
      "activate_study_workspace",
      "open_workbench",
      "get_effective_design_system",
      "revise_draft_design_system"
    ]) {
      if (!toolNames.has(required)) {
        throw new Error(`Study MCP omitted required tool: ${required}`);
      }
    }
    const discovered = await callToolOk(
      client,
      "list_working_folders",
      {},
      timeoutMs
    );
    if (discovered?.folder !== wrongProjectDir || discovered?.source !== "env") {
      throw new Error(
        `Smoke fixture did not expose the stale workspace: ${JSON.stringify(discovered)}`
      );
    }
    const projectBinding = await callToolOk(
      client,
      "activate_study_workspace",
      { manifestPath, workspaceId: "kit-2" },
      timeoutMs
    );
    if (
      projectBinding?.active_project !== projectDir ||
      projectBinding?.workspace_id !== "kit-2"
    ) {
      throw new Error(
        `Packaged MCP did not activate the manifest workspace: ${JSON.stringify(projectBinding)}`
      );
    }
    const activatedDiscovery = await callToolOk(
      client,
      "list_working_folders",
      {},
      timeoutMs
    );
    if (
      activatedDiscovery?.folder !== projectDir ||
      activatedDiscovery?.source !== "study_manifest"
    ) {
      throw new Error(
        `Manifest workspace did not remain authoritative: ${JSON.stringify(activatedDiscovery)}`
      );
    }
    const opened = await within(
      client.callTool({ name: "open_workbench", arguments: {} }),
      timeoutMs,
      "open_workbench"
    );
    workbenchUrl = resultUrl(opened);
    if (opened?.structuredContent?.active_project !== projectDir) {
      throw new Error(
        `open_workbench did not keep the explicit task workspace: ${JSON.stringify(opened?.structuredContent ?? opened)}`
      );
    }

    const parsed = new URL(workbenchUrl);
    const session = parsed.searchParams.get("session");
    const response = await within(
      fetch(new URL("/api/project", parsed), {
        headers: { "x-ikran-session": session },
        signal: AbortSignal.timeout(timeoutMs)
      }),
      timeoutMs,
      "Workbench project route"
    );
    const body = await response.text();
    if (!response.ok) {
      throw new Error(
        `Packaged Workbench project route failed with HTTP ${response.status}${body ? `: ${body}` : ""}`
      );
    }
    let project;
    try {
      project = JSON.parse(body);
    } catch {
      throw new Error("Packaged Workbench project route returned invalid JSON");
    }
    if (project?.ok !== true || project?.project?.path !== projectDir) {
      throw new Error(`Packaged Workbench project route returned unexpected state: ${body}`);
    }

    const figmaConnectionResponse = await within(
      fetch(new URL("/api/figma-connection", parsed), {
        headers: { "x-ikran-session": session },
        signal: AbortSignal.timeout(timeoutMs)
      }),
      timeoutMs,
      "Study Figma Connection route"
    );
    if (figmaConnectionResponse.status !== 404) {
      throw new Error(
        `Study Figma Connection route must be unavailable; received HTTP ${figmaConnectionResponse.status}`
      );
    }

    return Object.freeze({
      ok: true,
      aliases: portability.aliases,
      route: "/api/project",
      toolCount: toolNames.size,
      figmaConnectionRoute: "unavailable"
    });
  } finally {
    if (workbenchUrl) await boundedCleanup(() => requestStop(workbenchUrl), 5_000);
    if (client) await boundedCleanup(() => client.close(), 5_000);
    else if (transport) await boundedCleanup(() => transport.close(), 5_000);
    await stopRecordedRuntime(stateDir);
    await Promise.all([
      rm(stateDir, { recursive: true, force: true }),
      rm(packageDir, { recursive: true, force: true }),
      rm(wrongProjectDir, { recursive: true, force: true })
    ]);
  }
}

async function callToolOk(client, name, args, timeoutMs) {
  const result = await within(
    client.callTool({ name, arguments: args }),
    timeoutMs,
    name
  );
  if (result?.structuredContent?.ok !== true) {
    throw new Error(`${name} failed: ${JSON.stringify(result?.structuredContent ?? result)}`);
  }
  return result.structuredContent;
}

function resultUrl(result) {
  if (typeof result?.structuredContent?.url === "string") {
    return result.structuredContent.url;
  }
  for (const item of Array.isArray(result?.content) ? result.content : []) {
    if (item?.type !== "text" || typeof item.text !== "string") continue;
    const match = item.text.match(/http:\/\/127\.0\.0\.1:\d+\/\?session=[a-f0-9]{32,}&view=workbench/);
    if (match) return match[0];
  }
  throw new Error("open_workbench returned no URL");
}

async function requestStop(workbenchUrl) {
  const parsed = new URL(workbenchUrl);
  const response = await fetch(new URL("/api/runtime/stop", parsed), {
    method: "POST",
    headers: { "x-ikran-session": parsed.searchParams.get("session") },
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
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  const deadline = Date.now() + 5_000;
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
  } catch {}
}

async function boundedCleanup(task, timeoutMs) {
  try {
    await within(Promise.resolve().then(task), timeoutMs, "study smoke cleanup");
  } catch {}
}

function within(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
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

function* walkFiles(root) {
  if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) yield* walkFiles(file);
    else if (entry.isFile()) yield file;
  }
}

async function main(argv) {
  const rootFlag = argv.find((value) => value.startsWith("--root="));
  const result = await smokeStudyPlugin({
    root: rootFlag ? rootFlag.slice("--root=".length) : process.cwd()
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
