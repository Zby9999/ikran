// Ikran Issue 09 / 09A — Design System Browser e2e through the real Workbench.
//
// Full chain: six-part alignment completes → the Draft Design System entry
// appears → design-system JSON sources declared + ingested through MCP → the
// bottom sheet renders Foundations/Components from the DB view → the ⓘ layer
// shows the real evidence chain → Esc layering (popover first, sheet second)
// and canvas-shortcut isolation → candidate → formalized approval writes BOTH
// the DB row and the JSON source file → the typed approval failure reason
// renders inline for a candidate without a designer-edited linked card.
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
    const designerEditedCardId = cards["design-principle"][0].id;
    const tokenDesignerEditedCardId = cards["token"][0].id;
    const agentAcceptedCardId = cards["token"][1].id;
    for (const cardId of [designerEditedCardId, tokenDesignerEditedCardId]) {
      const answered = await patchAlignment(workbenchUrl, token, {
        action: "record-designer-answer",
        input: { questionCardId: cardId, finalAnswer: "设计师改写后的回答" }
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
          arguments: { questionCardId: card.id, finalAnswer: card.answer }
        }))).toMatchObject({ ok: true, record: { status: "answered" } });
      }
    }

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
      principles: [
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
          value: "#101418",
          meaning: "Primary text ink",
          status: "candidate",
          links: [tokenDesignerEditedCardId]
        },
        "color.brand": {
          value: "#3A93FF",
          meaning: "Brand accent",
          status: "candidate",
          links: [agentAcceptedCardId]
        }
      },
      semantic: {
        "color.text-primary": {
          value: { alias: "primitive.color.ink" },
          meaning: "Default text color",
          status: "candidate",
          links: [tokenDesignerEditedCardId]
        },
        "color.surface-muted": {
          value: "#F2F2F2",
          meaning: "Muted surface",
          status: "candidate",
          links: [agentAcceptedCardId]
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
    writeSource("design-system/components/button.json", {
      id: "button",
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
        boundaries: ["Never nest interactive elements inside Button"],
        stateMatrix: [
          { state: "hover", background: "primitive.color.ink" },
          { state: "disabled", opacity: "0.5" }
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
      "design-system/token.json",
      "token.json",
      [tokenDesignerEditedCardId, agentAcceptedCardId]
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
    expect(structuredContent(await declare(
      "design-system/interaction-rules.json",
      "interaction-rules.json",
      [designerEditedCardId]
    ))).toMatchObject({ ok: true, record: { status: "ingested" } });

    // ---- Sheet rendering: Foundations home, token leaf, Components. ----
    await entryButton.click();
    const sheet = page.getByTestId("ds-sheet");
    await expect(sheet).toHaveAttribute("data-open", "true");
    await expect(page.getByTestId("ds-principle-principle-clarity")).toBeVisible();
    await expect(page.getByTestId("ds-row-visual-language")).toBeVisible();

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
    await expect(aliasRow.getByRole("tooltip")).toContainText(
      "color.ink · #101418"
    );
    // Unconsumed primitives stay visible as bare swatches — name and usage
    // deliberately absent until something consumes them.
    const unconsumed = page.getByTestId("ds-color-unconsumed");
    await expect(unconsumed).toBeVisible();
    await expect(unconsumed).toContainText("Unconsumed primitives · 1");
    await expect(unconsumed.locator(".dsb-color-name")).toHaveCount(0);
    await expect(
      page.getByTestId("ds-color-swatch-color.brand")
    ).toBeVisible();

    await page.getByRole("tab", { name: "Components" }).click();
    const componentCard = page.getByTestId("ds-component-card-button");
    await expect(componentCard).toBeVisible();
    await componentCard.click();
    await expect(
      page.getByRole("heading", { name: "Button", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Boundaries" })
    ).toBeVisible();
    await expect(
      page.getByText("Never nest interactive elements inside Button")
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "State matrix" })
    ).toBeVisible();
    await expect(page.getByRole("cell", { name: "hover" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "disabled" })).toBeVisible();

    // ---- Inline rule edit: UI → source + DB + event → SSE refresh. ----
    await page.getByRole("tab", { name: "Foundations" }).click();
    await page.getByRole("button", { name: "Interaction", exact: true }).click();
    const interactionRule = page.getByTestId("ds-interaction-rule-1");
    await expect(interactionRule.getByRole("button", { name: "Save" })).toHaveCount(0);
    const rowBeforeEdit = await interactionRule
      .locator(".dsb-interaction-ledger-row")
      .boundingBox();
    const bodyBeforeEdit = await interactionRule.locator(".dsb-card-desc").boundingBox();
    const editButton = interactionRule.getByTestId(
      "ds-rule-edit-interaction-calm-feedback"
    );
    await editButton.click();
    await expect(editButton).toHaveAttribute("aria-pressed", "true");
    const bodyInput = interactionRule.getByLabel("Rule body");
    const rowAfterEdit = await interactionRule
      .locator(".dsb-interaction-ledger-row")
      .boundingBox();
    const bodyAfterEdit = await bodyInput.boundingBox();
    const bodyOffsetBefore =
      bodyBeforeEdit && rowBeforeEdit ? bodyBeforeEdit.y - rowBeforeEdit.y : null;
    const bodyOffsetAfter =
      bodyAfterEdit && rowAfterEdit ? bodyAfterEdit.y - rowAfterEdit.y : null;
    expect(bodyOffsetBefore).not.toBeNull();
    expect(bodyOffsetAfter).not.toBeNull();
    expect(Math.abs(bodyOffsetAfter! - bodyOffsetBefore!)).toBeLessThan(0.5);
    const titleInput = interactionRule.getByLabel("Rule title");
    await titleInput.fill("Measured feedback");
    await expect(
      interactionRule.getByTestId("ds-rule-save-interaction-calm-feedback")
    ).toBeVisible();
    await bodyInput.fill(
      "Respond immediately.\nKeep feedback motion deliberately restrained."
    );
    await interactionRule.getByRole("button", { name: "Save", exact: true }).click();
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

    // ---- Approve a candidate: chip flips, DB row + source file rewritten. ----
    await page.getByRole("button", { name: "Color", exact: true }).click();
    await page
      .getByRole("button", { name: "Evidence for color.text-primary", exact: true })
      .hover();
    const approveInk = page.getByTestId("ds-approve-semantic.color.text-primary");
    await expect(approveInk).toBeVisible();
    // Moving into the popover content cancels the hover-close timer.
    await approveInk.hover();
    await approveInk.click();
    // The tray retires only after the server committed (DB + file + event).
    await expect(approveInk).toHaveCount(0);
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

    // ---- Approval failure: candidate without a designer-edited linked card. ----
    // Close the ink popover with a pointer-down OUTSIDE it. The approve
    // commit re-rendered the sheet under a stationary mouse, so hover
    // bookkeeping (which node "owns" mouseenter/mouseleave) is unreliable
    // here; a pointerdown dismisses the popover regardless. Click EMPTY
    // left-pane space by coordinates: the hover popover opens side="top"
    // over the upper pane (covering even the block-level heading's hit
    // points), while the lower pane is always clear of it.
    await page.mouse.click(300, 640);
    await expect(
      page.getByTestId("ds-evidence-semantic.color.text-primary")
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Evidence for color.surface-muted", exact: true })
      .hover();
    const mutedEvidence = page.getByTestId(
      "ds-evidence-semantic.color.surface-muted"
    );
    await expect(mutedEvidence).toBeVisible();
    const approveMuted = page.getByTestId(
      "ds-approve-semantic.color.surface-muted"
    );
    await expect(approveMuted).toBeVisible();
    await approveMuted.hover();
    await approveMuted.click();
    const mutedRow = page.getByTestId("ds-row-semantic.color.surface-muted");
    // The row alert renders approvalErrorMessage(reason) — this exact copy
    // maps 1:1 to the typed reason `formalized_requires_designer_edited_link`.
    await expect(mutedRow.getByRole("alert")).toContainText(
      "Needs a designer-edited answered card before it can be formalized."
    );
    await expect(mutedRow.getByTestId("ds-status-chip")).toHaveText("Candidate");
    expect(
      readDesignSystemEntryStatus(
        projectDir,
        "design-system/token.json",
        "semantic.color.surface-muted"
      )
    ).toBe("candidate");

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
