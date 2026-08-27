#!/usr/bin/env node
import { readFile, rm } from "node:fs/promises";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
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

    await callToolOk(
      client,
      "create_or_open_project",
      { path: projectDir },
      timeoutMs
    );
    const projectResponse = await within(
      fetch(new URL("/api/project", parsed), {
        headers: { "x-ikran-session": session },
        signal: AbortSignal.timeout(timeoutMs)
      }),
      timeoutMs,
      "Workbench project route"
    );
    const projectText = await projectResponse.text();
    if (!projectResponse.ok) {
      throw new ReleasePolicyError(
        "workbench_project_unavailable",
        `Workbench project route failed with HTTP ${projectResponse.status}${projectText ? `: ${projectText}` : ""}`
      );
    }
    let projectState;
    try {
      projectState = JSON.parse(projectText);
    } catch {
      throw new ReleasePolicyError(
        "invalid_workbench_project",
        "Workbench project route returned invalid JSON"
      );
    }
    if (projectState?.ok !== true || projectState?.project?.path !== projectDir) {
      throw new ReleasePolicyError(
        "invalid_workbench_project",
        `Workbench project route returned unexpected state: ${projectText}`
      );
    }
    writePrototypeFixture(projectDir);
    await connectFigmaForSmoke(workbenchUrl, timeoutMs);
    const capturedSeed = await callToolOk(
      client,
      "add_seed_reference",
      {
        figmaSeedReference:
          "https://www.figma.com/design/ReleaseGate/Frame?node-id=1-1",
        referenceNote: "Release-gate prototype"
      },
      timeoutMs
    );
    prepareDraftPhaseFixture(projectDir);
    await callToolOk(client, "confirm_draft_design_system", {}, timeoutMs);
    const seedReferenceId = capturedSeed.record?.id;
    const evidenceVersionId = capturedSeed.surface?.id;
    if (typeof seedReferenceId !== "string" || typeof evidenceVersionId !== "string") {
      throw new ReleasePolicyError(
        "seed_capture_failed",
        `Seed capture returned incomplete lineage: ${JSON.stringify(capturedSeed)}`
      );
    }
    for (const [artifactPath, artifactType] of [
      ["prototype/package.json", "code"],
      ["prototype/server.mjs", "code"],
      ["prototype/index.html", "prototype"]
    ]) {
      await callToolOk(
        client,
        "record_artifact_written",
        {
          path: artifactPath,
          artifactType,
          semanticPurpose: "Release-gate prototype preview fixture."
        },
        timeoutMs
      );
    }
    const preview = await callToolOk(
      client,
      "record_preview",
      {
        runId: "release-gate-run",
        sourceArtifactPath: "prototype/index.html",
        prototypeRoot: "prototype",
        routePath: "/",
        surfaceKey: "release-gate-home",
        name: "Release Gate Home",
        seedReferenceIds: [seedReferenceId],
        evidenceVersionIds: [evidenceVersionId]
      },
      timeoutMs
    );
    if (
      preview.readiness !== "ready" ||
      preview.surface?.readiness !== "ready" ||
      preview.surface?.stale !== false
    ) {
      throw new ReleasePolicyError(
        "prototype_preview_not_ready",
        `Product Kit preview did not settle ready/non-stale: ${JSON.stringify(preview)}`
      );
    }
    await verifyWorkbenchIframe(kitRoot, workbenchUrl, timeoutMs);

    return Object.freeze({
      kit: "product",
      tools: tools.tools.length,
      workbenchOrigin: parsed.origin,
      runtimeService: "ikran-runtime",
      prototypeSurface: "live"
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

async function callToolOk(client, name, args, timeoutMs) {
  const result = await within(
    client.callTool({ name, arguments: args }),
    timeoutMs,
    name
  );
  const structured = result?.structuredContent;
  if (!structured || structured.ok !== true) {
    throw new ReleasePolicyError(
      "product_tool_failed",
      `${name} failed: ${JSON.stringify(structured ?? result)}`
    );
  }
  return structured;
}

function writePrototypeFixture(projectDir) {
  const root = path.join(projectDir, "prototype");
  mkdirSync(path.join(root, "node_modules"), { recursive: true });
  writeFileSync(
    path.join(root, "package.json"),
    `${JSON.stringify({
      name: "ikran-release-gate-preview",
      private: true,
      scripts: { dev: "node server.mjs" }
    })}\n`
  );
  writeFileSync(
    path.join(root, "server.mjs"),
    `import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
http.createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(fs.readFileSync(path.join(root, "index.html"), "utf8"));
}).listen(Number(process.env.PORT), "127.0.0.1");
`
  );
  writeFileSync(
    path.join(root, "index.html"),
    "<!doctype html><html><body><h1 id=\"release-prototype\">Ikran prototype is live</h1></body></html>\n"
  );
}

async function connectFigmaForSmoke(workbenchUrl, timeoutMs) {
  const parsed = new URL(workbenchUrl);
  const response = await fetch(new URL("/api/figma-connection", parsed), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ikran-session": parsed.searchParams.get("session")
    },
    body: JSON.stringify({ token: "figd_ok_release_gate" }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const body = await response.json();
  if (!response.ok || body?.ok !== true || body?.connected !== true) {
    throw new ReleasePolicyError(
      "figma_connection_failed",
      `Release smoke Figma Connection failed: ${JSON.stringify(body)}`
    );
  }
}

/**
 * The product smoke targets the post-Draft preview boundary, not the full
 * Alignment/extraction workflow. Seed/evidence still enter through Runtime;
 * this fixture advances only the audited Draft precondition and records the
 * canonical phase event before exercising confirm_draft_design_system.
 */
function prepareDraftPhaseFixture(projectDir) {
  const db = new DatabaseSync(path.join(projectDir, ".ikran", "ikran.db"));
  try {
    const now = new Date().toISOString();
    db.exec("BEGIN IMMEDIATE");
    db.prepare(
      `UPDATE project_phase SET phase = 'draft_design_system', updated_at = ?
       WHERE singleton = 1`
    ).run(now);
    db.prepare(
      `INSERT INTO events (event_id, type, payload, created_at)
       VALUES (?, 'project_phase_confirmed', ?, ?)`
    ).run(
      randomUUID(),
      JSON.stringify({
        from_phase: "seed",
        phase: "draft_design_system",
        command: "initial_design_system_preparation_completed",
        fixture: "release_gate"
      }),
      now
    );
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Transaction did not start or already rolled back.
    }
    throw error;
  } finally {
    db.close();
  }
}

async function verifyWorkbenchIframe(kitRoot, workbenchUrl, timeoutMs) {
  const playwrightUrl = pathToFileURL(
    path.join(kitRoot, "node_modules", "playwright-core", "index.mjs")
  ).href;
  const { chromium } = await import(playwrightUrl);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(workbenchUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    const tokenInput = page.getByRole("textbox", {
      name: "Figma Personal Access Token"
    });
    const selectTool = page.getByRole("button", { name: "Select (V)" });
    await Promise.race([
      tokenInput.waitFor({ state: "visible", timeout: timeoutMs }),
      selectTool.waitFor({ state: "visible", timeout: timeoutMs })
    ]);
    if (await tokenInput.isVisible()) {
      await tokenInput.fill("figd_ok_release_gate");
      await page.getByRole("button", { name: "Check Figma token" }).click();
      await page.getByRole("button", { name: "Enter Canvas" }).click();
    }
    const iframe = page.getByTestId("prototype-surface-projection-live");
    await iframe.waitFor({ state: "visible", timeout: timeoutMs });
    const heading = iframe.contentFrame().locator("#release-prototype");
    await heading.waitFor({ state: "visible", timeout: timeoutMs });
    if ((await heading.textContent()) !== "Ikran prototype is live") {
      throw new ReleasePolicyError(
        "prototype_iframe_unavailable",
        "Workbench did not render the ready Prototype Surface as a live iframe"
      );
    }
  } finally {
    await browser.close();
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
