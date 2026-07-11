import { expect, test as base } from "./fixtures";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { rawGet as httpGet, rawPost as httpPost } from "./helpers/http";

// Issue 02/04 — tldraw Workbench shell + Agent-first seed projection.
//
// Seed write path is Agent/MCP only:
//   register_seed_reference (MCP → POST /api/seed-reference) → record
//   → record_evidence_package → Workbench projects from GET records
//
// Workbench has no EnterPanel / URL / intent write UI. These tests assert the
// tldraw shell, projection from pre-seeded Runtime records, record SSE
// invalidation for Agent-written records, pending/evidence refresh, and
// negative UI guards.

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
) {
  return httpPost(port, route, body, {
    host: `localhost:${port}`,
    ...headers
  });
}

function rawGet(
  route: string,
  headers: Record<string, string>,
  port: number
) {
  return httpGet(port, route, {
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
    if (token) {
      sessionToken = token;
    }
    await route.continue();
  });
  await page.goto(baseURL + "/");
  await expect(page.getByTestId("runtime-label")).toContainText(
    "Runtime connected"
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
  const dbPath = path.join(folder, ".ikran", "ikran.db");
  if (!existsSync(dbPath)) return [];
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(dbPath);
  try {
    return (
      db
        .prepare("SELECT type, payload FROM events ORDER BY id ASC")
        .all() as Array<{ type: string; payload: string }>
    ).map((r) => ({
      type: r.type,
      payload: JSON.parse(r.payload) as Record<string, unknown>
    }));
  } finally {
    db.close();
  }
}

function readSeedReferences(folder: string): Array<{
  id: string;
  figma_seed_reference: string;
  original_design_intent: string;
  registered_via?: string;
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
      registered_via?: string;
    }>;
  } finally {
    db.close();
  }
}

// Drive the UI to the tldraw Workbench once the project is bound.
// Reused across tests so each test starts from a bound project.
async function enterWorkbench(page: import("@playwright/test").Page) {
  await expect(page.getByTestId("project-path")).toHaveText(/.+/, {
    timeout: 15000
  });
  const startButton = page.getByRole("button", { name: "Start Building" });
  await expect(startButton).toBeEnabled();
  await startButton.click();
  await expect(page.getByTestId("seed-workbench")).toBeVisible();
}

/** Negative UI guards: no seed write surface; page must not POST seed-reference. */
async function assertNoWorkbenchSeedWriteUi(
  page: import("@playwright/test").Page
) {
  await expect(page.getByTestId("enter-panel")).toHaveCount(0);
  await expect(page.getByTestId("seed-add-button")).toHaveCount(0);
  await expect(page.getByTestId("figma-seed-reference-input")).toHaveCount(0);
  await expect(page.getByTestId("original-design-intent-input")).toHaveCount(0);
}

