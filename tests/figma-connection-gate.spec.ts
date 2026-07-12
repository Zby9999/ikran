// Issue 05A — Figma Connection Gate UI + fail-closed paste (deterministic doubles).

import { expect, test as base } from "./fixtures";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { rawGet as httpGet, rawPost as httpPost, rawDelete as httpDelete } from "./helpers/http";
import { connectFigmaForTests } from "./helpers/figma-connection";

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

async function ensureGateOpen(
  page: import("@playwright/test").Page,
  runtime: { baseURL: string; port: number },
  sessionToken: string
): Promise<void> {
  await connectFigmaForTests(runtime.port, sessionToken);
  await page.goto(runtime.baseURL + "/");
  await page.getByRole("button", { name: "Start Building" }).click();
  await expect(page.getByTestId("seed-workbench")).toHaveAttribute(
    "data-figma-gate",
    "open"
  );
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

test("gate closed: canvas paste shows disconnected error, no projection", async ({
  page,
  runtime,
  folder
}) => {
  const token = await captureToken(page, runtime.baseURL);
  await bindFolder(token, folder, runtime.port);
  // Worker-scoped memory store may retain a prior connect — clear first.
  await httpDelete(runtime.port, "/api/figma-connection", {
    host: `localhost:${runtime.port}`,
    "x-ikran-session": token
  });

  await page.goto(runtime.baseURL + "/");
  await page.getByRole("button", { name: "Start Building" }).click();
  await expect(page.getByTestId("seed-workbench")).toHaveAttribute(
    "data-figma-gate",
    "closed"
  );

  const figmaUrl =
    "https://www.figma.com/design/AbCdEfGh/Mock?node-id=1-2";
  await page.evaluate((url) => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        getData: (type: string) => (type === "text/plain" ? url : "")
      }
    });
    window.dispatchEvent(event);
  }, figmaUrl);

  await expect(page.getByTestId("workbench-paste-error")).toBeVisible();
  await expect(page.getByTestId("workbench-paste-error")).toContainText(
    "Connect Figma"
  );
  await expect(page.getByTestId("seed-reference-projection")).toHaveCount(0);

  const seeds = await httpGet(runtime.port, "/api/seed-reference", {
    host: `localhost:${runtime.port}`,
    "x-ikran-session": token
  });
  expect(JSON.parse(seeds.body).records).toEqual([]);
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

test("capture failure after gate open leaves no half-written seed", async ({
  page,
  runtime,
  folder
}) => {
  const token = await captureToken(page, runtime.baseURL);
  await bindFolder(token, folder, runtime.port);
  await ensureGateOpen(page, runtime, token);

  // Mock Figma API maps node-id 0:0 → not_found (createMockFigmaApiClient).
  const capture = await httpPost(
    runtime.port,
    "/api/seed-capture",
    {
      figmaSeedReference:
        "https://www.figma.com/design/AbCdEfGh/Mock?node-id=0-0"
    },
    {
      host: `localhost:${runtime.port}`,
      "x-ikran-session": token,
      "content-type": "application/json"
    }
  );
  expect(capture.status).toBe(404);
  expect(JSON.parse(capture.body)).toMatchObject({
    ok: false,
    error: "not_found"
  });

  const seeds = await httpGet(runtime.port, "/api/seed-reference", {
    host: `localhost:${runtime.port}`,
    "x-ikran-session": token
  });
  expect(JSON.parse(seeds.body).records).toEqual([]);
  await expect(page.getByTestId("seed-reference-projection")).toHaveCount(0);
});

