import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import {
  ComponentDetail,
  DESIGN_SYSTEM_SHEET_EXIT_MS,
  DESIGN_SYSTEM_SHEET_REDUCED_MOTION_EXIT_MS,
  DesignSystemEntryButton,
  EvidenceInfoContent,
  FoundationsHomePage,
  LayoutLeafPage,
  RulesLeafPage,
  SpecRowView,
  StatusChip,
  TokenLeafPage,
  TypographyLeafPage,
  designSystemSheetExitMs,
  type RowSharedProps
} from "../../components/workbench/design-system-browser";
import {
  buildDesignSystemBrowserModel,
  toRow,
  type DesignSystemEntryView,
  type DesignSystemView,
  type DsRow
} from "../../components/workbench/design-system-view-model";

function entry(
  partial: Partial<DesignSystemEntryView>
): DesignSystemEntryView {
  return {
    id: "row-uuid",
    entry_id: "semantic.text.primary",
    file_kind: "token.json",
    section: "token.semantic",
    name: "text.primary",
    value: "#0D0D0D",
    alias: null,
    meaning: "Primary readable text",
    status: "candidate",
    links: ["card-1"],
    source_artifact_path: "design-system/token.json",
    evidence: {
      question_cards: [
        {
          id: "card-1",
          section: "token",
          question: "What is the primary text color?",
          final_answer: "Near-black #0D0D0D",
          answer_source: "designer-edited"
        }
      ],
      annotations: [
        {
          id: "ann-1",
          title: "Inferred from hero",
          body: "Hero copy samples as #0D0D0D",
          inference: "reasonable"
        }
      ],
      evidence_versions: [
        {
          id: "ev-1",
          frame_node_id: "1:2",
          frame_name: "Landing / Hero",
          created_at: "2026-07-20"
        }
      ],
      designer_annotations: [
        {
          id: "da-1",
          body: "Confirmed by designer",
          section: "token",
          evidence_version_id: "ev-1",
          node_id: null,
          created_at: "2026-07-21"
        }
      ],
      unresolved_links: ["missing-card-9"]
    },
    ...partial
  };
}

describe("Design System sheet motion timing", () => {
  test("keeps JS presence timing aligned with the user's motion preference", () => {
    expect(designSystemSheetExitMs(false)).toBe(DESIGN_SYSTEM_SHEET_EXIT_MS);
    expect(designSystemSheetExitMs(true)).toBe(
      DESIGN_SYSTEM_SHEET_REDUCED_MOTION_EXIT_MS
    );
    expect(DESIGN_SYSTEM_SHEET_EXIT_MS).toBe(400);
    expect(DESIGN_SYSTEM_SHEET_REDUCED_MOTION_EXIT_MS).toBe(150);
  });
});

function row(partial: Partial<DsRow> = {}): DsRow {
  const e = entry({});
  return {
    key: `${e.source_artifact_path}::${e.entry_id}`,
    entryId: e.entry_id,
    sourceArtifactPath: e.source_artifact_path,
    name: "text.primary",
    value: "#0D0D0D",
    meaning: "Primary readable text",
    status: "candidate",
    swatch: "#0D0D0D",
    entry: e,
    ...partial
  };
}

function rowSharedProps(overrides: Partial<RowSharedProps> = {}): RowSharedProps {
  return {
    approvals: {},
    infoKey: null,
    popoverInstant: () => false,
    portalContainer: null,
    onInfoKey: vi.fn(),
    onInfoHoverOpen: vi.fn(),
    onInfoHoverClose: vi.fn(),
    onApprove: vi.fn(),
    ...overrides
  };
}

