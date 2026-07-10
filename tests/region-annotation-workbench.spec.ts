import http from "node:http";
import { expect, test as base } from "./fixtures";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Issue 06 — Region Annotation Workbench projection + Annotate toggle.
// Minimal: Agent-written annotation appears via poll; Annotate button toggles.

const test = base.extend<{ folder: string }>({
  folder: async ({}, use) => {
    const folder = mkdtempSync(path.join(tmpdir(), "ikran-e2e-06-ann-"));
    await use(folder);
    rmSync(folder, { recursive: true, force: true });
  }
});

const REAL_FIGMA_SEED_REFERENCE =
  "https://www.figma.com/design/FSgnAj1yrNlgDCt4V4wTfa/recursive-design-agent?node-id=177-426&t=RC4FGd8KwNfX6uqP-11";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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
    if (token) sessionToken = token;
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

async function enterWorkbench(page: import("@playwright/test").Page) {
  await expect(page.getByTestId("project-path")).toHaveText(/.+/, {
    timeout: 15000
  });
  const codex = page.getByRole("button", { name: "Codex" });
  const pressed = await codex.getAttribute("aria-pressed");
  if (pressed !== "true") {
    await codex.click();
  }
  await expect(page.getByTestId("agent-helper")).toContainText("Codex connected");
  await page.getByRole("button", { name: "Start Building" }).click();
  await expect(page.getByTestId("seed-workbench")).toBeVisible();
}

test.describe("Ikran Issue 06 — Region Annotation Workbench", () => {
  test.beforeEach(async ({ runtime }) => {
    rmSync(path.join(runtime.stateDir, "runtime-state.json"), { force: true });
  });

  test("Annotate toggle + Agent annotation projects as marker via poll", async ({
    page,
    runtime,
    folder
  }) => {
    const token = await captureToken(page, runtime.baseURL);
    await bindFolder(token, folder, runtime.port);

    const seedRes = await rawPost(
      "/api/seed-reference",
      {
        figmaSeedReference: REAL_FIGMA_SEED_REFERENCE,
        originalDesignIntent: "Issue 06 region annotation workbench."
      },
      { "x-ikran-session": token },
      runtime.port
    );
    expect(seedRes.status).toBe(200);
    const seedId = (JSON.parse(seedRes.body).record as { id: string }).id;

    const evidenceRes = await rawPost(
      "/api/evidence-package",
      {
        figmaSeedReference: REAL_FIGMA_SEED_REFERENCE,
        seedReferenceId: seedId,
        frame: { nodeId: "177:426", name: "Evidence Frame" },
        evidenceViews: { rawData: "available", screenshot: "available" },
        screenshot: { dataUrl: TINY_PNG }
      },
      { "x-ikran-session": token },
      runtime.port
    );
    expect(evidenceRes.status).toBe(200);
    const surfaceId = (JSON.parse(evidenceRes.body).record as { id: string }).id;

    await page.reload();
    await enterWorkbench(page);

    const annotate = page.getByTestId("annotate-button");
    await expect(annotate).toBeVisible();
    await expect(annotate).toHaveAttribute("aria-pressed", "false");
    await annotate.click();
    await expect(annotate).toHaveAttribute("aria-pressed", "true");
    await expect(annotate).toHaveAttribute("data-active", "true");
    await annotate.click();
    await expect(annotate).toHaveAttribute("aria-pressed", "false");

    // Agent-written annotation appears via GET poll (no page reload).
    const annRes = await rawPost(
      "/api/region-annotation",
      {
        surfaceArtifactId: surfaceId,
        author: "agent",
        body: "Agent observed this region",
        type: "assumption",
        rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.25 }
      },
      { "x-ikran-session": token },
      runtime.port
    );
    expect(annRes.status).toBe(200);
    const annotationId = (JSON.parse(annRes.body).record as { id: string }).id;

    await expect
      .poll(async () => {
        const marker = page.getByTestId("region-annotation");
        if ((await marker.count()) === 0) return null;
        return marker.first().getAttribute("data-runtime-record-id");
      })
      .toBe(annotationId);

    const marker = page.getByTestId("region-annotation").first();
    await expect(marker).toHaveAttribute("data-surface-record-id", surfaceId);
    await expect(marker).toHaveAttribute("data-author", "agent");

    // Audit event present on disk (Runtime source of truth path).
    const eventsFile = path.join(folder, ".ikran", "events.jsonl");
    if (existsSync(eventsFile)) {
      const types = readFileSync(eventsFile, "utf-8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line).type as string);
      expect(types).toContain("annotation_created");
    }
  });
});
