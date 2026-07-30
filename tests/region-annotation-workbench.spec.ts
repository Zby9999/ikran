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
    rmSync(folder, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50
    });
  }
});

const MOCK_FIGMA_URL =
  "https://www.figma.com/design/AbCdEfGh/Mock?node-id=1-2";

type AnnotationRecord = {
  id: string;
  surface_id: string;
  author: "designer" | "agent";
  type?: string;
  body?: string;
  section?: string | null;
  rect_x: number;
  rect_y: number;
  rect_w: number;
  rect_h: number;
};

// Issue 08A — pointer-up opens the entry form; the POST fires only after the
// designer submits the body. Section is implicit: the stage currently in view
// (default design-principle), never chosen in the form (Figma 670:891).
async function submitAnnotationEntry(
  page: import("@playwright/test").Page,
  body: string
) {
  const input = page.getByTestId("designer-annotation-entry-input");
  await expect(input).toBeVisible();
  await input.fill(body);
  await page.getByTestId("designer-annotation-entry-submit").click();
}

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

async function enterWorkbench(
  page: import("@playwright/test").Page,
  opts: { port: number; sessionToken: string }
) {
  const { connectFigmaForTests } = await import("./helpers/figma-connection");
  await connectFigmaForTests(opts.port, opts.sessionToken);

  const onWorkbench = await page.getByTestId("seed-workbench").isVisible();
  if (onWorkbench) {
    if (
      (await page.getByTestId("seed-workbench").getAttribute("data-figma-gate")) !==
      "open"
    ) {
      await page.reload();
    }
    await expect(page.getByTestId("seed-workbench")).toBeVisible();
    await expect(page.getByTestId("seed-workbench")).toHaveAttribute(
      "data-figma-gate",
      "open"
    );
    return;
  }

  await expect(page.getByTestId("project-path")).toHaveText(/.+/, {
    timeout: 15000
  });
  const startButton = page.getByRole("button", { name: "Start Building" });
  await expect(startButton).toBeEnabled();
  await startButton.click();
  await expect(page.getByTestId("seed-workbench")).toBeVisible();
  await expect(page.getByTestId("seed-workbench")).toHaveAttribute(
    "data-figma-gate",
    "open"
  );
}