function fixtureView(): DesignSystemView {
  return {
    generated_at: "2026-07-29T00:00:00.000Z",
    name: "Landing Seed",
    foundations: {
      visualLanguage: null,
      principles: [
        entry({
          entry_id: "p1",
          file_kind: "design-system.json",
          section: "foundations.principles",
          name: null,
          value: { statement: "Evidence before inference" },
          meaning: "Rules must trace to seed evidence",
          status: "candidate"
        })
      ]
    },
    tokens: {
      primitive: [
        entry({
          entry_id: "primitive.ink.900",
          section: "token.primitive",
          name: "ink.900",
          value: "#0D0D0D",
          status: "formalized"
        })
      ],
      semantic: [
        entry({
          entry_id: "semantic.text.primary",
          name: "text.primary",
          value: { alias: "primitive.ink.900" },
          alias: "primitive.ink.900",
          status: "candidate"
        })
      ],
      component: []
    },
    layout: [],
    interaction: [],
    components: {
      inventory: [
        entry({
          entry_id: "button",
          file_kind: "component-list.json",
          section: "components.inventory",
          name: "Button",
          value: {
            name: "Button",
            specPath: "design-system/components/button.json"
          },
          status: "candidate"
        })
      ],
      specs: [
        entry({
          entry_id: "button-spec",
          file_kind: "component-spec",
          section: "components.spec",
          name: "Button",
          source_artifact_path: "design-system/components/button.json",
          value: {
            description: "Primary and secondary actions.",
            props: [{ name: "variant", type: "string", required: true }],
            boundaries: ["Never two primary buttons in one group"],
            stateMatrix: [
              { state: "hover", behavior: "Darken fill" },
              { state: "disabled", behavior: "Ink 30%" }
            ]
          },
          status: "formalized"
        })
      ]
    }
  };
}

describe("StatusChip", () => {
  test("gap renders as open gap; others render their name", () => {
    expect(
      renderToStaticMarkup(createElement(StatusChip, { status: "gap" }))
    ).toContain("open gap");
    expect(
      renderToStaticMarkup(createElement(StatusChip, { status: "candidate" }))
    ).toContain('data-status="candidate"');
    expect(
      renderToStaticMarkup(createElement(StatusChip, { status: "formalized" }))
    ).toContain("formalized");
  });
});

describe("DesignSystemEntryButton", () => {
  test("renders the Draft Design System label", () => {
    const html = renderToStaticMarkup(
      createElement(DesignSystemEntryButton, { onOpen: vi.fn() })
    );
    expect(html).toContain("Draft Design System");
    expect(html).toContain('data-testid="open-design-system-browser"');
  });
});

describe("SpecRowView (09A d.6: name/value/meaning/chip only)", () => {
  test("renders the inline fields and keeps evidence behind the ⓘ trigger", () => {
    const html = renderToStaticMarkup(
      createElement(SpecRowView, {
        row: row(),
        approval: { kind: "idle" },
        infoOpen: false,
        popoverInstant: false,
        portalContainer: null,
        onInfoOpenChange: vi.fn(),
        onInfoHoverOpen: vi.fn(),
        onInfoHoverClose: vi.fn(),
        onApprove: vi.fn()
      })
    );
    expect(html).toContain("text.primary");
    expect(html).toContain("#0D0D0D");
    expect(html).toContain("Primary readable text");
    expect(html).toContain('data-status="candidate"');
    expect(html).toContain('aria-label="Evidence for text.primary"');
    // No evidence chain inline — it lives in the popover only.
    expect(html).not.toContain("What is the primary text color?");
  });

  test("approval failure is readable next to the row (no toast-only)", () => {
    const html = renderToStaticMarkup(
      createElement(SpecRowView, {
        row: row(),
        approval: {
          kind: "error",
          reason: "formalized_requires_designer_edited_link",
          message:
            "Needs a designer-edited answered card before it can be formalized."
        },
        infoOpen: false,
        popoverInstant: false,
        portalContainer: null,
        onInfoOpenChange: vi.fn(),
        onInfoHoverOpen: vi.fn(),
        onInfoHoverClose: vi.fn(),
        onApprove: vi.fn()
      })
    );
    expect(html).toContain("Approval failed");
    expect(html).toContain("designer-edited");
  });
});

