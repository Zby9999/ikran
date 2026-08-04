// Ikran Issue 09C-A — Reader Projection e2e through the real Workbench.
//
// Full chain: alignment completes → 09B-rich sources (composite text styles,
// alias chains, candidate + gap statuses, a rich principle, an object layout
// rule) declared + ingested through MCP → the Typography leaf renders the
// visual Type Atlas with construction data attached to each source-backed
// specimen → the Layout leaf renders Source Capture placards (09C-D02): a
// captured Figma node per rule with provenance caption, an honest unavailable
// block when no node is linked → Color / Materials / Component leaves render
// as full-width pages (2026-08-03: LeafSplit retired — no divider, no right
// pane, no split-ratio preference).
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

test("09C-A reader projection: atlas and leaf pages", async ({
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

    // ---- Prose-rule sources: composite text styles with an alias chain,
    // candidate + gap statuses, and top-level layout captures. ----
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
          value: "Design with intent across all product surfaces. Every choice needs a reason the designer can repeat; state that reason next to the choice and avoid decoration without a job. Marketing one-offs may be treated as exceptions.",
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
        },
        "rule.title-negative-tracking": {
          kind: "domain-rule",
          domain: "typography",
          value: "Titles use negative tracking so large type remains visually cohesive.",
          meaning: "Tighten display and heading roles.",
          status: "candidate",
          links: [designerEditedCardId]
        },
        "rule.cta-ink": {
          kind: "domain-rule",
          domain: "color",
          value: "CTA uses the ink color so calls to action stay typographic.",
          meaning: "Avoid introducing a filled action color.",
          status: "candidate",
          links: [designerEditedCardId]
        },
        "rule.no-shadow-regions": {
          kind: "domain-rule",
          domain: "shadow",
          value: "Do not use shadows to separate regions; use spacing and borders for hierarchy.",
          meaning: "Keep material treatment flat.",
          status: "candidate",
          links: [designerEditedCardId]
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
          value: "Use a 12-column page grid with spacing.200 gutters and a maximum width of 1120px.",
          sourceCaptures: [
            {
              nodeId: "11:20",
              nodeName: "Landing / Grid",
              artifactPath: "design-system/captures/grid-page.png",
              capturedAt: "2026-07-30T14:05:22Z",
              surfaceId: evidence.record.id,
              nodeRect: { x: 0.1, y: 0.2, width: 0.6, height: 0.4 }
            }
          ],
          meaning: "Default page grid",
          status: "candidate",
          links: [designerEditedCardId]
        },
        {
          id: "shell-regions",
          value: "Stack the page shell vertically as header, hero, content, then footer.",
          sourceCaptures: [
            {
              nodeId: "11:30",
              nodeName: "Landing / Shell",
              artifactPath: "design-system/captures/grid-page.png",
              capturedAt: "2026-07-28T09:12:00Z",
              // No live surface carries this id — the capture must read stale.
              surfaceId: "surf-shell-missing"
            }
          ],
          meaning: "Page shell vertical stack",
          status: "candidate",
          links: [designerEditedCardId]
        },
        {
          id: "section-rhythm",
          value: "Reduce the hero-to-next-section spacing from 96px on desktop to 56px on mobile.",
          meaning: "Scroll rhythm, desktop → mobile",
          status: "candidate",
          links: [designerEditedCardId]
        },
        {
          id: "breakpoints",
          value: "Use the same breakpoints as code: 640px, 768px, 1024px, and 1280px.",
          meaning: "Same source as code",
          status: "formalized",
          links: [designerEditedCardId]
        },
        {
          id: "nav-mobile",
          value: "The mobile navigation open-state layout is not yet defined.",
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
          value: "Routine feedback never competes with content. Use short feedback to explain a state change, avoid decorative loops, and preserve the same information when motion is reduced.",
          meaning: "Animation supports comprehension.",
          status: "candidate",
          links: [designerEditedCardId]
        },
        {
          id: "frequent-actions",
          name: "Frequent actions",
          value: "Repeated actions should never accumulate animation cost. Switch tabs and sibling views without transitional movement, and keep keyboard-initiated actions free of motion.",
          meaning: "Frequency determines whether motion belongs.",
          status: "candidate",
          links: [designerEditedCardId]
        },
        {
          id: "keyboard-parity",
          name: "Keyboard parity",
          value: "Every pointer action needs an equivalent keyboard path.",
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

    const viewResponse = await fetch(new URL("/api/design-system", workbenchUrl), {
      headers: { "x-ikran-session": token },
      cache: "no-store"
    });
    expect(viewResponse.status).toBe(200);
    const viewPayload = (await viewResponse.json()) as {
      ok: boolean;
      view: {
        tokens: {
          semantic: Array<{
            entry_id: string;
            kind?: string | null;
            domain?: string | null;
          }>;
        };
      };
    };
    expect(
      viewPayload.view.tokens.semantic.find(
        (entry) => entry.entry_id === "semantic.rule.no-shadow-regions"
      )
    ).toMatchObject({ kind: "domain-rule", domain: "shadow" });

    // ---- Foundations home: principle title + prose body. ----
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
    await expect(richPrinciple).toContainText("Intent over decoration");
    await expect(richPrinciple).toContainText("Design with intent");
    await expect(richPrinciple).toContainText("Every choice needs a reason");
    await expect(richPrinciple).toContainText("Marketing one-offs");

    // ---- Materials: a real source-backed rule with no Tokens zone. ----
    await page.getByRole("button", { name: "Materials", exact: true }).click();
    const materialsRules = page.getByTestId("ds-rules-zone");
    await expect(materialsRules).toBeVisible();
    await expect(page.getByTestId("ds-tokens-zone")).toHaveCount(0);
    const noShadowRule = page.getByTestId("ds-domain-rule-1");
    await expect(noShadowRule).toContainText("Keep material treatment flat.");
    await expect(noShadowRule).toContainText(
      "Do not use shadows to separate regions; use spacing and borders for hierarchy."
    );
    await expect(
      noShadowRule.getByTestId("ds-rule-edit-semantic.rule.no-shadow-regions")
    ).toBeVisible();
    const evidenceTrigger = noShadowRule.getByRole("button", {
      name: "Evidence for domain rule semantic.rule.no-shadow-regions"
    });
    await evidenceTrigger.hover();
    const approveNoShadow = page.getByTestId(
      "ds-approve-semantic.rule.no-shadow-regions"
    );
    await expect(approveNoShadow).toBeVisible();
    await approveNoShadow.hover();
    await approveNoShadow.click();
    await expect(approveNoShadow).toHaveCount(0);
    await expect(noShadowRule.getByTestId("ds-interaction-status")).toHaveText(
      "Formalized"
    );

    // ---- Typography leaf: quiet three-column ledger + one disclosure. ----
    await page.getByRole("button", { name: "Typography", exact: true }).click();
    await expect(
      page.locator(".dsb-typography-page > .dsb-h1")
    ).toHaveText("Typography");
    await expect(page.getByTestId("ds-leaf-split")).toHaveCount(0);
    const typographyRules = page.getByTestId("ds-rules-zone");
    const typographyTokens = page.getByTestId("ds-tokens-zone");
    await expect(typographyRules).toBeVisible();
    await expect(typographyTokens).toBeVisible();
    expect(
      await typographyRules.evaluate((element) =>
        Boolean(
          element.compareDocumentPosition(
            document.querySelector('[data-testid="ds-tokens-zone"]')!
          ) & Node.DOCUMENT_POSITION_FOLLOWING
        )
      )
    ).toBe(true);
    await expect(typographyRules).toContainText(
      "Titles use negative tracking so large type remains visually cohesive."
    );
    await expect(
      page.getByTestId("ds-atlas-semantic.rule.title-negative-tracking")
    ).toHaveCount(0);
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
      .toBe("16px");
    const componentFirstRow = componentGroup.locator(".dsb-type-row").first();
    await expect
      .poll(() =>
        componentFirstRow.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            paddingTop: style.paddingTop,
            paddingBottom: style.paddingBottom
          };
        })
      )
      .toEqual({ paddingTop: "16px", paddingBottom: "16px" });
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
    await expect(page.getByTestId("ds-typography-summary")).toHaveCount(0);
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
    await expect(displayCard.getByText("Canonical identity", { exact: true })).toHaveCount(0);
    await expect(displayCard.locator(".dsb-type-identity")).toHaveText(
      "semantic.display.large"
    );
    await expect(displayCard).toContainText("64px");
    await expect(displayCard).toContainText("700");
    await expect(displayCard).toContainText("Instrument Sans");
    const identityStyle = await displayCard
      .locator(".dsb-type-identity")
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          fontSize: style.fontSize,
          paddingTop: getComputedStyle(element.parentElement!).paddingTop,
          paddingBottom: getComputedStyle(element.parentElement!).paddingBottom,
          gap: getComputedStyle(element.parentElement!).rowGap || getComputedStyle(element.parentElement!).gap
        };
      });
    expect(identityStyle.fontSize).toBe("12px");
    expect(identityStyle.paddingTop).toBe("16px");
    expect(identityStyle.paddingBottom).toBe("16px");
    expect(identityStyle.gap).toBe("16px");
    const detailLayout = await displayCard
      .locator(".dsb-type-detail")
      .evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect();
          return { top: box.top, width: box.width };
        })
      );
    expect(detailLayout).toHaveLength(4);
    expect(new Set(detailLayout.map(({ top }) => Math.round(top))).size).toBe(1);
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
    ).toHaveText("Candidate");
    // The prose body preserves the extracted spatial facts without projection.
    const gridBody = gridPlacard.locator(".dsb-rule-prose");
    await expect(gridBody).toContainText("1120px");
    await expect(gridBody).toContainText("spacing.200");
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
    // v2: the figure is a fixed-ratio locator view, orientation from nodeRect.
    const gridFigure = gridPlacard.getByTestId("ds-layout-figure-grid-page");
    await expect(gridFigure).toHaveAttribute("data-orientation", "landscape");
    // A landscape figure holds the 3:2 ratio regardless of the PNG's shape.
    const figureBox = await gridFigure.boundingBox();
    expect(figureBox).not.toBeNull();
    expect(figureBox!.width / figureBox!.height).toBeCloseTo(1.5, 1);
    // nodeRect below the fill threshold draws a position mark over the node.
    const gridMark = gridFigure.locator(".dsb-placard-mark");
    await expect(gridMark).toHaveCount(1);
    const markStyle = await gridMark.evaluate(
      (el) => (el as HTMLElement).style.cssText
    );
    expect(markStyle).toContain("left: 10%");
    expect(markStyle).toContain("top: 20%");
    expect(markStyle).toContain("width: 60%");
    expect(markStyle).toContain("height: 40%");
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
    // Its capture carries no nodeRect — the figure renders without a mark.
    const shellFigure = shellPlacard.getByTestId(
      "ds-layout-figure-shell-regions"
    );
    await expect(shellFigure).toHaveAttribute("data-orientation", "landscape");
    await expect(shellFigure.locator(".dsb-placard-mark")).toHaveCount(0);

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
    ).toHaveText("Open gap");

    // v2 retires the full-frame lightbox: no trigger, no overlay anywhere.
    await expect(
      page.getByRole("button", { name: "View in frame" })
    ).toHaveCount(0);
    await expect(page.locator(".dsb-lightbox")).toHaveCount(0);
    await expect(sheet).toHaveAttribute("data-open", "true");

    // ---- Color leaf: full-width token/rules page; split retired 2026-08-03. ----
    await page.getByRole("button", { name: "Color", exact: true }).click();
    await expect(page.getByTestId("ds-rules-zone")).toContainText(
      "CTA uses the ink color so calls to action stay typographic."
    );
    await expect(page.getByTestId("ds-tokens-zone")).toHaveCount(0);
    await expect(page.getByTestId("ds-leaf-split")).toHaveCount(0);
    await expect(page.getByTestId("ds-samples-empty")).toHaveCount(0);

    // ---- Narrow viewport: Typography reflows without horizontal scroll. ----
    await page.setViewportSize({ width: 500, height: 800 });
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
    expect(narrowSpecimenOverflow).toBeLessThanOrEqual(1);
    const narrowSpecimenHeight = await narrowStatisticalDisplay
      .locator(".dsb-type-specimen")
      .evaluate((element) => element.getBoundingClientRect().height);
    expect(narrowSpecimenHeight).toBeGreaterThan(105);
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
    await expect(quietMotion).toContainText("Animation supports comprehension.");
    await expect(quietMotion).not.toContainText("Description");
    await expect(quietMotion).toContainText(
      "Use short feedback to explain a state change"
    );
    await expect(
      quietMotion.getByTestId("ds-rule-edit-quiet-motion")
    ).toBeVisible();
    await expect(quietMotion.getByTestId("ds-interaction-status")).toHaveText(
      "Candidate"
    );
    const info = quietMotion.getByLabel(
      "Evidence for interaction rule quiet-motion"
    );
    await info.hover();
    const interactionEvidence = page.getByTestId("ds-evidence-quiet-motion");
    await expect(interactionEvidence).toBeVisible();
    await expect(interactionEvidence).toContainText("设计师改写后的回答");
    await expect(page.getByTestId("ds-interaction-rule-3")).toContainText(
      "Input method does not limit capability."
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
