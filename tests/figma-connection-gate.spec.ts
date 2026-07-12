// Issue 05A — Figma Connection Gate UI + fail-closed paste (deterministic doubles).

import { expect, test as base } from "./fixtures";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { rawGet as httpGet, rawPost as httpPost, rawDelete as httpDelete } from "./helpers/http";

const test = base.extend<{ folder: string }>({
  folder: async ({}, use) => {
    const folder = mkdtempSync(path.join(tmpdir(), "ikran-e2e-05a-"));
    await use(folder);
    rmSync(folder, { recursive: true, force: true });
  }
});

async function captureToken(
  page: import("@playwright/test").Page,
  baseURL: string
): Promise<string> {
  let sessionToken: string | null = null;
  await page.route("**/api/**", async (route) => {
    const token = route.request().headers()["x-ikran-session"];
    if (token) sessionToken = token;
    await route.continue();
  });
  await page.goto(baseURL + "/");
  await expect(page.getByTestId("runtime-label")).toContainText(
    "Runtime connected"
  );
  await page.unroute("**/api/**");
  if (!sessionToken) {
    throw new Error("Runtime session token was not captured");
  }
  return sessionToken;
}

async function bindFolder(
  token: string,
  folder: string,
  port: number
): Promise<void> {
  const res = await httpPost(
    port,
    "/api/project/bind",
    { path: folder },
    { host: `localhost:${port}`, "x-ikran-session": token }
  );
  expect(res.status).toBe(200);
}

async function openWorkbench(
  page: import("@playwright/test").Page,
  baseURL: string
) {
  await page.goto(baseURL + "/?view=workbench");
}

test("gate closed: connection panel visible and canvas locked", async ({
  page,
  runtime,
  folder
}) => {
  const token = await captureToken(page, runtime.baseURL);
  await bindFolder(token, folder, runtime.port);

  await page.goto(runtime.baseURL + "/");
  await expect(page.getByTestId("runtime-label")).toContainText(
    "Runtime connected"
  );
  await page.getByRole("button", { name: "Start Building" }).click();
  await expect(page.getByTestId("seed-workbench")).toBeVisible();
  await expect(page.getByTestId("figma-verification-panel")).toBeVisible();
  await expect(page.getByTestId("seed-workbench")).toHaveAttribute(
    "data-figma-gate",
    "closed"
  );
  await expect(page.getByTestId("workbench-canvas")).toHaveClass(
    /seed-workbench__canvas--locked/
  );

  const status = await httpGet(runtime.port, "/api/figma-connection", {
    host: `localhost:${runtime.port}`,
    "x-ikran-session": token
  });
  expect(status.status).toBe(200);
  expect(JSON.parse(status.body)).toMatchObject({
    ok: true,
    connected: false
  });
});

test("invalid token stays closed and never stores credential", async ({
  page,
  runtime,
  folder
}) => {
  const token = await captureToken(page, runtime.baseURL);
  await bindFolder(token, folder, runtime.port);

  await page.goto(runtime.baseURL + "/");
  await page.getByRole("button", { name: "Start Building" }).click();
  await expect(page.getByTestId("figma-token-input")).toBeVisible();
  await page.getByTestId("figma-token-input").fill("figd_bad_token");
  await page.getByTestId("figma-token-check").click();
  await expect(page.getByTestId("figma-token-error")).toBeVisible();
  await expect(page.getByTestId("figma-enter-canvas")).toHaveCount(0);

  const status = await httpGet(runtime.port, "/api/figma-connection", {
    host: `localhost:${runtime.port}`,
    "x-ikran-session": token
  });
  expect(JSON.parse(status.body).connected).toBe(false);
});

test("valid token → Enter Canvas unlocks gate; paste captures surface", async ({
  page,
  runtime,
  folder
}) => {
  const token = await captureToken(page, runtime.baseURL);
  await bindFolder(token, folder, runtime.port);

  await page.goto(runtime.baseURL + "/");
  await page.getByRole("button", { name: "Start Building" }).click();
  await page.getByTestId("figma-token-input").fill("figd_ok_e2e");
  await page.getByTestId("figma-token-check").click();
  await expect(page.getByTestId("figma-token-verified")).toBeVisible();
  await page.getByTestId("figma-enter-canvas").click();
  await expect(page.getByTestId("figma-verification-panel")).toHaveCount(0);
  await expect(page.getByTestId("seed-workbench")).toHaveAttribute(
    "data-figma-gate",
    "open"
  );

  // Fail-closed capture without connection was covered earlier; now capture.
  const capture = await httpPost(
    runtime.port,
    "/api/seed-capture",
    {
      figmaSeedReference:
        "https://www.figma.com/design/AbCdEfGh/Mock?node-id=1-2"
    },
    {
      host: `localhost:${runtime.port}`,
      "x-ikran-session": token,
      "content-type": "application/json"
    }
  );
  expect(capture.status).toBe(200);
  const body = JSON.parse(capture.body);
  expect(body.ok).toBe(true);
  expect(body.surface.frame_name).toBe("Mock Frame");
  expect(body.surface.positional_nodes_json).toContain("FRAME");
});

test("paste/add fail closed when gate closed — no SQLite rows", async ({
  runtime,
  folder,
  page
}) => {
  const token = await captureToken(page, runtime.baseURL);
  await bindFolder(token, folder, runtime.port);
  // Worker-scoped memory store may retain a prior connect — clear first.
  await httpDelete(runtime.port, "/api/figma-connection", {
    host: `localhost:${runtime.port}`,
    "x-ikran-session": token
  });

  const capture = await httpPost(
    runtime.port,
    "/api/seed-capture",
    {
      figmaSeedReference:
        "https://www.figma.com/design/AbCdEfGh/Mock?node-id=1-2"
    },
    {
      host: `localhost:${runtime.port}`,
      "x-ikran-session": token,
      "content-type": "application/json"
    }
  );
  expect(capture.status).toBe(403);
  expect(JSON.parse(capture.body).error).toBe("figma_connection_required");

  const seeds = await httpGet(runtime.port, "/api/seed-reference", {
    host: `localhost:${runtime.port}`,
    "x-ikran-session": token
  });
  expect(JSON.parse(seeds.body).records).toEqual([]);
});