describe("EvidenceInfoContent (ⓘ layer)", () => {
  test("shows the full evidence chain, including unresolved links", () => {
    const html = renderToStaticMarkup(
      createElement(EvidenceInfoContent, {
        entry: entry({}),
        approval: { kind: "idle" },
        onApprove: vi.fn()
      })
    );
    expect(html).toContain("What is the primary text color?");
    expect(html).toContain("Near-black #0D0D0D");
    expect(html).toContain("designer-edited");
    expect(html).toContain("Inferred from hero");
    expect(html).toContain("Landing / Hero");
    expect(html).toContain("Confirmed by designer");
    expect(html).toContain("missing-card-9");
    // Candidate rows get the approve affordance.
    expect(html).toContain("Approve → formalized");
  });

  test("formalized entries have no approve affordance; empty chain is honest", () => {
    const formalized = renderToStaticMarkup(
      createElement(EvidenceInfoContent, {
        entry: entry({ status: "formalized" }),
        approval: { kind: "idle" },
        onApprove: vi.fn()
      })
    );
    expect(formalized).not.toContain("Approve → formalized");

    const bare = renderToStaticMarkup(
      createElement(EvidenceInfoContent, {
        entry: entry({
          evidence: {
            question_cards: [],
            annotations: [],
            evidence_versions: [],
            designer_annotations: [],
            unresolved_links: []
          }
        }),
        approval: { kind: "idle" },
        onApprove: vi.fn()
      })
    );
    expect(bare).toContain("No linked evidence.");
  });

  test("typed failure renders in place inside the layer", () => {
    const html = renderToStaticMarkup(
      createElement(EvidenceInfoContent, {
        entry: entry({}),
        approval: {
          kind: "error",
          reason: "gap_entry_not_approvable",
          message: "Open gaps must be filled by the agent, not approved."
        },
        onApprove: vi.fn()
      })
    );
    expect(html).toContain("Open gaps must be filled by the agent");
  });

  test("pending approval keeps the tray visible even after the optimistic flip", () => {
    // The entry status is already flipped to formalized by the optimistic
    // update; the tray must still render the disabled pending button.
    const html = renderToStaticMarkup(
      createElement(EvidenceInfoContent, {
        entry: entry({ status: "formalized" }),
        approval: { kind: "pending" },
        onApprove: vi.fn()
      })
    );
    expect(html).toContain("Approving…");
    expect(html).toContain("disabled");
    expect(html).not.toContain("Approve → formalized");
  });
});

describe("FoundationsHomePage", () => {
  test("renders principles as rule cards (09A: principles 规则卡)", () => {
    const model = buildDesignSystemBrowserModel(fixtureView());
    const html = renderToStaticMarkup(
      createElement(FoundationsHomePage, {
        model,
        rows: rowSharedProps()
      })
    );
    expect(html).toContain('data-testid="ds-principle-p1"');
    expect(html).toContain("Evidence before inference");
    expect(html).toContain("Rules must trace to seed evidence");
    expect(html).toContain('data-status="candidate"');
    expect(html).toContain('aria-label="Evidence for principle p1"');
    // Cards, not spec rows.
    expect(html).not.toContain('data-testid="ds-row-p1"');
  });
});

describe("TokenLeafPage", () => {
  test("renders layer groups with their rows", () => {
    const model = buildDesignSystemBrowserModel(fixtureView());
    const color = model.foundations.tokenLeaves.find(
      (leaf) => leaf.id === "color"
    )!;
    const html = renderToStaticMarkup(
      createElement(TokenLeafPage, { leaf: color, rows: rowSharedProps() })
    );
    expect(html).toContain('data-testid="ds-token-layer-primitive"');
    expect(html).toContain('data-testid="ds-token-layer-semantic"');
    expect(html).toContain("Primitive");
    expect(html).toContain("Semantic");
    expect(html).toContain('data-testid="ds-row-primitive.ink.900"');
    expect(html).toContain('data-testid="ds-row-semantic.text.primary"');
    expect(html).toContain("→ primitive.ink.900");
    expect(html).toContain("2 tokens across 2 layers");
  });
});

