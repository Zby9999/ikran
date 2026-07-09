import http from "node:http";
import { expect, test as base } from "./fixtures";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Issue 02/04 — tldraw Workbench shell + seed entry.
//
// The new seed entry path is:
//   EnterPanel -> POST /api/seed-reference -> seed_references record
//               -> tldraw projection
//
// These tests migrated from the React Flow + `seed_evidence_import` spec. They
// assert the tldraw shell, the semantic record-write boundary, the one-way
// projection (record id carried on the shape), refresh-rebuild from GET
// records, polling for Agent-written records, and that the legacy
// `/api/tasks` / `seed_evidence_import` path is NOT used by the new UI.

const test = base.extend<{ folder: string }>({
  folder: async ({}, use) => {
    const folder = mkdtempSync(path.join(tmpdir(), "ikran-e2e-04-"));
    await use(folder);
    rmSync(folder, { recursive: true, force: true });
  }
});

const REAL_FIGMA_SEED_REFERENCE =
  "https://www.figma.com/design/FSgnAj1yrNlgDCt4V4wTfa/recursive-design-agent?node-id=177-426&t=RC4FGd8KwNfX6uqP-11";

function rawPost(
  route: string,
  body: unknown,
  headers: Record<string, string>,
  port: number
): Promise<{ status: number; body: string }> {
  return new Promise((resolve) => {
    const json = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: route,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(json),
          host: `localhost:${port}`,
          ...headers
        }
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      }
    );
    req.on("error", () => resolve({ status: 0, body: "" }));
    req.write(json);
    req.end();
  });
}

async function captureToken(
  page: import("@playwright/test").Page,
  baseURL: string
): Promise<string> {
  let sessionToken: string | null = null;
  await page.route("**/api/**", async (route) => {
    const token = route.request().headers()["x-ikran-session"];
    if (token) {
      sessionToken = token;
    }
    await route.continue();
  });
  await page.goto(baseURL + "/");
  await expect(page.getByTestId("runtime-helper")).toContainText(
    "Local runtime connected"
  );
  await page.unroute("**/api/**");
  if (!sessionToken) {
    throw new Error("Runtime session token was not captured from the UI request");
  }
  return sessionToken;
}

async function bindFolder(
  token: string,
  folder: string,
  port: number
): Promise<void> {
  const res = await rawPost(
    "/api/project/bind",
    { path: folder },
    { "x-ikran-session": token },
    port
  );
  expect(res.status).toBe(200);
  expect(JSON.parse(res.body).ok).toBe(true);
}

