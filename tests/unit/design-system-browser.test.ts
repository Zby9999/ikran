import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import {
  ComponentDetail,
  DesignSystemEntryButton,
  EvidenceInfoContent,
  FoundationsHomePage,
  SpecRowView,
  StatusChip,
  TokenLeafPage,
  type RowSharedProps
} from "../../components/workbench/design-system-browser";
import {
  buildDesignSystemBrowserModel,
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