describe("RulesLeafPage interaction ledger (09C-D01)", () => {
  test("renders a collapsed source-backed strategy ledger without a visual specimen", () => {
    const rule = toRow(
      entry({
        entry_id: "quiet-motion",
        file_kind: "interaction-rules.json",
        section: "interaction",
        name: "Quiet motion",
        value: {
          statement: "Motion stays quiet",
          description: "Motion explains a change without becoming the subject.",
          behavior: [
            "Use short feedback for state changes.",
            "Avoid decorative loops."
          ],
          accessibility: ["Preserve the same information with reduced motion."]
        },
        meaning: "Animation supports comprehension.",
        status: "candidate",
        source_artifact_path: "design-system/interaction-rules.json"
      })
    );

    const html = renderToStaticMarkup(
      createElement(RulesLeafPage, {
        leaf: { rows: [rule], chips: ["1 candidate"] },
        rows: rowSharedProps()
      })
    );

    expect(html).toContain('data-testid="ds-interaction-rule-1"');
    expect(html).toContain("Motion stays quiet");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="ds-interaction-details-quiet-motion"');
    expect(html).not.toContain("Description");
    expect(html).not.toContain("Use short feedback for state changes.");
    expect(html).toContain('data-status="candidate"');
    expect(html).not.toContain('aria-label="Evidence for interaction rule quiet-motion"');
    expect(html).not.toContain("Live specimens");
    expect(html).not.toContain("No visual sample");
  });
});

describe("ComponentDetail", () => {
  test("renders the Boundaries list AND the state matrix table", () => {
    const model = buildDesignSystemBrowserModel(fixtureView());
    const button = model.components.list[0]!;
    const html = renderToStaticMarkup(
      createElement(ComponentDetail, {
        component: button,
        rows: rowSharedProps()
      })
    );
    // Status rows for inventory + spec.
    expect(html).toContain("Inventory");
    expect(html).toContain("Spec");
    // Props table.
    expect(html).toContain("variant");
    // Boundaries.
    expect(html).toContain("Boundaries");
    expect(html).toContain("Never two primary buttons in one group");
    // State matrix.
    expect(html).toContain("State matrix");
    expect(html).toContain("hover");
    expect(html).toContain("Darken fill");
    expect(html).toContain("disabled");
    expect(html).toContain("Ink 30%");
  });
});

/* --------------------------- 09C-A: Reader Projection ---------------------- */

function typographyLayers() {
  return [
    {
      layer: "primitive" as const,
      entries: [
        entry({
          entry_id: "primitive.font-family-sans",
          section: "token.primitive",
          name: "font.family.sans",
          value: "Instrument Sans, system-ui, sans-serif",
          status: "formalized"
        }),
        entry({
          entry_id: "primitive.font-size-400",
          section: "token.primitive",
          name: "font.size.400",
          value: "16px",
          status: "formalized"
        }),
        entry({
          entry_id: "primitive.font-size-700",
          section: "token.primitive",
          name: "font.size.700",
          value: "32px",
          status: "formalized"
        }),
        entry({
          entry_id: "primitive.font-weight-bold",
          section: "token.primitive",
          name: "font.weight.bold",
          value: "700",
          status: "gap"
        })
      ]
    },
    {
      layer: "semantic" as const,
      entries: [
        entry({
          entry_id: "semantic.body",
          name: "body",
          value: { family: "Inter", size: "16px", weight: "400", tracking: "0.01em" },
          status: "candidate"
        }),
        entry({
          entry_id: "semantic.display-large",
          name: "display.large",
          value: {
            fontFamily: { alias: "primitive.font-family-sans" },
            fontSize: "64px",
            fontWeight: "700",
            lineHeight: "1.05"
          },
          status: "formalized"
        })
      ]
    },
    { layer: "component" as const, entries: [] }
  ];
}

