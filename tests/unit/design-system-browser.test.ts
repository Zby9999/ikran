import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import {
  ColorLeafPage,
  ComponentDetail,
  DESIGN_SYSTEM_SHEET_EXIT_MS,
  DESIGN_SYSTEM_SHEET_REDUCED_MOTION_EXIT_MS,
  DesignSystemEntryButton,
  EntryStatusChip,
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
  buildColorLeafModel,
  buildDesignSystemBrowserModel,
  toRow,
  type DesignSystemEntryView,
  type DesignSystemView,
  type DsComponentModel,
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

describe("Design System extraction read-only state", () => {
  test("renders status as information instead of an approval action", () => {
    const markup = renderToStaticMarkup(
      createElement(EntryStatusChip, {
        row: row(),
        approval: { kind: "idle" }
      })
    );
    expect(markup).toContain('data-testid="ds-status-chip"');
    expect(markup).toContain("Candidate");
    expect(markup).not.toContain("<button");
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
          value: "Evidence before inference.",
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
        }),
        entry({
          entry_id: "semantic.rule.open-gap.image-accent-evidence",
          section: "token.semantic",
          name: "rule.open-gap.image-accent-evidence",
          kind: "domain-rule",
          domain: "color",
          meaning: "Image-led accent colors need broader evidence.",
          value:
            "Only one project image demonstrates the range. Next: inspect two more project pages before declaring reusable accent roles.",
          status: "gap",
          links: []
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
            variants: [{ axis: "style", name: "primary" }],
            stateMatrix: [
              { state: "hover", behavior: "Darken fill" },
              { state: "disabled", behavior: "Ink 30%" }
            ],
            guidelines: [],
            tokenLinks: [],
            codeLinks: []
          },
          status: "formalized"
        })
      ]
    }
  };
}

