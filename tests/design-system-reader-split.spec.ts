// Ikran Issue 09C-A — Reader Projection + resizable split e2e through the
// real Workbench.
//
// Full chain: alignment completes → 09B-rich sources (composite text styles,
// alias chains, candidate + gap statuses, a rich principle, an object layout
// rule) declared + ingested through MCP → the Typography leaf renders the
// visual Type Atlas with construction data attached to each source-backed
// specimen → the Layout leaf renders Source Capture placards (09C-D02): a
// captured Figma node per rule with provenance caption, an honest unavailable
// block when no node is linked → the divider drags, nudges by keyboard,
// double-click resets → the ratio persists project-locally across sheet
// close/reopen → narrow viewports stack split leaves without horizontal
// scroll.
//
// Staging mirrors tests/design-system-browser.spec.ts.

import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
    // 09C-D02: a real capture PNG the placard <img> loads via /api/artifacts.
    mkdirSync(path.join(projectDir, "design-system", "captures"), {
      recursive: true
    });
    copyFileSync(
      path.join(process.cwd(), "tests", "fixtures", "layout-capture-grid.png"),
      path.join(projectDir, "design-system", "captures", "grid-page.png")
    );
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
          meaning: "Alternate hero size",
          status: "formalized",
          links: [designerEditedCardId],
          domain: "typography"
        },
        "letterSpacing.hero": {
          value: "-0.04em",
          meaning: "Hero tracking",
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
        },
        "typography.statisticalDisplay": {
          value: {
            fontFamily: { alias: "primitive.font.family.sans" },
            fontSize: "105px",
            fontWeight: "400",
            lineHeight: "1"
          },
          meaning: "Studio proof point",
          status: "formalized",
          links: [designerEditedCardId],
          domain: "typography"
        }
      },
      component: {
        "navigation.label": {
          value: {
            fontFamily: { alias: "primitive.font.family.sans" },
            fontSize: "20px",
            fontWeight: "400",
            lineHeight: "1"
          },
          meaning: "Top navigation and footer information",
          status: "formalized",
          links: [designerEditedCardId],
          domain: "typography"
        }
      }
    });
    writeSource("design-system/layout-rules.json", {
      rules: [
        {
          id: "grid-page",
          value: {
            columns: "12",
            gutter: { alias: "spacing.200" },
            maxWidth: "1120px",
            sourceCaptures: [
              {
                nodeId: "11:20",
                nodeName: "Landing / Grid",
                artifactPath: "design-system/captures/grid-page.png",
                capturedAt: "2026-07-30T14:05:22Z",
                surfaceId: evidence.record.id
              }
            ]
          },
          meaning: "Default page grid",
          status: "candidate",
          links: [designerEditedCardId]
        },
        {
          id: "shell-regions",
          value: {
            regions: ["header", "hero", "content", "footer"],
            sourceCaptures: [
              {
                nodeId: "11:30",
                nodeName: "Landing / Shell",
                artifactPath: "design-system/captures/grid-page.png",
                capturedAt: "2026-07-28T09:12:00Z",
                // No live surface carries this id — the capture must read stale.
                surfaceId: "surf-shell-missing"
              }
            ]
          },
          meaning: "Page shell vertical stack",
          status: "candidate",
          links: [designerEditedCardId]
        },
        {
          id: "section-rhythm",
          value: { heroToNext: "96 → 56px" },
          meaning: "Scroll rhythm, desktop → mobile",
          status: "candidate",
          links: [designerEditedCardId]
        },
        {
          id: "breakpoints",
          value: { breakpoints: ["640", "768", "1024", "1280"] },
          meaning: "Same source as code",
          status: "formalized",
          links: [designerEditedCardId]
        },
        {
          id: "nav-mobile",
          value: { layout: "—" },
          meaning: "Mobile navigation layout — open state missing",
          status: "gap",
          links: []
        }
      ]
    });
    writeSource("design-system/interaction-rules.json", {
      rules: [
        {
          id: "quiet-motion",
          name: "Quiet motion",
          value: {
            statement: "Motion stays quiet",
            description: "Routine feedback never competes with content.",
            behavior: [
              "Use short feedback to explain a state change.",
              "Avoid decorative loops."
            ],
            accessibility: [
              "Preserve the same information when motion is reduced."
            ]
          },
          meaning: "Animation supports comprehension.",
          status: "candidate",
          links: [designerEditedCardId]
        },
        {
          id: "frequent-actions",
          name: "Frequent actions",
          value: {
            statement: "Frequent actions switch instantly",
            description: "Repeated actions should never accumulate animation cost.",
            behavior: [
              "Switch tabs and sibling views without transitional movement."
            ],
            accessibility: [
              "Keep keyboard-initiated actions free of motion."
            ]
          },
          meaning: "Frequency determines whether motion belongs.",
          status: "candidate",
          links: [designerEditedCardId]
        },
        {
          id: "keyboard-parity",
          name: "Keyboard parity",
          value: {
            statement: "Keyboard parity",
            description: "Every pointer action needs an equivalent keyboard path.",
            behavior: [],
            accessibility: []
          },
          meaning: "Input method does not limit capability.",
          status: "gap",
          links: []
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
    ))).toMatchObject({
      ok: true,
      record: { status: "ingested" },
      quality_diagnostics: []
    });
    expect(structuredContent(await declare(
      "design-system/layout-rules.json",
      "layout-rules.json"
    ))).toMatchObject({ ok: true, record: { status: "ingested" } });
    expect(structuredContent(await declare(
      "design-system/interaction-rules.json",
      "interaction-rules.json"
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

    // ---- Typography leaf: quiet three-column ledger + one disclosure. ----
    await page.getByRole("button", { name: "Typography", exact: true }).click();
    await expect(
      page.locator(".dsb-typography-page > .dsb-h1")
    ).toHaveText("Typography");
    await expect(page.getByTestId("ds-leaf-split")).toHaveCount(0);
    const ledger = page.getByTestId("ds-typography-ledger");
    await expect(ledger).toBeVisible();
    const typeGroup = page.getByTestId("ds-typography-group-type");
    const componentGroup = page.getByTestId("ds-typography-group-component");
    await expect(typeGroup.getByRole("heading", { name: "Type · 3" })).toBeVisible();
    await expect(
      componentGroup.getByRole("heading", { name: "Component · 1" })
    ).toBeVisible();
    await expect(ledger.getByText("Used for", { exact: true })).toHaveCount(2);
    const columnHeaderStyle = await ledger
      .locator(".dsb-type-columns")
      .first()
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          letterSpacing: style.letterSpacing,
          textTransform: style.textTransform
        };
      });
    expect(columnHeaderStyle).toEqual({
      fontSize: "12px",
      fontWeight: "400",
      letterSpacing: "normal",
      textTransform: "none"
    });
    const firstRow = typeGroup.locator(".dsb-type-row").first();
    await expect
      .poll(() =>
        firstRow.evaluate((element) => getComputedStyle(element).paddingTop)
      )
      .toBe("0px");
    const compactRow = typeGroup.locator(".dsb-type-row").last();
    await expect
      .poll(() =>
        compactRow.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            paddingTop: style.paddingTop,
            paddingBottom: style.paddingBottom,
            minHeight: style.minHeight
          };
        })
      )
      .toEqual({
        paddingTop: "16px",
        paddingBottom: "16px",
        minHeight: "0px"
      });
    const typographySummary = page.getByTestId("ds-typography-summary");
    await expect(typographySummary).toHaveText("4 type styles");
    await expect(ledger.getByText("formalized", { exact: true })).toHaveCount(0);
    await expect(ledger.getByText("Source-backed", { exact: true })).toHaveCount(0);
    await expect(page.locator('[aria-label="Order type atlas"]')).toHaveCount(0);

    await expect(
      page.getByTestId("ds-atlas-primitive.font.size.700")
    ).toHaveCount(0);

    const displayCard = page.getByTestId(
      "ds-atlas-semantic.display.large"
    );
    await expect(displayCard).toBeVisible();
    await expect(displayCard.getByRole("heading", { name: "Display Large" })).toBeVisible();
    await expect(displayCard).toContainText("Hero display role");
    await expect(displayCard.getByText("Weight", { exact: true })).toHaveCount(0);
    const displayDisclosure = displayCard.getByRole("button", {
      name: /details for Display Large/
    });
    await expect(displayDisclosure).toHaveAttribute("aria-expanded", "false");
    await displayDisclosure.click();
    await expect(displayDisclosure).toHaveAttribute("aria-expanded", "true");
    await expect(displayCard.getByText("Weight", { exact: true })).toBeVisible();
    await expect(displayCard.getByText("Letter spacing", { exact: true })).toBeVisible();
    await expect(displayCard.getByText("Size", { exact: true })).toBeVisible();
    await expect(displayCard.getByText("Typeface", { exact: true })).toBeVisible();
    await expect(displayCard).toContainText("64px");
    await expect(displayCard).toContainText("700");
    await expect(displayCard).toContainText("Instrument Sans");
    const typefaceDetailStyle = await displayCard
      .locator(".dsb-type-detail dd")
      .last()
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          fontFamily: style.fontFamily,
          letterSpacing: style.letterSpacing
        };
      });
    expect(typefaceDetailStyle.fontFamily).toContain("Inter");
    expect(typefaceDetailStyle.letterSpacing).toBe("-0.22px");
    await expect(displayCard.getByText("Line height", { exact: true })).toHaveCount(0);
    await expect(displayCard).toContainText("semantic.display.large");
    await expect(displayCard).not.toContainText("primitive.font.family.sans");

    await expect(page.getByTestId("ds-technical-details")).toHaveCount(0);
    await expect(
      page.getByText("Source tokens", { exact: true })
    ).toHaveCount(0);

    const displaySample = displayCard.locator(".dsb-type-specimen");
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
    expect(specimenSize).toBe(64);

    const statisticalDisplay = page.getByTestId(
      "ds-atlas-semantic.typography.statisticalDisplay"
    );
    await expect(
      statisticalDisplay.getByRole("heading", { name: "Statistical Display" })
    ).toBeVisible();
    await expect(statisticalDisplay.locator(".dsb-type-specimen")).toHaveCSS(
      "font-size",
      "105px"
    );
    await expect(
      componentGroup.getByRole("heading", { name: "Navigation Label" })
    ).toBeVisible();

    // ---- Layout leaf (09C-D02): Source Capture placards, one per rule. ----
    await page.getByRole("button", { name: "Layout", exact: true }).click();
    // Layout is a full-width page now — no split panes, no empty samples.
    await expect(page.getByTestId("ds-leaf-split")).toHaveCount(0);
    await expect(page.getByTestId("ds-samples-empty")).toHaveCount(0);
    const placards = page.getByTestId("ds-layout-placards");
    await expect(placards).toBeVisible();

    const gridPlacard = page.getByTestId("ds-layout-placard-grid-page");
    await expect(gridPlacard).toBeVisible();
    await expect(gridPlacard).toContainText("Default page grid");
    await expect(
      gridPlacard.getByTestId("ds-layout-status-grid-page")
    ).toHaveText("candidate");
    // Recognized facts read as one quiet line — never raw JSON.
    const gridFacts = gridPlacard.locator(".dsb-placard-facts");
    await expect(gridFacts).toContainText("1120px");
    await expect(gridFacts).toContainText("→ spacing.200");
    await expect(gridPlacard).not.toContainText('{"columns"');
    // The capture image renders and actually loads through /api/artifacts.
    const gridImg = gridPlacard.locator(".dsb-placard-figure img");
    await expect(gridImg).toHaveAttribute(
      "alt",
      "Source capture of Landing / Grid"
    );
    await expect
      .poll(() =>
        gridImg.evaluate((el) => (el as HTMLImageElement).naturalWidth)
      )
      .toBeGreaterThan(0);
    // The height cap keeps any capture from breaking the reading rhythm.
    const gridImgBox = await gridImg.boundingBox();
    expect(gridImgBox).not.toBeNull();
    expect(gridImgBox!.height).toBeLessThanOrEqual(341);
    // Provenance caption: origin tag, node name, formatted capture time.
    await expect(
      gridPlacard.locator('.dsb-origin[data-origin="source-capture"]')
    ).toBeVisible();
    await expect(gridPlacard).toContainText("Landing / Grid");
    await expect(gridPlacard).toContainText("captured 2026-07-30 14:05");
    await expect(gridPlacard).not.toContainText("stale");

    // A capture whose surface vanished reads stale.
    const shellPlacard = page.getByTestId("ds-layout-placard-shell-regions");
    await expect(shellPlacard).toContainText("Page shell vertical stack");
    await expect(shellPlacard).toContainText("Landing / Shell");
    await expect(shellPlacard.locator("[data-stale]")).toContainText("· stale");

    // Rules with no linked node get the honest unavailable block.
    const navPlacard = page.getByTestId("ds-layout-placard-nav-mobile");
    await expect(navPlacard).toContainText("Mobile navigation layout");
    await expect(
      navPlacard.getByTestId("ds-layout-unavailable-nav-mobile")
    ).toBeVisible();
    await expect(navPlacard).toContainText("No source capture");
    await expect(
      navPlacard.locator('.dsb-origin[data-origin="unavailable"]')
    ).toBeVisible();
    await expect(
      navPlacard.getByTestId("ds-layout-status-nav-mobile")
    ).toHaveText("open gap");

    // View in frame opens the full-frame lightbox; Esc closes it without
    // closing the sheet (capture-phase Esc handling).
    await gridPlacard.getByRole("button", { name: "View in frame" }).click();
    const lightbox = page.locator(".dsb-lightbox");
    await expect(lightbox).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(lightbox).toHaveCount(0);
    await expect(sheet).toHaveAttribute("data-open", "true");

    // ---- Split divider (09C-A): exercised on the Color leaf, which keeps
    // the reading/samples split. ----
    await page.getByRole("button", { name: "Color", exact: true }).click();
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
    await page.getByRole("button", { name: "Color", exact: true }).click();
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

    await page.getByRole("button", { name: "Typography", exact: true }).click();
    const narrowStatisticalDisplay = page.getByTestId(
      "ds-atlas-semantic.typography.statisticalDisplay"
    );
    await expect(
      narrowStatisticalDisplay.locator(".dsb-type-specimen")
    ).toHaveCSS("font-size", "105px");
    const narrowSpecimenOverflow = await narrowStatisticalDisplay
      .locator(".dsb-type-name")
      .evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(narrowSpecimenOverflow).toBeGreaterThan(0);
    const typographyPageOverflow = await page
      .locator(".dsb-typography-page")
      .evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(typographyPageOverflow).toBeLessThanOrEqual(1);
    await page.setViewportSize({ width: 1280, height: 720 });

    // ---- 09C-D01 Interaction ledger: strategy text, no inferred samples. ----
    await page.getByRole("button", { name: "Interaction", exact: true }).click();
    await expect(page.getByTestId("ds-interaction-rig")).toHaveCount(0);
    await expect(page.getByTestId("ds-leaf-split")).toHaveCount(0);

    const quietMotion = page.getByTestId("ds-interaction-rule-1");
    await expect(quietMotion).toContainText("Motion stays quiet");
    await expect(quietMotion).not.toContainText("Description");
    const quietMotionToggle = quietMotion.getByRole("button", {
      name: "Motion stays quiet"
    });
    await expect(quietMotionToggle).toHaveAttribute("aria-expanded", "false");
    await quietMotionToggle.click();
    await expect(quietMotionToggle).toHaveAttribute("aria-expanded", "true");
    await expect(quietMotion).toContainText("Description");
    await expect(quietMotion).toContainText("Behavior");
    await expect(quietMotion).toContainText("Accessibility");
    await expect(quietMotion).toContainText(
      "Use short feedback to explain a state change."
    );
    await expect(quietMotion.getByTestId("ds-interaction-status")).toHaveText(
      "candidate"
    );
    const info = quietMotion.getByLabel(
      "Evidence for interaction rule quiet-motion"
    );
    await info.hover();
    const interactionEvidence = page.getByTestId("ds-evidence-quiet-motion");
    await expect(interactionEvidence).toBeVisible();
    await expect(interactionEvidence).toContainText("设计师改写后的回答");
    await expect(page.getByTestId("ds-interaction-rule-3")).toContainText(
      "Keyboard parity"
    );
    await expect(page.getByText("No visual sample", { exact: true })).toHaveCount(0);
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
