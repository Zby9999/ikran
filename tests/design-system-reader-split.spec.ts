// Ikran Issue 09C-A — Reader Projection + resizable split e2e through the
// real Workbench.
//
// Full chain: alignment completes → 09B-rich sources (composite text styles,
// alias chains, candidate + gap statuses, a rich principle, an object layout
// rule) declared + ingested through MCP → the Typography leaf renders the
// visual Type Atlas with construction data attached to each source-backed
// specimen → the Layout leaf divider drags, nudges by keyboard, double-click
// resets → the ratio persists project-locally across sheet close/reopen →
// narrow viewports stack split leaves without horizontal scroll.
//
// Staging mirrors tests/design-system-browser.spec.ts.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { expect, test } from "./fixtures";
import { recordEvidencePackage } from "../lib/runtime/evidence-package";
import { setDesignLanguageDescription } from "../lib/runtime/project-readiness";
import { registerSeedReference } from "../lib/runtime/seed-reference";
import {
  killRecordedRuntime,
  spawnMcpClient,
  structuredContent
} from "./helpers/mcp";
import {
  ALIGNMENT_SECTIONS,
  stageAlignmentAnswering
} from "./helpers/alignment";
import { enterCanvas } from "./helpers/workbench";

async function patchAlignment(
  workbenchUrl: string,
  token: string,
  body: Record<string, unknown>
): Promise<Response> {
  return fetch(new URL("/api/design-intent-alignment", workbenchUrl), {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "x-ikran-session": token
    },
    body: JSON.stringify(body)
  });
}

async function readPreferences(
  workbenchUrl: string,
  token: string
): Promise<{ splitRatio: number } | null> {
  const response = await fetch(
    new URL("/api/design-system-browser-preferences", workbenchUrl),
    { headers: { "x-ikran-session": token }, cache: "no-store" }
  );
  const data = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    preferences?: { splitRatio?: unknown };
  };
  if (!response.ok || data.ok !== true) return null;
  return typeof data.preferences?.splitRatio === "number"
    ? { splitRatio: data.preferences.splitRatio }
    : null;
}

/** The debounced preference PUT (300ms) needs room to land. */
async function waitForPreferenceWrite(page: import("@playwright/test").Page) {
  await page.waitForTimeout(600);
}

