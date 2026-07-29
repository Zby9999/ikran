import { describe, expect, test } from "vitest";

import type { DesignIntentAlignmentSnapshot } from "@/lib/runtime/design-intent-alignment";
import {
  approvalErrorMessage,
  approvalReducer,
  buildDesignSystemBrowserModel,
  canOpenDesignSystemBrowser,
  classifyToken,
  detectSwatch,
  formatEntryValue,
  sheetReducer,
  sheetEscapeAction,
  shouldIsolateKeydown,
  statusChips,
  withEntryStatus,
  type DesignSystemEntryView,
  type DesignSystemView
} from "@/components/workbench/design-system-view-model";

function entry(
  partial: Partial<DesignSystemEntryView>
): DesignSystemEntryView {
  return {
    id: "row-uuid",
    entry_id: "e1",
    file_kind: "token.json",
    section: "token.semantic",
    name: "surface.page",
    value: "#FFFFFF",
    alias: null,
    meaning: "Default page background",
    status: "formalized",
    links: [],
    source_artifact_path: "design-system/token.json",
    evidence: {
      question_cards: [],
      annotations: [],
      evidence_versions: [],
      designer_annotations: [],
      unresolved_links: []
    },
    ...partial
  };
}

function emptyView(): DesignSystemView {
  return {
    generated_at: "2026-07-29T00:00:00.000Z",
    name: "",
    foundations: { visualLanguage: null, principles: [] },
    tokens: { primitive: [], semantic: [], component: [] },
    layout: [],
    interaction: [],
    components: { inventory: [], specs: [] }
  };
}

function fixtureView(): DesignSystemView {
  return {
    ...emptyView(),
    name: "Landing Seed",
    foundations: {
      visualLanguage: entry({
        entry_id: "vl",
        file_kind: "design-system.json",
        section: "foundations.visual-language",
        name: null,
        value: { description: "Quiet, editorial surfaces." }
      }),
      principles: [
        entry({
          entry_id: "p1",
          file_kind: "design-system.json",
          section: "foundations.principles",
          name: null,
          value: { statement: "Evidence before inference" },
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
          value: "#0D0D0D"
        }),
        entry({
          entry_id: "primitive.font.body",
          section: "token.primitive",
          name: "font.body",
          value: "16/1.6",
          status: "candidate"
        })
      ],
      semantic: [
        entry({
          entry_id: "semantic.text.primary",
          name: "text.primary",
          value: { alias: "primitive.ink.900" },
          alias: "primitive.ink.900"
        }),
        entry({
          entry_id: "semantic.radius.card",
          name: "radius.card",
          value: "10px",
          status: "candidate"
        })
      ],
      component: []
    },
    layout: [
      entry({
        entry_id: "rule-1",
        file_kind: "layout-rules.json",
        section: "layout",
        name: null,
        value: { columns: 12 },
        status: "gap"
      })
    ],
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
            stateMatrix: [{ state: "hover", behavior: "Darken fill" }]
          }
        })
      ]
    }
  };
}

describe("canOpenDesignSystemBrowser (entry button timing, 09A d.9)", () => {
  test("visible only once the six-part alignment is completed", () => {
    const completed = {
      alignment: { status: "completed", completed_at: "2026-07-29" }
    } as unknown as DesignIntentAlignmentSnapshot;
    const draft = {
      alignment: { status: "draft", completed_at: null }
    } as unknown as DesignIntentAlignmentSnapshot;
    expect(canOpenDesignSystemBrowser(completed)).toBe(true);
    expect(canOpenDesignSystemBrowser(draft)).toBe(false);
    expect(canOpenDesignSystemBrowser(null)).toBe(false);
  });
});

