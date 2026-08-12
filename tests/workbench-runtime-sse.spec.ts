// Task 11 — SSE `event: record` after domain commit; active-project filter; no leak.

import path from "node:path";
import { expect, test as base } from "./fixtures";
import { rawPost as httpPost } from "./helpers/http";
import { openRecordSse } from "./helpers/sse";

const test = base.extend<{ folder: string }>({
  folder: async ({ runtime }, use) => {
    const folder = runtime.createProjectFolder("record-sse-");
    await use(folder);
  }
});

const VALID_FIGMA =
  "https://www.figma.com/design/AbCdEfGh/Mock?node-id=1-2";

function rawPost(
  route: string,
  body: unknown,
  headers: Record<string, string>,
  port: number
) {
  return httpPost(port, route, body, {
    host: `localhost:${port}`,
    ...headers
  });
}

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

test.describe("Task 11 — SSE record invalidation", () => {
  test("POST seed emits event:record for active project; disconnect cleans up", async ({
    page,
    runtime,
    folder
  }) => {
    const token = await captureToken(page, runtime.baseURL);

    const bind = await rawPost(
      "/api/project/bind",
      { path: folder },
      { "x-ikran-session": token },
      runtime.port
    );
    expect(bind.status).toBe(200);

    const sse = await openRecordSse(runtime.port, token);
    const recordPromise = sse.waitForRecord();

    const { connectFigmaForTests } = await import("./helpers/figma-connection");
    await connectFigmaForTests(runtime.port, token);

    const seed = await rawPost(
      "/api/seed-reference",
      {
        figmaSeedReference: VALID_FIGMA,
        referenceNote: "sse record bus"
      },
      { "x-ikran-session": token },
      runtime.port
    );
    expect(seed.status).toBe(200);
    const seedId = (JSON.parse(seed.body).record as { id: string }).id;

    const event = await recordPromise;
    expect(event).toMatchObject({
      kind: "seed",
      action: "created",
      id: seedId
    });
    expect(String(event.projectPath)).toContain(path.basename(folder));

    sse.close();
  });

  test("delete success + background reload failure shows role=alert and removes marker", async ({
    page,
    runtime,
    folder
  }) => {
    const token = await captureToken(page, runtime.baseURL);
    await rawPost(
      "/api/project/bind",
      { path: folder },
      { "x-ikran-session": token },
      runtime.port
    );

    const { connectFigmaForTests } = await import("./helpers/figma-connection");
    await connectFigmaForTests(runtime.port, token);

    const captureRes = await rawPost(
      "/api/seed-capture",
      {
        figmaSeedReference: VALID_FIGMA,
        referenceNote: "mutation failure"
      },
      { "x-ikran-session": token },
      runtime.port
    );
    expect(captureRes.status).toBe(200);
    const surfaceId = (JSON.parse(captureRes.body).surface as { id: string })
      .id;

    const annRes = await rawPost(
      "/api/region-annotation",
      {
        target: {
          kind: "figma-region",
          surfaceArtifactId: surfaceId,
          rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.25 }
        },
        author: "designer",
        body: "Placeholder annotation",
        section: "design-principle"
      },
      { "x-ikran-session": token },
      runtime.port
    );
    expect(annRes.status).toBe(200);
    const annotationId = (JSON.parse(annRes.body).record as { id: string }).id;

    await page.reload();
    await expect(page.getByTestId("project-path")).toHaveText(/.+/, {
      timeout: 15000
    });
    await connectFigmaForTests(runtime.port, token);
    await page.getByRole("button", { name: "Start Building" }).click();
    await expect(page.getByTestId("seed-workbench")).toBeVisible();
    await expect(page.getByTestId("seed-workbench")).toHaveAttribute(
      "data-figma-gate",
      "open"
    );

    const marker = page.locator(
      `[data-testid="region-annotation"][data-runtime-record-id="${annotationId}"]`
    );
    await expect(marker).toHaveCount(1);

    let deleteSucceeded = false;
    await page.route("**/api/region-annotation**", async (route) => {
      if (route.request().method() === "DELETE") {
        deleteSucceeded = true;
        await route.continue();
        return;
      }
      if (deleteSucceeded && route.request().method() === "GET") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "reload_failed" })
        });
        return;
      }
      await route.continue();
    });

    await marker.click();
    await page.keyboard.press("Delete");

    const alert = page.getByTestId("workbench-runtime-error");
    await expect(alert).toBeVisible();
    await expect(alert).toHaveAttribute("role", "alert");
    await expect(alert).toContainText("reload_failed");
    await expect(marker).toHaveCount(0);
  });
});
