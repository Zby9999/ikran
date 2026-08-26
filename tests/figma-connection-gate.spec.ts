// Issue 05A — Figma Connection Gate UI + fail-closed paste (deterministic doubles).

import { expect, test as base } from "./fixtures";
import path from "node:path";
import { rawGet as httpGet, rawPost as httpPost, rawDelete as httpDelete, rawPatch as httpPatch } from "./helpers/http";
import { connectFigmaForTests } from "./helpers/figma-connection";
import { listEvents } from "../lib/runtime/events";
import { listRegionAnnotations } from "../lib/runtime/region-annotation";

const test = base.extend<{ folder: string }>({
  folder: async ({ runtime }, use) => {
    const folder = runtime.createProjectFolder("05a-");
    await use(folder);
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

test("preloaded Figma evidence bypasses the connection gate after credentials are removed", async ({
  page,
  runtime,
  folder
}) => {
  const token = await captureToken(page, runtime.baseURL);
  await bindFolder(token, folder, runtime.port);
  await ensureGateOpen(page, runtime, token);

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

  const readiness = await httpPatch(
    runtime.port,
    "/api/project/readiness",
    { designLanguageDescription: "Preloaded Study Kit evidence" },
    {
      host: `localhost:${runtime.port}`,
      "x-ikran-session": token,
      "content-type": "application/json"
    }
  );
  expect(readiness.status).toBe(200);
  await page.reload();
  await page.getByTestId("sign-seed-next-phase").click();
  await expect(page.getByTestId("seed-workbench")).toHaveAttribute(
    "data-alignment-workflow-stage",
    "alignment-preparing"
  );

  await httpDelete(runtime.port, "/api/figma-connection", {
    host: `localhost:${runtime.port}`,
    "x-ikran-session": token
  });
  await page.reload();

  await expect(page.getByTestId("seed-reference-projection")).toBeVisible();
  await expect(page.getByTestId("figma-verification-panel")).toHaveCount(0);
  await expect(page.getByTestId("seed-workbench")).toHaveAttribute(
    "data-figma-gate",
    "open"
  );
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

test("05C: header refresh button is leftmost and appends a new evidence version", async ({
  page,
  runtime,
  folder
}) => {
  const token = await captureToken(page, runtime.baseURL);
  await bindFolder(token, folder, runtime.port);
  await ensureGateOpen(page, runtime, token);

  const capture = await httpPost(
    runtime.port,
    "/api/seed-capture",
    {
      figmaSeedReference:
        "https://www.figma.com/design/AbCdEfGh/Mock?node-id=5-6"
    },
    {
      host: `localhost:${runtime.port}`,
      "x-ikran-session": token,
      "content-type": "application/json"
    }
  );
  expect(capture.status).toBe(200);
  const first = JSON.parse(capture.body) as {
    record: { id: string; current_surface_id: string };
    surface: { id: string };
  };

  const frame = page.getByTestId("seed-reference-projection");
  await expect(frame).toBeVisible({ timeout: 10000 });
  const refresh = frame.getByRole("button", { name: "Refresh" });
  await expect(refresh).toBeVisible();
  await expect(
    frame.locator(".seed-ref-frame__header-actions > :first-child button")
  ).toHaveAttribute("data-testid", "seed-reference-projection-refresh");

  const refreshResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/seed-reference/refresh"
  );
  await refresh.click();
  expect((await refreshResponse).status()).toBe(200);

  const surfacesResponse = await httpGet(
    runtime.port,
    "/api/evidence-package",
    {
      host: `localhost:${runtime.port}`,
      "x-ikran-session": token
    }
  );
  const surfaces = JSON.parse(surfacesResponse.body).records as Array<{
    id: string;
    superseded_by: string | null;
  }>;
  expect(surfaces).toHaveLength(2);
  const oldSurface = surfaces.find((surface) => surface.id === first.surface.id);
  const newSurface = surfaces.find((surface) => surface.id !== first.surface.id);
  expect(newSurface).toBeTruthy();
  expect(oldSurface?.superseded_by).toBe(newSurface?.id);

  const seedsResponse = await httpGet(runtime.port, "/api/seed-reference", {
    host: `localhost:${runtime.port}`,
    "x-ikran-session": token
  });
  const seeds = JSON.parse(seedsResponse.body).records as Array<{
    id: string;
    current_surface_id: string;
  }>;
  expect(seeds.find((seed) => seed.id === first.record.id)?.current_surface_id).toBe(
    newSurface?.id
  );
});

test("05C: Tab drills structural hover to its parent and commits that node", async ({
  page,
  runtime,
  folder
}) => {
  const token = await captureToken(page, runtime.baseURL);
  await bindFolder(token, folder, runtime.port);
  await ensureGateOpen(page, runtime, token);

  const capture = await httpPost(
    runtime.port,
    "/api/seed-capture",
    {
      figmaSeedReference:
        "https://www.figma.com/design/AbCdEfGh/Mock?node-id=7-9"
    },
    {
      host: `localhost:${runtime.port}`,
      "x-ikran-session": token,
      "content-type": "application/json"
    }
  );
  expect(capture.status).toBe(200);

  const overlay = page.getByTestId("seed-reference-structural-overlay");
  await expect(overlay).toHaveCount(0);
  const annotate = page.getByTestId("annotate-button");
  await annotate.click();
  await expect(annotate).toHaveAttribute("aria-pressed", "true");
  await expect(overlay).toBeVisible({ timeout: 10000 });
  const box = await overlay.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  // Mock Text sits inside a child Frame at this point.
  const point = {
    x: box.x + box.width * 0.3,
    y: box.y + box.height * 0.25
  };
  const eventsBeforeHover = listEvents(folder);
  const annotationsBeforeHover = listRegionAnnotations(folder);
  await page.mouse.move(point.x, point.y);
  const hovered = page.getByTestId(
    "seed-reference-structural-highlight-hovered"
  );
  await expect(hovered).toBeVisible();
  await expect(hovered).toHaveAttribute("data-node-id", /child-text$/);
  await expect(hovered).toHaveCSS("border-top-style", "none");
  await expect(hovered).toHaveCSS("background-color", "rgba(25, 209, 34, 0.4)");
  const hoveredBox = await hovered.boundingBox();
  expect(hoveredBox).not.toBeNull();
  expect(listEvents(folder)).toEqual(eventsBeforeHover);
  expect(listRegionAnnotations(folder)).toEqual(annotationsBeforeHover);

  await page.keyboard.press("Tab");
  await expect(hovered).toHaveAttribute("data-node-id", /child-frame$/);
  // Clamp at the highest selectable overlay node instead of cycling.
  await page.keyboard.press("Tab");
  await expect(hovered).toHaveAttribute("data-node-id", /child-frame$/);

  await page.mouse.click(point.x, point.y);

  // 08A — pointer-up opens the entry form; the create POST fires on submit.
  const entryInput = page.getByTestId("designer-annotation-entry-input");
  await expect(entryInput).toBeVisible();
  await entryInput.fill("Child frame intent");
  await page.getByTestId("designer-annotation-entry-submit").click();

  let committedAnnotation: ReturnType<typeof listRegionAnnotations>[number] | undefined;
  await expect
    .poll(() => {
      try {
        const records = listRegionAnnotations(folder);
        committedAnnotation = records.at(-1);
        return records.length;
      } catch {
        return -1;
      }
    })
    .toBe(annotationsBeforeHover.length + 1);
  expect(committedAnnotation).toMatchObject({
    target_kind: "figma-node",
    target_node_id: "7:9:child-frame",
    type: "designer_annotation",
    body: "Child frame intent",
    section: "design-concept"
  });
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

  // Hold capture at a deterministic boundary so canonical in-flight dedupe can
  // be asserted without timing assumptions under parallel test load.
  let captureRequests = 0;
  let releaseCapture!: () => void;
  const captureGate = new Promise<void>((resolve) => {
    releaseCapture = resolve;
  });
  await page.route("**/api/seed-capture", async (route) => {
    captureRequests += 1;
    await captureGate;
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

  try {
    await page.evaluate(() => {
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: {
          getData: (type: string) =>
            type === "text/plain"
              ? "https://www.figma.com/design/AbCdEfGh/Mock?node-id=1:2&t=duplicate"
              : ""
        }
      });
      window.dispatchEvent(event);
    });
    await page.waitForTimeout(100);
    expect(captureRequests).toBe(1);
    await expect(
      page.getByTestId("seed-reference-projection-awaiting")
    ).toHaveCount(1);
  } finally {
    releaseCapture();
  }

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

test("canvas paste of a random URL does not create embed or bookmark", async ({
  page,
  runtime,
  folder
}) => {
  const token = await captureToken(page, runtime.baseURL);
  await bindFolder(token, folder, runtime.port);
  await ensureGateOpen(page, runtime, token);

  await page.evaluate(() => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        getData: (type: string) =>
          type === "text/plain" ? "https://example.com/random-page" : ""
      }
    });
    window.dispatchEvent(event);
  });

  // Give tldraw a beat to create (or fail to create) shapes.
  await page.waitForTimeout(500);
  await expect(
    page.locator(".tl-embed, .tl-bookmark, .tl-embed iframe, iframe.tl-embed__iframe")
  ).toHaveCount(0);
  await expect(page.getByTestId("seed-reference-projection")).toHaveCount(0);
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

test("05B: three pastes project three frames; duplicate paste reuses and focuses", async ({
  page,
  runtime,
  folder
}) => {
  const token = await captureToken(page, runtime.baseURL);
  await bindFolder(token, folder, runtime.port);
  await ensureGateOpen(page, runtime, token);

  const urls = [
    "https://www.figma.com/design/AbCdEfGh/Mock?node-id=1-1",
    "https://www.figma.com/design/AbCdEfGh/Mock?node-id=2-2",
    "https://www.figma.com/design/OtherKey/Mock?node-id=3-3"
  ];

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

  for (let i = 0; i < urls.length; i++) {
    await pasteUrl(urls[i]);
    await expect(page.getByTestId("seed-reference-projection")).toHaveCount(
      i + 1,
      { timeout: 15000 }
    );
    await expect(
      page.getByTestId("seed-reference-projection-screenshot")
    ).toHaveCount(i + 1, { timeout: 15000 });
  }

  const listed = await httpGet(runtime.port, "/api/seed-reference", {
    host: `localhost:${runtime.port}`,
    "x-ikran-session": token
  });
  const records = JSON.parse(listed.body).records as Array<{
    id: string;
    node_id: string;
  }>;
  expect(records).toHaveLength(3);
  const firstId = records.find((r) => r.node_id === "1:1")?.id;
  expect(firstId).toBeTruthy();

  // Click another frame so selection is not already on the duplicate target.
  await page
    .locator(
      `[data-testid="seed-reference-projection"][data-seed-record-id]:not([data-seed-record-id="${firstId}"])`
    )
    .first()
    .click();

  let duplicateCaptureRequests = 0;
  await page.route("**/api/seed-capture", async (route) => {
    duplicateCaptureRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.continue();
  });

  await pasteUrl(
    "https://www.figma.com/design/AbCdEfGh/Mock?node-id=1:1&t=noise"
  );

  // Duplicate must focus immediately — no optimistic Capturing… frame.
  await expect(
    page.getByTestId("seed-reference-projection-awaiting")
  ).toHaveCount(0);
  await expect(page.getByTestId("seed-reference-projection")).toHaveCount(3);
  await expect(
    page.getByTestId("seed-reference-projection-screenshot")
  ).toHaveCount(3);
  await page.waitForTimeout(500);
  expect(duplicateCaptureRequests).toBe(0);
  const after = await httpGet(runtime.port, "/api/seed-reference", {
    host: `localhost:${runtime.port}`,
    "x-ikran-session": token
  });
  expect(JSON.parse(after.body).records).toHaveLength(3);

  const focused = page.locator(
    `[data-testid="seed-reference-projection"][data-seed-record-id="${firstId}"]`
  );
  await expect(focused).toHaveAttribute("data-selected", "true", {
    timeout: 5000
  });
});

test("05B: leaving the Workbench flushes the last frame layout change", async ({
  page,
  runtime,
  folder
}) => {
  const token = await captureToken(page, runtime.baseURL);
  await bindFolder(token, folder, runtime.port);
  await ensureGateOpen(page, runtime, token);
  let layoutPutRequests = 0;
  page.on("request", (request) => {
    if (
      request.method() === "PUT" &&
      request.url().includes("/api/workbench-layout")
    ) {
      layoutPutRequests += 1;
    }
  });

  await page.evaluate(() => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        getData: (type: string) =>
          type === "text/plain"
            ? "https://www.figma.com/design/AbCdEfGh/Mock?node-id=8-8"
            : ""
      }
    });
    window.dispatchEvent(event);
  });

  const projection = page.getByTestId("seed-reference-projection");
  await expect(projection).toBeVisible({ timeout: 15000 });
  await expect(
    page.getByTestId("seed-reference-projection-screenshot")
  ).toBeVisible({ timeout: 15000 });
  const seedId = await projection.getAttribute("data-seed-record-id");
  expect(seedId).toBeTruthy();

  const backBox = await page
    .getByRole("button", { name: "Back to setup" })
    .boundingBox();
  expect(backBox).toBeTruthy();
  await projection.click();
  await expect(projection).toHaveAttribute("data-selected", "true");
  await page.keyboard.press("ArrowRight");
  const canvasBox = await page.getByTestId("workbench-canvas").boundingBox();
  expect(canvasBox).toBeTruthy();
  await page.mouse.move(
    canvasBox!.x + canvasBox!.width / 2,
    canvasBox!.y + canvasBox!.height / 2
  );
  await page.mouse.wheel(0, 120);
  const putsBeforePagehide = layoutPutRequests;
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
  });
  await expect.poll(() => layoutPutRequests).toBeGreaterThan(putsBeforePagehide);
  await page.mouse.click(
    backBox!.x + backBox!.width / 2,
    backBox!.y + backBox!.height / 2
  );

  await expect.poll(() => layoutPutRequests).toBeGreaterThan(0);
  await expect.poll(async () => {
    const response = await httpGet(runtime.port, "/api/workbench-layout", {
      host: `localhost:${runtime.port}`,
      "x-ikran-session": token
    });
    const body = JSON.parse(response.body) as {
      layout?: { frames?: Record<string, { x: number }> };
    };
    return seedId ? body.layout?.frames?.[seedId]?.x ?? null : null;
  }).not.toBeNull();
});