describe("row value mapping", () => {
  test("swatch detection accepts css colors only", () => {
    expect(detectSwatch("#0D0D0D")).toBe("#0D0D0D");
    expect(detectSwatch("#fff")).toBe("#fff");
    expect(detectSwatch("rgb(0, 0, 0)")).toBe("rgb(0, 0, 0)");
    expect(detectSwatch("oklch(0.5 0.1 30)")).toBe("oklch(0.5 0.1 30)");
    expect(detectSwatch("16/1.6")).toBeNull();
    expect(detectSwatch("12")).toBeNull();
  });

  test("alias refs render as → layer.name; narrative objects project text", () => {
    expect(
      formatEntryValue(
        entry({ value: { alias: "primitive.ink.900" }, alias: "primitive.ink.900" })
      )
    ).toBe("→ primitive.ink.900");
    expect(formatEntryValue(entry({ value: "10px" }))).toBe("10px");
    expect(formatEntryValue(entry({ value: 12 }))).toBe("12");
    expect(
      formatEntryValue(entry({ value: { statement: "Evidence first" } }))
    ).toBe("Evidence first");
    expect(
      formatEntryValue(entry({ value: { columns: 12, gap: 24 } }))
    ).toBe('{"columns":12,"gap":24}');
  });

  test("token classification: color > typography > materials (catch-all)", () => {
    expect(classifyToken("text.primary")).toBe("color");
    expect(classifyToken("ink.900")).toBe("color");
    expect(classifyToken("action.primaryBg")).toBe("color");
    expect(classifyToken("font.body")).toBe("typography");
    expect(classifyToken("lineHeight.tight")).toBe("typography");
    expect(classifyToken("radius.card")).toBe("materials");
    expect(classifyToken("shadow.raised")).toBe("materials");
  });

  test("status chips count non-zero buckets", () => {
    expect(
      statusChips([
        { status: "formalized" },
        { status: "formalized" },
        { status: "candidate" },
        { status: "gap" }
      ])
    ).toEqual(["2 formalized", "1 candidate", "1 open gap"]);
    expect(statusChips([{ status: "gap" }, { status: "gap" }])).toEqual([
      "2 open gaps"
    ]);
    expect(statusChips([])).toEqual([]);
  });
});

describe("buildDesignSystemBrowserModel", () => {
  test("empty view → honest empty state", () => {
    const model = buildDesignSystemBrowserModel(emptyView());
    expect(model.empty).toBe(true);
    expect(model.components.list).toEqual([]);
    expect(
      model.foundations.tokenLeaves.every((leaf) => leaf.groups.length === 0)
    ).toBe(true);
  });

  test("maps foundations home, token leaves, and component pairing", () => {
    const model = buildDesignSystemBrowserModel(fixtureView());
    expect(model.empty).toBe(false);
    expect(model.name).toBe("Landing Seed");

    // Foundations Home: principles + visual language narrative.
    expect(model.foundations.visualLanguage?.description).toBe(
      "Quiet, editorial surfaces."
    );
    expect(model.foundations.principles.map((row) => row.value)).toEqual([
      "Evidence before inference"
    ]);

    // Token leaves: classification + layer grouping.
    const [color, typography, materials] = model.foundations.tokenLeaves;
    expect(color.groups.map((group) => group.layer)).toEqual([
      "primitive",
      "semantic"
    ]);
    expect(color.groups[0]!.rows.map((row) => row.name)).toEqual(["ink.900"]);
    expect(color.groups[1]!.rows[0]).toMatchObject({
      name: "text.primary",
      value: "→ primitive.ink.900",
      swatch: null
    });
    expect(color.groups[0]!.rows[0]!.swatch).toBe("#0D0D0D");
    expect(typography.groups.flatMap((g) => g.rows.map((r) => r.name))).toEqual(
      ["font.body"]
    );
    expect(materials.groups.flatMap((g) => g.rows.map((r) => r.name))).toEqual(
      ["radius.card"]
    );

    // Layout leaf rows.
    expect(model.foundations.layout.rows).toHaveLength(1);
    expect(model.foundations.layout.rows[0]!.status).toBe("gap");

    // Components: inventory paired with its spec via specPath.
    expect(model.components.list).toHaveLength(1);
    const button = model.components.list[0]!;
    expect(button.leafId).toBe("component:button");
    expect(button.spec?.entry_id).toBe("button-spec");
    expect(button.detail?.props).toEqual([
      { name: "variant", type: "string", required: true }
    ]);
    expect(button.detail?.boundaries).toEqual([
      "Never two primary buttons in one group"
    ]);
    expect(button.detail?.stateMatrix).toEqual([
      { state: "hover", behavior: "Darken fill" }
    ]);
    expect(button.chips).toEqual(["1 formalized", "1 candidate"]);
  });

  test("spec without inventory still surfaces as a leaf", () => {
    const view = fixtureView();
    view.components.inventory = [];
    const model = buildDesignSystemBrowserModel(view);
    expect(model.components.list).toHaveLength(1);
    expect(model.components.list[0]!.leafId).toBe("component:button-spec");
    expect(model.components.list[0]!.inventory).toBeNull();
  });
});

