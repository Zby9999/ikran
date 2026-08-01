// Route tests for GET /api/evidence-screenshot (09C-D02): session gate,
// active-project scoping, and the stored data-URL → image bytes decode.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { NextRequest } from "next/server";

const tmpDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.resetModules();
  delete process.env.IKRAN_STATE_DIR;
});

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DATA_URL = `data:image/png;base64,${PNG_BYTES.toString("base64")}`;

/** Temp state dir + temp bound project whose DB holds one surface row. */
async function setupProject(screenshotDataUrl: string | null) {
  const stateDir = tempDir("ikran-shot-state-");
  const folder = tempDir("ikran-shot-project-");
  process.env.IKRAN_STATE_DIR = stateDir;
  vi.resetModules();

  const { initializeProjectDb } = await import("../../lib/runtime/db");
  const { getProjectDbPath } = await import("../../lib/runtime/paths");
  const project = await import("../../lib/runtime/project");
  const session = await import("../../lib/runtime/session");

  initializeProjectDb(folder);
  const { registerSeedReference } = await import(
    "../../lib/runtime/seed-reference"
  );
  const seed = registerSeedReference(folder, {
    figmaSeedReference: "https://www.figma.com/design/AbCdEf/X?node-id=1:2",
    originalDesignIntent: "route fixture"
  });
  if (!seed.ok) throw new Error(`seed failed: ${seed.reason}`);
  const db = new DatabaseSync(getProjectDbPath(folder));
  db.prepare(
    `INSERT INTO figma_evidence_surfaces (
       id, seed_reference_id, figma_seed_reference,
       frame_node_id, frame_name, frame_bounds_json,
       evidence_views_json, screenshot_artifact_path, screenshot_data_url,
       design_signals_json, surface_bounds_json, created_at, superseded_by
     ) VALUES ('surface-1', ?, 'https://www.figma.com/design/AbCdEf/X?node-id=1:2',
       '1:2', 'Checkout', NULL, '{}', NULL, ?, NULL, NULL,
       '2026-08-01T00:00:00.000Z', NULL)`
  ).run(seed.record.id, screenshotDataUrl);
  db.close();

  project.setActiveProject(folder);
  const now = new Date().toISOString();
  mkdirSync(path.join(folder, ".ikran"), { recursive: true });
  writeFileSync(
    path.join(folder, ".ikran", "config.json"),
    JSON.stringify({
      path: folder,
      name: path.basename(folder),
      created_at: now,
      updated_at: now
    })
  );
  const route = await import("../../app/api/evidence-screenshot/route");
  return { route, token: session.getSessionToken() };
}

function request(url: string, token?: string) {
  const headers: Record<string, string> = { host: "127.0.0.1:3000" };
  if (token) headers["x-ikran-session"] = token;
  return new NextRequest(url, { headers });
}

describe("GET /api/evidence-screenshot", () => {
  test("serves the stored frame screenshot as image bytes", async () => {
    const { route, token } = await setupProject(PNG_DATA_URL);
    const response = await route.GET(
      request("http://127.0.0.1:3000/api/evidence-screenshot?id=surface-1", token)
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG_BYTES);
  });

  test("accepts the session via query param (img src cannot send headers)", async () => {
    const { route, token } = await setupProject(PNG_DATA_URL);
    const response = await route.GET(
      request(
        `http://127.0.0.1:3000/api/evidence-screenshot?id=surface-1&session=${encodeURIComponent(token)}`
      )
    );
    expect(response.status).toBe(200);
  });

  test("rejects an invalid session", async () => {
    const { route } = await setupProject(PNG_DATA_URL);
    const response = await route.GET(
      request(
        "http://127.0.0.1:3000/api/evidence-screenshot?id=surface-1",
        "wrong-token"
      )
    );
    expect(response.status).toBe(403);
  });

  test("unknown surface id and missing screenshot both 404", async () => {
    const { route, token } = await setupProject(null);
    const missing = await route.GET(
      request("http://127.0.0.1:3000/api/evidence-screenshot?id=nope", token)
    );
    expect(missing.status).toBe(404);
    const noScreenshot = await route.GET(
      request("http://127.0.0.1:3000/api/evidence-screenshot?id=surface-1", token)
    );
    expect(noScreenshot.status).toBe(404);
  });

  test("missing id is a client error", async () => {
    const { route, token } = await setupProject(PNG_DATA_URL);
    const response = await route.GET(
      request("http://127.0.0.1:3000/api/evidence-screenshot", token)
    );
    expect(response.status).toBe(400);
  });
});
