import { expect, test as base } from "./fixtures";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  rawGet as httpGet,
  rawPost as httpPost
} from "./helpers/http";

// Issue 06 — Region Annotation Workbench projection + Annotate toggle.
// Agent-written annotations arrive via SSE; designer annotations exercise the
// real tldraw pointer/keyboard → injected Runtime client mutation chain.

const test = base.extend<{ folder: string }>({
  folder: async ({}, use) => {
    const folder = mkdtempSync(path.join(tmpdir(), "ikran-e2e-06-ann-"));
    await use(folder);
    rmSync(folder, { recursive: true, force: true });
  }
});

const REAL_FIGMA_SEED_REFERENCE =
  "https://www.figma.com/design/FSgnAj1yrNlgDCt4V4wTfa/recursive-design-agent?node-id=177-426&t=RC4FGd8KwNfX6uqP-11";

const SCREENSHOT_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAUAAAADwCAIAAAD+Tyo8AAACFklEQVR42u3TQQEAAAjEMMC/58MCP7KkVbDtmQEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADwGzOIAAHY2h1OAAAAAElFTkSuQmCC";

type AnnotationRecord = {
  id: string;
  surface_id: string;
  author: "designer" | "agent";
  rect_x: number;
  rect_y: number;
  rect_w: number;
  rect_h: number;
};

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

async function listAnnotations(
  token: string,
  port: number
): Promise<AnnotationRecord[]> {
  const res = await httpGet(port, "/api/region-annotation", {
    host: `localhost:${port}`,
    "x-ikran-session": token
  });
  expect(res.status).toBe(200);
  const payload = JSON.parse(res.body) as {
    ok: boolean;
    records: AnnotationRecord[];
  };
  expect(payload.ok).toBe(true);
  return payload.records;
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
  const startButton = page.getByRole("button", { name: "Start Building" });
  await expect(startButton).toBeEnabled();
  await startButton.click();
  await expect(page.getByTestId("seed-workbench")).toBeVisible();
}

async function seedEvidenceSurface({
  token,
  port
}: {
  token: string;
  port: number;
}): Promise<string> {
  const seedRes = await rawPost(
    "/api/seed-reference",
    {
      figmaSeedReference: REAL_FIGMA_SEED_REFERENCE,
      originalDesignIntent: "Issue 06 designer gesture annotation."
    },
    { "x-ikran-session": token },
    port
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
      screenshot: { dataUrl: SCREENSHOT_PNG }
    },
    { "x-ikran-session": token },
    port
  );
  expect(evidenceRes.status).toBe(200);
  return (JSON.parse(evidenceRes.body).record as { id: string }).id;
}

async function openSeededWorkbench({
  page,
  runtime,
  folder
}: {
  page: import("@playwright/test").Page;
  runtime: { baseURL: string; port: number };
  folder: string;
}): Promise<{ token: string; surfaceId: string }> {
  const token = await captureToken(page, runtime.baseURL);
  await bindFolder(token, folder, runtime.port);
  const surfaceId = await seedEvidenceSurface({ token, port: runtime.port });
  await page.reload();
  await enterWorkbench(page);

  const projection = page.getByTestId("seed-reference-projection");
  await expect(projection).toHaveAttribute("data-surface-record-id", surfaceId);
  await expect(
    projection.getByTestId("seed-reference-projection-screenshot")
  ).toBeVisible();
  return { token, surfaceId };
}

async function mediaBox(
  page: import("@playwright/test").Page
): Promise<{ x: number; y: number; width: number; height: number }> {
  const media = page
    .getByTestId("seed-reference-projection")
    .getByTestId("seed-reference-projection-media");
  await expect(media).toBeVisible();
  const box = await media.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(100);
  expect(box!.height).toBeGreaterThan(100);
  return box!;
}