describe("StatusChip", () => {
  test("renders title-case labels; data-status stays lowercase", () => {
    expect(
      renderToStaticMarkup(createElement(StatusChip, { status: "gap" }))
    ).toContain("Open gap");
    expect(
      renderToStaticMarkup(createElement(StatusChip, { status: "candidate" }))
    ).toContain(">Candidate</span>");
    expect(
      renderToStaticMarkup(createElement(StatusChip, { status: "candidate" }))
    ).toContain('data-status="candidate"');
    expect(
      renderToStaticMarkup(createElement(StatusChip, { status: "formalized" }))
    ).toContain(">Formalized</span>");
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
    expect(html).toContain('<button');
    expect(html).toContain('aria-label="Switch text.primary to Formalized"');
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
          message: "Couldn't update. Try again."
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
    expect(html).toContain("Couldn&#x27;t update. Try again.");
    expect(html).not.toContain("designer-edited");
  });

  test("pending direct approval keeps the status control in place", () => {
    const html = renderToStaticMarkup(
      createElement(SpecRowView, {
        row: row({ status: "formalized", entry: entry({ status: "formalized" }) }),
        approval: { kind: "pending" },
        infoOpen: false,
        popoverInstant: false,
        portalContainer: null,
        onInfoOpenChange: vi.fn(),
        onInfoHoverOpen: vi.fn(),
        onInfoHoverClose: vi.fn(),
        onApprove: vi.fn()
      })
    );
    expect(html).toContain(">Updating…</button>");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("disabled");
  });

  test("formalized status is also a direct switch back to candidate", () => {
    const html = renderToStaticMarkup(
      createElement(SpecRowView, {
        row: row({ status: "formalized", entry: entry({ status: "formalized" }) }),
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
    expect(html).toContain('data-status="formalized"');
    expect(html).toContain('aria-label="Switch text.primary to Candidate"');
    expect(html).toContain(">Formalized</button>");
  });
});

describe("EvidenceInfoContent (ⓘ layer)", () => {
  test("shows direct designer edit history as provenance", () => {
    const html = renderToStaticMarkup(
      createElement(EvidenceInfoContent, {
        entry: entry({
          evidence: {
            question_cards: [],
            annotations: [],
            evidence_versions: [],
            designer_annotations: [],
            edit_history: [
              {
                id: "edit-1",
                field: "meaning",
                before: "Quiet transitions",
                after: "Calm transitions",
                created_at: "2026-08-03T00:00:00.000Z"
              }
            ],
            unresolved_links: []
          }
        })
      })
    );
    expect(html).toContain("Designer edits");
    expect(html).toContain("Quiet transitions");
    expect(html).toContain("Calm transitions");
  });

  test("shows the full evidence chain, including unresolved links", () => {
    const html = renderToStaticMarkup(
      createElement(EvidenceInfoContent, {
        entry: entry({})
      })
    );
    expect(html).toContain("What is the primary text color?");
    expect(html).toContain("Near-black #0D0D0D");
    expect(html).toContain("designer-edited");
    expect(html).toContain("Inferred from hero");
    expect(html).toContain("Landing / Hero");
    expect(html).toContain("Confirmed by designer");
    expect(html).toContain("missing-card-9");
    expect(html).not.toContain("Approve → formalized");
  });

  test("formalized entries have no approve affordance; empty chain is honest", () => {
    const formalized = renderToStaticMarkup(
      createElement(EvidenceInfoContent, {
        entry: entry({ status: "formalized" })
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
        })
      })
    );
    expect(bare).toContain("No linked evidence.");
  });

  test("approval failures stay out of the evidence layer", () => {
    const html = renderToStaticMarkup(
      createElement(EvidenceInfoContent, {
        entry: entry({})
      })
    );
    expect(html).not.toContain("Open gaps must be filled by the agent");
  });

  test("pending approval stays out of the evidence layer", () => {
    const html = renderToStaticMarkup(
      createElement(EvidenceInfoContent, {
        entry: entry({ status: "formalized" })
      })
    );
    expect(html).not.toContain("Approving…");
    expect(html).not.toContain("Approve → formalized");
  });
});

describe("FoundationsHomePage", () => {
  test("renders principles as ledger rules (shared Rules presentation)", () => {
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
    expect(html).toContain("dsb-interaction-ledger");
    // Ledger items, not spec rows.
    expect(html).not.toContain('data-testid="ds-row-p1"');
  });

  test("offers one inline edit-mode control for global principles", () => {
    const model = buildDesignSystemBrowserModel(fixtureView());
    const html = renderToStaticMarkup(
      createElement(FoundationsHomePage, {
        model,
        rows: rowSharedProps({ onEditEntry: vi.fn() })
      })
    );
    expect(html).toContain('data-testid="ds-rule-edit-p1"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).not.toContain('data-testid="ds-rule-save-p1"');
    expect(html).not.toContain('aria-label="Rule title"');
    expect(html).not.toContain('aria-label="Rule body"');
  });
});

describe("TokenLeafPage", () => {
  test("renders Rules above Tokens and omits either empty zone", () => {
    const view = fixtureView();
    view.tokens.semantic.push(
      entry({
        entry_id: "semantic.no-shadow-regions",
        name: "no-shadow-regions",
        kind: "domain-rule",
        domain: "shadow",
        value: "Do not use shadows to separate regions; hierarchy comes from spacing.",
        meaning: "Keep material treatment flat.",
        status: "candidate"
      }),
      entry({
        entry_id: "semantic.radius.card",
        name: "radius.card",
        kind: "token",
        domain: "radius",
        value: "12px",
        meaning: "Standard card radius",
        status: "formalized"
      })
    );
    const model = buildDesignSystemBrowserModel(view);
    const materials = model.foundations.tokenLeaves.find(
      (leaf) => leaf.id === "materials"
    )!;
    const html = renderToStaticMarkup(
      createElement(TokenLeafPage, {
        leaf: materials,
        rows: rowSharedProps()
      })
    );

    const rulesAt = html.indexOf('data-testid="ds-rules-zone"');
    const tokensAt = html.indexOf('data-testid="ds-tokens-zone"');
    expect(rulesAt).toBeGreaterThan(-1);
    expect(tokensAt).toBeGreaterThan(rulesAt);
    expect(html).toContain('data-testid="ds-domain-rule-1"');
    expect(html).toContain("Do not use shadows to separate regions; hierarchy comes from spacing.");
    expect(html).toContain('data-testid="ds-row-semantic.radius.card"');
    expect(html).not.toContain("No tokens classified here yet");

    const rulesOnly = renderToStaticMarkup(
      createElement(TokenLeafPage, {
        leaf: { ...materials, groups: [] },
        rows: rowSharedProps()
      })
    );
    expect(rulesOnly).toContain('data-testid="ds-rules-zone"');
    expect(rulesOnly).not.toContain('data-testid="ds-tokens-zone"');
    expect(rulesOnly).not.toContain("No tokens classified here yet");

    const tokensOnly = renderToStaticMarkup(
      createElement(TokenLeafPage, {
        leaf: { ...materials, rules: [] },
        rows: rowSharedProps()
      })
    );
    expect(tokensOnly).not.toContain('data-testid="ds-rules-zone"');
    expect(tokensOnly).toContain('data-testid="ds-tokens-zone"');

    const empty = renderToStaticMarkup(
      createElement(TokenLeafPage, {
        leaf: { ...materials, rules: [], groups: [], chips: [] },
        rows: rowSharedProps()
      })
    );
    expect(empty).toContain("No tokens classified here yet");
  });

  test("renders layer groups with their rows", () => {
    const leaf = {
      id: "materials" as const,
      name: "Materials",
      rules: [],
      groups: [
        {
          layer: "primitive" as const,
          rows: [
            toRow(
              entry({
                entry_id: "primitive.radius.sm",
                section: "token.primitive",
                name: "radius.sm",
                value: "6px",
                meaning: "Small radius"
              })
            )
          ]
        },
        {
          layer: "semantic" as const,
          rows: [
            toRow(
              entry({
                entry_id: "semantic.radius.card",
                name: "radius.card",
                value: "10px",
                meaning: "Card radius"
              })
            )
          ]
        }
      ],
      chips: []
    };
    const html = renderToStaticMarkup(
      createElement(TokenLeafPage, { leaf, rows: rowSharedProps() })
    );
    expect(html).toContain('data-testid="ds-token-layer-primitive"');
    expect(html).toContain('data-testid="ds-token-layer-semantic"');
    expect(html).toContain("Primitive");
    expect(html).toContain("Semantic");
    expect(html).toContain('data-testid="ds-row-primitive.radius.sm"');
    expect(html).toContain('data-testid="ds-row-semantic.radius.card"');
    expect(html).not.toContain("2 tokens across 2 layers");
  });

  test("color leaf: primitive layer collapses into swatch provenance", () => {
    const html = renderToStaticMarkup(
      createElement(ColorLeafPage, {
        model: buildColorLeafModel(fixtureView()),
        rows: rowSharedProps()
      })
    );
    // No layer sections, no primitive row, no alias text — the consumed
    // primitive survives only as the swatch tooltip's provenance.
    expect(html).not.toContain("ds-token-layer-");
    expect(html).not.toContain('data-testid="ds-row-primitive.ink.900"');
    expect(html).not.toContain("→ primitive.ink.900");
    expect(html).toContain('data-testid="ds-color-group-semantic"');
    expect(html).toContain('data-testid="ds-row-semantic.text.primary"');
    expect(html).toContain('data-testid="ds-color-swatch-text.primary"');
    expect(html).toContain("ink.900 · #0D0D0D");
    // Unconsumed primitives are not gaps and never produce a problem strip.
    expect(html).not.toContain("ds-color-unconsumed");
    expect(html).toContain('data-testid="ds-rules-zone"');
    expect(html).toContain("Image-led accent colors need broader evidence.");
    expect(html).toContain(
      "Only one project image demonstrates the range. Next: inspect two more project pages before declaring reusable accent roles."
    );
    expect(html).toContain(">Open gap<");
  });

  test("color leaf has no separate Open Color Gaps region", () => {
    const view = fixtureView();
    const html = renderToStaticMarkup(
      createElement(ColorLeafPage, {
        model: buildColorLeafModel(view),
        rows: rowSharedProps()
      })
    );
    expect(html).not.toContain("ds-color-open-gaps");
    expect(html).not.toContain("Open Color Gaps");
  });
});

describe("RulesLeafPage interaction ledger (09C-D01)", () => {
  test("renders a directly editable strategy ledger without a visual specimen", () => {
    const rule = toRow(
      entry({
        entry_id: "quiet-motion",
        file_kind: "interaction-rules.json",
        section: "interaction",
        name: "Quiet motion",
        value: "Motion explains change without becoming the subject. Use short feedback for state changes, avoid decorative loops, and preserve the same information with reduced motion.",
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
    expect(html).toContain("Animation supports comprehension.");
    expect(html).toContain("Motion explains change without becoming the subject.");
    expect(html).not.toContain('aria-controls="ds-interaction-details-quiet-motion"');
    expect(html).not.toContain("dsb-interaction-ledger-chevron");
    expect(html).not.toContain("Description");
    expect(html).toContain("Use short feedback for state changes, avoid decorative loops");
    expect(html).toContain("Animation supports comprehension.");
    expect(html).toContain('data-status="candidate"');
    expect(html).toContain('aria-label="Evidence for interaction rule quiet-motion"');
    expect(html).not.toContain("Live specimens");
    expect(html).not.toContain("No visual sample");
  });
});

describe("ComponentDetail (09C-D03 Placard)", () => {
  function richComponentModel(): DsComponentModel {
    const view = fixtureView();
    const spec = view.components.specs[0]!;
    spec.value = {
      ...(spec.value as Record<string, unknown>),
      props: [
        {
          name: "variant",
          type: "string",
          required: true,
          status: "candidate"
        },
        { name: "size", type: "string" }
      ],
      stateMatrix: [
        { state: "default", behavior: "静态呈现。" },
        {
          state: "hover",
          behavior: "指针悬停。",
          transition: "100ms ease-out",
          reducedMotion: "立即切换颜色。"
        }
      ],
      variants: [
        { axis: "style", name: "default", gap: "20px" },
        { axis: "size", name: "small", height: "32px" }
      ],
      guidelines: [
        {
          kind: "do",
          text: "每组只使用一个主操作。",
          rationale: "保持视觉层级清晰。"
        },
        { kind: "dont", text: "不得出现填充背景。" }
      ],
      tokenLinks: ["semantic.color.ink", "semantic.motion.fast"],
      codeLinks: ["components/Button.tsx"]
    };
    return buildDesignSystemBrowserModel(view).components.list[0]!;
  }

  function renderDetail(
    component: DsComponentModel,
    rows: RowSharedProps = rowSharedProps()
  ) {
    return renderToStaticMarkup(
      createElement(ComponentDetail, {
        component,
        rows,
        session: "test-session"
      })
    );
  }

  test("renders the four designer sections and full technical details", () => {
    const html = renderDetail(richComponentModel());
    // Hero before the title — the component detail special case (09C-D03).
    const heroAt = html.indexOf('data-testid="ds-component-hero"');
    const titleAt = html.indexOf('data-testid="ds-component-title"');
    expect(heroAt).toBeGreaterThan(-1);
    expect(titleAt).toBeGreaterThan(heroAt);
    expect(html).toContain(">Button</h1>");
    // The placard title carries one status chip (worst of inventory/spec).
    expect(html).toContain('data-testid="ds-component-status"');
    // The four designer-facing sections use the consolidated contract.
    expect(html).toContain(">Overview</h2>");
    expect(html).toContain("Primary and secondary actions.");
    expect(html).toContain('data-testid="ds-component-variants"');
    expect(html).toContain(">Variants</h2>");
    expect(html).toContain('data-testid="ds-component-properties"');
    expect(html).toContain(">Properties</h2>");
    expect(html.indexOf('data-testid="ds-component-properties"')).toBeGreaterThan(
      html.indexOf('data-testid="ds-component-variants"')
    );
    expect(html).toContain("style");
    expect(html).toContain("small");
    expect(html).toContain("32px");
    expect(html).toContain(">States</h2>");
    expect(html).toContain(">Reduced motion</th>");
    expect(html).not.toContain(">AXIS</th>");
    expect(html).toContain("100ms ease-out");
    expect(html).toContain("立即切换颜色。");
    expect(html).toContain(">Do / Don’ts</h2>");
    expect(html).toContain('aria-label="Do"');
    expect(html).toContain('aria-label="Don’t"');
    expect(html).toContain("每组只使用一个主操作。");
    expect(html).toContain(">Rationale</th>");
    expect(html).toContain("保持视觉层级清晰。");
    expect(html).toContain("不得出现填充背景。");
    expect(html.indexOf('aria-label="Do"')).toBeLessThan(
      html.indexOf('aria-label="Don’t"')
    );
    // Props: candidate entries carry a chip.
    expect(html).toContain('data-testid="ds-component-prop-variant"');
    expect(html).toContain('data-testid="ds-component-prop-status-variant"');
    expect(html).not.toContain('data-testid="ds-component-prop-status-size"');
    // Technical details are visible, complete, and not collapsed or summarized.
    expect(html).toContain(">Technical details</h2>");
    expect(html).toContain("Token links");
    expect(html).toContain("semantic.color.ink");
    expect(html).toContain("semantic.motion.fast");
    expect(html).toContain("Code links");
    expect(html).toContain("components/Button.tsx");
    expect(html).toContain("Status &amp; evidence");
    expect(html).not.toContain("<details");
    expect(html).not.toContain("Anatomy");
    expect(html).not.toContain("Open gaps");
    expect(html).not.toContain(">Motion<");
    expect(html).not.toContain(">Sizes<");
  });

  test("empty optional content is omitted while declared states stay", () => {
    const model = buildDesignSystemBrowserModel(fixtureView());
    const html = renderDetail(model.components.list[0]!);
    expect(html).toContain(">States</h2>");
    expect(html).toContain("hover");
    expect(html).toContain("Darken fill");
    expect(html).not.toContain("Do / Don’ts");
    expect(html).not.toContain("Token links");
    expect(html).toContain(">Technical details</h2>");
  });

  test("the states row is a read-only name line inside the hero", () => {
    const html = renderDetail(richComponentModel());
    const states = html.match(
      /<div class="dsb-hero-states"[^>]*>([\s\S]*?)<\/div>/
    );
    expect(states).not.toBeNull();
    expect(states![1]).toContain("default");
    expect(states![1]).toContain("hover");
    // Read-only: names are text, not buttons — no hover switching this slice.
    expect(states![1]).not.toContain("<button");
  });

  test("no capture renders the explicit unavailable hero with guidance", () => {
    const html = renderDetail(richComponentModel());
    expect(html).toContain('data-testid="ds-component-unavailable"');
    expect(html).toContain('data-origin="unavailable"');
    expect(html).toContain("No source capture");
    // Says what is missing and what to ask for — never a blank box.
    expect(html).toContain("ask the agent to implement this component");
  });

  test("a source capture renders the image with its origin tag and provenance", () => {
    const view = fixtureView();
    view.components.specs[0] = {
      ...view.components.specs[0]!,
      captures: [
        {
          nodeId: "1:99",
          nodeName: "Button / Primary",
          artifactPath: "design-system/captures/button.png",
          capturedAt: "2026-08-03T12:00:00.000Z",
          surfaceId: "surf-old",
          stale: true,
          nodeRect: null
        },
        {
          nodeId: "1:100",
          nodeName: "Button / Secondary",
          artifactPath: "design-system/captures/button-secondary.png",
          capturedAt: "2026-08-03T12:05:00.000Z",
          surfaceId: "surf-current",
          stale: false,
          nodeRect: { x: 0, y: 0, width: 160, height: 40 }
        }
      ]
    };
    const model = buildDesignSystemBrowserModel(view);
    const html = renderDetail(model.components.list[0]!);
    expect(html).toContain(
      "/api/artifacts/design-system/captures/button.png?session=test-session"
    );
    expect(html).toContain('alt="Source capture of Button / Primary"');
    expect(html).toContain('data-origin="source-capture"');
    expect(html).not.toContain('data-testid="ds-component-unavailable"');
    // Provenance caption — same visual language as the layout placard,
    // including the stale verdict.
    expect(html).toContain('data-testid="ds-component-caption"');
    expect(html).toContain("Button / Primary");
    expect(html).toContain("captured 2026-08-03 12:00");
    expect(html).toContain('data-stale="true"');
    expect(html).toContain("· stale");
    expect(html).toContain("Source captures");
    expect(html).toContain("Button / Secondary");
    expect(html).toContain("design-system/captures/button-secondary.png");
  });

  test("Status & evidence rows keep the inventory/spec approval wiring", () => {
    const html = renderDetail(richComponentModel());
    expect(html).toContain("Status &amp; evidence");
    expect(html).toContain("Inventory");
    expect(html).toContain("Spec");
    expect(html).toContain('aria-label="Evidence for Inventory"');
    expect(html).toContain('aria-label="Evidence for Spec"');
  });

  test("no spec keeps the honest fallback", () => {
    const view = fixtureView();
    view.components.inventory = [view.components.inventory[0]!];
    view.components.inventory[0] = {
      ...view.components.inventory[0]!,
      value: { name: "Button" }
    };
    view.components.specs = [];
    const model = buildDesignSystemBrowserModel(view);
    const html = renderDetail(model.components.list[0]!);
    expect(html).toContain("No spec ingested for this component yet.");
    expect(html).not.toContain("State matrix");
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
          value: {
            family: "Inter",
            size: "16px",
            weight: "400",
            tracking: "0.01em",
            usedFor: "Primary readable text"
          },
          status: "candidate"
        }),
        entry({
          entry_id: "semantic.display-large",
          name: "display.large",
          value: {
            fontFamily: { alias: "primitive.font-family-sans" },
            fontSize: "64px",
            fontWeight: "700",
            lineHeight: "1.05",
            usedFor: "Primary readable text"
          },
          status: "formalized"
        })
      ]
    },
    { layer: "component" as const, entries: [] }
  ];
}

describe("TypographyLeafPage (09C-A Type Atlas)", () => {
  test("renders typography Rules above the atlas Tokens zone", () => {
    const rule = toRow(
      entry({
        entry_id: "semantic.negative-title-tracking",
        name: "negative-title-tracking",
        kind: "domain-rule",
        domain: "typography",
        value: "Display and heading roles use negative tracking.",
        meaning: "Keep large type visually cohesive."
      })
    );
    const html = renderToStaticMarkup(
      createElement(TypographyLeafPage, {
        layers: typographyLayers(),
        rules: [rule],
        rows: rowSharedProps()
      })
    );
    const rulesAt = html.indexOf('data-testid="ds-rules-zone"');
    const tokensAt = html.indexOf('data-testid="ds-tokens-zone"');
    expect(rulesAt).toBeGreaterThan(-1);
    expect(tokensAt).toBeGreaterThan(rulesAt);
    expect(html).toContain("Display and heading roles use negative tracking.");
  });

  test("groups readable specimens into Type and Component sections", () => {
    const html = renderToStaticMarkup(
      createElement(TypographyLeafPage, {
        layers: [
          { layer: "primitive" as const, entries: [] },
          {
            layer: "semantic" as const,
            entries: [
              entry({
                entry_id: "semantic.typography.statisticalDisplay",
                section: "token.semantic",
                name: "typography.statisticalDisplay",
                value: { fontFamily: "Instrument Sans", fontSize: "105px" }
              })
            ]
          },
          {
            layer: "component" as const,
            entries: [
              entry({
                entry_id: "component.navigation.label",
                section: "token.component",
                name: "navigation.label",
                value: { fontFamily: "Instrument Sans", fontSize: "20px" }
              })
            ]
          }
        ],
        rows: rowSharedProps()
      })
    );

    expect(html).not.toContain("2 type styles");
    expect(html).toContain('data-testid="ds-typography-group-type"');
    expect(html).toContain('data-testid="ds-typography-group-component"');
    expect(html).toContain("Type · 1");
    expect(html).toContain("Component · 1");
    expect(html).toContain(">Statistical Display</h3>");
    expect(html).toContain(">Navigation Label</h3>");
    expect(html).toContain("--dsb-type-size:105px");
  });

  test("renders a quiet three-column ledger without evidence or status chrome", () => {
    const html = renderToStaticMarkup(
      createElement(TypographyLeafPage, {
        layers: typographyLayers(),
        rows: rowSharedProps()
      })
    );

    expect(html).toContain('data-testid="ds-typography-ledger"');
    expect(html).toContain("Type · 2");
    expect(html).toContain("Used for");
    expect(html).toContain("Show details for Display Large");
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
    expect(html).toContain('data-testid="ds-typography-ledger"');
    expect(html).not.toContain('data-testid="ds-typography-summary"');
    expect(html).not.toContain('data-testid="ds-leaf-split"');
    expect(html).not.toContain('data-testid="ds-atlas-primitive.font-size-700"');
    expect(
      html.indexOf('data-testid="ds-atlas-semantic.display-large"')
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
    expect(html).toContain(">Display Large</h3>");
    expect(html).toContain(
      "font-family:&quot;Instrument Sans&quot;, system-ui, sans-serif"
    );
    expect(html).toContain("Primary readable text");
    expect(html).toContain('aria-label="Show details for Display Large"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Letter spacing");
    expect(html).not.toContain("Line height");
    expect(html).not.toContain("Source-backed");
    expect(html).not.toContain("Evidence for display.large");
    expect(html).not.toContain('data-testid="ds-atlas-status"');
  });

  test("shows governance status on atlas rows while keeping raw source and technical audit content out", () => {
    const html = renderToStaticMarkup(
      createElement(TypographyLeafPage, {
        layers: typographyLayers(),
        rows: rowSharedProps()
      })
    );
    expect(html).not.toContain("Source tokens");
    expect(html).not.toContain("Source-backed");
    // Governance chrome (candidate/formalized) is now on this surface;
    // the fixtures are fully formalized.
    expect(html).toContain('data-testid="ds-typography-status"');
    expect(html).toContain("Formalized");
    expect(html).not.toContain("Tokens · Primitive");
    expect(html).not.toContain('data-testid="ds-row-primitive.font-size-400"');
    expect(html).not.toContain('data-testid="ds-technical-details"');
    expect(html).not.toContain('data-testid="ds-typography-roles"');
  });

  test("atlas status chip batch-approves every contributing source row", () => {
    const onApproveRows = vi.fn();
    const html = renderToStaticMarkup(
      createElement(TypographyLeafPage, {
        layers: typographyLayers(),
        rows: rowSharedProps({ onApproveRows })
      })
    );
    // Fully-formalized style: the chip offers the revert-to-candidate switch.
    expect(html).toContain('aria-label="Switch Display Large to Candidate"');
  });

  test("atlas status falls back to a static chip when approvals are unavailable", () => {
    const html = renderToStaticMarkup(
      createElement(TypographyLeafPage, {
        layers: typographyLayers(),
        rows: rowSharedProps({ onApprove: undefined, onApproveRows: undefined })
      })
    );
    expect(html).toContain('data-testid="ds-typography-status"');
    expect(html).not.toContain('aria-label="Switch Display Large to Candidate"');
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
    expect(html).toContain("No composite typography roles classified here yet.");
    expect(html).not.toContain('data-testid="ds-typography-ledger"');
    expect(html).not.toContain('data-testid="ds-atlas-status"');
  });

  test("atomic-only typography names the missing composite roles", () => {
    const html = renderToStaticMarkup(
      createElement(TypographyLeafPage, {
        layers: [
          {
            layer: "primitive" as const,
            entries: [
              entry({
                entry_id: "primitive.font-size-400",
                section: "token.primitive",
                name: "fontSize.400",
                value: "4rem",
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
    expect(html).toContain("No composite typography roles classified here yet.");
    expect(html).not.toContain("fontSize.400");
  });

  test("shows an unresolved state for a composite role without a typeface", () => {
    const html = renderToStaticMarkup(
      createElement(TypographyLeafPage, {
        layers: [
          {
            layer: "primitive" as const,
            entries: [
              entry({
                entry_id: "semantic.caption",
                section: "token.semantic",
                name: "caption",
                value: {
                  fontSize: "16px",
                  usedFor: "Primary readable text"
                },
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
    expect(html).toContain("--dsb-type-size:72px");
    expect(html).toContain("font-weight:600");
    expect(html).toContain("line-height:1.1");
    expect(html).toContain('aria-label="Show details for Hero Title"');
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
  test("principles project meaning as title and prose value as body", () => {
    const view = fixtureView();
    view.foundations.principles = [
      entry({
        entry_id: "p-rich",
        file_kind: "design-system.json",
        section: "foundations.principles",
        name: null,
        value: "Design with intent. Every choice needs an evidence-backed reason.",
        meaning: "Intent over decoration",
        status: "candidate"
      }),
      entry({
        entry_id: "p-legacy",
        file_kind: "design-system.json",
        section: "foundations.principles",
        name: null,
        value: "Evidence before inference.",
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
    expect(html).toContain('data-testid="ds-principle-p-rich"');
    expect(html).toContain("Intent over decoration");
    expect(html).toContain("Design with intent.");
    expect(html).toContain("Every choice needs an evidence-backed reason.");
    expect(html).toContain('data-testid="ds-principle-p-legacy"');
    expect(html).toContain("Evidence before inference");
  });
});

/* ------------------- Layout leaf: Source Capture (09C-D02) ------------------- */

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
    layoutEntry(
      "grid-page",
      "grid.page",
      {
        columns: "12",
        gutter: { alias: "spacing.200" },
        maxWidth: "1120px"
      },
      {
        meaning: "Page grid: 12 columns",
        captures: [
          {
            nodeId: "11:20",
            nodeName: "Landing / Grid",
            artifactPath: "design-system/captures/grid-page.png",
            capturedAt: "2026-07-30T14:05:22Z",
            surfaceId: "surf-grid",
            stale: false,
            nodeRect: { x: 0.1, y: 0.2, width: 0.6, height: 0.4 }
          },
          {
            nodeId: "11:21",
            nodeName: "Landing / Grid Detail",
            artifactPath: "design-system/captures/grid-page-detail.png",
            capturedAt: "2026-07-30T14:06:01Z",
            surfaceId: null,
            stale: false,
            nodeRect: null
          }
        ]
      }
    ),
    layoutEntry(
      "shell-regions",
      "shell.regions",
      {
        regions: ["header", "hero", "content", "footer"]
      },
      {
        meaning: "Shell stacks four regions",
        captures: [
          {
            nodeId: "11:30",
            nodeName: "Landing / Shell",
            artifactPath: "design-system/captures/shell.png",
            capturedAt: "2026-07-28T09:12:00Z",
            surfaceId: "surf-shell",
            stale: true,
            nodeRect: null
          }
        ]
      }
    ),
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

describe("LayoutLeafPage Source Capture (09C-D02)", () => {
  function renderLayoutLeaf(rows: DsRow[] = layoutLeafRows()) {
    return renderToStaticMarkup(
      createElement(LayoutLeafPage, {
        leaf: {
          rows,
          chips: ["1 formalized", "3 candidate", "1 open gap"]
        },
        rows: rowSharedProps(),
        session: "test-session"
      })
    );
  }

  test("keeps the standard Browser heading and renders one placard per rule", () => {
    const html = renderLayoutLeaf();
    expect(html).toContain('class="dsb-h1">Layout</h1>');
    expect(html).not.toContain('class="dsb-intro"');
    expect(html).toContain('data-testid="ds-layout-placards"');
    expect(html).toContain('data-testid="ds-layout-placard-grid-page"');
    expect(html).toContain('data-testid="ds-layout-placard-shell-regions"');
    expect(html).toContain('data-testid="ds-layout-placard-section-rhythm"');
    expect(html).toContain('data-testid="ds-layout-placard-breakpoints"');
    expect(html).toContain('data-testid="ds-layout-placard-nav-mobile"');
    // Every placard keeps the status chip + ⓘ evidence wiring of a row.
    expect(html).toContain('data-testid="ds-layout-status-grid-page"');
    expect(html).toContain('aria-label="Evidence for layout rule grid-page"');
    // The headline is the rule's human-readable claim.
    expect(html).toContain("Page grid: 12 columns");
    expect(html).toContain("Mobile navigation layout");
  });

  test("rules with captures render the capture image and provenance caption", () => {
    const html = renderLayoutLeaf();
    // The capture image is served via /api/artifacts with the session.
    expect(html).toContain(
      "/api/artifacts/design-system/captures/grid-page.png?session=test-session"
    );
    expect(html).toContain('alt="Source capture of Landing / Grid"');
    // Provenance caption: origin tag, node name, formatted capture time.
    expect(html).toContain('data-origin="source-capture"');
    expect(html).toContain("Source capture");
    expect(html).toContain("Landing / Grid");
    expect(html).toContain("captured 2026-07-30 14:05");
    // Main reading is title + readable body; no derived spatial-facts row.
    expect(html).not.toContain('class="dsb-placard-facts"');
    expect(html).toContain('class="dsb-rule-prose"');
    expect(html).toContain("1120px");
    expect(html).toContain("alias: spacing.200");
    expect(html).not.toContain("{&quot;");
    expect(html).not.toContain("{&quot;columns&quot;");
    // v2: the figure is a fixed-ratio locator view, orientation from nodeRect.
    expect(html).toContain('data-testid="ds-layout-figure-grid-page"');
    expect(html).toContain('data-orientation="landscape"');
    // nodeRect below the fill threshold renders a hairline mark over the node.
    expect(html).toContain('class="dsb-placard-mark"');
    expect(html).toContain("left:10%");
    expect(html).toContain("top:20%");
    expect(html).toContain("width:60%");
    expect(html).toContain("height:40%");
    // The full-frame lightbox and its trigger are retired.
    expect(html).not.toContain("View in frame");
    expect(html).not.toContain("dsb-lightbox");
  });

  test("a capture without nodeRect renders no mark", () => {
    const html = renderLayoutLeaf();
    // shell-regions' capture has nodeRect null — the figure renders but no
    // mark is drawn (nothing honest to locate).
    expect(html).toContain('data-testid="ds-layout-figure-shell-regions"');
    expect(html).not.toContain("left:0%");
  });

  test("a rule with several captures renders a thumbnail strip", () => {
    const html = renderLayoutLeaf();
    expect(html.match(/class="dsb-placard-thumb"/g)!.length).toBe(2);
    expect(html).toContain('aria-label="Show Landing / Grid"');
    expect(html).toContain('aria-label="Show Landing / Grid Detail"');
    expect(html).toContain('aria-pressed="true"');
    // Single-capture rules get no strip.
    expect(html).not.toContain('aria-label="Show Landing / Shell"');
  });

  test("a stale capture is marked in the caption", () => {
    const html = renderLayoutLeaf();
    expect(html).toContain("Landing / Shell");
    expect(html).toContain("captured 2026-07-28 09:12");
    expect(html).toContain('data-stale="true"');
    expect(html).toContain("· stale");
  });

  test("rules without captures render an honest unavailable block", () => {
    const html = renderLayoutLeaf();
    expect(html).toContain('data-testid="ds-layout-unavailable-nav-mobile"');
    expect(html).toContain("No source capture");
    expect(html).toContain(
      "This rule has no linked Figma node — nothing to show honestly."
    );
    expect(html).toContain('data-origin="unavailable"');
    // section-rhythm and breakpoints have no captures either.
    expect(html).toContain('data-testid="ds-layout-unavailable-section-rhythm"');
    expect(html).toContain('data-testid="ds-layout-unavailable-breakpoints"');
    // Facts still show under the unavailable block.
    expect(html).toContain("96 → 56px");
  });

  test("empty leaf keeps the honest empty state", () => {
    const html = renderLayoutLeaf([]);
    expect(html).toContain("No rules declared yet.");
    expect(html).not.toContain('data-testid="ds-layout-placards"');
  });
});