test("canvas paste shows Ikran frame only — never Figma iframe embed", async ({
  page,
  runtime,
  folder
}) => {
  const token = await captureToken(page, runtime.baseURL);
  await bindFolder(token, folder, runtime.port);
  await ensureGateOpen(page, runtime, token);

  // Hold capture briefly so the optimistic awaiting frame is observable.
  await page.route("**/api/seed-capture", async (route) => {
    await new Promise((r) => setTimeout(r, 400));
    await route.continue();
  });

  const figmaUrl =
    "https://www.figma.com/design/AbCdEfGh/Mock?node-id=1-2";
  // Paste is window-level; no canvas click needed (folder chrome can intercept).
  await page.evaluate((url) => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        getData: (type: string) => (type === "text/plain" ? url : "")
      }
    });
    window.dispatchEvent(event);
  }, figmaUrl);

  // Loading / in-flight Ikran frame — not a Figma player iframe.
  await expect(
    page.getByTestId("seed-reference-projection").first()
  ).toBeVisible({ timeout: 5000 });
  await expect(page.locator('iframe[src*="figma.com"]')).toHaveCount(0);
  await expect(
    page.locator('.tl-embed iframe, iframe.tl-embed__iframe')
  ).toHaveCount(0);

  // After capture completes, still only Ikran projection (with screenshot).
  await expect(
    page.getByTestId("seed-reference-projection").first()
  ).toBeVisible();
  await expect(
    page.getByTestId("seed-reference-projection-screenshot").first()
  ).toBeVisible({ timeout: 10000 });
  await expect(page.locator('iframe[src*="figma.com"]')).toHaveCount(0);
});

test("deleting a seed frame stays gone after pasting another", async ({
  page,
  runtime,
  folder
}) => {
  const token = await captureToken(page, runtime.baseURL);
  await bindFolder(token, folder, runtime.port);
  await ensureGateOpen(page, runtime, token);

  const firstUrl =
    "https://www.figma.com/design/AbCdEfGh/Mock?node-id=1-2";
  const secondUrl =
    "https://www.figma.com/design/AbCdEfGh/Mock?node-id=3-4";

  const pasteUrl = async (url: string) => {
    await page.evaluate((u) => {
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: {
          getData: (type: string) => (type === "text/plain" ? u : "")
        }
      });
      window.dispatchEvent(event);
    }, url);
  };

  await pasteUrl(firstUrl);
  const first = page.getByTestId("seed-reference-projection").first();
  await expect(first).toBeVisible({ timeout: 10000 });
  await expect(
    page.getByTestId("seed-reference-projection-screenshot").first()
  ).toBeVisible({ timeout: 10000 });

  const seedsBefore = await httpGet(runtime.port, "/api/seed-reference", {
    host: `localhost:${runtime.port}`,
    "x-ikran-session": token
  });
  const firstId = (
    JSON.parse(seedsBefore.body).records as Array<{ id: string }>
  )[0]?.id;
  expect(firstId).toBeTruthy();

  await first.click();
  const deleteRequest = page.waitForRequest(
    (request) =>
      request.method() === "DELETE" &&
      new URL(request.url()).pathname === "/api/seed-reference"
  );
  await page.keyboard.press("Delete");
  const deleted = await deleteRequest;
  expect(new URL(deleted.url()).searchParams.get("id")).toBe(firstId);

  await expect(page.getByTestId("seed-reference-projection")).toHaveCount(0, {
    timeout: 10000
  });

  await pasteUrl(secondUrl);
  await expect(page.getByTestId("seed-reference-projection")).toHaveCount(1, {
    timeout: 10000
  });
  await expect(
    page.getByTestId("seed-reference-projection-screenshot").first()
  ).toBeVisible({ timeout: 10000 });

  const seedsAfter = await httpGet(runtime.port, "/api/seed-reference", {
    host: `localhost:${runtime.port}`,
    "x-ikran-session": token
  });
  const records = JSON.parse(seedsAfter.body).records as Array<{
    id: string;
    figma_seed_reference: string;
  }>;
  expect(records).toHaveLength(1);
  expect(records[0]?.id).not.toBe(firstId);
  expect(records[0]?.figma_seed_reference).toContain("node-id=3-4");
});