async function seedEvidenceSurface({
  token,
  port
}: {
  token: string;
  port: number;
}): Promise<string> {
  const { connectFigmaForTests } = await import("./helpers/figma-connection");
  await connectFigmaForTests(port, token);
  const captureRes = await rawPost(
    "/api/seed-capture",
    {
      figmaSeedReference: MOCK_FIGMA_URL,
      referenceNote: "Issue 06 designer gesture annotation."
    },
    { "x-ikran-session": token },
    port
  );
  expect(captureRes.status).toBe(200);
  return (JSON.parse(captureRes.body).surface as { id: string }).id;
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
  await enterWorkbench(page, { port: runtime.port, sessionToken: token });

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

  // Regression: Agent tools return workbench_url; opening/reloading that URL must
  // NOT bounce the designer back to Project Setup (ephemeral showSeedWorkbench).
  test("reloading Workbench URL after Start Building stays on seed canvas", async ({
    page,
    runtime,
    folder
  }) => {
    await openSeededWorkbench({ page, runtime, folder });
    await expect(page.getByTestId("seed-workbench")).toBeVisible();

    // Agent create_region_annotation / open_workbench reopens the Workbench URL.
    await page.reload();

    await expect(page.getByTestId("seed-workbench")).toBeVisible({
      timeout: 15_000
    });
    await expect(
      page.getByRole("button", { name: "Start Building" })
    ).toHaveCount(0);
  });

  test("MCP Workbench URL with view=workbench opens seed canvas when bound", async ({
    page,
    runtime,
    folder
  }) => {
    const token = await captureToken(page, runtime.baseURL);
    await bindFolder(token, folder, runtime.port);
    await seedEvidenceSurface({ token, port: runtime.port });

    const { connectFigmaForTests } = await import("./helpers/figma-connection");
    await connectFigmaForTests(runtime.port, token);

    // Same shape as composeWorkbenchUrl / create_region_annotation workbench_url.
    await page.goto(
      `${runtime.baseURL}/?session=${encodeURIComponent(token)}&view=workbench`
    );

    await expect(page.getByTestId("seed-workbench")).toBeVisible({
      timeout: 15_000
    });
    await expect(
      page.getByRole("button", { name: "Start Building" })
    ).toHaveCount(0);
  });

  test("Annotate toggle + Agent annotation projects as marker via SSE", async ({
    page,
    runtime,
    folder
  }) => {
    const token = await captureToken(page, runtime.baseURL);
    await bindFolder(token, folder, runtime.port);

    const surfaceId = await seedEvidenceSurface({
      token,
      port: runtime.port
    });

    await page.reload();
    await enterWorkbench(page, { port: runtime.port, sessionToken: token });

    const annotate = page.getByTestId("annotate-button");
    const select = page.getByTestId("select-button");
    await expect(annotate).toBeVisible();
    await expect(select).toBeVisible();
    await expect(select).toHaveAttribute("aria-pressed", "true");
    await expect(select).toHaveAttribute("data-active", "true");
    await expect(annotate).toHaveAttribute("aria-pressed", "false");
    await annotate.click();
    await expect(select).toHaveAttribute("aria-pressed", "false");
    await expect(annotate).toHaveAttribute("aria-pressed", "true");
    await expect(annotate).toHaveAttribute("data-active", "true");
    await select.click();
    await expect(select).toHaveAttribute("aria-pressed", "true");
    await expect(annotate).toHaveAttribute("aria-pressed", "false");

    // Tool hotkeys: F → Annotate, V → select.
    await page.keyboard.press("f");
    await expect(select).toHaveAttribute("aria-pressed", "false");
    await expect(annotate).toHaveAttribute("aria-pressed", "true");
    await expect(annotate).toHaveAttribute("data-active", "true");
    const tldraw = page.locator(".tl-container");
    await expect(tldraw).toHaveAttribute(
      "style",
      /--tl-cursor: var\(--tl-cursor-cross\)/
    );
    // Esc makes tldraw leave a custom tool. The controlled Annotation mode
    // must immediately reassert it so button state, cursor, and Frame hover
    // never drift apart.
    await page.keyboard.press("Escape");
    await expect(annotate).toHaveAttribute("aria-pressed", "true");
    await expect(tldraw).toHaveAttribute(
      "style",
      /--tl-cursor: var\(--tl-cursor-cross\)/
    );
    await page.keyboard.press("v");
    await expect(select).toHaveAttribute("aria-pressed", "true");
    await expect(select).toHaveAttribute("data-active", "true");
    await expect(annotate).toHaveAttribute("aria-pressed", "false");
    await expect(annotate).not.toHaveAttribute("data-active", "true");

    // Agent-written annotation invalidates the Workbench via SSE (no reload).
    const annRes = await rawPost(
      "/api/region-annotation",
      {
        target: {
          kind: "figma-region",
          surfaceArtifactId: surfaceId,
          rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.25 }
        },
        author: "agent",
        body: "Agent observed this region",
        type: "assumption"
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

    await page.mouse.click(
      box.x + box.width * 0.4,
      box.y + box.height * 0.45
    );

    // While the entry waits, a dashed connector bridges the marker and the
    // out-of-frame entry box so the form can be found from far away (08A).
    const entryConnector = page.getByTestId(
      "designer-annotation-entry-connector"
    );
    await expect(entryConnector).toBeVisible();
    const entryLine = entryConnector.locator("line");
    const [x1, x2] = [
      Number(await entryLine.getAttribute("x1")),
      Number(await entryLine.getAttribute("x2"))
    ];
    expect(Math.abs(x2 - x1)).toBeGreaterThan(0);

    const createRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/region-annotation"
    );
    await submitAnnotationEntry(page, "Move this toolbar 8px up");
    const request = await createRequest;
    const requestBody = request.postDataJSON() as {
      author: string;
      body: string;
      section: string;
      target: { kind: string; surfaceArtifactId: string };
    };
    expect(requestBody.author).toBe("designer");
    expect(requestBody.body).toBe("Move this toolbar 8px up");
    // Section = the stage currently in view (default), never form-chosen.
    expect(requestBody.section).toBe("design-principle");
    expect(requestBody.target.kind).toBe("figma-region");
    expect(requestBody.target.surfaceArtifactId).toBe(surfaceId);

    let record: AnnotationRecord | undefined;
    await expect
      .poll(async () => {
        record = (await listAnnotations(token, runtime.port))[0];
        return record?.id;
      })
      .toBeTruthy();

    expect(record!.surface_id).toBe(surfaceId);
    expect(record!.author).toBe("designer");
    expect(record!.type).toBe("designer_annotation");
    expect(record!.body).toBe("Move this toolbar 8px up");
    expect(record!.section).toBe("design-principle");
    expect(record!.rect_x).toBeGreaterThanOrEqual(0);
    expect(record!.rect_y).toBeGreaterThanOrEqual(0);
    expect(record!.rect_w).toBeGreaterThan(0);
    expect(record!.rect_h).toBeGreaterThan(0);
    expect(record!.rect_x + record!.rect_w).toBeLessThanOrEqual(1);
    expect(record!.rect_y + record!.rect_h).toBeLessThanOrEqual(1);

    const marker = page.getByTestId("region-annotation");
    await expect(marker).toHaveAttribute("data-runtime-record-id", record!.id);
    await expect(marker).toHaveAttribute("data-author", "designer");

    // Filled designer annotations project a green side card (08A).
    const card = page.getByTestId("designer-annotation-card");
    await expect(card).toHaveAttribute("data-runtime-record-id", record!.id);
    await expect(card).toHaveAttribute("data-section", "design-principle");
    await expect(card).toContainText("Move this toolbar 8px up");

    // Direct DB proof complements the API assertion above.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(path.join(folder, ".ikran", "ikran.db"));
    try {
      const stored = db
        .prepare(
          "SELECT id, author, surface_id, type, section FROM region_annotations WHERE id = ?"
        )
        .get(record!.id) as
        | {
            id: string;
            author: string;
            surface_id: string;
            type: string;
            section: string;
          }
        | undefined;
      expect(stored).toEqual({
        id: record!.id,
        author: "designer",
        surface_id: surfaceId,
        type: "designer_annotation",
        section: "design-principle"
      });
    } finally {
      db.close();
    }
  });

  test("designer pending entry box auto-grows with multiline input and stays centered on the connector", async ({
    page,
    runtime,
    folder
  }) => {
    await openSeededWorkbench({ page, runtime, folder });
    const box = await mediaBox(page);
    await page.getByTestId("annotate-button").click();
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.45);
    const entry = page.getByTestId("designer-annotation-entry");
    await expect(entry).toBeVisible();
    const heightOf = () =>
      entry.evaluate((el) => (el as HTMLElement).offsetHeight);
    const initialHeight = await heightOf();
    expect(initialHeight).toBeGreaterThanOrEqual(56);
    await page
      .getByTestId("designer-annotation-entry-input")
      .fill("Line one\nLine two\nLine three\nLine four");
    await expect.poll(heightOf).toBeGreaterThan(initialHeight + 30);
    // The anchor is centered on the marker midline, so growth stays symmetric around the dashed connector.
    await expect(page.getByTestId("designer-annotation-entry-anchor")).toHaveCSS(
      "transform",
      /matrix/
    );
  });

  test("submitted designer card fits a multiline CJK body without clipping", async ({
    page,
    runtime,
    folder
  }) => {
    await openSeededWorkbench({ page, runtime, folder });
    const box = await mediaBox(page);
    await page.getByTestId("annotate-button").click();
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.45);
    const entry = page.getByTestId("designer-annotation-entry");
    await expect(entry).toBeVisible();
    const text =
      "左上角的黑白插图需要跟底部左边的插图一一对应，这里继续增加更多文字让内容换到第二行第三行。";
    await page.getByTestId("designer-annotation-entry-input").fill(text);
    await page.getByTestId("designer-annotation-entry-submit").click();

    const card = page.getByTestId("designer-annotation-card").first();
    await expect(card).toBeVisible();
    await expect(card.locator(".designer-annotation-card__body")).toHaveText(
      text
    );
    // Regression guard: the char-count estimate sized this body for ~2 lines;
    // the DOM-measured height must fit the real wrapped render (3+ lines).
    await expect
      .poll(() => card.evaluate((el) => (el as HTMLElement).offsetHeight))
      .toBeGreaterThan(68);
    const clipped = await card.evaluate((el) => {
      const article = el.querySelector(".designer-annotation-card");
      if (!article) return null;
      return article.scrollHeight > article.clientHeight + 1;
    });
    expect(clipped).toBe(false);
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

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();

    const createRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/region-annotation"
    );
    await submitAnnotationEntry(page, "Tighten this region's spacing");
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

  test("Delete removes the full designer annotation and Command-Z restores its region and text", async ({
    page,
    runtime,
    folder
  }) => {
    const { token } = await openSeededWorkbench({ page, runtime, folder });
    const box = await mediaBox(page);
    const annotate = page.getByTestId("annotate-button");
    await annotate.click();

    await page.mouse.click(
      box.x + box.width * 0.5,
      box.y + box.height * 0.5
    );
    const createRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/region-annotation"
    );
    await submitAnnotationEntry(page, "Delete me");
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
    const card = page.locator(
      `[data-testid="designer-annotation-card"][data-runtime-record-id="${annotationId}"]`
    );
    const connector = page.locator(
      `[data-testid="designer-annotation-connector"][data-runtime-record-id="${annotationId}"]`
    );
    await expect(marker).toHaveCount(1);
    await expect(card).toContainText("Delete me");
    await expect(connector).toHaveCount(1);

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
    await expect(card).toHaveCount(0);
    await expect(connector).toHaveCount(0);

    const restoreRequest = page.waitForRequest(
      (request) =>
        request.method() === "PUT" &&
        new URL(request.url()).pathname === "/api/region-annotation"
    );
    await page.keyboard.press("Meta+z");
    const restore = await restoreRequest;
    expect(restore.postDataJSON()).toEqual({ annotationId });

    await expect
      .poll(async () => (await listAnnotations(token, runtime.port))[0]?.body)
      .toBe("Delete me");
    await expect(marker).toHaveCount(1);
    await expect(card).toContainText("Delete me");
    await expect(connector).toHaveCount(1);
  });

  test("clicking a filled card edits its body through Runtime PATCH", async ({
    page,
    runtime,
    folder
  }) => {
    const { token } = await openSeededWorkbench({ page, runtime, folder });
    const box = await mediaBox(page);
    await page.getByTestId("annotate-button").click();

    await page.mouse.click(
      box.x + box.width * 0.5,
      box.y + box.height * 0.5
    );
    const createRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/region-annotation"
    );
    await submitAnnotationEntry(page, "First pass");
    await createRequest;

    let annotationId = "";
    await expect
      .poll(async () => {
        annotationId = (await listAnnotations(token, runtime.port))[0]?.id ?? "";
        return annotationId;
      })
      .not.toBe("");

    // Click the filled card → pre-filled edit form (Figma 646:1320 lower card).
    const card = page.getByTestId("designer-annotation-card");
    await expect(card).toHaveAttribute("data-runtime-record-id", annotationId);
    await card.click();
    await expect(card).toHaveAttribute("data-editing", "true");

    const editInput = page.getByTestId("designer-annotation-card-edit-input");
    await expect(editInput).toBeVisible();
    await expect(editInput).toHaveValue("First pass");
    await editInput.fill("Second pass — tightened spacing");

    const patchRequest = page.waitForRequest(
      (request) =>
        request.method() === "PATCH" &&
        new URL(request.url()).pathname === "/api/region-annotation"
    );
    await page.getByTestId("designer-annotation-card-edit-submit").click();
    const request = await patchRequest;
    const requestBody = request.postDataJSON() as {
      annotationId: string;
      body: string;
    };
    expect(requestBody.annotationId).toBe(annotationId);
    expect(requestBody.body).toBe("Second pass — tightened spacing");

    await expect
      .poll(
        async () => (await listAnnotations(token, runtime.port))[0]?.body ?? ""
      )
      .toBe("Second pass — tightened spacing");
    await expect(card).toHaveAttribute("data-editing", "false");
    await expect(card).toContainText("Second pass — tightened spacing");

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(path.join(folder, ".ikran", "ikran.db"));
    try {
      const stored = db
        .prepare("SELECT body FROM region_annotations WHERE id = ?")
        .get(annotationId) as { body: string } | undefined;
      expect(stored?.body).toBe("Second pass — tightened spacing");
      const types = (
        db.prepare("SELECT type FROM events ORDER BY id ASC").all() as Array<{
          type: string;
        }>
      ).map((r) => r.type);
      expect(types).toContain("annotation_body_updated");
    } finally {
      db.close();
    }
  });
});