describe("withEntryStatus (optimistic approval flip)", () => {
  test("flips the targeted entry and leaves others untouched", () => {
    const view = fixtureView();
    const flipped = withEntryStatus(
      view,
      "design-system/token.json",
      "semantic.radius.card",
      "formalized"
    );
    expect(
      flipped.tokens.semantic.find((e) => e.entry_id === "semantic.radius.card")
        ?.status
    ).toBe("formalized");
    expect(
      flipped.tokens.semantic.find((e) => e.entry_id === "semantic.text.primary")
        ?.status
    ).toBe("formalized");
    expect(
      flipped.components.inventory.find((e) => e.entry_id === "button")?.status
    ).toBe("candidate");
    // Original view is not mutated.
    expect(
      view.tokens.semantic.find((e) => e.entry_id === "semantic.radius.card")
        ?.status
    ).toBe("candidate");
  });
});

describe("sheet state machine", () => {
  test("open, then close via scrim / escape / button", () => {
    const closed = { open: false };
    const open = sheetReducer(closed, { type: "open" });
    expect(open).toEqual({ open: true });
    expect(sheetReducer(open, { type: "open" })).toEqual({ open: true });
    for (const source of ["scrim", "escape", "button"] as const) {
      expect(sheetReducer(open, { type: "close", source })).toEqual({
        open: false
      });
    }
    expect(sheetReducer(closed, { type: "close", source: "escape" })).toEqual(
      closed
    );
  });

  test("Esc isolation: only inside an open sheet", () => {
    expect(shouldIsolateKeydown(true, true)).toBe(true);
    expect(shouldIsolateKeydown(true, false)).toBe(false);
    expect(shouldIsolateKeydown(false, true)).toBe(false);
  });

  test("Esc layering: ⓘ popover first, then sheet, swallowed in exit window", () => {
    // An open ⓘ popover consumes Esc before the sheet ever sees it.
    expect(sheetEscapeAction(true, true)).toBe("close-info");
    // No popover: Esc closes the sheet itself.
    expect(sheetEscapeAction(false, true)).toBe("close-sheet");
    // Exit window (mounted, no longer shown): Esc never closes the sheet
    // again, but it can still close an open ⓘ layer.
    expect(sheetEscapeAction(false, false)).toBe("swallow");
    expect(sheetEscapeAction(true, false)).toBe("close-info");
  });
});

describe("approval UI states", () => {
  test("idle → pending → idle (success) / error (failure)", () => {
    const pending = approvalReducer({ kind: "idle" }, { type: "start" });
    expect(pending).toEqual({ kind: "pending" });
    expect(approvalReducer(pending, { type: "start" })).toEqual(pending);
    expect(approvalReducer(pending, { type: "succeeded" })).toEqual({
      kind: "idle"
    });
    const failed = approvalReducer(pending, {
      type: "failed",
      reason: "already_formalized"
    });
    expect(failed).toMatchObject({ kind: "error", reason: "already_formalized" });
  });

  test("typed failure reasons read next to the row", () => {
    expect(
      approvalErrorMessage("formalized_requires_designer_edited_link")
    ).toContain("designer-edited");
    expect(approvalErrorMessage("gap_entry_not_approvable")).toContain(
      "filled by the agent"
    );
    expect(approvalErrorMessage("already_formalized")).toContain(
      "Already formalized"
    );
    expect(approvalErrorMessage("not_found")).toContain("no longer exists");
    expect(
      approvalErrorMessage("some_other_reason", { links: ["card-1"] })
    ).toBe("some_other_reason (links: card-1)");
  });
});