test.describe("Ikran Issue 02/04 — tldraw Workbench shell + Agent-first seed", () => {
  test.beforeEach(async ({ runtime }) => {
    // Reset the Runtime-global active-project pointer so no test inherits
    // state from a previous test in the same worker.
    rmSync(path.join(runtime.stateDir, "runtime-state.json"), { force: true });
  });

  test("Start Building opens tldraw; Agent-preseeded record projects; no UI seed write", async ({
    page,
    runtime,
    folder
  }) => {
    const token = await captureToken(page, runtime.baseURL);
    await bindFolder(token, folder, runtime.port);

    const tasksRequests: string[] = [];
    const figmaValidateRequests: string[] = [];
    const seedReferencePostsFromUi: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (url.includes("/api/tasks")) tasksRequests.push(url);
      if (url.includes("/api/figma/validate")) figmaValidateRequests.push(url);
      if (
        url.includes("/api/seed-reference") &&
        req.method() === "POST" &&
        req.resourceType() === "fetch"
      ) {
        // Playwright API helpers use Node http, not page fetch — only UI POSTs land here.
        seedReferencePostsFromUi.push(url);
      }
    });

    const intent = "Agent-first: tldraw projects a Runtime seed record.";
    const seedRes = await rawPost(
      "/api/seed-reference",
      {
        figmaSeedReference: REAL_FIGMA_SEED_REFERENCE,
        originalDesignIntent: intent,
        registeredVia: "agent"
      },
      { "x-ikran-session": token },
      runtime.port
    );
    expect(seedRes.status).toBe(200);
    const record = JSON.parse(seedRes.body).record as {
      id: string;
      registered_via?: string;
    };
    expect(record.id).toBeTruthy();
    expect(record.registered_via).toBe("agent");

    await page.reload();
    await enterWorkbench(page);

    const workbench = page.getByTestId("seed-workbench");
    await expect(workbench).toHaveAttribute("data-canvas-engine", "tldraw");

    await expect(workbench.locator("svg.react-flow__background")).toHaveCount(0);
    await expect(workbench.locator(".react-flow__viewport")).toHaveCount(0);
    await expect(page.getByTestId("workbench-canvas")).toBeVisible();
    await expect(workbench.locator(".tl-container")).toBeVisible();

    await assertNoWorkbenchSeedWriteUi(page);

    const projection = page.getByTestId("seed-reference-projection");
    await expect(projection).toBeVisible();
    await expect(projection).toHaveAttribute("data-runtime-record-id", record.id);
    const canvasRecordId = await projection.getAttribute("data-canvas-record-id");
    expect(canvasRecordId).toBe(`seed-reference:${record.id}`);
    await expect(projection.getByTestId("seed-reference-projection-title")).toHaveText(
      "Figma seed"
    );
    await expect(projection.getByTestId("seed-reference-projection-media")).toBeVisible();
    await expect(projection.getByTestId("seed-reference-projection-url")).toHaveCount(0);

    const awaiting = projection.getByTestId("seed-reference-projection-awaiting");
    await expect(awaiting).toBeVisible();
    await expect(awaiting).toHaveAttribute("data-awaiting-ux", "spinner");
    await expect(projection.locator(".seed-ref-frame__awaiting-spinner")).toBeVisible();

    await projection.getByTestId("seed-reference-projection-info").hover();
    const tip = projection.getByTestId("seed-reference-projection-tip");
    await expect(tip).toContainText("Agent-first");

    const records = readSeedReferences(folder);
    expect(records.length).toBe(1);
    expect(records[0].registered_via).toBe("agent");
    expect(readEvents(folder).map((e) => e.type)).toContain("seed_reference_registered");
    expect(tasksRequests).toEqual([]);
    expect(figmaValidateRequests).toEqual([]);
    expect(seedReferencePostsFromUi).toEqual([]);
  });

  test("empty Workbench is FolderChrome + empty canvas; no seed-add / URL / intent inputs", async ({
    page,
    runtime,
    folder
  }) => {
    const token = await captureToken(page, runtime.baseURL);
    await bindFolder(token, folder, runtime.port);

    const seedReferencePostsFromUi: string[] = [];
    page.on("request", (req) => {
      if (
        req.url().includes("/api/seed-reference") &&
        req.method() === "POST" &&
        req.resourceType() === "fetch"
      ) {
        seedReferencePostsFromUi.push(req.url());
      }
    });

    await page.reload();
    await enterWorkbench(page);

    const workbench = page.getByTestId("seed-workbench");
    await expect(workbench).toHaveAttribute("data-canvas-engine", "tldraw");
    await expect(page.getByTestId("workbench-canvas")).toBeVisible();
    await expect(workbench.locator(".tl-container")).toBeVisible();
    await expect(page.getByTestId("seed-reference-projection")).toHaveCount(0);

    await assertNoWorkbenchSeedWriteUi(page);
    expect(seedReferencePostsFromUi).toEqual([]);
    expect(readSeedReferences(folder).length).toBe(0);
  });

  test("HTTP POST registeredVia ui is rejected and writes no ui row", async ({
    page,
    runtime,
    folder
  }) => {
    const token = await captureToken(page, runtime.baseURL);
    await bindFolder(token, folder, runtime.port);

    const res = await rawPost(
      "/api/seed-reference",
      {
        figmaSeedReference: REAL_FIGMA_SEED_REFERENCE,
        originalDesignIntent: "HTTP ui payload must not create ui rows.",
        registeredVia: "ui"
      },
      { "x-ikran-session": token },
      runtime.port
    );
    expect(res.status).toBe(400);
    const body = JSON.parse(res.body) as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("ui_registration_disabled");
    expect(readSeedReferences(folder).length).toBe(0);

    await page.reload();
    await enterWorkbench(page);
    await assertNoWorkbenchSeedWriteUi(page);
    await expect(page.getByTestId("seed-reference-projection")).toHaveCount(0);
  });

  test("refresh rebuilds the tldraw projection from Runtime records (GET /api/seed-reference)", async ({
    page,
    runtime,
    folder
  }) => {
    const token = await captureToken(page, runtime.baseURL);
    await bindFolder(token, folder, runtime.port);

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

    await assertNoWorkbenchSeedWriteUi(page);
    await expect(page.locator("svg.react-flow__background")).toHaveCount(0);

    const projection = page.getByTestId("seed-reference-projection");
    await expect(projection).toBeVisible();
    await expect(projection).toHaveAttribute("data-runtime-record-id", record.id);
    await expect(projection).toHaveAttribute(
      "data-canvas-record-id",
      `seed-reference:${record.id}`
    );
    await expect(projection.getByTestId("seed-reference-projection-title")).toHaveText(
      "Figma seed"
    );

    const recordsAfter = readSeedReferences(folder);
    expect(recordsAfter.length).toBe(1);
    expect(recordsAfter[0].id).toBe(record.id);

    await page.reload();
    await enterWorkbench(page);
    await expect(page.getByTestId("seed-reference-projection")).toBeVisible();
    await expect(page.getByTestId("seed-reference-projection")).toHaveAttribute(
      "data-runtime-record-id",
      record.id
    );
  });

  test("an Agent-written seed reference appears via record SSE invalidation without a manual refresh", async ({
    page,
    runtime,
    folder
  }) => {
    const token = await captureToken(page, runtime.baseURL);
    await bindFolder(token, folder, runtime.port);

    await page.reload();
    await enterWorkbench(page);

    await assertNoWorkbenchSeedWriteUi(page);
    await expect(page.getByTestId("seed-reference-projection")).toHaveCount(0);

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

    await assertNoWorkbenchSeedWriteUi(page);
    expect(readSeedReferences(folder).length).toBe(1);
  });

  test("Agent-registered seed shows awaiting spinner until screenshot surface arrives", async ({
    page,
    runtime,
    folder
  }) => {
    const token = await captureToken(page, runtime.baseURL);
    await bindFolder(token, folder, runtime.port);

    let figmaNetworkHits = 0;
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      if (
        url.includes("figma.com") ||
        url.includes("/api/figma/") ||
        url.includes("oembed")
      ) {
        figmaNetworkHits += 1;
        await route.abort();
        return;
      }
      await route.continue();
    });

    try {
      const seedRes = await rawPost(
        "/api/seed-reference",
        {
          figmaSeedReference: REAL_FIGMA_SEED_REFERENCE,
          originalDesignIntent: "Awaiting evidence: seed before screenshot.",
          registeredVia: "agent"
        },
        { "x-ikran-session": token },
        runtime.port
      );
      expect(seedRes.status).toBe(200);
      const seedId = (JSON.parse(seedRes.body).record as { id: string }).id;

      await page.reload();
      await enterWorkbench(page);
      await assertNoWorkbenchSeedWriteUi(page);

      const projection = page.getByTestId("seed-reference-projection");
      await expect(projection).toBeVisible();
      await expect(projection).toHaveAttribute("data-kind", "seed_reference_projection");
      await expect(projection).toHaveAttribute("data-runtime-record-id", seedId);

      const awaiting = projection.getByTestId("seed-reference-projection-awaiting");
      await expect(awaiting).toBeVisible();
      await expect(awaiting).toHaveAttribute("data-awaiting-evidence", "true");
      await expect(awaiting).toHaveAttribute("data-awaiting-ux", "spinner");
      await expect(projection.locator(".seed-ref-frame__awaiting-spinner")).toBeVisible();
      await expect(
        projection.getByTestId("seed-reference-projection-awaiting-hint")
      ).toContainText("Waiting for Agent");
      await expect(
        projection.getByTestId("seed-reference-projection-screenshot")
      ).toHaveCount(0);

      const TINY_PNG =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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

      await expect
        .poll(async () => {
          const p = page.getByTestId("seed-reference-projection");
          return (await p.getAttribute("data-kind")) === "figma_evidence_surface"
            ? await p.getAttribute("data-surface-record-id")
            : null;
        })
        .toBe(surfaceId);

      await expect(
        projection.getByTestId("seed-reference-projection-awaiting")
      ).toHaveCount(0);
      const media = projection.getByTestId("seed-reference-projection-media");
      await expect(media).toHaveAttribute("data-has-screenshot", "true");
      await expect(
        projection.getByTestId("seed-reference-projection-screenshot")
      ).toBeVisible();
      await expect(projection.getByTestId("seed-reference-projection-title")).toHaveText(
        "Evidence Frame"
      );

      expect(figmaNetworkHits).toBe(0);
      expect(readEvents(folder).map((e) => e.type)).toContain(
        "evidence_package_recorded"
      );
    } finally {
      await page.unroute("**/*");
    }
  });

  test("Agent-written evidence package with tiny dataUrl projects screenshot; zero Figma network", async ({
    page,
    runtime,
    folder
  }) => {
    const token = await captureToken(page, runtime.baseURL);
    await bindFolder(token, folder, runtime.port);

    let figmaNetworkHits = 0;
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      if (
        url.includes("figma.com") ||
        url.includes("/api/figma/") ||
        url.includes("oembed")
      ) {
        figmaNetworkHits += 1;
        await route.abort();
        return;
      }
      await route.continue();
    });

    try {
      const seedRes = await rawPost(
        "/api/seed-reference",
        {
          figmaSeedReference: REAL_FIGMA_SEED_REFERENCE,
          originalDesignIntent: "Issue 05 workbench: evidence screenshot projection."
        },
        { "x-ikran-session": token },
        runtime.port
      );
      expect(seedRes.status).toBe(200);
      const seedId = (JSON.parse(seedRes.body).record as { id: string }).id;

      const TINY_PNG =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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
      await assertNoWorkbenchSeedWriteUi(page);

      const projection = page.getByTestId("seed-reference-projection");
      await expect(projection).toBeVisible();
      await expect(projection).toHaveAttribute("data-seed-record-id", seedId);
      await expect(projection).toHaveAttribute("data-surface-record-id", surfaceId);
      await expect(projection).toHaveAttribute("data-runtime-record-id", surfaceId);
      await expect(projection).toHaveAttribute("data-kind", "figma_evidence_surface");
      await expect(projection.getByTestId("seed-reference-projection-title")).toHaveText(
        "Evidence Frame"
      );

      const figmaLink = projection.getByTestId(
        "seed-reference-projection-figma-link"
      );
      await expect(figmaLink).toBeEnabled();
      await figmaLink.hover();
      await expect(
        projection.getByTestId("seed-reference-projection-figma-hint")
      ).toBeVisible();
      await page.evaluate(() => {
        window.open = ((url) => {
          document.body.dataset.openedFigmaUrl = String(url);
          return null;
        }) as typeof window.open;
      });
      await figmaLink.click();
      await expect(page.locator("body")).toHaveAttribute(
        "data-opened-figma-url",
        REAL_FIGMA_SEED_REFERENCE
      );

      const media = projection.getByTestId("seed-reference-projection-media");
      await expect(media).toHaveAttribute("data-has-screenshot", "true");
      await expect(
        projection.getByTestId("seed-reference-projection-screenshot")
      ).toBeVisible();
      await expect(
        projection.getByTestId("seed-reference-projection-awaiting")
      ).toHaveCount(0);

      expect(figmaNetworkHits).toBe(0);
      expect(readEvents(folder).map((e) => e.type)).toContain(
        "evidence_package_recorded"
      );
    } finally {
      await page.unroute("**/*");
    }
  });

  test("evidence package with artifactPath only: Workbench loads screenshot via /api/artifacts", async ({
    page,
    runtime,
    folder
  }) => {
    test.setTimeout(90_000);
    const token = await captureToken(page, runtime.baseURL);
    await bindFolder(token, folder, runtime.port);

    const TINY_PNG_BYTES = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );
    const artifactRel = ".ikran/artifacts/figma-smoke-screenshot.png";
    mkdirSync(path.join(folder, ".ikran", "artifacts"), { recursive: true });
    writeFileSync(path.join(folder, artifactRel), TINY_PNG_BYTES);

    let figmaNetworkHits = 0;
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      if (
        url.includes("figma.com") ||
        url.includes("/api/figma/") ||
        url.includes("oembed")
      ) {
        figmaNetworkHits += 1;
        await route.abort();
        return;
      }
      await route.continue();
    });

    try {
      const seedRes = await rawPost(
        "/api/seed-reference",
        {
          figmaSeedReference: REAL_FIGMA_SEED_REFERENCE,
          originalDesignIntent: "Issue 05 workbench: artifactPath screenshot."
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
          frame: { nodeId: "177:426", name: "Artifact Frame" },
          evidenceViews: { rawData: "available", screenshot: "available" },
          screenshot: { artifactPath: artifactRel }
        },
        { "x-ikran-session": token },
        runtime.port
      );
      expect(evidenceRes.status).toBe(200);
      const surface = JSON.parse(evidenceRes.body).record as {
        id: string;
        screenshot_artifact_path: string;
        screenshot_data_url: string | null;
      };
      expect(surface.screenshot_artifact_path).toBe(artifactRel);
      expect(surface.screenshot_data_url).toBeNull();

      await page.reload();
      await enterWorkbench(page);
      await assertNoWorkbenchSeedWriteUi(page);

      const projection = page.getByTestId("seed-reference-projection");
      await expect(projection).toBeVisible();
      await expect(projection.getByTestId("seed-reference-projection-title")).toHaveText(
        "Artifact Frame"
      );

      const media = projection.getByTestId("seed-reference-projection-media");
      await expect(media).toHaveAttribute("data-has-screenshot", "true");
      await expect(media).toHaveAttribute("data-screenshot-from-artifact", "true");
      const img = projection.getByTestId("seed-reference-projection-screenshot");
      await expect(img).toBeVisible();
      await expect(img).toHaveAttribute(
        "src",
        new RegExp(`/api/artifacts/.*figma-smoke-screenshot\\.png\\?session=`)
      );

      expect(figmaNetworkHits).toBe(0);
    } finally {
      await page.unroute("**/*");
    }
  });

  test("Agent-registered seed appears in pending-seed-evidence until screenshot recorded", async ({
    page,
    runtime,
    folder
  }) => {
    const token = await captureToken(page, runtime.baseURL);
    await bindFolder(token, folder, runtime.port);

    let figmaNetworkHits = 0;
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      if (
        url.includes("figma.com") ||
        url.includes("/api/figma/") ||
        url.includes("oembed")
      ) {
        figmaNetworkHits += 1;
        await route.abort();
        return;
      }
      await route.continue();
    });

    try {
      const seedRes = await rawPost(
        "/api/seed-reference",
        {
          figmaSeedReference: REAL_FIGMA_SEED_REFERENCE,
          originalDesignIntent: "Agent pending: must capture evidence.",
          registeredVia: "agent"
        },
        { "x-ikran-session": token },
        runtime.port
      );
      expect(seedRes.status).toBe(200);
      const seedBody = JSON.parse(seedRes.body).record as {
        id: string;
        registered_via?: string;
      };
      const seedId = seedBody.id;
      expect(seedBody.registered_via).toBe("agent");

      const pendingBefore = await rawGet(
        "/api/pending-seed-evidence",
        { "x-ikran-session": token },
        runtime.port
      );
      expect(pendingBefore.status).toBe(200);
      const pendingBeforeBody = JSON.parse(pendingBefore.body) as {
        ok: boolean;
        records: Array<{ id: string; figma_seed_reference: string }>;
      };
      expect(pendingBeforeBody.ok).toBe(true);
      expect(pendingBeforeBody.records.map((r) => r.id)).toContain(seedId);
      expect(
        pendingBeforeBody.records.find((r) => r.id === seedId)?.figma_seed_reference
      ).toBe(REAL_FIGMA_SEED_REFERENCE);

      await page.reload();
      await enterWorkbench(page);
      await assertNoWorkbenchSeedWriteUi(page);

      const projection = page.getByTestId("seed-reference-projection");
      await expect(projection).toBeVisible();
      await expect(projection).toHaveAttribute("data-runtime-record-id", seedId);
      const awaiting = projection.getByTestId("seed-reference-projection-awaiting");
      await expect(awaiting).toBeVisible();
      await expect(awaiting).toHaveAttribute("data-awaiting-ux", "spinner");
      await expect(projection.locator(".seed-ref-frame__awaiting-spinner")).toBeVisible();
      await expect(
        projection.getByTestId("seed-reference-projection-awaiting-hint")
      ).toContainText("Waiting for Agent");

      const TINY_PNG =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

      const evidenceRes = await rawPost(
        "/api/evidence-package",
        {
          figmaSeedReference: REAL_FIGMA_SEED_REFERENCE,
          seedReferenceId: seedId,
          frame: { nodeId: "177:426", name: "Pending Bridge Frame" },
          evidenceViews: { rawData: "available", screenshot: "available" },
          screenshot: { dataUrl: TINY_PNG }
        },
        { "x-ikran-session": token },
        runtime.port
      );
      expect(evidenceRes.status).toBe(200);
      const surfaceId = (JSON.parse(evidenceRes.body).record as { id: string }).id;

      const pendingAfter = await rawGet(
        "/api/pending-seed-evidence",
        { "x-ikran-session": token },
        runtime.port
      );
      expect(pendingAfter.status).toBe(200);
      const pendingAfterBody = JSON.parse(pendingAfter.body) as {
        ok: boolean;
        records: Array<{ id: string }>;
      };
      expect(pendingAfterBody.ok).toBe(true);
      expect(pendingAfterBody.records.map((r) => r.id)).not.toContain(seedId);

      await expect
        .poll(async () => {
          const p = page.getByTestId("seed-reference-projection");
          return (await p.getAttribute("data-kind")) === "figma_evidence_surface"
            ? await p.getAttribute("data-surface-record-id")
            : null;
        })
        .toBe(surfaceId);

      await expect(
        projection.getByTestId("seed-reference-projection-awaiting")
      ).toHaveCount(0);
      await expect(
        projection.getByTestId("seed-reference-projection-awaiting-hint")
      ).toHaveCount(0);
      await expect(
        projection.getByTestId("seed-reference-projection-screenshot")
      ).toBeVisible();
      await expect(projection.getByTestId("seed-reference-projection-title")).toHaveText(
        "Pending Bridge Frame"
      );

      expect(figmaNetworkHits).toBe(0);
    } finally {
      await page.unroute("**/*");
    }
  });
});