function readEvents(folder: string): { type: string; payload: Record<string, unknown> }[] {
  const file = `${folder}/.ikran/events.jsonl`;
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function readSeedReferences(folder: string): Array<{
  id: string;
  figma_seed_reference: string;
  original_design_intent: string;
}> {
  const dbPath = path.join(folder, ".ikran", "ikran.db");
  if (!existsSync(dbPath)) return [];
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(dbPath);
  try {
    return db
      .prepare("SELECT * FROM seed_references ORDER BY created_at ASC")
      .all() as Array<{
      id: string;
      figma_seed_reference: string;
      original_design_intent: string;
    }>;
  } finally {
    db.close();
  }
}

// Drive the UI to the tldraw Workbench: connect the Codex agent (unless it is
// already connected, e.g. restored after a reload), then Start Building.
// Reused across tests so each test starts from a bound project.
async function enterWorkbench(page: import("@playwright/test").Page) {
  // Wait for the project to be bound — the agent chips only enable after a
  // project is bound, and Start Building needs a bound project + agent.
  await expect(page.getByTestId("project-path")).toHaveText(/.+/, {
    timeout: 15000
  });

  // The Codex chip may already be connected (aria-pressed="true") if the agent
  // connection was restored after a reload. Only click to connect when it is
  // not already pressed; clicking a selected chip is a no-op (it is disabled).
  const codex = page.getByRole("button", { name: "Codex" });
  const pressed = await codex.getAttribute("aria-pressed");
  if (pressed !== "true") {
    await codex.click();
  }
  await expect(page.getByTestId("agent-helper")).toContainText("Codex connected");
  await page.getByRole("button", { name: "Start Building" }).click();
  await expect(page.getByTestId("seed-workbench")).toBeVisible();
}

test.describe("Ikran Issue 02/04 — tldraw Workbench shell + seed entry", () => {
  test.beforeEach(async ({ runtime }) => {
    // Reset the Runtime-global active-project pointer so no test inherits
    // state from a previous test in the same worker.
    rmSync(path.join(runtime.stateDir, "runtime-state.json"), { force: true });
  });

  test("Start Building opens a tldraw canvas (not React Flow); EnterPanel submits a Figma seed reference that the Runtime records and tldraw projects", async ({
    page,
    runtime,
    folder
  }) => {
    const token = await captureToken(page, runtime.baseURL);
    await bindFolder(token, folder, runtime.port);

    // Track legacy endpoints so we can prove the new path never uses them.
    const tasksRequests: string[] = [];
    const figmaValidateRequests: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (url.includes("/api/tasks")) tasksRequests.push(url);
      if (url.includes("/api/figma/validate")) figmaValidateRequests.push(url);
    });

    await page.reload();
    await enterWorkbench(page);

    const workbench = page.getByTestId("seed-workbench");
    await expect(workbench).toHaveAttribute("data-canvas-engine", "tldraw");
    await expect(workbench).toHaveAttribute("data-enter-masked", "true");

    // The React Flow seed surface is gone.
    await expect(workbench.locator("svg.react-flow__background")).toHaveCount(0);
    await expect(workbench.locator(".react-flow__viewport")).toHaveCount(0);

    // The tldraw canvas 底座 is present.
    await expect(page.getByTestId("workbench-canvas")).toBeVisible();
    await expect(workbench.locator(".tl-container")).toBeVisible();

    // EnterPanel is the seed entry surface (default "+" state).
    const enterPanel = page.getByTestId("enter-panel");
    await expect(enterPanel).toBeVisible();
    await expect(enterPanel).toHaveAttribute("data-state", "default");

    await page.getByTestId("seed-add-button").click();
    await expect(enterPanel).toHaveAttribute("data-state", "address");

    const seedInput = page.getByTestId("figma-seed-reference-input");
    await seedInput.fill(REAL_FIGMA_SEED_REFERENCE);
    // Confirm the address with Enter -> validating -> description.
    await seedInput.press("Enter");
    await expect(enterPanel).toHaveAttribute("data-state", "description");
    await expect(page.getByTestId("original-design-intent-input")).toBeVisible();

    const intent = "UI test intent: tldraw projects a Runtime seed record.";
    await page.getByTestId("original-design-intent-input").fill(intent);

    await page.getByRole("button", { name: "Enter Canvas" }).click();

    // The Runtime recorded the seed reference and tldraw projects it.
    const projection = page.getByTestId("seed-reference-projection");
    await expect(projection).toBeVisible();
    const runtimeRecordId = await projection.getAttribute("data-runtime-record-id");
    expect(runtimeRecordId).toBeTruthy();
    const canvasRecordId = await projection.getAttribute("data-canvas-record-id");
    expect(canvasRecordId).toMatch(/^seed-reference:.+$/);
    await expect(projection.getByTestId("seed-reference-projection-url")).toContainText(
      "RC4FGd8KwNfX6uqP-11"
    );
    await expect(projection.getByTestId("seed-reference-projection-intent")).toContainText(
      "UI test intent"
    );

    // The projection's canvas-record-id ties the shape back to the record id.
    expect(canvasRecordId).toBe(`seed-reference:${runtimeRecordId}`);

    // The Runtime source-of-truth has the record, URL stored verbatim.
    const records = readSeedReferences(folder);
    expect(records.length).toBe(1);
    expect(records[0].id).toBe(runtimeRecordId);
    expect(records[0].figma_seed_reference).toBe(REAL_FIGMA_SEED_REFERENCE);
    expect(records[0].original_design_intent).toBe(intent);

    // A seed_reference_registered semantic event was logged.
    const types = readEvents(folder).map((e) => e.type);
    expect(types).toContain("seed_reference_registered");

    // The legacy seed_evidence_import / figma validate paths were NOT used.
    expect(types).not.toContain("seed_evidence_import_started");
    expect(types).not.toContain("figma_evidence_package_returned");
    expect(tasksRequests).toEqual([]);
    expect(figmaValidateRequests).toEqual([]);

    // With a record present, the EnterPanel entry overlay is dismissed.
    await expect(workbench).toHaveAttribute("data-enter-masked", "false");
  });

  test("refresh rebuilds the tldraw projection from Runtime records (GET /api/seed-reference)", async ({
    page,
    runtime,
    folder
  }) => {
    const token = await captureToken(page, runtime.baseURL);
    await bindFolder(token, folder, runtime.port);

    // Simulate a real Agent writing a seed reference through the semantic
    // boundary (POST /api/seed-reference), then visit the Workbench. The UI
    // must rebuild the projection from GET records — NOT from a persisted
    // tldraw store (geometry is not persisted).
    const intent = "Agent-written seed: editorial portfolio system.";
    const res = await rawPost(
      "/api/seed-reference",
      { figmaSeedReference: REAL_FIGMA_SEED_REFERENCE, originalDesignIntent: intent },
      { "x-ikran-session": token },
      runtime.port
    );
    expect(res.status).toBe(200);
    const record = JSON.parse(res.body).record as { id: string };
    expect(record.id).toBeTruthy();

    const recordsBefore = readSeedReferences(folder);
    expect(recordsBefore[0].figma_seed_reference).toBe(REAL_FIGMA_SEED_REFERENCE);

    await page.reload();
    await enterWorkbench(page);

    const workbench = page.getByTestId("seed-workbench");
    // A record already exists, so the EnterPanel entry overlay is NOT shown —
    // the canvas shows the projection rebuilt from the record.
    await expect(workbench).toHaveAttribute("data-enter-masked", "false");
    await expect(workbench.locator("svg.react-flow__background")).toHaveCount(0);

    const projection = page.getByTestId("seed-reference-projection");
    await expect(projection).toBeVisible();
    await expect(projection).toHaveAttribute(
      "data-runtime-record-id",
      record.id
    );
    await expect(projection).toHaveAttribute(
      "data-canvas-record-id",
      `seed-reference:${record.id}`
    );

    // The record still exists in the DB (source of truth survives refresh;
    // only tldraw geometry was reset).
    const recordsAfter = readSeedReferences(folder);
    expect(recordsAfter.length).toBe(1);
    expect(recordsAfter[0].id).toBe(record.id);

    // A hard page reload rebuilds the projection again from the same record.
    await page.reload();
    await enterWorkbench(page);
    await expect(page.getByTestId("seed-reference-projection")).toBeVisible();
    await expect(page.getByTestId("seed-reference-projection")).toHaveAttribute(
      "data-runtime-record-id",
      record.id
    );
  });

  test("an Agent-written seed reference appears via light polling without a manual refresh", async ({
    page,
    runtime,
    folder
  }) => {
    const token = await captureToken(page, runtime.baseURL);
    await bindFolder(token, folder, runtime.port);

    await page.reload();
    await enterWorkbench(page);

    const workbench = page.getByTestId("seed-workbench");
    // No records yet -> the EnterPanel entry overlay is shown.
    await expect(workbench).toHaveAttribute("data-enter-masked", "true");

    // A real Agent registers a seed reference via the semantic boundary while
    // the Workbench is open. The hook's light polling should pick it up.
    await rawPost(
      "/api/seed-reference",
      {
        figmaSeedReference: REAL_FIGMA_SEED_REFERENCE,
        originalDesignIntent: "Polled agent seed reference."
      },
      { "x-ikran-session": token },
      runtime.port
    );

    await expect
      .poll(async () => {
        const p = page.getByTestId("seed-reference-projection");
        return (await p.count()) > 0 ? await p.getAttribute("data-runtime-record-id") : null;
      })
      .toBeTruthy();

    // The overlay dismisses once a record exists.
    await expect(workbench).toHaveAttribute("data-enter-masked", "false");
    expect(readSeedReferences(folder).length).toBe(1);
  });

  test("address field stays editable while typing and only confirms on Enter; non-Figma URLs are rejected at the gate", async ({
    page,
    runtime,
    folder
  }) => {
    const token = await captureToken(page, runtime.baseURL);
    await bindFolder(token, folder, runtime.port);
    await page.reload();
    await enterWorkbench(page);

    const enterPanel = page.getByTestId("enter-panel");
    await page.getByTestId("seed-add-button").click();
    await expect(enterPanel).toHaveAttribute("data-state", "address");

    const seedInput = page.getByTestId("figma-seed-reference-input");
    // Typing char-by-char must NOT lock the field out of address.
    await seedInput.type(REAL_FIGMA_SEED_REFERENCE);
    await expect(enterPanel).toHaveAttribute("data-state", "address");
    await expect(seedInput).toBeEditable();

    // Enter confirms -> description (read-only confirmed input).
    await seedInput.press("Enter");
    await expect(enterPanel).toHaveAttribute("data-state", "description");
    await expect(page.getByTestId("figma-seed-reference-input")).not.toBeEditable();

    // A non-Figma URL is rejected at the local gate: no description, no
    // projection, and no Runtime record.
    await page.reload();
    await enterWorkbench(page);
    await page.getByTestId("seed-add-button").click();
    const seedInput2 = page.getByTestId("figma-seed-reference-input");
    await seedInput2.fill("not a figma link");
    await seedInput2.press("Enter");
    await expect(page.getByTestId("enter-panel")).toHaveAttribute("data-state", "address");
    await expect(seedInput2).toBeEditable();
    await expect(page.getByTestId("original-design-intent-input")).toHaveCount(0);
    await expect(page.getByTestId("seed-reference-projection")).toHaveCount(0);
    expect(readSeedReferences(folder).length).toBe(0);
  });

  test("clearing the confirmed Figma address returns to the default plus state", async ({
    page,
    runtime,
    folder
  }) => {
    const token = await captureToken(page, runtime.baseURL);
    await bindFolder(token, folder, runtime.port);
    await page.reload();
    await enterWorkbench(page);

    const enterPanel = page.getByTestId("enter-panel");
    await page.getByTestId("seed-add-button").click();
    const seedInput = page.getByTestId("figma-seed-reference-input");
    await seedInput.fill(REAL_FIGMA_SEED_REFERENCE);
    await seedInput.press("Enter");
    await expect(enterPanel).toHaveAttribute("data-state", "description");
    await page.getByTestId("original-design-intent-input").fill("Intent to clear");

    const confirmedRow = page.locator(".enter-panel__field-row--confirmed");
    await confirmedRow.hover();
    await page.getByTestId("figma-seed-reference-clear").click();

    await expect(enterPanel).toHaveAttribute("data-state", "default");
    await expect(page.getByTestId("seed-add-button")).toBeVisible();
    await expect(page.getByTestId("original-design-intent-input")).toHaveCount(0);
    expect(readSeedReferences(folder).length).toBe(0);
  });

  test("Runtime validation failure returns EnterPanel to an editable state and writes no projection", async ({
    page,
    runtime,
    folder
  }) => {
    const token = await captureToken(page, runtime.baseURL);
    await bindFolder(token, folder, runtime.port);
    await page.reload();
    await enterWorkbench(page);

    const enterPanel = page.getByTestId("enter-panel");
    await page.getByTestId("seed-add-button").click();
    const seedInput = page.getByTestId("figma-seed-reference-input");
    await seedInput.fill(REAL_FIGMA_SEED_REFERENCE);
    await seedInput.press("Enter");
    await expect(enterPanel).toHaveAttribute("data-state", "description");
    await page
      .getByTestId("original-design-intent-input")
      .fill("intent for validation failure test");

    // Runtime is the authority at POST time (no /api/figma/validate). Mock
    // POST /api/seed-reference to return a structured validation error (only
    // POST; let GET polling pass through).
    await page.route("**/api/seed-reference", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "invalid_figma_url" })
        });
        return;
      }
      await route.continue();
    });

    await page.getByRole("button", { name: "Enter Canvas" }).click();

    // EnterPanel returns to the editable description state; no projection.
    await expect(enterPanel).toHaveAttribute("data-state", "description");
    await expect(page.getByRole("button", { name: "Enter Canvas" })).toBeVisible();
    await expect(page.getByTestId("seed-reference-projection")).toHaveCount(0);

    // No Runtime record was written (validation failure writes no record).
    expect(readSeedReferences(folder).length).toBe(0);
    const types = readEvents(folder).map((e) => e.type);
    expect(types).not.toContain("seed_reference_registered");

    await page.unroute("**/api/seed-reference");
  });
});