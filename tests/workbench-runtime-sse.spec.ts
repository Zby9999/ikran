// Task 11 — SSE `event: record` after domain commit; active-project filter; no leak.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { expect, test as base } from "./fixtures";
import { rawPost as httpPost } from "./helpers/http";

const test = base.extend<{ folder: string }>({
  folder: async ({}, use) => {
    const folder = mkdtempSync(path.join(tmpdir(), "ikran-e2e-record-sse-"));
    await use(folder);
    rmSync(folder, { recursive: true, force: true });
  }
});

const VALID_FIGMA =
  "https://www.figma.com/design/AbCdEf/Checkout?node-id=1:2";

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
  await expect(page.getByTestId("runtime-helper")).toContainText(
    "Local runtime connected"
  );
  await page.unroute("**/api/**");
  if (!sessionToken) {
    throw new Error("Runtime session token was not captured");
  }
  return sessionToken;
}

function openSse(
  port: number,
  session: string
): Promise<{
  close: () => void;
  waitForRecord: (timeoutMs?: number) => Promise<Record<string, unknown>>;
}> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/events?session=${encodeURIComponent(session)}`,
        method: "GET",
        headers: {
          host: `localhost:${port}`,
          Accept: "text/event-stream"
        }
      },
      (res) => {
        if ((res.statusCode ?? 0) !== 200) {
          reject(new Error(`SSE status ${res.statusCode}`));
          return;
        }
        let buffer = "";
        const pending: Array<(v: Record<string, unknown>) => void> = [];
        const queued: Record<string, unknown>[] = [];

        res.on("data", (chunk: Buffer) => {
          buffer += chunk.toString("utf8");
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";
          for (const part of parts) {
            const lines = part.split("\n");
            let event = "message";
            let data = "";
            for (const line of lines) {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              if (line.startsWith("data:")) data += line.slice(5).trim();
            }
            if (event === "record" && data) {
              const parsed = JSON.parse(data) as Record<string, unknown>;
              const waiter = pending.shift();
              if (waiter) waiter(parsed);
              else queued.push(parsed);
            }
          }
        });

        resolve({
          close: () => {
            req.destroy();
            res.destroy();
          },
          waitForRecord: (timeoutMs = 10_000) =>
            new Promise((resWait, rejWait) => {
              if (queued.length > 0) {
                resWait(queued.shift()!);
                return;
              }
              const timer = setTimeout(
                () => rejWait(new Error("timeout waiting for record event")),
                timeoutMs
              );
              pending.push((v) => {
                clearTimeout(timer);
                resWait(v);
              });
            })
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

test.describe("Task 11 — SSE record invalidation", () => {
  test.beforeEach(async ({ runtime }) => {
    rmSync(path.join(runtime.stateDir, "runtime-state.json"), { force: true });
  });

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

    const sse = await openSse(runtime.port, token);
    const recordPromise = sse.waitForRecord();

    const seed = await rawPost(
      "/api/seed-reference",
      {
        figmaSeedReference: VALID_FIGMA,
        originalDesignIntent: "sse record bus"
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

  test("delete success + reload failure shows role=alert and keeps marker", async ({
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

    const seedRes = await rawPost(
      "/api/seed-reference",
      {
        figmaSeedReference: VALID_FIGMA,
        originalDesignIntent: "mutation failure"
      },
      { "x-ikran-session": token },
      runtime.port
    );
    const seedId = (JSON.parse(seedRes.body).record as { id: string }).id;

    const evidenceRes = await rawPost(
      "/api/evidence-package",
      {
        figmaSeedReference: VALID_FIGMA,
        seedReferenceId: seedId,
        frame: { nodeId: "1:2", name: "Frame" },
        evidenceViews: { rawData: "available", screenshot: "available" },
        screenshot: {
          dataUrl:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        }
      },
      { "x-ikran-session": token },
      runtime.port
    );
    const surfaceId = (JSON.parse(evidenceRes.body).record as { id: string }).id;

    const annRes = await rawPost(
      "/api/region-annotation",
      {
        surfaceArtifactId: surfaceId,
        author: "designer",
        body: "Placeholder annotation",
        rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.25 }
      },
      { "x-ikran-session": token },
      runtime.port
    );
    const annotationId = (JSON.parse(annRes.body).record as { id: string }).id;

    await page.reload();
    await expect(page.getByTestId("project-path")).toHaveText(/.+/, {
      timeout: 15000
    });
    await page.getByRole("button", { name: "Start Building" }).click();
    await expect(page.getByTestId("seed-workbench")).toBeVisible();

    const marker = page.getByTestId("region-annotation").first();
    await expect(marker).toHaveAttribute("data-runtime-record-id", annotationId);

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
    await expect(
      page.getByTestId("region-annotation").first()
    ).toHaveAttribute("data-runtime-record-id", annotationId);
  });
});