describe("TypographyLeafPage (09C-A Type Atlas)", () => {
  test("renders a quiet three-column ledger without evidence or status chrome", () => {
    const html = renderToStaticMarkup(
      createElement(TypographyLeafPage, {
        layers: typographyLayers(),
        rows: rowSharedProps()
      })
    );

    expect(html).toContain('data-testid="ds-typography-ledger"');
    expect(html).toContain("Typeface");
    expect(html).toContain("Used for");
    expect(html).toContain("Show details for display.large");
    expect(html).not.toContain("Source-backed");
    expect(html).not.toContain('data-testid="ds-atlas-status"');
    expect(html).not.toContain('aria-label="Order type atlas"');
  });

  test("keeps the standard heading and orders the ledger from largest to smallest", () => {
    const html = renderToStaticMarkup(
      createElement(TypographyLeafPage, {
        layers: typographyLayers(),
        rows: rowSharedProps()
      })
    );
    expect(html).toContain('<h1 class="dsb-h1">Typography</h1>');
    expect(html).toContain("3 type styles");
    expect(html).toContain('data-testid="ds-typography-ledger"');
    expect(html).toContain('data-testid="ds-typography-summary"');
    expect(html).not.toContain('data-testid="ds-leaf-split"');
    expect(
      html.indexOf('data-testid="ds-atlas-semantic.display-large"')
    ).toBeLessThan(
      html.indexOf('data-testid="ds-atlas-primitive.font-size-700"')
    );
    expect(
      html.indexOf('data-testid="ds-atlas-primitive.font-size-700"')
    ).toBeLessThan(html.indexOf('data-testid="ds-atlas-semantic.body"'));
  });

  test("renders each style name in its declared typeface and hides construction details", () => {
    const html = renderToStaticMarkup(
      createElement(TypographyLeafPage, {
        layers: typographyLayers(),
        rows: rowSharedProps()
      })
    );
    expect(html).toContain('data-testid="ds-atlas-semantic.display-large"');
    expect(html).toContain(">display.large</h2>");
    expect(html).toContain(
      "font-family:&quot;Instrument Sans&quot;, system-ui, sans-serif"
    );
    expect(html).toContain("Primary readable text");
    expect(html).toContain('aria-label="Show details for display.large"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Letter spacing");
    expect(html).not.toContain("Line height");
    expect(html).not.toContain("Source-backed");
    expect(html).not.toContain("Evidence for display.large");
    expect(html).not.toContain('data-testid="ds-atlas-status"');
  });

  test("keeps raw source, status and technical audit content out of the surface", () => {
    const html = renderToStaticMarkup(
      createElement(TypographyLeafPage, {
        layers: typographyLayers(),
        rows: rowSharedProps()
      })
    );
    expect(html).not.toContain("Source tokens");
    expect(html).not.toContain("Source-backed");
    expect(html).not.toContain("formalized");
    expect(html).not.toContain("Tokens · Primitive");
    expect(html).not.toContain('data-testid="ds-row-primitive.font-size-400"');
    expect(html).not.toContain('data-testid="ds-technical-details"');
    expect(html).not.toContain('data-testid="ds-typography-roles"');
  });

  test("empty typography stays honest without inventing specimens", () => {
    const html = renderToStaticMarkup(
      createElement(TypographyLeafPage, {
        layers: [
          { layer: "primitive" as const, entries: [] },
          { layer: "semantic" as const, entries: [] },
          { layer: "component" as const, entries: [] }
        ],
        rows: rowSharedProps()
      })
    );
    expect(html).toContain("No typography tokens classified here yet.");
    expect(html).not.toContain('data-testid="ds-typography-ledger"');
    expect(html).not.toContain('data-testid="ds-atlas-status"');
  });

  test("shows an unresolved state instead of inheriting the Browser font", () => {
    const html = renderToStaticMarkup(
      createElement(TypographyLeafPage, {
        layers: [
          {
            layer: "primitive" as const,
            entries: [
              entry({
                entry_id: "primitive.font-size-400",
                section: "token.primitive",
                name: "font.size.400",
                value: "16px",
                status: "formalized"
              })
            ]
          },
          { layer: "semantic" as const, entries: [] },
          { layer: "component" as const, entries: [] }
        ],
        rows: rowSharedProps()
      })
    );
    expect(html).toContain("Typeface unresolved");
    expect(html).toContain("Primary readable text");
    expect(html).not.toContain("Source-backed");
    expect(html).not.toContain('class="dsb-type-specimen"');
  });

  test("applies terminal values from metric alias chains to the specimen", () => {
    const html = renderToStaticMarkup(
      createElement(TypographyLeafPage, {
        layers: [
          {
            layer: "primitive" as const,
            entries: [
              entry({
                entry_id: "primitive.font-family-sans",
                name: "font.family.sans",
                value: "Instrument Sans, sans-serif"
              }),
              entry({
                entry_id: "primitive.font-size-hero",
                name: "font.size.hero",
                value: "72px"
              }),
              entry({
                entry_id: "primitive.font-weight-hero",
                name: "font.weight.hero",
                value: "600"
              })
            ]
          },
          {
            layer: "semantic" as const,
            entries: [
              entry({
                entry_id: "semantic.font-size-hero",
                name: "font.size.hero",
                value: { alias: "primitive.font-size-hero" },
                alias: "primitive.font-size-hero"
              })
            ]
          },
          {
            layer: "component" as const,
            entries: [
              entry({
                entry_id: "component.hero-title",
                name: "hero.title",
                value: {
                  fontFamily: { alias: "primitive.font-family-sans" },
                  fontSize: { alias: "semantic.font-size-hero" },
                  fontWeight: { alias: "primitive.font-weight-hero" },
                  lineHeight: "1.1"
                }
              })
            ]
          }
        ],
        rows: rowSharedProps()
      })
    );
    expect(html).toContain("--dsb-type-size:64px");
    expect(html).toContain("font-weight:600");
    expect(html).toContain("line-height:1.1");
    expect(html).toContain('aria-label="Show details for hero.title"');
  });
});

describe("SpecRowView object values (09C-A: no raw JSON in the reading layer)", () => {
  test("multi-key objects render as labeled field lines", () => {
    const objectRow = row({
      name: "grid.page",
      value: '{"columns":"12","gutter":{"alias":"spacing.200"}}',
      entry: entry({
        entry_id: "layout.grid.page",
        file_kind: "design-system.json",
        section: "layout",
        name: "grid.page",
        value: { columns: "12", gutter: { alias: "spacing.200" } }
      })
    });
    const html = renderToStaticMarkup(
      createElement(SpecRowView, {
        row: objectRow,
        approval: { kind: "idle" },
        infoOpen: false,
        popoverInstant: false,
        portalContainer: null,
        onInfoOpenChange: vi.fn(),
        onInfoHoverOpen: vi.fn(),
        onInfoHoverClose: vi.fn(),
        onApprove: vi.fn()
      })
    );
    expect(html).toContain("dsb-fields");
    expect(html).toContain("columns");
    expect(html).toContain(">12<");
    expect(html).toContain("→ spacing.200");
    expect(html).not.toContain("{&quot;columns&quot;");
  });

  test("single-key narrative objects keep their flat text display", () => {
    const flatRow = row({
      name: "rule.summary",
      value: "Keep it simple.",
      entry: entry({
        entry_id: "layout.rule.summary",
        file_kind: "design-system.json",
        section: "layout",
        name: "rule.summary",
        value: { description: "Keep it simple." }
      })
    });
    const html = renderToStaticMarkup(
      createElement(SpecRowView, {
        row: flatRow,
        approval: { kind: "idle" },
        infoOpen: false,
        popoverInstant: false,
        portalContainer: null,
        onInfoOpenChange: vi.fn(),
        onInfoHoverOpen: vi.fn(),
        onInfoHoverClose: vi.fn(),
        onApprove: vi.fn()
      })
    );
    expect(html).toContain("Keep it simple.");
    expect(html).not.toContain("dsb-fields");
  });
});

describe("FoundationsHomePage rich principles (09B shapes, 09C-A reading)", () => {
  test("rich statement objects project into labeled fields; legacy stays flat", () => {
    const view = fixtureView();
    view.foundations.principles = [
      entry({
        entry_id: "p-rich",
        file_kind: "design-system.json",
        section: "foundations.principles",
        name: null,
        value: {
          statement: "Design with intent.",
          rationale: "Every choice needs a reason.",
          scope: "All product surfaces",
          use: ["State the reason"],
          avoid: ["Decoration without job"],
          exceptions: ["Marketing one-offs"]
        },
        meaning: "Intent over decoration",
        status: "candidate"
      }),
      entry({
        entry_id: "p-legacy",
        file_kind: "design-system.json",
        section: "foundations.principles",
        name: null,
        value: { statement: "Evidence before inference" },
        meaning: "Rules must trace to seed evidence",
        status: "formalized"
      })
    ];
    const model = buildDesignSystemBrowserModel(view);
    const html = renderToStaticMarkup(
      createElement(FoundationsHomePage, {
        model,
        rows: rowSharedProps()
      })
    );
    // Rich card: statement + labeled rationale/scope/use/avoid/exceptions.
    expect(html).toContain('data-testid="ds-principle-p-rich"');
    expect(html).toContain("Design with intent.");
    expect(html).toContain("Rationale");
    expect(html).toContain("Every choice needs a reason.");
    expect(html).toContain("Scope");
    expect(html).toContain("All product surfaces");
    expect(html).toContain("State the reason");
    expect(html).toContain("Decoration without job");
    expect(html).toContain("Marketing one-offs");
    // Legacy card: flat statement, no rich field labels bleeding out.
    expect(html).toContain('data-testid="ds-principle-p-legacy"');
    expect(html).toContain("Evidence before inference");
  });
});

/* ---------------------- Layout leaf: Blueprint (09C-B) ---------------------- */

function layoutEntry(
  entryId: string,
  name: string,
  value: Record<string, unknown>,
  extra: Partial<DesignSystemEntryView> = {}
): DsRow {
  return toRow(
    entry({
      entry_id: entryId,
      file_kind: "layout-rules.json",
      section: "layout",
      name,
      value,
      links: [],
      ...extra
    })
  );
}

function layoutLeafRows(): DsRow[] {
  return [
    layoutEntry("grid-page", "grid.page", {
      columns: "12",
      gutter: { alias: "spacing.200" },
      maxWidth: "1120px"
    }),
    layoutEntry("shell-regions", "shell.regions", {
      regions: ["header", "hero", "content", "footer"]
    }),
    layoutEntry("section-rhythm", "section.heroToNext", {
      heroToNext: "96 → 56px"
    }),
    layoutEntry(
      "breakpoints",
      "breakpoints",
      { breakpoints: ["640", "768", "1024", "1280"] },
      { status: "formalized" }
    ),
    layoutEntry(
      "nav-mobile",
      "nav.mobile",
      { layout: "—" },
      { status: "gap", meaning: "Mobile navigation layout" }
    )
  ];
}

describe("LayoutLeafPage Blueprint (09C-B)", () => {
  function renderLayoutLeaf() {
    const rows = layoutLeafRows();
    return renderToStaticMarkup(
      createElement(LayoutLeafPage, {
        leaf: {
          rows,
          chips: ["1 formalized", "3 candidate", "1 open gap"]
        },
        rows: rowSharedProps(),
        split: {
          ratio: 0.42,
          onRatioChange: vi.fn(),
          onRatioCommit: vi.fn()
        }
      })
    );
  }

  test("keeps the standard Browser heading and anchored rule rows", () => {
    const html = renderLayoutLeaf();
    expect(html).toContain('class="dsb-h1">Layout</h1>');
    expect(html).toContain("5 rules");
    expect(html).toContain("1 formalized");
    expect(html).toContain("3 candidate");
    expect(html).toContain("1 open gap");
    // Every rule row carries its 1-based anchor number.
    expect(html.match(/dsb-anchor-num/g)!.length).toBeGreaterThanOrEqual(5);
    expect(html).toContain('data-testid="ds-row-grid-page"');
    expect(html).toContain('data-testid="ds-row-nav-mobile"');
    // Object values stay field lines; aliases render through, never raw JSON.
    expect(html).toContain("→ spacing.200");
    expect(html).not.toContain("{&quot;columns&quot;");
  });

  test("draws one schematic blueprint with anchors, origins, and status dots", () => {
    const html = renderLayoutLeaf();
    expect(html).toContain('data-testid="ds-layout-blueprint"');
    expect(html).toContain('data-testid="ds-layout-blueprint-svg"');
    expect(html).toContain('role="img"');
    expect(html).toContain("Schematic layout blueprint");
    // grid.page contributes three facts under one anchor.
    expect(html.match(/data-anchor="1"/g)!.length).toBe(3);
    expect(html).toContain('data-anchor="2"');
    expect(html).toContain('data-anchor="3"');
    expect(html).toContain('data-anchor="4"');
    // Anchor dots carry status into the visual module.
    expect(html).toContain('data-anchor="4" data-status="formalized"');
    // Source values label the measurements.
    expect(html).toContain(">1120px</text>");
    expect(html).toContain("12 columns");
    expect(html).toContain("96 → 56px");
    expect(html).toContain(">1024</text>");
    // The drawing declares its origin; keyboard path exists via focusable dots.
    expect(html).toContain('data-origin="schematic"');
    expect(html).toContain("Schematic");
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("Anchor 1: grid.page");
  });

  test("undrawable rules surface as explicit unavailable samples", () => {
    const html = renderLayoutLeaf();
    expect(html).toContain('data-testid="ds-layout-unavailable-nav-mobile"');
    expect(html).toContain("No visual sample");
    expect(html).toContain('data-origin="unavailable"');
    expect(html).toContain("nav.mobile");
    expect(html).toContain("Mobile navigation layout");
    expect(html).toContain("open gap");
    // The honest unknown is also docked in the drawing as a dashed marker.
    expect(html).toContain('data-anchor="5"');
    expect(html).toContain("nav.mobile ?");
    // The empty-samples fallback is gone once the blueprint exists.
    expect(html).not.toContain('data-testid="ds-samples-empty"');
  });

  test("every rule row carries a checklist control for composition", () => {
    const html = renderLayoutLeaf();
    // One check control per row, all unchecked by default.
    expect(html.match(/dsb-row-check/g)!.length).toBeGreaterThanOrEqual(5);
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-label="Include grid.page in the drawing"');
    expect(html).toContain('aria-label="Include nav.mobile in the drawing"');
    // The whole row is the pointer toggle target.
    expect(html.match(/data-selectable/g)!.length).toBeGreaterThanOrEqual(5);
    // Nothing selected, nothing hovered: the full-leaf caption holds.
    expect(html).toContain("One schematic drawing per rule set");
  });

  test("empty leaf keeps the honest empty states on both panes", () => {    const html = renderToStaticMarkup(
      createElement(LayoutLeafPage, {
        leaf: { rows: [], chips: [] },
        rows: rowSharedProps(),
        split: {
          ratio: 0.42,
          onRatioChange: vi.fn(),
          onRatioCommit: vi.fn()
        }
      })
    );
    expect(html).toContain("No rules declared yet.");
    expect(html).toContain('data-testid="ds-samples-empty"');
  });
});