test("09C-A reader projection: atlas, split persistence, stacking", async ({
  page
}) => {
  test.setTimeout(240_000);
  const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-ds-reader-state-"));
  const projectDir = mkdtempSync(path.join(tmpdir(), "ikran-ds-reader-project-"));
  let client: Client | null = null;

  try {
    const handle = await spawnMcpClient(stateDir);
    client = handle.client;
    const opened = structuredContent(await client.callTool({
      name: "create_or_open_project",
      arguments: { path: projectDir }
    }));
    expect(opened.ok).toBe(true);
    const token = String(opened.session);
    const workbenchUrl = String(opened.workbench_url);

    const seed = registerSeedReference(projectDir, {
      figmaSeedReference:
        "https://www.figma.com/design/DsReader/Fixture?node-id=1:2",
      originalDesignIntent: "Design system reader e2e fixture"
    });
    expect(seed.ok).toBe(true);
    if (!seed.ok) return;
    const evidence = recordEvidencePackage(projectDir, {
      seedReferenceId: seed.record.id,
      frame: { nodeId: "1:2", name: "DS reader fixture" },
      evidenceViews: { rawData: "available", screenshot: "missing" }
    });
    expect(evidence.ok).toBe(true);
    if (!evidence.ok) return;
    expect(
      setDesignLanguageDescription(projectDir, "A calm, precise product language").ok
    ).toBe(true);

    await page.goto(workbenchUrl);
    await enterCanvas(page);
    const entryButton = page.getByTestId("open-design-system-browser");

    const prepareResponse = await patchAlignment(workbenchUrl, token, {
      action: "prepare"
    });
    expect(prepareResponse.status).toBe(200);
    const staged = await stageAlignmentAnswering(client, {
      seedReferenceId: seed.record.id,
      evidenceId: evidence.record.id,
      keyPrefix: "ds-reader-e2e"
    });
    const { cards } = staged;
    const designerEditedCardId = cards["token"][0].id;
    const answered = await patchAlignment(workbenchUrl, token, {
      action: "record-designer-answer",
      input: { questionCardId: designerEditedCardId, finalAnswer: "设计师改写后的回答" }
    });
    expect(answered.status).toBe(200);
    for (const section of ALIGNMENT_SECTIONS) {
      for (const card of cards[section]) {
        if (card.id === designerEditedCardId) continue;
        expect(structuredContent(await client.callTool({
          name: "record_designer_answer",
          arguments: { questionCardId: card.id, finalAnswer: card.answer }
        }))).toMatchObject({ ok: true, record: { status: "answered" } });
      }
    }
    const completeResponse = await patchAlignment(workbenchUrl, token, {
      action: "complete"
    });
    expect(completeResponse.status).toBe(200);
    await expect(entryButton).toBeVisible();

    // ---- 09B-rich sources: composite text styles with an alias chain,
    // candidate + gap statuses, a rich principle, an object layout rule. ----
    mkdirSync(path.join(projectDir, "design-system"), { recursive: true });
    const writeSource = (relative: string, json: unknown) =>
      writeFileSync(
        path.join(projectDir, relative),
        `${JSON.stringify(json, null, 2)}\n`,
        "utf-8"
      );

    writeSource("design-system/design-system.json", {
      name: "Ikran Reader System",
      visualLanguage: {
        id: "visual-language",
        value: { description: "Calm, precise product language." },
        meaning: "Overall visual tone",
        status: "formalized",
        links: [designerEditedCardId]
      },
      principles: [
        {
          id: "principle-intent",
          value: {
            statement: "Design with intent.",
            rationale: "Every choice needs a reason the designer can repeat.",
            scope: "All product surfaces",
            use: ["State the reason next to the choice"],
            avoid: ["Decoration without a job"],
            exceptions: ["Marketing one-offs"]
          },
          meaning: "Intent over decoration",
          status: "candidate",
          links: [designerEditedCardId]
        }
      ]
    });
    writeSource("design-system/token.json", {
      primitive: {
        "font.family.sans": {
          value: "Instrument Sans, system-ui, sans-serif",
          meaning: "Primary typeface stack",
          status: "formalized",
          links: [designerEditedCardId],
          domain: "typography"
        },
        "font.size.400": {
          value: "16px",
          meaning: "Base body size",
          status: "formalized",
          links: [designerEditedCardId],
          domain: "typography"
        },
        "font.size.700": {
          value: "32px",
          meaning: "Section heading size",
          status: "formalized",
          links: [designerEditedCardId],
          domain: "typography"
        },
        "font.weight.bold": {
          value: "700",
          meaning: "Bold weight",
          status: "gap",
          links: [],
          domain: "typography"
        }
      },
      semantic: {
        body: {
          value: { family: "Inter", size: "16px", weight: "400", tracking: "0.01em" },
          meaning: "Default reading role",
          status: "candidate",
          links: [designerEditedCardId],
          domain: "typography"
        },
        "display.large": {
          value: {
            fontFamily: { alias: "primitive.font.family.sans" },
            fontSize: "64px",
            fontWeight: "700",
            lineHeight: "1.05"
          },
          meaning: "Hero display role",
          status: "formalized",
          links: [designerEditedCardId],
          domain: "typography"
        }
      },
      component: {}
    });
    writeSource("design-system/layout-rules.json", {
      rules: [
        {
          id: "grid-page",
          value: { columns: "12", gutter: { alias: "spacing.200" }, maxWidth: "1120px" },
          meaning: "Default page grid",
          status: "candidate",
          links: [designerEditedCardId]
        }
      ]
    });

    const declare = (artifactPath: string, artifactType: string) =>
      client!.callTool({
        name: "record_artifact_written",
        arguments: {
          path: artifactPath,
          artifactType,
          semanticPurpose: `${artifactType} source`,
          relatedRecordIds: [designerEditedCardId]
        }
      });
    expect(structuredContent(await declare(
      "design-system/design-system.json",
      "design-system.json"
    ))).toMatchObject({ ok: true, record: { status: "ingested" } });
    expect(structuredContent(await declare(
      "design-system/token.json",
      "token.json"
    ))).toMatchObject({ ok: true, record: { status: "ingested" } });
    expect(structuredContent(await declare(
      "design-system/layout-rules.json",
      "layout-rules.json"
    ))).toMatchObject({ ok: true, record: { status: "ingested" } });

    // ---- Foundations home: the rich principle reads as labeled fields. ----
    await entryButton.click();
    const sheet = page.getByTestId("ds-sheet");
    await expect(sheet).toHaveAttribute("data-open", "true");
    await expect
      .poll(() =>
        sheet.locator(".dsb-sidebar").evaluate(
          (element) => getComputedStyle(element).overscrollBehaviorY
        )
      )
      .toBe("none");
    await expect
      .poll(() =>
        sheet.locator(".dsb-main").evaluate(
          (element) => getComputedStyle(element).overscrollBehaviorY
        )
      )
      .toBe("none");
    const richPrinciple = page.getByTestId("ds-principle-principle-intent");
    await expect(richPrinciple).toBeVisible();
    await expect(richPrinciple).toContainText("Design with intent.");
    await expect(richPrinciple).toContainText("Rationale");
    await expect(richPrinciple).toContainText("Every choice needs a reason");
    await expect(richPrinciple).toContainText("Marketing one-offs");

    // ---- Typography leaf: standard heading + source-backed Type Atlas. ----
    await page.getByRole("button", { name: "Typography", exact: true }).click();
    await expect(
      page.locator(".dsb-typography-page > .dsb-h1")
    ).toHaveText("Typography");
    await expect(page.getByTestId("ds-leaf-split")).toHaveCount(0);
    const atlas = page.getByTestId("ds-typography-atlas");
    await expect(atlas).toBeVisible();
    const scaleOrder = page.getByRole("button", {
      name: "Scale",
      exact: true
    });
    const roleOrder = page.getByRole("button", {
      name: "Role",
      exact: true
    });
    await expect(scaleOrder).toHaveAttribute("aria-pressed", "true");
    await expect(roleOrder).toHaveAttribute("aria-pressed", "false");
    expect((await scaleOrder.boundingBox())!.x).toBeLessThan(
      (await roleOrder.boundingBox())!.x
    );
    const atlasCardIds = await atlas.locator(".dsb-atlas-card").evaluateAll(
      (cards) => cards.map((card) => card.getAttribute("data-testid"))
    );
    expect(
      atlasCardIds.indexOf("ds-atlas-primitive.font.size.700")
    ).toBeLessThan(
      atlasCardIds.indexOf("ds-atlas-semantic.body")
    );
    const displayCard = page.getByTestId(
      "ds-atlas-semantic.display.large"
    );
    await expect(displayCard).toBeVisible();
    await expect(displayCard).toContainText("Hero display role");
    await expect(displayCard).toContainText("64px");
    await expect(displayCard).toContainText("700");
    await expect(displayCard).toContainText("1.05");
    await expect(displayCard).toContainText("semantic.display.large");
    await expect(displayCard).toContainText("primitive.font.family.sans");
    await expect(page.getByTestId("ds-technical-details")).toHaveCount(0);
    await expect(
      page.getByText("Source tokens", { exact: true })
    ).toHaveCount(0);

    const displaySample = displayCard.locator(".dsb-atlas-sample");
    await expect(displaySample).toBeVisible();
    // The specimen renders in the typeface the source declares (resolved
    // through the family alias) — computed, not just annotated.
    const specimenFont = await displaySample.evaluate(
      (el) => getComputedStyle(el).fontFamily
    );
    expect(specimenFont).toContain("Instrument Sans");
    // A computed family name alone is not proof that the browser rendered
    // that face: an unregistered family silently falls back while preserving
    // the requested CSS string. Pin the self-hosted FontFace registration
    // and load state so the specimen cannot regress to "correct label,
    // fallback glyphs".
    const instrumentSansFaces = await page.evaluate(async () => {
      await document.fonts.load('400 16px "Instrument Sans"', "Ag");
      await document.fonts.load('700 64px "Instrument Sans"', "Ag");
      const faces = Array.from(document.fonts).filter(
        (face) => face.family.replaceAll('"', "") === "Instrument Sans"
      );
      return {
        weights: [...new Set(faces.map((face) => Number(face.weight)))].sort(
          (a, b) => a - b
        ),
        loadedWeights: [
          ...new Set(
            faces
              .filter((face) => face.status === "loaded")
              .map((face) => Number(face.weight))
          )
        ].sort((a, b) => a - b)
      };
    });
    expect(instrumentSansFaces.weights).toEqual([400, 500, 600, 700]);
    expect(instrumentSansFaces.loadedWeights).toEqual(
      expect.arrayContaining([400, 700])
    );
    const specimenSize = await displaySample.evaluate(
      (el) => Number.parseFloat(getComputedStyle(el).fontSize)
    );
    expect(specimenSize).toBeGreaterThan(24);

    // User-confirmed Atlas status treatment: 4px rounded rectangle with no
    // border/stroke. This is scoped to Atlas; legacy Browser chips are not
    // globally redesigned.
    const atlasStatus = displayCard.getByTestId("ds-atlas-status");
    await expect(atlasStatus).toHaveText("formalized");
    const statusStyle = await atlasStatus.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        borderRadius: style.borderRadius,
        borderStyle: style.borderStyle,
        boxShadow: style.boxShadow
      };
    });
    expect(statusStyle).toEqual({
      borderRadius: "4px",
      borderStyle: "none",
      boxShadow: "none"
    });

    // ---- Layout leaf: object values + persisted resizable split. ----
    await page.getByRole("button", { name: "Layout", exact: true }).click();
    const gridRow = page.getByTestId("ds-row-grid-page");
    await expect(gridRow).toBeVisible();
    await expect(gridRow).toContainText("columns");
    await expect(gridRow).toContainText("→ spacing.200");
    await expect(gridRow).not.toContainText("{\"columns\"");
    await expect(page.getByTestId("ds-samples-empty")).toBeVisible();
    const split = page.getByTestId("ds-leaf-split");
    await expect(split).toBeVisible();
    await expect(split).not.toHaveAttribute("data-stacked", "true");

    // ---- Drag the divider: live resize + debounced preference write. ----
    const divider = page.getByTestId("ds-split-divider");
    await expect(divider).toBeVisible();
    await expect(divider).toHaveAttribute("role", "separator");
    await expect(divider).toHaveAttribute("aria-valuenow", "42");
    await expect(divider).toHaveAttribute(
      "aria-label",
      "Resize reading and visual sample panels"
    );
    // aria-valuemin/max derive from the measured container width (pixel
    // minimums → percents), so assert the contract, not fixed numbers.
    const ariaMin = Number.parseInt(
      (await divider.getAttribute("aria-valuemin")) ?? "-1",
      10
    );
    const ariaMax = Number.parseInt(
      (await divider.getAttribute("aria-valuemax")) ?? "-1",
      10
    );
    expect(ariaMin).toBeGreaterThanOrEqual(0);
    expect(ariaMin).toBeLessThan(42);
    expect(ariaMax).toBeGreaterThan(42);
    expect(ariaMax).toBeLessThanOrEqual(100);
    const leftPane = page.getByTestId("ds-split-left");
    const leftWidthBefore = (await leftPane.boundingBox())!.width;
    const dividerBox = (await divider.boundingBox())!;
    const startX = dividerBox.x + dividerBox.width / 2;
    const startY = dividerBox.y + dividerBox.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 120, startY, { steps: 6 });
    await page.mouse.up();
    const leftWidthAfter = (await leftPane.boundingBox())!.width;
    expect(leftWidthAfter).toBeGreaterThan(leftWidthBefore + 80);
    const draggedNow = Number.parseInt(
      (await divider.getAttribute("aria-valuenow")) ?? "0",
      10
    );
    expect(draggedNow).toBeGreaterThan(42);
    await waitForPreferenceWrite(page);
    const draggedPrefs = await readPreferences(workbenchUrl, token);
    expect(draggedPrefs).not.toBeNull();
    expect(draggedPrefs!.splitRatio).toBeGreaterThan(0.42);
    expect(draggedPrefs!.splitRatio).toBeCloseTo(draggedNow / 100, 1);

    // ---- Double-click restores the default and persists it. ----
    await divider.dblclick();
    await expect(divider).toHaveAttribute("aria-valuenow", "42");
    await waitForPreferenceWrite(page);
    expect((await readPreferences(workbenchUrl, token))?.splitRatio).toBeCloseTo(
      0.42,
      2
    );

    // ---- Keyboard nudges: Arrow ±2%, Shift ±10%, Home resets. ----
    await divider.focus();
    await page.keyboard.press("ArrowRight");
    await expect(divider).toHaveAttribute("aria-valuenow", "44");
    await page.keyboard.press("Shift+ArrowRight");
    await expect(divider).toHaveAttribute("aria-valuenow", "54");
    await page.keyboard.press("ArrowLeft");
    await expect(divider).toHaveAttribute("aria-valuenow", "52");
    await page.keyboard.press("Home");
    await expect(divider).toHaveAttribute("aria-valuenow", "42");

    // ---- Persistence across sheet close/reopen (project-local route). ----
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(divider).toHaveAttribute("aria-valuenow", "46");
    await waitForPreferenceWrite(page);
    await page.getByTestId("ds-close").click();
    await expect(sheet).toHaveAttribute("data-open", "false");
    await expect(page.getByTestId("design-system-browser")).toHaveCount(0);
    await entryButton.click();
    await expect(sheet).toHaveAttribute("data-open", "true");
    await page.getByRole("button", { name: "Layout", exact: true }).click();
    await expect(page.getByTestId("ds-split-divider")).toHaveAttribute(
      "aria-valuenow",
      "46"
    );

    // ---- Narrow viewport: panes stack, samples below, no horizontal scroll. ----
    await page.setViewportSize({ width: 500, height: 800 });
    await expect(split).toHaveAttribute("data-stacked", "true");
    await expect(page.getByTestId("ds-split-divider")).toHaveCount(0);
    await expect(page.getByTestId("ds-split-right")).toBeVisible();
    const splitOverflow = await split.evaluate(
      (el) => el.scrollWidth - el.clientWidth
    );
    expect(splitOverflow).toBeLessThanOrEqual(1);
    await page.setViewportSize({ width: 1280, height: 720 });
  } finally {
    try {
      await client?.close();
    } catch {
      // best-effort test cleanup
    }
    killRecordedRuntime(stateDir);
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  }
});
