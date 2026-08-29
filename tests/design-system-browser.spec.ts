// Ikran Issue 09 / 09A — Design System Browser e2e through the real Workbench.
//
// Full chain: six-part alignment completes → the Draft Design System entry
// appears → design-system JSON sources declared + ingested through MCP → the
// bottom sheet renders Foundations/Components from the DB view → the ⓘ layer
// shows the real evidence chain → Esc layering (popover first, sheet second)
// and canvas-shortcut isolation → clicking the status switches it both ways
// entries with either designer-edited or designer-accepted evidence and writes
// BOTH the DB row and the JSON source file.
//
// Staging mirrors tests/design-intent-alignment-mcp.spec.ts and
// tests/alignment-command-staged-smoke.spec.ts: seed/evidence are registered
// directly, the alignment flow is driven through MCP tools + the alignment
// HTTP surface, and the Workbench page follows along via the live SSE channel.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import { openIkranDb } from "./helpers/db";
import { writeSyntheticCapture } from "./helpers/synthetic-capture";

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

function readDesignSystemEntryStatus(
  projectDir: string,
  sourceArtifactPath: string,
  entryId: string
): string | null {
  const db = openIkranDb(path.join(projectDir, ".ikran", "ikran.db"));
  try {
    const row = db
      .prepare(
        `SELECT status FROM design_system_entries
         WHERE source_artifact_path = ? AND entry_id = ?`
      )
      .get(sourceArtifactPath, entryId) as { status: string } | undefined;
    return row?.status ?? null;
  } finally {
    db.close();
  }
}

function readEventTypes(projectDir: string): string[] {
  const db = openIkranDb(path.join(projectDir, ".ikran", "ikran.db"));
  try {
    return (
      db.prepare("SELECT type FROM events ORDER BY id ASC").all() as Array<{
        type: string;
      }>
    ).map((row) => row.type);
  } finally {
    db.close();
  }
}