test.describe("Ikran Issue 06 — Region Annotation Workbench", () => {
  test.beforeEach(async ({ runtime }) => {
    rmSync(path.join(runtime.stateDir, "runtime-state.json"), { force: true });
  });

  test("Annotate toggle + Agent annotation projects as marker via SSE", async ({
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
        screenshot: { dataUrl: SCREENSHOT_PNG }
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

    // Agent-written annotation invalidates the Workbench via SSE (no reload).
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

    // Audit event present in canonical SQLite events.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(path.join(folder, ".ikran", "ikran.db"));
    try {
      const types = (
        db.prepare("SELECT type FROM events ORDER BY id ASC").all() as Array<{
          type: string;
        }>
      ).map((r) => r.type);
      expect(types).toContain("annotation_created");
    } finally {
      db.close();
    }
  });

  test("designer media click creates a persisted normalized annotation through the Runtime client", async ({
    page,
    runtime,
    folder
  }) => {
    const { token, surfaceId } = await openSeededWorkbench({
      page,
      runtime,
      folder
    });
    const box = await mediaBox(page);

    const annotate = page.getByTestId("annotate-button");
    await annotate.click();
    await expect(annotate).toHaveAttribute("aria-pressed", "true");

    const createRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/region-annotation"
    );
    await page.mouse.click(
      box.x + box.width * 0.4,
      box.y + box.height * 0.45
    );
    const request = await createRequest;
    const requestBody = request.postDataJSON() as {
      author: string;
      surfaceArtifactId: string;
    };
    expect(requestBody.author).toBe("designer");
    expect(requestBody.surfaceArtifactId).toBe(surfaceId);

    let record: AnnotationRecord | undefined;
    await expect
      .poll(async () => {
        record = (await listAnnotations(token, runtime.port))[0];
        return record?.id;
      })
      .toBeTruthy();

    expect(record!.surface_id).toBe(surfaceId);
    expect(record!.author).toBe("designer");
    expect(record!.rect_x).toBeGreaterThanOrEqual(0);
    expect(record!.rect_y).toBeGreaterThanOrEqual(0);
    expect(record!.rect_w).toBeGreaterThan(0);
    expect(record!.rect_h).toBeGreaterThan(0);
    expect(record!.rect_x + record!.rect_w).toBeLessThanOrEqual(1);
    expect(record!.rect_y + record!.rect_h).toBeLessThanOrEqual(1);

    const marker = page.getByTestId("region-annotation");
    await expect(marker).toHaveAttribute("data-runtime-record-id", record!.id);
    await expect(marker).toHaveAttribute("data-author", "designer");

    // Direct DB proof complements the API assertion above.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(path.join(folder, ".ikran", "ikran.db"));
    try {
      const stored = db
        .prepare(
          "SELECT id, author, surface_id FROM region_annotations WHERE id = ?"
        )
        .get(record!.id) as
        | { id: string; author: string; surface_id: string }
        | undefined;
      expect(stored).toEqual({
        id: record!.id,
        author: "designer",
        surface_id: surfaceId
      });
    } finally {
      db.close();
    }
  });

  test("designer media drag persists the raw gesture rect and projects its marker", async ({
    page,
    runtime,
    folder
  }) => {
    const { token, surfaceId } = await openSeededWorkbench({
      page,
      runtime,
      folder
    });
    const box = await mediaBox(page);
    await page.getByTestId("annotate-button").click();

    const start = {
      x: box.x + box.width * 0.2,
      y: box.y + box.height * 0.25
    };
    const end = {
      x: box.x + box.width * 0.65,
      y: box.y + box.height * 0.7
    };

    const createRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/region-annotation"
    );
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();
    await createRequest;

    let record: AnnotationRecord | undefined;
    await expect
      .poll(async () => {
        record = (await listAnnotations(token, runtime.port))[0];
        return record?.id;
      })
      .toBeTruthy();

    expect(record!.surface_id).toBe(surfaceId);
    expect(record!.author).toBe("designer");
    expect(record!.rect_x).toBeCloseTo(0.2, 1);
    expect(record!.rect_y).toBeCloseTo(0.25, 1);
    expect(record!.rect_w).toBeCloseTo(0.45, 1);
    expect(record!.rect_h).toBeCloseTo(0.45, 1);

    const marker = page.getByTestId("region-annotation");
    await expect(marker).toHaveAttribute("data-runtime-record-id", record!.id);
    await expect(marker).toHaveAttribute("data-author", "designer");
  });

  test("selecting a designer marker and pressing Delete removes Runtime record and marker", async ({
    page,
    runtime,
    folder
  }) => {
    const { token } = await openSeededWorkbench({ page, runtime, folder });
    const box = await mediaBox(page);
    const annotate = page.getByTestId("annotate-button");
    await annotate.click();

    const createRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/region-annotation"
    );
    await page.mouse.click(
      box.x + box.width * 0.5,
      box.y + box.height * 0.5
    );
    await createRequest;

    let annotationId = "";
    await expect
      .poll(async () => {
        annotationId = (await listAnnotations(token, runtime.port))[0]?.id ?? "";
        return annotationId;
      })
      .not.toBe("");

    const marker = page.locator(
      `[data-testid="region-annotation"][data-runtime-record-id="${annotationId}"]`
    );
    await expect(marker).toHaveCount(1);

    await annotate.click();
    await expect(annotate).toHaveAttribute("aria-pressed", "false");
    await marker.click();
    await expect(marker).toHaveAttribute("data-selected", "true");

    const deleteRequest = page.waitForRequest(
      (request) =>
        request.method() === "DELETE" &&
        new URL(request.url()).pathname === "/api/region-annotation"
    );
    await page.keyboard.press("Delete");
    const request = await deleteRequest;
    expect(new URL(request.url()).searchParams.get("id")).toBe(annotationId);

    await expect
      .poll(async () => (await listAnnotations(token, runtime.port)).length)
      .toBe(0);
    await expect(marker).toHaveCount(0);
  });
});
