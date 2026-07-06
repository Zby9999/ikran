import http from "node:http";
import { expect, test as base } from "./fixtures";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Issue 04 — seed evidence workbench.
//
// Uses the worker-scoped `runtime` fixture ({ baseURL, port, stateDir }) for
// the server origin, and a test-scoped `folder` fixture for the isolated
// project dir. No module-level mutable port/baseURL/testFolder.

const test = base.extend<{ folder: string }>({
  folder: async ({}, use) => {
    const folder = mkdtempSync(path.join(tmpdir(), "ikran-e2e-04-"));
    await use(folder);
    rmSync(folder, { recursive: true, force: true });
  }
});

function rawGet(
  route: string,
  headers: Record<string, string>,
  port: number
): Promise<{ status: number; body: string }> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: route,
        method: "GET",
        headers: { host: `localhost:${port}`, ...headers }
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
    req.end();
  });
}

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

async function postSeedEvidenceTask(
  token: string,
  input: { figmaSeedReference: string; originalDesignIntent: string },
  port: number
): Promise<{ taskId: string }> {
  const res = await rawPost(
    "/api/tasks",
    {
      family: "seed_evidence_import",
      payload: { input, mock: { progressTicks: 1, delayMs: 10 } }
    },
    { "x-ikran-session": token },
    port
  );
  expect(res.status).toBe(201);
  const body = JSON.parse(res.body);
  expect(body.ok).toBe(true);
  return { taskId: body.taskId };
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

test.describe("Ikran Issue 04 — seed evidence workbench", () => {
  test.beforeEach(async ({ runtime }) => {
    // Reset the Runtime-global active-project + connected-agent pointer so no
    // test inherits state from a previous test in the same worker. The pointer
    // is a process-global singleton by design (single-project-single-flow);
    // test isolation = per-worker state dir + this per-test reset. The server
    // re-reads this file from disk on every request, so deleting it is safe.
    rmSync(path.join(runtime.stateDir, "runtime-state.json"), {
      force: true
    });
  });
  test("Runtime creates seed evidence task with seed reference and intent, then returns deterministic evidence package", async ({
    page,
    runtime,
    folder
  }) => {
    const token = await captureToken(page, runtime.baseURL);
    await bindFolder(token, folder, runtime.port);

    const figmaSeedReference =
      "https://www.figma.com/design/FSgnAj1yrNlgDCt4V4wTfa/recursive-design-agent?node-id=133-129&t=issue04-runtime-test";
    const originalDesignIntent =
      "Runtime test intent: editorial black-and-white portfolio system.";

    const { taskId } = await postSeedEvidenceTask(
      token,
      { figmaSeedReference, originalDesignIntent },
      runtime.port
    );

    await expect
      .poll(async () => {
        const detail = await rawGet(`/api/tasks/${taskId}`, {
          "x-ikran-session": token
        }, runtime.port);
        return JSON.parse(detail.body).task.status;
      })
      .toBe("done");

    const detail = await rawGet(`/api/tasks/${taskId}`, {
      "x-ikran-session": token
    }, runtime.port);
    const task = JSON.parse(detail.body).task;
    expect(task.payload.input).toMatchObject({
      figmaSeedReference,
      originalDesignIntent
    });
    expect(task.result.structuredEvidence.source.figmaSeedReference).toBe(
      figmaSeedReference
    );
    expect(task.result.structuredEvidence.source.originalDesignIntent).toBe(
      originalDesignIntent
    );
    expect(task.result.evidenceSurface).toMatchObject({
      kind: "figma",
      title: "Figma Evidence Surface"
    });
    expect(task.result).not.toHaveProperty("annotations");
    expect(task.result).not.toHaveProperty("questionCards");
    expect(task.result).not.toHaveProperty("regionSelections");

    const events = readEvents(folder);
    const types = events.map((event) => event.type);
    expect(types).toContain("seed_evidence_import_started");
    expect(types).toContain("figma_evidence_package_returned");
  });

  test("Runtime rejects seed evidence import without both seed reference and intent", async ({
    page,
    runtime,
    folder
  }) => {
    const token = await captureToken(page, runtime.baseURL);
    await bindFolder(token, folder, runtime.port);

    for (const input of [
      {},
      { figmaSeedReference: "https://www.figma.com/design/example" },
      { originalDesignIntent: "missing the Figma seed URL" },
      { figmaSeedReference: "", originalDesignIntent: "empty seed" },
      { figmaSeedReference: "https://www.figma.com/design/example", originalDesignIntent: "" }
    ]) {
      const res = await rawPost(
        "/api/tasks",
        {
          family: "seed_evidence_import",
          payload: { input, mock: { progressTicks: 1, delayMs: 10 } }
        },
        { "x-ikran-session": token },
        runtime.port
      );
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body).error).toBe("invalid_seed_evidence_input");
    }

    expect(readEvents(folder).map((event) => event.type)).not.toContain(
      "seed_evidence_import_started"
    );
  });

  test("Start building enters a locked React Flow workbench, imports through Enter Panel, and unlocks only after evidence renders", async ({
    page,
    runtime,
    folder
  }) => {
    const token = await captureToken(page, runtime.baseURL);
    await bindFolder(token, folder, runtime.port);
    await page.reload();
    await page.getByRole("button", { name: "Codex" }).click();
    await expect(page.getByTestId("agent-helper")).toContainText("Codex connected");

    await page.getByRole("button", { name: "Start Building" }).click();

    const workbench = page.getByTestId("seed-workbench");
    await expect(workbench).toBeVisible();
    await expect(workbench).toHaveCSS("background-color", "rgb(220, 220, 220)");
    const flowBackground = workbench.locator("svg.react-flow__background");
    await expect(flowBackground).toBeVisible();
    await expect(flowBackground).toHaveCSS("background-color", "rgb(220, 220, 220)");
    await expect(flowBackground.locator("pattern")).toHaveCount(1);
    await expect(
      flowBackground.locator(".react-flow__background-pattern.lines")
    ).toHaveCount(1);
    await expect(workbench).toHaveAttribute("data-enter-masked", "true");
    await expect(workbench).toHaveAttribute("data-canvas-locked", "true");
    await expect(workbench).toHaveAttribute("data-pan-enabled", "false");
    await expect(workbench).toHaveAttribute("data-zoom-enabled", "false");

    const enterPanel = page.getByTestId("enter-panel");
    const enterPanelChrome = page.locator(".enter-panel-chrome");
    await expect(enterPanel).toBeVisible();
    await expect(enterPanel).toContainText("Add a Figma seed page");
    await expect(enterPanel).toHaveAttribute("data-state", "default");

    // Reusable SmallIconButton (Figma 139:436): 24x24, border #c3c3c3, r8.
    await expect(page.getByTestId("seed-add-button")).toHaveCSS("width", "24px");
    await expect(page.getByTestId("seed-add-button")).toHaveCSS("height", "24px");
    await expect(page.getByTestId("seed-add-button")).toHaveCSS("border-radius", "8px");
    await expect(page.getByTestId("seed-add-button")).toHaveCSS("border-top-color", "rgb(195, 195, 195)");

    const viewportSize = page.viewportSize();
    if (!viewportSize) {
      throw new Error("Playwright viewport size was not configured");
    }
    const panelBox = await enterPanelChrome.boundingBox();
    if (!panelBox) {
      throw new Error("Enter Panel bounding box was not available");
    }
    const panelCenterX = panelBox.x + panelBox.width / 2;
    const panelCenterY = panelBox.y + panelBox.height / 2;
    const viewportCenterX = viewportSize.width / 2;
    const viewportCenterY = viewportSize.height / 2;
    expect(Math.abs(panelCenterX - viewportCenterX)).toBeLessThan(80);
    expect(Math.abs(panelCenterY - viewportCenterY)).toBeLessThan(80);
    await expect(enterPanelChrome).toHaveCSS("width", "270px");

    const defaultPanelHeight = (await enterPanelChrome.boundingBox())?.height;
    if (!defaultPanelHeight) {
      throw new Error("Enter Panel bounding box was not available in default state");
    }

    const viewport = page.locator(".react-flow__viewport");
    const beforeTransform = await viewport.getAttribute("style");
    await page.mouse.move(512, 360);
    await page.mouse.down();
    await page.mouse.move(612, 420);
    await page.mouse.up();
    await page.mouse.wheel(0, -500);
    await expect(viewport).toHaveAttribute("style", beforeTransform ?? "");

    await page.getByTestId("seed-add-button").click();
    await expect(enterPanel).toHaveAttribute("data-state", "address");
    await expect(page.getByTestId("figma-seed-reference-input")).toBeVisible();
    await expect(workbench).toHaveAttribute("data-enter-masked", "true");

    await page.getByTestId("enter-panel-backdrop").click({ position: { x: 8, y: 8 } });
    await expect(page.getByTestId("seed-add-button")).toBeVisible();
    await expect(page.getByTestId("figma-seed-reference-input")).not.toBeVisible();
    await expect(workbench).toHaveAttribute("data-enter-masked", "true");

    await page.getByTestId("seed-add-button").click();
    await expect(enterPanel).toHaveAttribute("data-state", "address");
    await expect(page.getByTestId("figma-seed-reference-input")).toBeVisible();
    const addressPanelHeight = (await enterPanelChrome.boundingBox())?.height;
    if (!addressPanelHeight) {
      throw new Error("Enter Panel bounding box was not available in address state");
    }
    expect(Math.abs(addressPanelHeight - defaultPanelHeight)).toBeLessThan(1);

    const folderChip = page.locator(".seed-workbench__folder");
    const folderBody = page.locator(".seed-workbench__folder-body");
    await expect(folderChip).toBeVisible();
    await expect(folderChip).toHaveCSS("width", "270px");
    await expect(folderChip).toHaveCSS("height", "48px");
    await expect(folderChip).toHaveCSS("top", "16px");
    await expect(folderChip).toHaveCSS("left", "16px");
    await expect(folderChip).toHaveCSS("background-color", "rgba(0, 0, 0, 0.25)");
    await expect(folderBody).toHaveCSS("padding", "12px");
    await expect(folderBody).toHaveCSS("background-color", "rgb(241, 241, 241)");
    await expect(folderBody).toHaveCSS("border-top-color", "rgb(255, 255, 255)");
    await expect(folderBody).toHaveCSS("font-size", "13px");
    await expect(folderBody).toHaveCSS("letter-spacing", "-0.39px");

    const seedInput = page.getByTestId("figma-seed-reference-input");
    await seedInput.fill(
      "https://www.figma.com/design/FSgnAj1yrNlgDCt4V4wTfa/recursive-design-agent?node-id=133-129&t=issue04-ui-test"
    );
    // Confirm the address with Enter (not per-keystroke) -> validating -> description.
    await seedInput.press("Enter");
    await expect(enterPanel).toHaveAttribute("data-state", "validating");
    await expect(enterPanel).toHaveAttribute("data-state", "description");
    await expect(page.getByTestId("original-design-intent-input")).toBeVisible();
    await expect(seedInput).not.toBeEditable();

    const submitButton = page.getByRole("button", { name: "Enter Canvas" });
    await expect(submitButton).toBeDisabled();
    await expect(submitButton).toHaveCSS("height", "28px");
    await expect(submitButton).toHaveCSS("border-radius", "6px");
    await expect(submitButton).toHaveCSS("border-top-color", "rgb(255, 255, 255)");
    await expect(submitButton).toHaveCSS("color", "rgb(157, 157, 157)");

    await page
      .getByTestId("original-design-intent-input")
      .fill("UI test intent: show that evidence comes from Runtime data.");
    await expect(submitButton).toBeEnabled();
    await expect(submitButton).toHaveCSS("color", "rgb(61, 61, 61)");

    await submitButton.click();

    await expect(enterPanel).toContainText("Preparing Candidates");
    await expect(workbench).toHaveAttribute("data-canvas-locked", "true");

    await expect(page.getByTestId("figma-evidence-surface")).toBeVisible();
    await expect(page.getByTestId("figma-evidence-surface")).toContainText(
      "issue04-ui-test"
    );
    await expect(page.getByTestId("figma-evidence-surface")).toContainText(
      "UI test intent"
    );
    await expect(workbench).toHaveAttribute("data-canvas-locked", "false");
    await expect(workbench).toHaveAttribute("data-pan-enabled", "true");
    await expect(workbench).toHaveAttribute("data-zoom-enabled", "true");

    const flowPane = page.locator(".react-flow__pane");
    await expect(flowPane).toBeVisible();

    const beforeUnlockPan = await viewport.getAttribute("style");
    await flowPane.hover({ position: { x: 120, y: 200 } });
    await page.mouse.down();
    await page.mouse.move(320, 360, { steps: 12 });
    await page.mouse.up();
    await expect
      .poll(async () => viewport.getAttribute("style"))
      .not.toBe(beforeUnlockPan ?? "");

    const beforeUnlockZoom = await viewport.getAttribute("style");
    await flowPane.hover({ position: { x: 320, y: 360 } });
    await page.mouse.wheel(0, -500);
    await expect
      .poll(async () => viewport.getAttribute("style"))
      .not.toBe(beforeUnlockZoom ?? "");

    await expect(page.getByTestId("question-card")).toHaveCount(0);
    await expect(page.getByTestId("annotation-overlay")).toHaveCount(0);
    await expect(page.getByTestId("region-selection")).toHaveCount(0);
  });

  test("address field stays editable while typing and only confirms on Enter", async ({
    page,
    runtime,
    folder
  }) => {
    const token = await captureToken(page, runtime.baseURL);
    await bindFolder(token, folder, runtime.port);
    await page.reload();
    await page.getByRole("button", { name: "Codex" }).click();
    await page.getByRole("button", { name: "Start Building" }).click();

    const enterPanel = page.getByTestId("enter-panel");
    await page.getByTestId("seed-add-button").click();
    await expect(enterPanel).toHaveAttribute("data-state", "address");

    const seedInput = page.getByTestId("figma-seed-reference-input");
    // Typing char-by-char must NOT flip the panel out of address (the old bug
    // locked the field read-only after the first character).
    await seedInput.type("https://www.figma.com/design/abc");
    await expect(enterPanel).toHaveAttribute("data-state", "address");
    await expect(seedInput).toBeEditable();

    // Enter confirms -> validating -> description (read-only confirmed input).
    await seedInput.press("Enter");
    await expect(enterPanel).toHaveAttribute("data-state", "validating");
    await expect(enterPanel).toHaveAttribute("data-state", "description");
    await expect(page.getByTestId("figma-seed-reference-input")).not.toBeEditable();
  });

  test("failed seed import returns to the description state instead of hanging", async ({
    page,
    runtime,
    folder
  }) => {
    const token = await captureToken(page, runtime.baseURL);
    await bindFolder(token, folder, runtime.port);
    await page.reload();
    await page.getByRole("button", { name: "Codex" }).click();
    await page.getByRole("button", { name: "Start Building" }).click();

    await page.getByTestId("seed-add-button").click();
    const seedInput = page.getByTestId("figma-seed-reference-input");
    await seedInput.fill("https://www.figma.com/design/xyz");
    await seedInput.press("Enter");
    await expect(page.getByTestId("original-design-intent-input")).toBeVisible();
    await page
      .getByTestId("original-design-intent-input")
      .fill("intent for error test");

    // Force task creation to fail (500). The UI must not hang in loading.
    await page.route("**/api/tasks", (route) =>
      route.fulfill({ status: 500, body: '{"ok":false}' })
    );
    await page.getByRole("button", { name: "Enter Canvas" }).click();

    const enterPanel = page.getByTestId("enter-panel");
    await expect(enterPanel).toHaveAttribute("data-state", "description");
    await expect(page.getByRole("button", { name: "Enter Canvas" })).toBeVisible();
    await page.unroute("**/api/tasks");
  });
});