test("05B: readiness reports description_missing until Description is set", async ({
  page,
  runtime,
  folder
}) => {
  const token = await captureToken(page, runtime.baseURL);
  await bindFolder(token, folder, runtime.port);
  await connectFigmaForTests(runtime.port, token);

  const empty = await httpGet(runtime.port, "/api/project/readiness", {
    host: `localhost:${runtime.port}`,
    "x-ikran-session": token
  });
  expect(empty.status).toBe(200);
  expect(JSON.parse(empty.body)).toMatchObject({
    ok: true,
    preconditions: ["description_missing"],
    designLanguageDescription: ""
  });

  // Capture still works with empty Description.
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

  const patch = await httpPatch(
    runtime.port,
    "/api/project/readiness",
    {
      designLanguageDescription: "Shared editorial language"
    },
    {
      host: `localhost:${runtime.port}`,
      "x-ikran-session": token
    }
  );
  expect(patch.status).toBe(200);
  const patched = JSON.parse(patch.body);
  expect(patched.ok).toBe(true);
  expect(patched.preconditions).toEqual([]);
  expect(patched.designLanguageDescription).toBe("Shared editorial language");

  const ready = await httpGet(runtime.port, "/api/project/readiness", {
    host: `localhost:${runtime.port}`,
    "x-ikran-session": token
  });
  expect(JSON.parse(ready.body).preconditions).toEqual([]);
});