function markInitialDesignSystemPreparationCompleted(projectDir: string): void {
  const db = openIkranDb(path.join(projectDir, ".ikran", "ikran.db"));
  try {
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE agent_commands
       SET status = 'completed', completed_at = ?, updated_at = ?
       WHERE command_type = 'prepare_initial_design_system'`
    ).run(now, now);
  } finally {
    db.close();
  }
}

test("09A design system browser: declare → render → approve write-back", async ({
  page
}) => {
  test.setTimeout(240_000);
  const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-ds-browser-state-"));
  const projectDir = mkdtempSync(path.join(tmpdir(), "ikran-ds-browser-project-"));
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
        "https://www.figma.com/design/DsBrowser/Fixture?node-id=1:2",
      originalDesignIntent: "Design system browser e2e fixture"
    });
    expect(seed.ok).toBe(true);
    if (!seed.ok) return;
    const evidence = recordEvidencePackage(projectDir, {
      seedReferenceId: seed.record.id,
      frame: { nodeId: "1:2", name: "DS browser fixture" },
      evidenceViews: { rawData: "available", screenshot: "missing" }
    });
    expect(evidence.ok).toBe(true);
    if (!evidence.ok) return;
    expect(
      setDesignLanguageDescription(projectDir, "A calm, precise product language").ok
    ).toBe(true);

    // The Browser entry exists only after the six-part alignment completes.
    await page.goto(workbenchUrl);
    await enterCanvas(page);
    const entryButton = page.getByTestId("open-design-system-browser");
    await expect(entryButton).toHaveCount(0);

    const prepareResponse = await patchAlignment(workbenchUrl, token, {
      action: "prepare"
    });
    expect(prepareResponse.status).toBe(200);
    const staged = await stageAlignmentAnswering(client, {
      seedReferenceId: seed.record.id,
      evidenceId: evidence.record.id,
      keyPrefix: "ds-e2e"
    });
    const { annotationIds, cards } = staged;

    // Two designer-edited answers (HTTP surface = the designer typing their
    // own wording) — one backs the approvable token, one the formalized
    // visual language. Everything else is answered as proposed.
    const designerEditedCardId = cards["design-concept"][0].id;
    const tokenDesignerEditedCardId = cards["token"][0].id;
    const agentAcceptedCardId = cards["token"][1].id;
    for (const cardId of [designerEditedCardId, tokenDesignerEditedCardId]) {
      const answered = await patchAlignment(workbenchUrl, token, {
        action: "record-designer-answer",
        input: {
          questionCardId: cardId,
          answer: { kind: "custom", text: "设计师改写后的回答" }
        }
      });
      expect(answered.status).toBe(200);
    }
    for (const section of ALIGNMENT_SECTIONS) {
      for (const card of cards[section]) {
        if (
          card.id === designerEditedCardId ||
          card.id === tokenDesignerEditedCardId
        ) {
          continue;
        }
        expect(structuredContent(await client.callTool({
          name: "record_designer_answer",
          arguments: {
            questionCardId: card.id,
            answer: { kind: "option", optionId: card.optionId }
          }
        }))).toMatchObject({ ok: true, record: { status: "answered" } });
      }
    }
    expect(await staged.finalization).toMatchObject({
      ok: true,
      incrementalPlanning: { reason: "delta_available" }
    });

    const completeResponse = await patchAlignment(workbenchUrl, token, {
      action: "complete"
    });
    expect(completeResponse.status).toBe(200);
    // SSE-driven: the entry appears without a reload once alignment completes.
    await expect(entryButton).toBeVisible();

    // ---- Declare a small but complete design-system source set via MCP. ----
    const designSystemDir = path.join(projectDir, "design-system");
    mkdirSync(path.join(designSystemDir, "components"), { recursive: true });
    const writeSource = (relative: string, json: unknown) =>
      writeFileSync(
        path.join(projectDir, relative),
        `${JSON.stringify(json, null, 2)}\n`,
        "utf-8"
      );

    writeSource("design-system/design-system.json", {
      name: "Ikran Test System",
      visualLanguage: {
        id: "visual-language",
        value: { description: "Calm, precise product language." },
        meaning: "Overall visual tone",
        status: "formalized",
        links: [designerEditedCardId]
      },
      concepts: [
        {
          id: "principle-clarity",
          value: "Clarity comes before ornament.",
          meaning: "Lead with legibility",
          status: "candidate",
          links: [designerEditedCardId]
        }
      ]
    });
    writeSource("design-system/token.json", {
      primitive: {
        "color.ink": {
          kind: "token",
          domain: "color",
          value: "#101418",
          status: "candidate",
          links: [tokenDesignerEditedCardId]
        },
        "color.brand": {
          kind: "token",
          domain: "color",
          value: "#3A93FF",
          status: "candidate",
          links: [agentAcceptedCardId]
        }
      },
      semantic: {
        "color.text-primary": {
          kind: "token",
          domain: "color",
          value: {
            alias: "primitive.color.ink",
            usage: "Default text color"
          },
          status: "candidate",
          links: [tokenDesignerEditedCardId]
        },
        "color.surface-muted": {
          kind: "token",
          domain: "color",
          value: "#F2F2F2",
          status: "candidate",
          links: [agentAcceptedCardId]
        },
        "rule.open-gap.interactive-state-evidence": {
          kind: "domain-rule",
          domain: "color",
          meaning: "Interactive color states need direct evidence.",
          value:
            "The captured frames show only the default state, so hover and pressed colors cannot be extracted safely. Next: inspect the Button hover and pressed states before declaring state tokens.",
          status: "gap",
          links: []
        }
      },
      component: {}
    });
    writeSource("design-system/component-list.json", {
      components: [
        {
          id: "button",
          value: { name: "Button", specPath: "design-system/components/button.json" },
          meaning: "Primary action trigger",
          status: "candidate",
          links: [annotationIds["component"]]
        }
      ]
    });
    // Issue 32 follow-up: generated code screenshots are no longer an active
    // hero tier. Keep the real code link on the spec, but use source evidence
    // as the static fallback until a live harness is declared.
    mkdirSync(path.join(projectDir, "components"), { recursive: true });
    writeFileSync(
      path.join(projectDir, "components", "Button.tsx"),
      'export const Button = () => <button type="button">Button</button>;\n',
      "utf-8"
    );
    mkdirSync(path.join(designSystemDir, "captures"), { recursive: true });
    writeSyntheticCapture(
      path.join(designSystemDir, "captures", "button-source.svg")
    );
    const buttonCodeLinks = ["components/Button.tsx"];
    writeSource("design-system/components/button.json", {
      id: "button-spec",
      name: "Button",
      meaning: "Button component spec",
      status: "candidate",
      links: [annotationIds["component"]],
      value: {
        description: "The primary action button.",
        props: [
          {
            name: "variant",
            type: "string",
            required: true,
            description: "Visual variant"
          }
        ],
        variants: [
          { axis: "style", name: "primary" },
          { axis: "size", name: "default" }
        ],
        stateMatrix: [
          { state: "hover", background: "primitive.color.ink" },
          { state: "disabled", opacity: "0.5" }
        ],
        guidelines: [
          {
            kind: "dont",
            text: "Never nest interactive elements inside Button"
          }
        ],
        tokenLinks: ["semantic.color.text-primary"],
        codeLinks: buttonCodeLinks,
        sourceCaptures: [
          {
            nodeName: "Button",
            artifactPath: "design-system/captures/button-source.svg",
            capturedAt: "2026-08-07T14:00:00.000Z",
            origin: "source"
          }
        ]
      }
    });
    writeSource("design-system/interaction-rules.json", {
      rules: [
        {
          id: "interaction-calm-feedback",
          value: "Feedback remains quiet and immediate.",
          meaning: "Calm feedback",
          status: "candidate",
          links: [designerEditedCardId]
        }
      ]
    });

    const declare = (artifactPath: string, artifactType: string, links: string[]) =>
      client!.callTool({
        name: "record_artifact_written",
        arguments: {
          path: artifactPath,
          artifactType,
          semanticPurpose: `${artifactType} source`,
          relatedRecordIds: links
        }
      });

    writeSource("design-system/interaction-rules.json", {
      rules: [
        {
          id: "interaction-legacy-shape",
          value: { statement: "Feedback remains quiet." },
          meaning: "Legacy feedback",
          status: "candidate",
          links: [designerEditedCardId]
        }
      ]
    });
    expect(structuredContent(await declare(
      "design-system/interaction-rules.json",
      "interaction-rules.json",
      [designerEditedCardId]
    ))).toMatchObject({
      ok: false,
      error: "legacy_rule_body_requires_prose",
      details: {
        field: "value",
        expected: "non-empty prose string"
      }
    });
    writeSource("design-system/interaction-rules.json", {
      rules: [
        {
          id: "interaction-calm-feedback",
          value: "Feedback remains quiet and immediate.",
          meaning: "Calm feedback",
          status: "candidate",
          links: [designerEditedCardId]
        }
      ]
    });

    expect(structuredContent(await declare(
      "design-system/design-system.json",
      "design-system.json",
      [designerEditedCardId]
    ))).toMatchObject({ ok: true, record: { status: "ingested" } });
    expect(structuredContent(await declare(
      "design-system/interaction-rules.json",
      "interaction-rules.json",
      [designerEditedCardId]
    ))).toMatchObject({ ok: true, record: { status: "ingested" } });
    expect(structuredContent(await declare(
      "design-system/component-list.json",
      "component-list.json",
      [annotationIds["component"]]
    ))).toMatchObject({ ok: true, record: { status: "ingested" } });
    expect(structuredContent(await declare(
      "design-system/components/button.json",
      "component-spec",
      [annotationIds["component"]]
    ))).toMatchObject({ ok: true, record: { status: "ingested" } });

    // Issues 36-40: the Agent drafts the complete Review privately, then
    // publishes the full batch. The Browser, not chat text, owns revision and
    // decision UI; decisions wake the Agent through the durable command queue.
    const reviewResult = structuredContent(await client.callTool({
      name: "create_rule_update_review",
      arguments: { context: "Prototype validation · feedback behavior" }
    }));
    expect(reviewResult).toMatchObject({ ok: true, review: { status: "draft" } });
    const reviewId = String((reviewResult.review as { id: string }).id);
    const updateProposalResult = structuredContent(await client.callTool({
      name: "propose_rule_update",
      arguments: {
        reviewId,
        kind: "update",
        classification: "proposed_update",
        title: "Calm feedback stays immediate",
        fullRuleBody: "Feedback stays immediate without demanding attention.",
        reason: "The validated prototype clarified the existing feedback rule.",
        affectedItems: ["Feedback"],
        evidenceRecordIds: [],
        targetCategory: "foundations.interaction",
        sourceArtifactPath: "design-system/interaction-rules.json",
        entryId: "interaction-calm-feedback"
      }
    }));
    expect(updateProposalResult).toMatchObject({ ok: true, proposal: { revision: 1 } });
    const updateProposalId = String((updateProposalResult.proposal as { id: string }).id);
    const newProposalResult = structuredContent(await client.callTool({
      name: "propose_rule_update",
      arguments: {
        reviewId,
        kind: "new",
        classification: "proposed_update",
        title: "Purposeful progressive disclosure",
        fullRuleBody: "Reveal secondary controls only when their context becomes relevant.",
        reason: "The validated prototype established a reusable disclosure pattern.",
        affectedItems: ["Secondary controls"],
        evidenceRecordIds: [],
        targetCategory: "foundations.interaction",
        sourceArtifactPath: "design-system/interaction-rules.json"
      }
    }));
    expect(newProposalResult).toMatchObject({ ok: true, proposal: { revision: 1 } });
    const newProposalId = String((newProposalResult.proposal as { id: string }).id);
    const componentProposalResult = structuredContent(await client.callTool({
      name: "propose_rule_update",
      arguments: {
        reviewId,
        kind: "update",
        classification: "proposed_update",
        title: "Button action hierarchy",
        changeDescription: "Keep one clear action hierarchy in every Button.",
        fullRuleBody: JSON.stringify({
          id: "button-spec",
          name: "Button",
          status: "candidate",
          links: [annotationIds["component"]],
          value: {
            description: "Button keeps one clear action hierarchy.",
            props: [
              {
                name: "variant",
                type: "string",
                required: true,
                description: "Visual variant"
              }
            ],
            variants: [
              { axis: "style", name: "primary" },
              { axis: "size", name: "default" }
            ],
            stateMatrix: [
              { state: "hover", background: "primitive.color.ink" },
              { state: "disabled", opacity: "0.5" }
            ],
            guidelines: [
              {
                kind: "dont",
                text: "Never nest interactive elements inside Button"
              }
            ],
            tokenLinks: ["semantic.color.text-primary"],
            codeLinks: buttonCodeLinks,
            sourceCaptures: [
              {
                nodeName: "Button",
                artifactPath: "design-system/captures/button-source.svg",
                capturedAt: "2026-08-07T14:00:00.000Z",
                origin: "source"
              }
            ]
          }
        }),
        reason: "The linked spec used a legacy id distinct from the inventory id.",
        affectedItems: ["Button"],
        evidenceRecordIds: [],
        targetCategory: "component:button-spec",
        sourceArtifactPath: "design-system/components/button.json",
        entryId: "button-spec"
      }
    }));
    expect(componentProposalResult).toMatchObject({
      ok: true,
      proposal: {
        revision: 1,
        change_description: "Keep one clear action hierarchy in every Button.",
        target: { category: "component:button", entryId: "button" }
      }
    });
    const componentProposalId = String(
      (componentProposalResult.proposal as { id: string }).id
    );
    expect(structuredContent(await client.callTool({
      name: "publish_rule_update_review",
      arguments: { reviewId }
    }))).toMatchObject({ ok: true, proposal_count: 3 });
    expect(structuredContent(await declare(
      "design-system/token.json",
      "token.json",
      [tokenDesignerEditedCardId, agentAcceptedCardId]
    ))).toMatchObject({ ok: true, record: { status: "ingested" } });
    expect(structuredContent(await declare(
      "design-system/interaction-rules.json",
      "interaction-rules.json",
      [designerEditedCardId]
    ))).toMatchObject({ ok: true, record: { status: "ingested" } });

    // This test exercises the post-finalize Browser write-back surface. The
    // extraction protocol itself is covered by its Runtime/MCP tests.
    markInitialDesignSystemPreparationCompleted(projectDir);

    // ---- Sheet rendering: Foundations home, token leaf, Components. ----
    await entryButton.click();
    const sheet = page.getByTestId("ds-sheet");
    await expect(sheet).toHaveAttribute("data-open", "true");
    await expect(sheet.locator(".dsb-intro")).toHaveCount(0);
    await expect(
      sheet
        .getByRole("button", { name: "Home", exact: true })
        .locator(".dsb-navrow-candidate-dot")
    ).toBeVisible();
    await expect(page.getByTestId("ds-concept-principle-clarity")).toBeVisible();
    await expect(page.getByTestId("ds-visual-language-visual-language")).toBeVisible();

    // Visual Language uses value.description rather than a string value, but
    // remains editable through the same visible rule-edit interaction.
    const visualLanguage = page.getByTestId(
      "ds-visual-language-visual-language"
    );
    const visualEdit = visualLanguage.getByTestId(
      "ds-rule-edit-visual-language"
    );
    await visualEdit.click();
    await visualLanguage
      .getByLabel("Rule body")
      .fill("A calm monochrome system whose project imagery supplies color.");
    const visualSave = visualLanguage.getByRole("button", {
      name: /^Save rule/
    });
    await expect(visualSave).toHaveAttribute("data-size", "icon-xs");
    await expect(visualSave.locator("svg")).toBeVisible();
    await visualSave.click();
    // The click starts an async write. Wait for the editor to retire before
    // reading the canonical source file; the input already contains the new
    // text while the request is still pending, so text visibility alone is
    // not a persistence boundary.
    await expect(
      visualLanguage.getByTestId("ds-rule-save-visual-language")
    ).toHaveCount(0);
    await expect(visualLanguage).toContainText(
      "A calm monochrome system whose project imagery supplies color."
    );
    const editedVisualLanguage = JSON.parse(
      readFileSync(path.join(designSystemDir, "design-system.json"), "utf-8")
    ) as { visualLanguage: { value: { description: string } } };
    expect(editedVisualLanguage.visualLanguage.value.description).toBe(
      "A calm monochrome system whose project imagery supplies color."
    );

    await page.getByRole("button", { name: "Color", exact: true }).click();
    // Redesign: the Primitive section collapses into swatch provenance —
    // no layer sections, no primitive rows, no "→ layer.name" alias text.
    await expect(page.getByTestId("ds-color-group-semantic")).toBeVisible();
    await expect(page.getByTestId("ds-token-layer-primitive")).toHaveCount(0);
    await expect(page.getByTestId("ds-row-primitive.color.ink")).toHaveCount(0);
    const aliasRow = page.getByTestId("ds-row-semantic.color.text-primary");
    await expect(aliasRow).toBeVisible();
    await expect(aliasRow.getByTestId("ds-status-chip")).toHaveText("Candidate");
    await expect(aliasRow).toContainText("Default text color");
    await expect(aliasRow).not.toContainText("→ primitive.color.ink");
    // The consumed primitive survives as the swatch tooltip's provenance.
    await aliasRow.getByTestId("ds-color-swatch-color.text-primary").hover();
    // Tooltip content is portalled to the sheet surface so it is not clipped
    // by the row or content pane.
    await expect(page.getByRole("tooltip")).toContainText(
      "color.ink · #101418"
    );
    // A primitive with no incoming alias is not automatically a gap. Open
    // extraction questions render as ordinary gap-status Rules.
    await expect(page.getByTestId("ds-color-unconsumed")).toHaveCount(0);
    await expect(page.getByTestId("ds-color-open-gaps")).toHaveCount(0);
    const rules = page.getByTestId("ds-rules-zone");
    await expect(rules).toContainText(
      "Interactive color states need direct evidence."
    );
    await expect(rules.getByTestId("ds-interaction-status").last()).toHaveText(
      "Open gap"
    );

    // 09C-D03: no Components Home — the tab lands directly on the first
    // component's placard detail; the sidebar carries the grouped nav with
    // a candidate blue dot.
    await page.getByRole("tab", { name: "Components" }).click();
    const componentGroup = page.getByTestId("ds-navgroup-component");
    await expect(componentGroup).toBeVisible();
    const buttonNav = componentGroup.getByRole("button", { name: "Button" });
    await expect(buttonNav).toBeVisible();
    await expect(buttonNav).toHaveAttribute("data-active", "true");
    await expect(
      buttonNav.locator(".dsb-navrow-candidate-dot")
    ).toBeVisible();
    // Placard: without a declared live harness, source evidence is the static
    // fallback. Generated code screenshots are not an active hero tier.
    await expect(page.getByTestId("ds-component-hero")).toBeVisible();
    await expect(page.getByTestId("ds-component-unavailable")).toHaveCount(0);
    const heroOrigin = page.getByTestId("ds-component-capture-origin");
    await expect(heroOrigin).toHaveText("Source capture");
    await expect(heroOrigin).toHaveAttribute("data-origin", "source-capture");
    await expect(page.locator(".dsb-hero-image")).toHaveAttribute(
      "src",
      /design-system\/captures\/button-source\.svg/
    );
    // Hover provenance: the popover marks the source evidence.
    await heroOrigin.hover();
    const capturePanel = page.getByTestId("ds-component-capture-panel");
    await expect(capturePanel).toContainText("Source capture");
    await page.mouse.move(0, 0);
    await expect(page.getByTestId("ds-component-title")).toHaveText("Button");
    const statesRow = page.getByTestId("ds-component-states");
    await expect(statesRow).toBeVisible();
    await expect(statesRow).toContainText("hover");
    await expect(statesRow.locator("button")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Do / Don’ts" })
    ).toBeVisible();
    await expect(
      page.getByText("Never nest interactive elements inside Button")
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "States" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Variants" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Properties" })
    ).toBeVisible();
    await expect(page.getByRole("cell", { name: "hover" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "disabled" })).toBeVisible();
    const componentProposalCard = page.locator(".dsb-ru-card").filter({
      hasText: "Button action hierarchy"
    });
    await expect(componentProposalCard).toBeVisible();
    await componentProposalCard.getByRole("button", {
      name: "Expand Button action hierarchy"
    }).click();
    await expect(componentProposalCard).toContainText(
      "Keep one clear action hierarchy in every Button."
    );
    await expect(componentProposalCard).not.toContainText('"button-spec"');

    // ---- Inline rule edit: UI → source + DB + event → SSE refresh. ----
    await page.getByRole("tab", { name: "Foundations" }).click();
    const interactionNav = page.getByRole("button", { name: "Interaction", exact: true });
    await expect(interactionNav.locator(".dsb-navrow-rule-update-dot")).toBeVisible();
    await interactionNav.click();
    const newProposalCard = page.locator(".dsb-ru-card").filter({ hasText: "Purposeful progressive disclosure" });
    await expect(newProposalCard).toBeVisible();
    await expect(newProposalCard).not.toHaveAttribute("data-open", "true");
    await expect(newProposalCard.getByText("Pending Review", { exact: true })).toBeVisible();
    await expect(newProposalCard.locator(".dsb-ru-body")).toHaveCSS("opacity", "0");
    const interactionRule = page.getByTestId("ds-interaction-rule-1");
    const updateProposalSlot = interactionRule.locator("xpath=following-sibling::li[1]");
    await expect(interactionRule.getByTestId("ds-interaction-status")).toHaveText("Candidate");
    await expect(interactionRule.getByTestId("ds-interaction-status")).not.toHaveText("Pending Review");
    await expect(updateProposalSlot).toContainText("Calm feedback stays immediate");
    const pendingRuleUpdateDot = updateProposalSlot.getByLabel("Pending Rule Update");
    await expect(pendingRuleUpdateDot).toBeVisible();
    await expect(pendingRuleUpdateDot).toHaveCSS("width", "5px");
    await expect(pendingRuleUpdateDot).toHaveCSS("height", "5px");
    await updateProposalSlot.getByRole("button", { name: "Expand Calm feedback stays immediate" }).click();
    await expect(updateProposalSlot).toContainText(
      "Feedback stays immediate without demanding attention."
    );
    await expect(updateProposalSlot.getByText("Proposed", { exact: true })).toBeVisible();
    await expect(updateProposalSlot.getByText("Reason", { exact: true })).toBeVisible();
    await expect(updateProposalSlot.getByText("Affected", { exact: true })).toHaveCount(0);
    await expect(updateProposalSlot.getByText("Current", { exact: true })).toHaveCount(0);
    await expect(updateProposalSlot.getByText("Exchanges", { exact: true })).toHaveCount(0);
    const acceptRuleUpdate = updateProposalSlot.getByRole("button", {
      name: "Accept",
      exact: true
    });
    const rejectRuleUpdate = updateProposalSlot.getByRole("button", {
      name: "Reject",
      exact: true
    });
    const [acceptBox, rejectBox] = await Promise.all([
      acceptRuleUpdate.boundingBox(),
      rejectRuleUpdate.boundingBox()
    ]);
    expect(acceptBox?.width).toBe(rejectBox?.width);
    const updateEdit = updateProposalSlot.getByRole("button", {
      name: "Edit Calm feedback stays immediate"
    });
    const originalEdit = interactionRule.getByRole("button", {
      name: /Edit rule/
    });
    const [updateEditBox, originalEditBox] = await Promise.all([
      updateEdit.boundingBox(),
      originalEdit.boundingBox()
    ]);
    expect(updateEditBox?.width).toBe(originalEditBox?.width);
    expect(updateEditBox?.height).toBe(originalEditBox?.height);
    await updateEdit.click();
    const inlineTitle = updateProposalSlot.getByRole("textbox", {
      name: "Rule Update title"
    });
    const inlineBody = updateProposalSlot.getByRole("textbox", {
      name: "Proposed rule"
    });
    await expect(inlineTitle).toBeVisible();
    await expect(inlineBody).toBeVisible();
    await expect(updateProposalSlot.getByRole("combobox")).toHaveCount(0);
    await expect(inlineTitle).toHaveCSS("border-top-width", "0px");
    await expect(inlineBody).toHaveCSS("border-top-width", "0px");
    await expect(acceptRuleUpdate).toBeVisible();
    await expect(rejectRuleUpdate).toBeVisible();
    await expect(
      updateProposalSlot.getByRole("button", {
        name: "Interaction record for Calm feedback stays immediate"
      })
    ).toBeVisible();
    await expect(acceptRuleUpdate).toBeEnabled();
    await expect(rejectRuleUpdate).toBeEnabled();
    await inlineTitle.fill("Calm feedback stays immediate — revised");
    await expect(acceptRuleUpdate).toBeDisabled();
    await expect(rejectRuleUpdate).toBeDisabled();
    await expect(
      updateProposalSlot.getByRole("button", {
        name: "Save Rule Update Calm feedback stays immediate"
      })
    ).toBeVisible();
    await updateProposalSlot
      .getByRole("button", {
        name: "Cancel editing Rule Update Calm feedback stays immediate"
      })
      .click();
    const interactionInfo = updateProposalSlot.getByRole("button", {
      name: "Interaction record for Calm feedback stays immediate"
    });
    await interactionInfo.hover();
    await expect(page.locator(".dsb-ru-interaction-popover")).toBeVisible();
    await expect(page.locator(".dsb-ru-interaction-popover")).toContainText(
      "Interaction record"
    );
    await page.mouse.move(0, 0);

    await page
      .getByRole("button", { name: /^(Records|Interaction records)$/ })
      .click();
    const interactionRecords = page.getByTestId("rule-update-interaction-records");
    await expect(interactionRecords).toBeVisible();
    await expect(page.locator(".dsb-breadcrumb-current")).toHaveText(
      /^(Records|Interaction Records)$/
    );
    await expect(interactionRecords.locator(".dsb-ru-record")).toHaveCount(3);
    await expect(interactionRecords.getByRole("button", { name: "Check", exact: true })).toHaveCount(3);
    const componentRecord = interactionRecords.locator(".dsb-ru-record").filter({
      hasText: "Button action hierarchy"
    });
    await expect(componentRecord).toContainText(
      "Keep one clear action hierarchy in every Button."
    );
    await expect(componentRecord).not.toContainText('"button-spec"');
    await componentRecord.getByRole("button", { name: "Check", exact: true }).click();
    await expect(page.getByTestId("ds-component-title")).toHaveText("Button");
    await page
      .getByRole("button", { name: /^(Records|Interaction records)$/ })
      .click();
    const componentRecordDecision = page
      .getByTestId("rule-update-interaction-records")
      .locator(".dsb-ru-record")
      .filter({ hasText: "Button action hierarchy" });
    await componentRecordDecision.getByRole("button", {
      name: "Expand Button action hierarchy"
    }).click();
    await componentRecordDecision.getByRole("button", {
      name: "Reject",
      exact: true
    }).click();
    await expect(componentRecordDecision.getByRole("button", {
      name: "Reject",
      exact: true
    })).toHaveCount(0);
    await page.getByRole("tab", { name: "Foundations" }).click();
    await interactionNav.click();

    await updateProposalSlot.getByRole("button", { name: "Expand Calm feedback stays immediate" }).click();
    await updateProposalSlot.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(
      page.locator(".dsb-ru-card").filter({ hasText: "Calm feedback stays immediate" })
    ).toHaveCount(0);

    await newProposalCard.getByRole("button", { name: "Expand Purposeful progressive disclosure" }).click();
    await newProposalCard.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(newProposalCard).toContainText("Waiting for Agent");

    expect(structuredContent(await client.callTool({
      name: "claim_rule_update_decision",
      arguments: {}
    }))).toMatchObject({
      ok: true,
      completed: true,
      command: { payload: { proposal_id: componentProposalId, decision: "rejected" } }
    });
    expect(structuredContent(await client.callTool({
      name: "claim_rule_update_decision",
      arguments: {}
    }))).toMatchObject({
      ok: true,
      completed: true,
      command: { payload: { proposal_id: updateProposalId, decision: "rejected" } }
    });
    const acceptedClaim = structuredContent(await client.callTool({
      name: "claim_rule_update_decision",
      arguments: {}
    }));
    expect(acceptedClaim.ok, JSON.stringify(acceptedClaim)).toBe(true);
    expect(acceptedClaim).toMatchObject({
      ok: true,
      completed: false,
      command: { status: "claimed", payload: { proposal_id: newProposalId, decision: "accepted" } }
    });
    writeSource("design-system/interaction-rules.json", {
      rules: [
        {
          id: "interaction-calm-feedback",
          value: "Feedback remains quiet and immediate.",
          meaning: "Calm feedback",
          status: "candidate",
          links: [designerEditedCardId]
        },
        {
          id: "interaction-purposeful-disclosure",
          value: "Reveal secondary controls only when their context becomes relevant.",
          meaning: "Purposeful progressive disclosure",
          status: "candidate",
          links: [designerEditedCardId]
        }
      ]
    });
    expect(structuredContent(await client.callTool({
      name: "record_artifact_written",
      arguments: {
        path: "design-system/interaction-rules.json",
        artifactType: "interaction-rules.json",
        semanticPurpose: "Apply accepted Rule Update revision",
        relatedRecordIds: [designerEditedCardId],
        proposalId: newProposalId
      }
    }))).toMatchObject({ ok: true, record: { status: "ingested" } });
    await expect(newProposalCard).toHaveCount(0);
    await expect(interactionNav.locator(".dsb-navrow-rule-update-dot")).toHaveCount(0);
    await expect(page.getByText("Purposeful progressive disclosure", { exact: true })).toBeVisible();
    await expect(interactionRule.getByRole("button", { name: "Save" })).toHaveCount(0);
    const bodyReadOnly = interactionRule.locator(".dsb-card-desc");
    const bodyOffsetBefore = await bodyReadOnly.evaluate((element) => {
      const row = element.closest(".dsb-interaction-ledger-row");
      if (!row) return null;
      return (
        element.getBoundingClientRect().top - row.getBoundingClientRect().top
      );
    });
    const typographyBeforeEdit = await bodyReadOnly.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        letterSpacing: style.letterSpacing,
        lineHeight: style.lineHeight
      };
    });
    const editButton = interactionRule.getByTestId(
      "ds-rule-edit-interaction-calm-feedback"
    );
    await editButton.click();
    await expect(editButton).toHaveAttribute("aria-pressed", "true");
    const bodyInput = interactionRule.getByLabel("Rule body");
    const bodyOffsetAfter = await bodyInput.evaluate((element) => {
      const row = element.closest(".dsb-interaction-ledger-row");
      if (!row) return null;
      return (
        element.getBoundingClientRect().top - row.getBoundingClientRect().top
      );
    });
    const typographyAfterEdit = await bodyInput.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        letterSpacing: style.letterSpacing,
        lineHeight: style.lineHeight
      };
    });
    expect(bodyOffsetBefore).not.toBeNull();
    expect(bodyOffsetAfter).not.toBeNull();
    // Read the body and its row in one browser layout snapshot. Separate
    // boundingBox calls can observe different frames while the sheet settles,
    // even though the body's position inside the row is unchanged.
    expect(bodyOffsetAfter).toBeCloseTo(bodyOffsetBefore!, 4);
    expect(typographyAfterEdit).toEqual(typographyBeforeEdit);
    const titleInput = interactionRule.getByLabel("Rule title");
    await titleInput.fill("Measured feedback");
    await expect(
      interactionRule.getByTestId("ds-rule-save-interaction-calm-feedback")
    ).toBeVisible();
    await bodyInput.fill(
      "Respond immediately.\nKeep feedback motion deliberately restrained."
    );
    await interactionRule
      .getByRole("button", { name: /^Save rule/ })
      .click();
    await expect(interactionRule.getByLabel("Rule title")).toHaveCount(0);
    await expect(interactionRule.getByLabel("Rule body")).toHaveCount(0);
    await expect(editButton).toHaveAttribute("aria-pressed", "false");
    await expect(interactionRule).toContainText("Measured feedback");
    await expect(interactionRule).toContainText(
      "Keep feedback motion deliberately restrained."
    );

    const editedInteraction = JSON.parse(
      readFileSync(
        path.join(designSystemDir, "interaction-rules.json"),
        "utf-8"
      )
    ) as { rules: Array<{ meaning: string; value: string }> };
    expect(editedInteraction.rules[0].meaning).toBe("Measured feedback");
    expect(editedInteraction.rules[0].value).toBe(
      "Respond immediately.\nKeep feedback motion deliberately restrained."
    );
    const editDb = openIkranDb(path.join(projectDir, ".ikran", "ikran.db"));
    try {
      expect(
        editDb
          .prepare(
            `SELECT meaning FROM design_system_entries
             WHERE source_artifact_path = ? AND entry_id = ?`
          )
          .get(
            "design-system/interaction-rules.json",
            "interaction-calm-feedback"
          )
      ).toEqual({ meaning: "Measured feedback" });
    } finally {
      editDb.close();
    }
    expect(readEventTypes(projectDir)).toContain("design_system_entry_edited");
    await interactionRule
      .getByRole("button", {
        name: "Evidence for interaction rule interaction-calm-feedback"
      })
      .hover();
    await expect(
      page.getByTestId("ds-evidence-interaction-calm-feedback")
    ).toContainText("Calm feedback → Measured feedback");
    await expect(
      page.getByTestId("ds-evidence-interaction-calm-feedback")
    ).toContainText(
      "Feedback remains quiet and immediate. → Respond immediately. Keep feedback motion deliberately restrained."
    );
    await page.getByRole("heading", { name: "Interaction", exact: true }).hover();
    await expect(
      page.getByTestId("ds-evidence-interaction-calm-feedback")
    ).toHaveCount(0);

    // Issue 41: Retire is reviewed on the existing Rule, not as a replacement
    // body. Accept keeps the Delete state until the Agent declares the exact
    // removal; the applied proposal then remains in Interaction Records.
    const retireReview = structuredContent(await client.callTool({
      name: "create_rule_update_review",
      arguments: { context: "Retire duplicated feedback behavior" }
    }));
    expect(retireReview).toMatchObject({ ok: true, review: { status: "draft" } });
    const retireReviewId = String((retireReview.review as { id: string }).id);
    const retireProposal = structuredContent(await client.callTool({
      name: "propose_rule_update",
      arguments: {
        reviewId: retireReviewId,
        kind: "retire",
        classification: "proposed_update",
        title: "Measured feedback",
        reason: "The canonical disclosure rule now covers this behavior.",
        affectedItems: ["interaction-calm-feedback"],
        evidenceRecordIds: [designerEditedCardId],
        targetCategory: "foundations.interaction",
        sourceArtifactPath: "design-system/interaction-rules.json",
        entryId: "interaction-calm-feedback"
      }
    }));
    expect(retireProposal).toMatchObject({
      ok: true,
      proposal: { kind: "retire", full_rule_body: "" }
    });
    const retireProposalId = String((retireProposal.proposal as { id: string }).id);
    expect(structuredContent(await client.callTool({
      name: "publish_rule_update_review",
      arguments: { reviewId: retireReviewId }
    }))).toMatchObject({ ok: true, proposal_count: 1 });

    const retireStatus = interactionRule.getByTestId("ds-interaction-status");
    await expect(retireStatus).toHaveText("Delete");
    await expect(retireStatus).toHaveClass(/\bdsb-chip\b/);
    await expect(retireStatus).toHaveCSS("font-size", "12px");
    await expect(retireStatus).toHaveCSS("font-weight", "400");
    await expect(retireStatus).toHaveCSS("line-height", "12px");
    const effectiveOpacity = (locator: typeof retireStatus) =>
      locator.evaluate((element) => {
        let opacity = 1;
        for (
          let node: Element | null = element;
          node;
          node = node.parentElement
        ) {
          opacity *= Number.parseFloat(getComputedStyle(node).opacity || "1");
        }
        return opacity;
      });
    await expect(interactionRule).toHaveCSS("opacity", "1");
    expect(await effectiveOpacity(retireStatus)).toBeCloseTo(0.4);
    expect(
      await effectiveOpacity(interactionRule.locator(".dsb-interaction-anchor"))
    ).toBeCloseTo(0.4);
    expect(
      await effectiveOpacity(interactionRule.locator(".dsb-interaction-ledger-main"))
    ).toBeCloseTo(0.4);
    expect(
      await effectiveOpacity(interactionRule.locator(".dsb-rule-edit-icon"))
    ).toBe(1);
    expect(
      await effectiveOpacity(interactionRule.locator(".dsb-info-trigger"))
    ).toBe(1);
    const retireSlot = interactionRule.locator("xpath=following-sibling::li[1]");
    await expect(retireSlot).toHaveCSS("opacity", "1");
    await retireSlot.getByRole("button", { name: "Expand Measured feedback" }).click();
    await expect(retireSlot.getByText("Proposed", { exact: true })).toHaveCount(0);
    await expect(retireSlot).toContainText(
      "The canonical disclosure rule now covers this behavior."
    );
    await retireSlot.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(retireSlot).toContainText("Waiting for Agent");
    await expect(retireSlot).toContainText("Ask the Agent to continue.");
    await expect(interactionRule.getByTestId("ds-interaction-status")).toHaveText("Delete");

    const retireClaim = structuredContent(await client.callTool({
      name: "claim_rule_update_decision",
      arguments: {}
    }));
    expect(retireClaim).toMatchObject({
      ok: true,
      completed: false,
      command: {
        status: "claimed",
        payload: { proposal_id: retireProposalId, decision: "accepted" }
      }
    });
    writeSource("design-system/interaction-rules.json", {
      rules: [
        {
          id: "interaction-purposeful-disclosure",
          value: "Changed while retiring another Rule.",
          meaning: "Purposeful progressive disclosure",
          status: "candidate",
          links: [designerEditedCardId]
        }
      ]
    });
    expect(structuredContent(await client.callTool({
      name: "record_artifact_written",
      arguments: {
        path: "design-system/interaction-rules.json",
        artifactType: "interaction-rules.json",
        semanticPurpose: "Attempt an unrelated change with a Retire",
        relatedRecordIds: [designerEditedCardId],
        proposalId: retireProposalId
      }
    }))).toMatchObject({ ok: false, error: "retire_semantic_diff_mismatch" });
    await expect(interactionRule.getByTestId("ds-interaction-status")).toHaveText("Delete");
    writeSource("design-system/interaction-rules.json", {
      rules: [
        {
          id: "interaction-purposeful-disclosure",
          value: "Reveal secondary controls only when their context becomes relevant.",
          meaning: "Purposeful progressive disclosure",
          status: "candidate",
          links: [designerEditedCardId]
        }
      ]
    });
    expect(structuredContent(await client.callTool({
      name: "record_artifact_written",
      arguments: {
        path: "design-system/interaction-rules.json",
        artifactType: "interaction-rules.json",
        semanticPurpose: "Retire the accepted duplicate Rule",
        relatedRecordIds: [designerEditedCardId],
        proposalId: retireProposalId
      }
    }))).toMatchObject({ ok: true, record: { status: "ingested" } });
    await expect(page.getByText("Measured feedback", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: /^(Records|Interaction records)$/ }).click();
    const retiredRecord = page
      .getByTestId("rule-update-interaction-records")
      .locator(".dsb-ru-record")
      .filter({ hasText: "The canonical disclosure rule now covers this behavior." });
    await expect(retiredRecord).toContainText("Retired");
    await expect(retiredRecord).toContainText("Evidence");
    await expect(retiredRecord).toContainText(designerEditedCardId);

    // ---- ⓘ evidence chain for a row. ----
    await page.getByRole("tab", { name: "Foundations" }).click();
    await page.getByRole("button", { name: "Color", exact: true }).click();
    // Click static sheet content first: the leaf button that held keyboard
    // focus is destroyed by the navigation render, dropping focus to <body>,
    // and the sheet's Esc handler only acts on keydown originating inside
    // the sheet. Clicking the (non-focusable) leaf heading focuses the sheet
    // root — what a real mouse user poking at the sheet surface gets.
    await page.getByRole("heading", { name: "Color", exact: true }).click();
    // Open the ⓘ layer via HOVER — the designed affordance.
    await page
      .getByRole("button", { name: "Evidence for color.text-primary", exact: true })
      .hover();
    const inkEvidence = page.getByTestId("ds-evidence-semantic.color.text-primary");
    await expect(inkEvidence).toBeVisible();
    await expect(inkEvidence).toContainText("Question 1 for token?");
    await expect(inkEvidence).toContainText("设计师改写后的回答");
    await expect(inkEvidence).toContainText("designer-edited");
    await expect(
      page.getByRole("button", {
        name: "Switch color.text-primary to Formalized",
        exact: true
      })
    ).toBeVisible();
    // Hover-away close (the INFO_HOVER_CLOSE_MS delayed close in
    // design-system-browser.tsx) must stay closed — the regression class
    // where a programmatic close reopened the popover.
    await page.getByRole("heading", { name: "Color", exact: true }).hover();
    await expect(inkEvidence).toHaveCount(0);

    // ---- Esc layering: ⓘ layer first, sheet second. ----
    // Reopen the ⓘ layer; keyboard focus is still on the sheet root from the
    // heading click above, so Esc reaches the sheet's handler.
    await page
      .getByRole("button", { name: "Evidence for color.text-primary", exact: true })
      .hover();
    await expect(inkEvidence).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(inkEvidence).toHaveCount(0);
    await expect(sheet).toHaveAttribute("data-open", "true");
    // The second Esc closes the sheet itself. If the popover had reopened,
    // this press would close the popover instead and the assertions below
    // would fail — so the layering check doubles as a stability check.
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveAttribute("data-open", "false");
    await expect(page.getByTestId("design-system-browser")).toHaveCount(0);

    // ---- Canvas shortcuts stay inert while the sheet owns the keyboard. ----
    await entryButton.click();
    await expect(sheet).toHaveAttribute("data-open", "true");
    await page.keyboard.press("f");
    await expect(page.getByTestId("annotate-button")).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    await expect(sheet).toHaveAttribute("data-open", "true");

    // ---- Formalize directly from the Candidate chip. ----
    await page.getByRole("button", { name: "Color", exact: true }).click();
    const inkStatus = aliasRow.getByTestId("ds-status-chip");
    await expect(inkStatus).toHaveRole("button");
    await expect(inkStatus).toHaveAccessibleName(
      "Switch color.text-primary to Formalized"
    );
    await inkStatus.click();
    await expect(aliasRow.getByTestId("ds-status-chip")).toHaveText("Formalized");

    // The same control reverses an accidental click without a confirmation flow.
    await aliasRow.getByTestId("ds-status-chip").click();
    await expect(aliasRow.getByTestId("ds-status-chip")).toHaveText("Candidate");
    expect(
      readDesignSystemEntryStatus(
        projectDir,
        "design-system/token.json",
        "semantic.color.text-primary"
      )
    ).toBe("candidate");
    expect(readEventTypes(projectDir)).toContain("design_system_entry_reverted");

    // Switch once more so the remaining write-back assertions inspect Formalized.
    await aliasRow.getByTestId("ds-status-chip").click();
    await expect(aliasRow.getByTestId("ds-status-chip")).toHaveText("Formalized");

    const rewritten = JSON.parse(
      readFileSync(path.join(designSystemDir, "token.json"), "utf-8")
    ) as {
      primitive: Record<string, { status: string }>;
      semantic: Record<string, { status: string }>;
    };
    expect(rewritten.semantic["color.text-primary"].status).toBe("formalized");
    expect(rewritten.primitive["color.ink"].status).toBe("candidate");
    expect(
      readDesignSystemEntryStatus(
        projectDir,
        "design-system/token.json",
        "semantic.color.text-primary"
      )
    ).toBe("formalized");
    expect(readEventTypes(projectDir)).toContain("design_system_entry_approved");

    // A designer-accepted answer is enough when the designer directly clicks
    // Candidate; no prior designer-edited answer is required.
    const mutedRow = page.getByTestId("ds-row-semantic.color.surface-muted");
    await mutedRow.getByTestId("ds-status-chip").click();
    await expect(mutedRow.getByTestId("ds-status-chip")).toHaveText("Formalized");
    await expect(mutedRow.getByRole("alert")).toHaveCount(0);
    expect(
      readDesignSystemEntryStatus(
        projectDir,
        "design-system/token.json",
        "semantic.color.surface-muted"
      )
    ).toBe("formalized");

    // ---- Lazy file→DB sync: an undeclared Agent edit converges on read. ----
    // The Agent rewrote token.json with host-native editing and forgot to
    // re-declare; the Browser must not keep serving the stale DB rows.
    const tokenPath = path.join(designSystemDir, "token.json");
    const tokenSource = JSON.parse(readFileSync(tokenPath, "utf-8")) as {
      primitive: Record<string, { value: string }>;
    };
    tokenSource.primitive["color.ink"].value = "#ff0000";
    writeFileSync(tokenPath, JSON.stringify(tokenSource));
    // Close + reopen the sheet so the Browser re-fetches the view.
    await page.getByTestId("ds-close").click();
    await expect(sheet).toHaveAttribute("data-open", "false");
    await entryButton.click();
    await expect(sheet).toHaveAttribute("data-open", "true");
    await page.getByRole("button", { name: "Color", exact: true }).click();
    const syncedRow = page.getByTestId("ds-row-semantic.color.text-primary");
    await expect(syncedRow).toBeVisible();
    await syncedRow.getByTestId("ds-color-swatch-color.text-primary").hover();
    await expect(page.getByRole("tooltip")).toContainText(
      "color.ink · #ff0000"
    );
    await expect(page.getByTestId("ds-sync-warning")).toHaveCount(0);
    const syncDb = openIkranDb(path.join(projectDir, ".ikran", "ikran.db"));
    try {
      expect(
        syncDb
          .prepare(
            `SELECT value_json FROM design_system_entries
             WHERE source_artifact_path = ? AND entry_id = ?`
          )
          .get("design-system/token.json", "primitive.color.ink")
      ).toEqual({ value_json: '"#ff0000"' });
    } finally {
      syncDb.close();
    }
    // Hover-away so the tooltip does not linger into later assertions.
    await page.getByRole("heading", { name: "Color", exact: true }).hover();

    // The derived export is never the Browser's source, but it is regenerated.
    expect(
      existsSync(
        path.join(projectDir, ".ikran", "artifacts", "design-system-view.json")
      )
    ).toBe(true);
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
