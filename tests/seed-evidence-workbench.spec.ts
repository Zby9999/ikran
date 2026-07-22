import { expect, test as base } from "./fixtures";
import {
  existsSync,
  mkdtempSync,
  rmSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  rawDelete as httpDelete,
  rawGet as httpGet,
  rawPatch as httpPatch,
  rawPost as httpPost
} from "./helpers/http";
import { connectFigmaForTests } from "./helpers/figma-connection";
import {
  claimAlignmentPreparationCommand,
  finalizeAlignmentPreparation
} from "../lib/runtime/alignment-agent-command";
import { waitForAgentCommand } from "../lib/runtime/adaptive-agent-wait";
import {
  ALIGNMENT_SECTIONS,
  createQuestionCard
} from "../lib/runtime/design-intent-alignment";

// Issue 02/04 — tldraw Workbench shell + Agent-first seed projection.
//
// Active seed write path (Issue 05A / 05D / ADR 0003):
//   Figma Connection + POST /api/seed-reference (or /api/seed-capture)
//   → atomic Seed + Evidence Surface → Workbench projects from GET records
//
// POST /api/evidence-package is retired. Workbench has no EnterPanel / URL /
// intent write UI.

const test = base.extend<{ folder: string }>({
  folder: async ({}, use) => {
    const folder = mkdtempSync(path.join(tmpdir(), "ikran-e2e-04-"));
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

function rawPatch(
  route: string,
  body: unknown,
  headers: Record<string, string>,
  port: number
) {
  return httpPatch(port, route, body, {
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

/** Agent HTTP Active path: connect + POST /api/seed-reference (capture). */
async function agentCaptureSeed(
  token: string,
  port: number,
  opts?: { figmaSeedReference?: string; referenceNote?: string }
): Promise<{
  status: number;
  body: string;
  record: { id: string; registered_via?: string };
  surface: { id: string; frame_name: string };
}> {
  await connectFigmaForTests(port, token);
  const res = await rawPost(
    "/api/seed-reference",
    {
      figmaSeedReference: opts?.figmaSeedReference ?? MOCK_FIGMA_URL,
      ...(opts?.referenceNote !== undefined
        ? { referenceNote: opts.referenceNote }
        : {})
    },
    { "x-ikran-session": token },
    port
  );
  const parsed = JSON.parse(res.body) as {
    ok?: boolean;
    record?: { id: string; registered_via?: string };
    surface?: { id: string; frame_name: string };
  };
  return {
    status: res.status,
    body: res.body,
    record: parsed.record as { id: string; registered_via?: string },
    surface: parsed.surface as { id: string; frame_name: string }
  };
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

async function enterWorkbench(
  page: import("@playwright/test").Page,
  opts?: { port: number; sessionToken: string }
) {
  if (opts) {
    await connectFigmaForTests(opts.port, opts.sessionToken);
  }

  const workbench = page.getByTestId("seed-workbench");
  const startButton = page.getByRole("button", { name: "Start Building" });

  // Hydration race: view=workbench may paint setup briefly before bind resolves.
  await expect
    .poll(
      async () => {
        if (await workbench.isVisible()) return "workbench";
        if (await startButton.isVisible()) {
          const pathText = await page.getByTestId("project-path").textContent();
          if (pathText && pathText.trim().length > 0) return "setup";
        }
        return null;
      },
      { timeout: 15000 }
    )
    .toBeTruthy();

  if (await workbench.isVisible()) {
    if ((await workbench.getAttribute("data-figma-gate")) !== "open") {
      await page.reload();
      await expect(workbench).toBeVisible({ timeout: 15000 });
    }
    await expect(workbench).toHaveAttribute("data-figma-gate", "open");
    return;
  }

  await expect(startButton).toBeEnabled();
  await startButton.click();
  await expect(workbench).toBeVisible();
  await expect(workbench).toHaveAttribute("data-figma-gate", "open");
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
    rmSync(path.join(runtime.stateDir, "runtime-state.json"), { force: true });
  });

  test("Shutdown expands to the Figma confirmation, dismisses outside, and stops only on Yes", async ({
    page,
    runtime,
    folder
  }) => {
    const token = await captureToken(page, runtime.baseURL);
    await bindFolder(token, folder, runtime.port);
    await page.reload();
    await enterWorkbench(page, { port: runtime.port, sessionToken: token });

    let stopRequests = 0;
    await page.route("**/api/runtime/stop", async (route) => {
      stopRequests += 1;
      await route.fulfill({ status: 202, contentType: "application/json", body: '{"ok":true,"status":"stopping"}' });
    });

    const trigger = page.getByTestId("runtime-shutdown");
    await trigger.click();
    const confirmation = page.getByTestId("runtime-shutdown-confirmation");
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText("Are you sure you want to shut down ikran?");
    await expect(confirmation.getByRole("button", { name: "Yes" })).toBeVisible();

    await page.mouse.click(500, 100);
    await expect(confirmation).toBeHidden();
    await expect(trigger).toBeVisible();
    expect(stopRequests).toBe(0);

    await trigger.click();
    await confirmation.getByRole("button", { name: "Yes" }).click();
    await expect.poll(() => stopRequests).toBe(1);
  });

  test("Start Building opens tldraw; Agent-captured seed projects; no UI seed write", async ({
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
        seedReferencePostsFromUi.push(url);
      }
    });

    const note = "Agent-first: tldraw projects a Runtime seed record.";
    const captured = await agentCaptureSeed(token, runtime.port, {
      referenceNote: note
    });
    expect(captured.status).toBe(200);
    expect(captured.record.id).toBeTruthy();
    expect(captured.record.registered_via).toBe("agent");
    expect(captured.surface.frame_name).toBe("Mock Frame");

    const description = "Shared design language for Agent-first projection.";
    const readiness = await rawPatch(
      "/api/project/readiness",
      { designLanguageDescription: description },
      { "x-ikran-session": token, "content-type": "application/json" },
      runtime.port
    );
    expect(readiness.status).toBe(200);

    await page.reload();
    await enterWorkbench(page, { port: runtime.port, sessionToken: token });

    const workbench = page.getByTestId("seed-workbench");
    await expect(workbench).toHaveAttribute("data-canvas-engine", "tldraw");

    await expect(workbench.locator("svg.react-flow__background")).toHaveCount(0);
    await expect(workbench.locator(".react-flow__viewport")).toHaveCount(0);
    await expect(page.getByTestId("workbench-canvas")).toBeVisible();
    await expect(workbench.locator(".tl-container")).toBeVisible();

    await assertNoWorkbenchSeedWriteUi(page);

    const projection = page.getByTestId("seed-reference-projection");
    await expect(projection).toBeVisible();
    await expect(projection).toHaveAttribute(
      "data-kind",
      "figma_evidence_surface"
    );
    await expect(projection).toHaveAttribute(
      "data-surface-record-id",
      captured.surface.id
    );
    await expect(projection).toHaveAttribute(
      "data-seed-record-id",
      captured.record.id
    );
    await expect(projection.getByTestId("seed-reference-projection-title")).toHaveText(
      "Mock Frame"
    );
    await expect(projection.getByTestId("seed-reference-projection-media")).toBeVisible();
    await expect(
      projection.getByTestId("seed-reference-projection-screenshot")
    ).toBeVisible();
    await expect(
      projection.getByTestId("seed-reference-projection-awaiting")
    ).toHaveCount(0);
    await expect(projection.getByTestId("seed-reference-projection-url")).toHaveCount(0);

    await projection.getByTestId("seed-reference-projection-info").click();
    const descriptionPanel = projection.getByTestId(
      "seed-reference-description-panel"
    );
    await expect(descriptionPanel).toBeVisible();
    await expect(
      projection.getByTestId("seed-reference-description-text")
    ).toContainText("Shared design language");

    await projection.getByTestId("seed-reference-projection-notes").click();
    await expect(
      projection.getByTestId("seed-reference-notes-panel")
    ).toBeVisible();
    await expect(
      projection.getByTestId("seed-reference-notes-text")
    ).toContainText("Agent-first");
    await expect(descriptionPanel).toHaveCount(0);

    const records = readSeedReferences(folder);
    expect(records.length).toBe(1);
    expect(records[0].registered_via).toBe("agent");
    const eventTypes = readEvents(folder).map((e) => e.type);
    expect(eventTypes).toContain("seed_reference_registered");
    expect(eventTypes).toContain("evidence_package_recorded");
    expect(tasksRequests).toEqual([]);
    expect(figmaValidateRequests).toEqual([]);
    expect(seedReferencePostsFromUi).toEqual([]);
  });

  test("07A: Next Phase persists Alignment preparation and survives reload", async ({
    page,
    runtime,
    folder
  }) => {
    const token = await captureToken(page, runtime.baseURL);
    await bindFolder(token, folder, runtime.port);
    const captured = await agentCaptureSeed(token, runtime.port, {
      referenceNote: "Immutable preparation snapshot"
    });
    expect(captured.status).toBe(200);

    const description = "A calm, precise product language";
    const readiness = await rawPatch(
      "/api/project/readiness",
      { designLanguageDescription: description },
      { "x-ikran-session": token, "content-type": "application/json" },
      runtime.port
    );
    expect(readiness.status).toBe(200);

    await page.reload();
    await enterWorkbench(page, {
      port: runtime.port,
      sessionToken: token
    });

    const workbench = page.getByTestId("seed-workbench");
    await expect(workbench).toHaveAttribute(
      "data-alignment-workflow-stage",
      "seed-reference-registration"
    );
    await expect(workbench).toHaveAttribute("data-canvas-stage", "sign-seed");

    await page.getByTestId("sign-seed-next-phase").click();
    await expect(workbench).toHaveAttribute(
      "data-alignment-workflow-stage",
      "alignment-preparing"
    );
    await expect(workbench).toHaveAttribute("data-canvas-stage", "extraction");
    await expect(page.getByTestId("sign-seed-next-phase")).toHaveCount(0);

    const alignmentResponse = await rawGet(
      "/api/design-intent-alignment",
      { "x-ikran-session": token },
      runtime.port
    );
    expect(alignmentResponse.status).toBe(200);
    const alignment = JSON.parse(alignmentResponse.body) as {
      preparation: {
        workflow: { stage: string };
        current_attempt: { status: string };
        input_snapshot: {
          data: {
            design_language_description: string;
            seed_references: Array<{
              id: string;
              reference_note: string;
              evidence_version: { id: string };
            }>;
          };
        };
        commands: Array<{ command_type: string; status: string }>;
      };
    };
    expect(alignment.preparation).toMatchObject({
      workflow: { stage: "alignment-preparing" },
      current_attempt: { status: "preparing" },
      input_snapshot: {
        data: {
          design_language_description: description,
          seed_references: [
            {
              id: captured.record.id,
              reference_note: "Immutable preparation snapshot",
              evidence_version: { id: captured.surface.id }
            }
          ]
        }
      },
      commands: [
        {
          command_type: "prepare_design_intent_alignment",
          status: "pending"
        }
      ]
    });

    await page.reload();
    await enterWorkbench(page, {
      port: runtime.port,
      sessionToken: token
    });
    await expect(workbench).toHaveAttribute(
      "data-alignment-workflow-stage",
      "alignment-preparing"
    );
    await expect(workbench).toHaveAttribute("data-canvas-stage", "extraction");
  });

  test("07D: Back abandons preparing/answering attempts and regenerated questions replace current reads", async ({
    page,
    runtime,
    folder
  }) => {
    const token = await captureToken(page, runtime.baseURL);
    await bindFolder(token, folder, runtime.port);
    const captured = await agentCaptureSeed(token, runtime.port, {
      referenceNote: "Attempt one"
    });
    await rawPatch(
      "/api/project/readiness",
      { designLanguageDescription: "Regenerated alignment" },
      { "x-ikran-session": token, "content-type": "application/json" },
      runtime.port
    );
    await page.reload();
    await enterWorkbench(page, { port: runtime.port, sessionToken: token });
    await page.getByTestId("sign-seed-next-phase").click();

    const readAttempt = async () => {
      const response = await rawGet(
        "/api/design-intent-alignment",
        { "x-ikran-session": token },
        runtime.port
      );
      return JSON.parse(response.body).preparation.current_attempt.id as string;
    };
    const anchor = {
      kind: "single",
      target: {
        kind: "surface",
        seedReferenceId: captured.record.id,
        evidenceSurfaceId: captured.surface.id,
        evidenceVersionId: captured.surface.id
      }
    };
    const claim = async () => {
      for (let retry = 0; retry < 5; retry += 1) {
        const result = claimAlignmentPreparationCommand(folder);
        if (result.ok || result.reason !== "db_error") return result;
        await page.waitForTimeout(25);
      }
      return claimAlignmentPreparationCommand(folder);
    };
    const create = async (attemptId: string, section: string, index: number) => {
      for (let retry = 0; retry < 5; retry += 1) {
        const result = createQuestionCard(folder, {
          alignmentAttemptId: attemptId,
          idempotencyKey: `${attemptId}:${section}:${index}`,
          section,
          observation: `${section} ${index}`,
          question: `Question ${index} for ${section}?`,
          proposedAnswer: `Proposal ${index}`,
          anchor
        });
        if (result.ok || result.reason !== "db_error") return result;
        await page.waitForTimeout(25);
      }
      return createQuestionCard(folder, {
        alignmentAttemptId: attemptId,
        idempotencyKey: `${attemptId}:${section}:${index}`,
        section,
        observation: `${section} ${index}`,
        question: `Question ${index} for ${section}?`,
        proposedAnswer: `Proposal ${index}`,
        anchor
      });
    };

    const firstAttempt = await readAttempt();
    expect((await claim()).ok).toBe(true);
    const oldPreparingCard = await create(firstAttempt, "design-principle", 1);
    expect(oldPreparingCard.ok).toBe(true);
    await page.reload();
    await enterWorkbench(page, { port: runtime.port, sessionToken: token });
    await page.getByRole("button", { name: "Back to Seed Reference" }).click();
    await expect(page.getByTestId("seed-workbench")).toHaveAttribute(
      "data-alignment-workflow-stage",
      "seed-reference-registration"
    );
    await expect(page.getByTestId("sign-seed-next-phase")).toBeVisible();
    await expect(page.getByText("design-principle 1", { exact: true })).toHaveCount(0);

    await page.getByTestId("sign-seed-next-phase").click();
    const secondAttempt = await readAttempt();
    expect(secondAttempt).not.toBe(firstAttempt);
    expect((await claim()).ok).toBe(true);
    let firstAnsweringCard = "";
    for (const section of ALIGNMENT_SECTIONS) {
      for (let index = 1; index <= 2; index += 1) {
        const created = await create(secondAttempt, section, index);
        expect(created, JSON.stringify(created)).toMatchObject({ ok: true });
        if (created.ok && !firstAnsweringCard) firstAnsweringCard = created.record.id;
      }
    }
    expect(finalizeAlignmentPreparation(folder, secondAttempt).ok).toBe(true);
    await page.reload();
    await enterWorkbench(page, { port: runtime.port, sessionToken: token });
    await expect(page.getByTestId("seed-workbench")).toHaveAttribute(
      "data-alignment-workflow-stage",
      "alignment-answering"
    );
    await page.getByRole("button", { name: "Back to Seed Reference" }).click();
    await expect(page.getByTestId("seed-workbench")).toHaveAttribute(
      "data-alignment-workflow-stage",
      "seed-reference-registration"
    );
    expect(createQuestionCard(folder, {
      alignmentAttemptId: secondAttempt,
      idempotencyKey: "stale-write",
      section: "layout",
      observation: "Stale write",
      question: "Should this be rejected?",
      proposedAnswer: "Yes",
      anchor
    })).toEqual({ ok: false, reason: "stale_alignment_attempt" });
    expect(firstAnsweringCard).toBeTruthy();
  });

  test("07E: Complete atomically advances to durable Initial Design System preparation", async ({
    page,
    runtime,
    folder
  }) => {
    const token = await captureToken(page, runtime.baseURL);
    await bindFolder(token, folder, runtime.port);
    const captured = await agentCaptureSeed(token, runtime.port, {
      referenceNote: "Completion handoff"
    });
    await rawPatch(
      "/api/project/readiness",
      { designLanguageDescription: "Completion handoff" },
      { "x-ikran-session": token, "content-type": "application/json" },
      runtime.port
    );
    await page.reload();
    await enterWorkbench(page, { port: runtime.port, sessionToken: token });
    await page.getByTestId("sign-seed-next-phase").click();

    const preparationResponse = await rawGet(
      "/api/design-intent-alignment",
      { "x-ikran-session": token },
      runtime.port
    );
    const attemptId = JSON.parse(preparationResponse.body).preparation
      .current_attempt.id as string;
    let claim = claimAlignmentPreparationCommand(folder);
    for (let retry = 0; !claim.ok && claim.reason === "db_error" && retry < 4; retry += 1) {
      await page.waitForTimeout(25);
      claim = claimAlignmentPreparationCommand(folder);
    }
    expect(claim.ok).toBe(true);
    const anchor = {
      kind: "single",
      target: {
        kind: "surface",
        seedReferenceId: captured.record.id,
        evidenceSurfaceId: captured.surface.id,
        evidenceVersionId: captured.surface.id
      }
    };
    for (const section of ALIGNMENT_SECTIONS) {
      for (let index = 1; index <= 2; index += 1) {
        let created = createQuestionCard(folder, {
          alignmentAttemptId: attemptId,
          idempotencyKey: `07e:${section}:${index}`,
          section,
          observation: `${section} ${index}`,
          question: `Question ${index} for ${section}?`,
          proposedAnswer: `Proposal ${index} for ${section}`,
          anchor
        });
        for (let retry = 0; !created.ok && created.reason === "db_error" && retry < 4; retry += 1) {
          await page.waitForTimeout(25);
          created = createQuestionCard(folder, {
            alignmentAttemptId: attemptId,
            idempotencyKey: `07e:${section}:${index}`,
            section,
            observation: `${section} ${index}`,
            question: `Question ${index} for ${section}?`,
            proposedAnswer: `Proposal ${index} for ${section}`,
            anchor
          });
        }
        expect(created, JSON.stringify(created)).toMatchObject({ ok: true });
      }
    }
    let finalized = finalizeAlignmentPreparation(folder, attemptId);
    for (let retry = 0; !finalized.ok && finalized.reason === "db_error" && retry < 4; retry += 1) {
      await page.waitForTimeout(25);
      finalized = finalizeAlignmentPreparation(folder, attemptId);
    }
    expect(finalized, JSON.stringify(finalized)).toMatchObject({ ok: true });

    await page.reload();
    await enterWorkbench(page, { port: runtime.port, sessionToken: token });
    const workbench = page.getByTestId("seed-workbench");
    await expect(workbench).toHaveAttribute(
      "data-alignment-workflow-stage",
      "alignment-answering"
    );
    await page.getByRole("button", { name: "Open question 1 editor" }).click();
    await page.getByRole("textbox", { name: "Answer question 1" }).fill(
      "Designer-approved final answer"
    );
    await page.getByRole("button", { name: "Submit answer 1" }).click();
    await expect.poll(async () => {
      const response = await rawGet(
        "/api/design-intent-alignment",
        { "x-ikran-session": token },
        runtime.port
      );
      return JSON.parse(response.body).question_cards[0].final_answer;
    }).toBe("Designer-approved final answer");

    const waiting = waitForAgentCommand(folder, { windowMs: 5_000 });
    await page.getByRole("navigation", {
      name: "Design intent alignment stages"
    }).hover();
    await page.getByRole("button", { name: "Complete alignment" }).click();
    await expect(workbench).toHaveAttribute(
      "data-alignment-workflow-stage",
      "initial-design-system-preparing"
    );
    await expect(workbench).toHaveAttribute(
      "data-agent-command-status",
      "pending"
    );
    await expect(waiting).resolves.toMatchObject({
      reason: "command_available",
      command: {
        command_type: "prepare_initial_design_system",
        alignment_attempt_id: attemptId
      }
    });

    const completedResponse = await rawGet(
      "/api/design-intent-alignment",
      { "x-ikran-session": token },
      runtime.port
    );
    const completed = JSON.parse(completedResponse.body) as {
      alignment: { status: string };
      preparation: {
        workflow: { stage: string };
        current_attempt: { status: string };
        commands: Array<{
          command_type: string;
          status: string;
          payload: { question_cards: unknown[] };
        }>;
      };
    };
    expect(completed).toMatchObject({
      alignment: { status: "completed" },
      preparation: {
        workflow: { stage: "initial-design-system-preparing" },
        current_attempt: { status: "completed" },
        commands: expect.arrayContaining([
          expect.objectContaining({
            command_type: "prepare_initial_design_system",
            status: "pending"
          })
        ])
      }
    });
    expect(
      completed.preparation.commands.find(
        (command) => command.command_type === "prepare_initial_design_system"
      )?.payload.question_cards
    ).toHaveLength(12);

    await page.reload();
    await enterWorkbench(page, { port: runtime.port, sessionToken: token });
    await expect(workbench).toHaveAttribute(
      "data-alignment-workflow-stage",
      "initial-design-system-preparing"
    );
    await expect(workbench).toHaveAttribute(
      "data-agent-command-status",
      "pending"
    );
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
    await enterWorkbench(page, { port: runtime.port, sessionToken: token });

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
    await connectFigmaForTests(runtime.port, token);

    const res = await rawPost(
      "/api/seed-reference",
      {
        figmaSeedReference: MOCK_FIGMA_URL,
        referenceNote: "HTTP ui payload must not create ui rows.",
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
    await enterWorkbench(page, { port: runtime.port, sessionToken: token });
    await assertNoWorkbenchSeedWriteUi(page);
    await expect(page.getByTestId("seed-reference-projection")).toHaveCount(0);
  });

  test("POST seed-reference without Figma Connection fails closed — no seed rows", async ({
    page,
    runtime,
    folder
  }) => {
    const token = await captureToken(page, runtime.baseURL);
    await bindFolder(token, folder, runtime.port);

    // Ensure gate is closed (worker memory store may retain a prior connect).
    await httpDelete(runtime.port, "/api/figma-connection", {
      host: `localhost:${runtime.port}`,
      "x-ikran-session": token
    });

    const res = await rawPost(
      "/api/seed-reference",
      { figmaSeedReference: MOCK_FIGMA_URL },
      { "x-ikran-session": token },
      runtime.port
    );
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body)).toMatchObject({
      ok: false,
      error: "figma_connection_required"
    });
    expect(readSeedReferences(folder).length).toBe(0);
  });

  test("POST evidence-package is retired (410 endpoint_retired)", async ({
    page,
    runtime,
    folder
  }) => {
    const token = await captureToken(page, runtime.baseURL);
    await bindFolder(token, folder, runtime.port);

    const res = await rawPost(
      "/api/evidence-package",
      {
        figmaSeedReference: MOCK_FIGMA_URL,
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
    expect(res.status).toBe(410);
    expect(JSON.parse(res.body)).toMatchObject({
      ok: false,
      error: "endpoint_retired"
    });
  });

  test("refresh rebuilds the tldraw projection from Runtime records (GET /api/seed-reference)", async ({
    page,
    runtime,
    folder
  }) => {
    const token = await captureToken(page, runtime.baseURL);
    await bindFolder(token, folder, runtime.port);

    const captured = await agentCaptureSeed(token, runtime.port, {
      referenceNote: "Agent-written seed: editorial portfolio system."
    });
    expect(captured.status).toBe(200);
    expect(captured.record.id).toBeTruthy();

    const recordsBefore = readSeedReferences(folder);
    expect(recordsBefore[0].figma_seed_reference).toBe(MOCK_FIGMA_URL);

    await connectFigmaForTests(runtime.port, token);
    await page.goto(
      `${runtime.baseURL}/?session=${encodeURIComponent(token)}&view=workbench`
    );
    // Wait for the projected record (bind + Workbench hydrate), not Setup chrome.
    const projection = page.getByTestId("seed-reference-projection");
    await expect(projection).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("seed-workbench")).toHaveAttribute(
      "data-figma-gate",
      "open"
    );

    await assertNoWorkbenchSeedWriteUi(page);
    await expect(page.locator("svg.react-flow__background")).toHaveCount(0);

    await expect(projection).toHaveAttribute(
      "data-surface-record-id",
      captured.surface.id
    );
    await expect(projection.getByTestId("seed-reference-projection-title")).toHaveText(
      "Mock Frame"
    );

    const recordsAfter = readSeedReferences(folder);
    expect(recordsAfter.length).toBe(1);
    expect(recordsAfter[0].id).toBe(captured.record.id);

    await page.goto(
      `${runtime.baseURL}/?session=${encodeURIComponent(token)}&view=workbench`
    );
    await expect(page.getByTestId("seed-reference-projection")).toBeVisible({
      timeout: 30000
    });
    await expect(page.getByTestId("seed-reference-projection")).toHaveAttribute(
      "data-surface-record-id",
      captured.surface.id
    );
  });

  test("an Agent-captured seed appears via record SSE invalidation without a manual refresh", async ({
    page,
    runtime,
    folder
  }) => {
    const token = await captureToken(page, runtime.baseURL);
    await bindFolder(token, folder, runtime.port);

    await page.reload();
    await enterWorkbench(page, { port: runtime.port, sessionToken: token });

    await assertNoWorkbenchSeedWriteUi(page);
    await expect(page.getByTestId("seed-reference-projection")).toHaveCount(0);

    const captured = await agentCaptureSeed(token, runtime.port, {
      referenceNote: "Polled agent seed reference."
    });
    expect(captured.status).toBe(200);

    await expect
      .poll(async () => {
        const p = page.getByTestId("seed-reference-projection");
        return (await p.count()) > 0
          ? await p.getAttribute("data-surface-record-id")
          : null;
      })
      .toBe(captured.surface.id);

    await assertNoWorkbenchSeedWriteUi(page);
    expect(readSeedReferences(folder).length).toBe(1);
  });

  test("Agent-captured evidence surface projects screenshot; zero Figma network", async ({
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
      const captured = await agentCaptureSeed(token, runtime.port, {
        referenceNote: "Issue 05 workbench: evidence screenshot projection."
      });
      expect(captured.status).toBe(200);

      await page.reload();
      await enterWorkbench(page, { port: runtime.port, sessionToken: token });
      await assertNoWorkbenchSeedWriteUi(page);

      const projection = page.getByTestId("seed-reference-projection");
      await expect(projection).toBeVisible();
      await expect(projection).toHaveAttribute(
        "data-seed-record-id",
        captured.record.id
      );
      await expect(projection).toHaveAttribute(
        "data-surface-record-id",
        captured.surface.id
      );
      await expect(projection).toHaveAttribute(
        "data-kind",
        "figma_evidence_surface"
      );
      await expect(projection.getByTestId("seed-reference-projection-title")).toHaveText(
        "Mock Frame"
      );

      const figmaLink = projection.getByTestId(
        "seed-reference-projection-figma-link"
      );
      await expect(figmaLink).toBeEnabled();
      await figmaLink.hover();
      await expect(
        projection.getByTestId("seed-reference-projection-figma-hint")
      ).toBeVisible();
      await projection.getByTestId("seed-reference-projection-notes").hover();
      await expect(
        projection.getByTestId("seed-reference-projection-notes-hint")
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
        MOCK_FIGMA_URL
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

  test("legacy pending reader and Agent evidence writer stay retired after Active capture", async ({
    page,
    runtime,
    folder
  }) => {
    const token = await captureToken(page, runtime.baseURL);
    await bindFolder(token, folder, runtime.port);

    const captured = await agentCaptureSeed(token, runtime.port, {
      referenceNote: "Agent capture fulfills evidence atomically."
    });
    expect(captured.status).toBe(200);

    const pending = await rawGet(
      "/api/pending-seed-evidence",
      { "x-ikran-session": token },
      runtime.port
    );
    expect(pending.status).toBe(410);
    expect(JSON.parse(pending.body).error).toBe("endpoint_retired");

    const retired = await rawPost(
      "/api/evidence-package",
      {
        figmaSeedReference: MOCK_FIGMA_URL,
        seedReferenceId: captured.record.id,
        frame: { nodeId: "1:2", name: "Should Not Write" },
        evidenceViews: { rawData: "available", screenshot: "available" },
        screenshot: {
          dataUrl:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        }
      },
      { "x-ikran-session": token },
      runtime.port
    );
    expect(retired.status).toBe(410);
    expect(JSON.parse(retired.body).error).toBe("endpoint_retired");

    await page.reload();
    await enterWorkbench(page, { port: runtime.port, sessionToken: token });
    await assertNoWorkbenchSeedWriteUi(page);

    const projection = page.getByTestId("seed-reference-projection");
    await expect(projection).toBeVisible();
    await expect(projection).toHaveAttribute(
      "data-kind",
      "figma_evidence_surface"
    );
    await expect(
      projection.getByTestId("seed-reference-projection-screenshot")
    ).toBeVisible();
  });
});
