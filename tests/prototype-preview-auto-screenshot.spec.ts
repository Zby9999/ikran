// Issue 30 — after the first record_preview, Runtime recaptures Prototype
// Surface screenshots on source edits without another Agent/MCP tool call.
// Workbench follows the existing SSE + screenshot_captured_at cache-bust.

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { expect, test } from "./fixtures";
import { rawGet } from "./helpers/http";
import {
  killRecordedRuntime,
  sc,
  spawnMcpClient
} from "./helpers/mcp";
import { openIkranDb } from "./helpers/db";
import { enterCanvas } from "./helpers/workbench";

const SEED_ID = "seed-auto-shot";
const EVIDENCE_ID = "surface-auto-shot";

function writeMiniPrototype(projectDir: string, heading: string): void {
  const root = path.join(projectDir, "prototype");
  mkdirSync(path.join(root, "node_modules"), { recursive: true });
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "ikran-auto-screenshot-proto",
      private: true,
      scripts: { dev: "node server.mjs" }
    })
  );
  writeFileSync(
    path.join(root, "server.mjs"),
    `import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const port = Number(process.env.PORT || "0");
const index = path.join(path.dirname(fileURLToPath(import.meta.url)), "index.html");
http
  .createServer((_req, res) => {
    const html = fs.readFileSync(index, "utf8");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  })
  .listen(port, "127.0.0.1");
`
  );
  writeFileSync(
    path.join(root, "index.html"),
    `<!doctype html><html><head><title>${heading}</title></head>
<body style="margin:0;background:#f4f0e6;font-family:sans-serif">
  <h1 id="heading">${heading}</h1>
</body></html>
`
  );
}

function seedPrototypeValidation(projectDir: string): void {
  const db = openIkranDb(path.join(projectDir, ".ikran", "ikran.db"));
  try {
    const now = "2026-08-19T00:00:00.000Z";
    db.prepare(
      `INSERT INTO seed_references
       (id, figma_seed_reference, original_design_intent, created_at,
        registered_via, file_key, node_id)
       VALUES (?, ?, ?, ?, 'agent', ?, ?)`
    ).run(
      SEED_ID,
      "https://www.figma.com/design/AutoShot/Frame?node-id=1-1",
      "Auto screenshot reconstruction",
      now,
      "AutoShot",
      "1:1"
    );
    db.prepare(
      `INSERT INTO figma_evidence_surfaces
       (id, seed_reference_id, figma_seed_reference, frame_node_id, frame_name,
        evidence_views_json, created_at)
       VALUES (?, ?, ?, '1:1', 'Landing', '{}', ?)`
    ).run(
      EVIDENCE_ID,
      SEED_ID,
      "https://www.figma.com/design/AutoShot/Frame?node-id=1-1",
      now
    );
    db.prepare(
      `UPDATE project_phase SET phase = 'prototype_validation', updated_at = ?
       WHERE singleton = 1`
    ).run(now);
  } finally {
    db.close();
  }
}

async function listSurfaces(
  port: number,
  token: string
): Promise<Array<Record<string, unknown>>> {
  const result = await rawGet(port, "/api/prototype-surface", {
    host: `127.0.0.1:${port}`,
    "x-ikran-session": token
  });
  expect(result.status).toBe(200);
  const body = JSON.parse(result.body) as {
    ok: boolean;
    records?: Array<Record<string, unknown>>;
  };
  expect(body.ok).toBe(true);
  return body.records ?? [];
}

test("Runtime recaptures the Prototype screenshot after a code edit without another tool call", async ({
  page
}) => {
  test.setTimeout(150_000);

  const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-auto-shot-state-"));
  const projectDir = mkdtempSync(path.join(tmpdir(), "ikran-auto-shot-proj-"));
  let client: Client | null = null;

  try {
    writeMiniPrototype(projectDir, "Version one");
    const handle = await spawnMcpClient(stateDir, { cwd: projectDir });
    client = handle.client;

    const created = sc(
      await client.callTool({
        name: "create_or_open_project",
        arguments: { path: projectDir }
      })
    );
    expect(created.ok).toBe(true);
    const token = String(created.session);
    const workbenchUrl = String(created.workbench_url);
    const port = Number(workbenchUrl.match(/127\.0\.0\.1:(\d+)\//)?.[1]);
    expect(port).toBeGreaterThan(0);

    seedPrototypeValidation(projectDir);

    const declared = sc(
      await client.callTool({
        name: "record_artifact_written",
        arguments: {
          path: "prototype/index.html",
          artifactType: "prototype",
          semanticPurpose: "Mini prototype page for screenshot refresh."
        }
      })
    );
    expect(declared.ok).toBe(true);

    const preview = sc(
      await client.callTool({
        name: "record_preview",
        arguments: {
          runId: "run-auto-shot",
          sourceArtifactPath: "prototype/index.html",
          prototypeRoot: "prototype",
          routePath: "/",
          surfaceKey: "home",
          name: "Home",
          seedReferenceIds: [SEED_ID],
          evidenceVersionIds: [EVIDENCE_ID]
        }
      })
    );
    expect(preview.ok).toBe(true);

    await page.goto(workbenchUrl);
    await enterCanvas(page);
    const live = page.getByTestId("prototype-surface-projection-live");
    await expect(live).toBeVisible({ timeout: 20_000 });
    await expect(live.contentFrame().locator("#heading")).toHaveText(
      "Version one"
    );

    const second = sc(
      await client.callTool({
        name: "record_preview",
        arguments: {
          runId: "run-auto-shot",
          sourceArtifactPath: "prototype/index.html",
          prototypeRoot: "prototype",
          routePath: "/about",
          surfaceKey: "about",
          name: "About",
          seedReferenceIds: [SEED_ID],
          evidenceVersionIds: [EVIDENCE_ID]
        }
      })
    );
    expect(second.ok).toBe(true);

    await expect
      .poll(
        async () => {
          const records = await listSurfaces(port, token);
          return records.every(
            (record) =>
              typeof record.screenshot_captured_at === "string" &&
              record.screenshot_captured_at.length > 0
          );
        },
        { timeout: 60_000 }
      )
      .toBe(true);

    const before = await listSurfaces(port, token);
    const beforeAt = String(before[0]?.screenshot_captured_at);

    const screenshot = page.getByTestId(
      "prototype-surface-projection-screenshot"
    );
    await expect(screenshot.first()).toHaveAttribute("src", /[?&]v=/, {
      timeout: 20_000
    });
    const srcBefore = await screenshot.first().getAttribute("src");
    expect(srcBefore ?? "").toContain("v=");

    writeMiniPrototype(projectDir, "Version two");

    await expect
      .poll(
        async () => {
          const records = await listSurfaces(port, token);
          return records.some(
            (record) => String(record.screenshot_captured_at) !== beforeAt
          );
        },
        { timeout: 60_000 }
      )
      .toBe(true);

    await expect
      .poll(async () => screenshot.first().getAttribute("src"), {
        timeout: 20_000
      })
      .not.toBe(srcBefore);
    const srcAfter = await screenshot.first().getAttribute("src");
    expect(srcAfter ?? "").toContain("v=");
    expect(srcAfter).not.toBe(srcBefore);
  } finally {
    if (client) {
      try {
        await client.close();
      } catch {
        // Already closed.
      }
    }
    killRecordedRuntime(stateDir);
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  }
});
