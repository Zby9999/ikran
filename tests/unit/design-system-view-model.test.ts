import { describe, expect, test } from "vitest";

import type { DesignIntentAlignmentSnapshot } from "@/lib/runtime/design-intent-alignment";
import {
  approvalErrorMessage,
  approvalReducer,
  buildColorLeafModel,
  buildDesignSystemBrowserModel,
  canOpenDesignSystemBrowser,
  classifyToken,
  detectSwatch,
  formatEntryValue,
  sheetReducer,
  sheetEscapeAction,
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
          value: "Evidence before inference.",
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
      formatEntryValue(entry({ value: { summary: "Evidence first" } }))
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

describe("token leaf classification", () => {
  test("explicit domain wins while legacy tokens retain keyword fallback", () => {
    expect(classifyToken("color.brand", "typography")).toBe("typography");
    expect(classifyToken("font.body", null)).toBe("typography");
    expect(classifyToken("color.brand", null)).toBe("color");
    expect(classifyToken("radius.card", null)).toBe("materials");
  });
});

describe("buildDesignSystemBrowserModel", () => {
  test("09C-D04 splits domain rules from tokens while legacy entries keep their existing leaf classification", () => {
    const view = emptyView();
    view.tokens.primitive = [
      entry({
        entry_id: "primitive.ink.900",
        name: "ink.900",
        kind: "token",
        domain: "color",
        value: "#111111"
      }),
      entry({
        entry_id: "primitive.font.body",
        name: "font.body",
        value: "16px"
      })
    ];
    view.tokens.semantic = [
      entry({
        entry_id: "semantic.color.no-shadow",
        name: "color.no-shadow",
        kind: "domain-rule",
        domain: "shadow",
        value: "Do not use shadows to separate regions.",
        meaning: "Prefer spacing and borders.",
        status: "candidate"
      })
    ];

    const model = buildDesignSystemBrowserModel(view);
    const color = model.foundations.tokenLeaves.find(
      (leaf) => leaf.id === "color"
    )!;
    const typography = model.foundations.tokenLeaves.find(
      (leaf) => leaf.id === "typography"
    )!;
    const materials = model.foundations.tokenLeaves.find(
      (leaf) => leaf.id === "materials"
    )!;

    expect(color.rules).toEqual([]);
    expect(color.groups.flatMap((group) => group.rows).map((row) => row.name)).toEqual([
      "ink.900"
    ]);
    expect(
      typography.groups.flatMap((group) => group.rows).map((row) => row.name)
    ).toEqual(["font.body"]);
    expect(materials.rules).toHaveLength(1);
    expect(materials.rules[0]).toMatchObject({
      entryId: "semantic.color.no-shadow",
      status: "candidate"
    });
    expect(materials.groups).toEqual([]);
    expect(materials.chips).toEqual(["1 candidate"]);
  });

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
      "Evidence before inference."
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

  test("design-system-root-relative specPath still pairs (no duplicate leaf)", () => {
    // Real agents write specPath relative to the design-system root
    // ("components/button.json") while source_artifact_path is
    // project-relative — both are schema-legal and must pair, otherwise the
    // spec surfaces a second time as an unpaired leaf (duplicate React key).
    const view = fixtureView();
    (
      view.components.inventory[0]!.value as { specPath: string }
    ).specPath = "components/button.json";
    const model = buildDesignSystemBrowserModel(view);
    expect(model.components.list).toHaveLength(1);
    expect(model.components.list[0]!.leafId).toBe("component:button");
    expect(model.components.list[0]!.spec?.entry_id).toBe("button-spec");
  });
});

describe("buildColorLeafModel (color page redesign)", () => {
  function colorView(): DesignSystemView {
    const view = emptyView();
    view.tokens.primitive = [
      entry({
        entry_id: "primitive.gray.800",
        section: "token.primitive",
        name: "gray.800",
        kind: "token",
        domain: "color",
        value: "#3D3D3D",
        meaning: ""
      }),
      entry({
        entry_id: "primitive.blue.500",
        section: "token.primitive",
        name: "blue.500",
        kind: "token",
        domain: "color",
        value: "#3A93FF",
        meaning: ""
      }),
      entry({
        entry_id: "primitive.pink.400",
        section: "token.primitive",
        name: "pink.400",
        kind: "token",
        domain: "color",
        value: "#F968AD",
        meaning: ""
      }),
      entry({
        entry_id: "primitive.font.body",
        section: "token.primitive",
        name: "font.body",
        kind: "token",
        domain: "typography",
        value: "16/1.6",
        meaning: "Body text style"
      })
    ];
    view.tokens.semantic = [
      entry({
        entry_id: "semantic.ink.primary",
        name: "ink.primary",
        kind: "token",
        domain: "color",
        value: { alias: "primitive.gray.800" },
        alias: "primitive.gray.800",
        meaning: "主要文字与标题。"
      }),
      entry({
        entry_id: "semantic.accent.solid",
        name: "accent.solid",
        kind: "token",
        domain: "color",
        value: "#3A93FF",
        meaning: "主要行动与选中态。"
      }),
      entry({
        entry_id: "semantic.divider.subtle",
        name: "divider.subtle",
        kind: "token",
        domain: "color",
        value: null,
        meaning: "面板边界。",
        status: "gap"
      }),
      entry({
        entry_id: "semantic.color.no-warm",
        name: "color.no-warm",
        kind: "domain-rule",
        domain: "color",
        value: "Do not use warm neutrals on canvas.",
        meaning: "Canvas stays on the cool gray ramp."
      })
    ];
    view.tokens.component = [
      entry({
        entry_id: "component.annotation.agent",
        name: "annotation.agent",
        kind: "token",
        domain: "color",
        value: { alias: "semantic.ink.primary" },
        alias: "semantic.ink.primary",
        meaning: "Agent Annotation 标注色。"
      }),
      entry({
        entry_id: "component.bridge.link",
        name: "bridge.link",
        kind: "token",
        domain: "color",
        value: { alias: "primitive.missing.999" },
        alias: "primitive.missing.999",
        meaning: "Bridge 连接指示。"
      })
    ];
    return view;
  }

  test("resolves alias chains to a concrete color + terminal source name", () => {
    const model = buildColorLeafModel(colorView());
    expect(model.semantic[0]).toMatchObject({
      name: "ink.primary",
      hex: "#3D3D3D",
      source: "gray.800",
      meaning: "主要文字与标题。"
    });
    // component → semantic → primitive chain ends at the primitive.
    expect(model.component[0]).toMatchObject({
      name: "annotation.agent",
      hex: "#3D3D3D",
      source: "gray.800"
    });
  });

  test("concrete tokens carry their own hex with no source; gaps and dangling aliases are unresolved", () => {
    const model = buildColorLeafModel(colorView());
    expect(model.semantic[1]).toMatchObject({
      name: "accent.solid",
      hex: "#3A93FF",
      source: null
    });
    expect(model.semantic[2]).toMatchObject({
      name: "divider.subtle",
      hex: null,
      source: null,
      status: "gap"
    });
    expect(model.component[1]).toMatchObject({
      name: "bridge.link",
      hex: null,
      source: null
    });
  });

  test("domain rules split out; rows keep the full DsRow for evidence/approval", () => {
    const model = buildColorLeafModel(colorView());
    expect(model.rules.map((row) => row.entryId)).toEqual([
      "semantic.color.no-warm"
    ]);
    expect(model.semantic[0]!.row.entryId).toBe("semantic.ink.primary");
    expect(model.component).toHaveLength(2);
  });

  test("unconsumed = color primitives with no incoming alias, file-wide", () => {
    const model = buildColorLeafModel(colorView());
    // gray.800 consumed by semantic.ink.primary; blue.500 + pink.400 not
    // referenced by any alias. font.body is not a color primitive.
    expect(model.unconsumed).toEqual([
      { name: "blue.500", hex: "#3A93FF", status: "formalized" },
      { name: "pink.400", hex: "#F968AD", status: "formalized" }
    ]);
  });

  test("empty view → empty groups, no unconsumed", () => {
    const model = buildColorLeafModel(emptyView());
    expect(model.rules).toEqual([]);
    expect(model.semantic).toEqual([]);
    expect(model.component).toEqual([]);
    expect(model.unconsumed).toEqual([]);
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


/* ------------------- 09C-D03: component grouping + rich detail ------------------- */

function richSpecEntry(
  value: Record<string, unknown>,
  extra: Partial<DesignSystemEntryView> = {}
): DesignSystemEntryView {
  return entry({
    entry_id: "button-spec",
    file_kind: "component-spec",
    section: "components.spec",
    name: "Button",
    source_artifact_path: "design-system/components/button.json",
    value: {
      description: "Primary and secondary actions.",
      props: [{ name: "variant", type: "string", required: true }],
      boundaries: ["Never two primary buttons in one group"],
      stateMatrix: [{ state: "hover", behavior: "Darken fill" }],
      ...value
    },
    ...extra
  });
}

function blockComponentView(): DesignSystemView {
  const view = fixtureView();
  view.components.inventory.push(
    entry({
      entry_id: "page-shell",
      file_kind: "component-list.json",
      section: "components.inventory",
      name: "Page Shell",
      value: {
        name: "Page Shell",
        specPath: "design-system/components/page-shell.json"
      },
      status: "formalized"
    })
  );
  view.components.specs.push(
    entry({
      entry_id: "page-shell-spec",
      file_kind: "component-spec",
      section: "components.spec",
      name: "Page Shell",
      source_artifact_path: "design-system/components/page-shell.json",
      value: {
        description: "Page structure.",
        props: [],
        boundaries: [],
        stateMatrix: [],
        group: "block"
      },
      status: "formalized"
    })
  );
  return view;
}

describe("component grouping + sidebar projection (09C-D03)", () => {
  test("group defaults to component; the spec declares block via value.group", () => {
    const model = buildDesignSystemBrowserModel(blockComponentView());
    const [button, pageShell] = model.components.list;
    expect(button!.group).toBe("component");
    expect(pageShell!.group).toBe("block");
  });

  test("a non-enum group value defensively falls back to component", () => {
    const view = blockComponentView();
    const spec = view.components.specs.find(
      (s) => s.entry_id === "page-shell-spec"
    )!;
    (spec.value as Record<string, unknown>).group = "section";
    const model = buildDesignSystemBrowserModel(view);
    expect(model.components.list[1]!.group).toBe("component");
  });

  test("spec captures surface on the component model", () => {
    const view = fixtureView();
    const captures = [
      {
        nodeId: "1:99",
        nodeName: "Button / Primary",
        artifactPath: "design-system/captures/button.png",
        capturedAt: "2026-08-03T12:00:00.000Z",
        surfaceId: null,
        stale: false,
        nodeRect: null
      }
    ];
    view.components.specs[0] = { ...view.components.specs[0]!, captures };
    const model = buildDesignSystemBrowserModel(view);
    expect(model.components.list[0]!.captures).toEqual(captures);
    // No captures declared → an empty list, never undefined.
    const bare = buildDesignSystemBrowserModel(fixtureView());
    expect(bare.components.list[0]!.captures).toEqual([]);
  });

  test("component status is the worst of inventory/spec (drives the dot)", () => {
    // fixture: inventory candidate + spec formalized → candidate.
    const model = buildDesignSystemBrowserModel(fixtureView());
    expect(model.components.list[0]!.status).toBe("candidate");

    const allFormalized = buildDesignSystemBrowserModel(blockComponentView());
    expect(allFormalized.components.list[1]!.status).toBe("formalized");

    const gapView = fixtureView();
    gapView.components.inventory[0] = {
      ...gapView.components.inventory[0]!,
      status: "gap"
    };
    expect(
      buildDesignSystemBrowserModel(gapView).components.list[0]!.status
    ).toBe("gap");
  });

  test("sidebar groups order Components before Blocks; empty groups omitted", () => {
    const mixed = buildDesignSystemBrowserModel(blockComponentView());
    expect(mixed.components.groups.map((group) => group.id)).toEqual([
      "component",
      "block"
    ]);
    expect(mixed.components.groups.map((group) => group.name)).toEqual([
      "Components",
      "Blocks"
    ]);
    const [components, blocks] = mixed.components.groups;
    expect(components!.items.map((item) => item.leafId)).toEqual([
      "component:button"
    ]);
    expect(blocks!.items.map((item) => item.leafId)).toEqual([
      "component:page-shell"
    ]);
    // Group header status summary: one vote per component (worst-of status).
    expect(components!.summary).toEqual(["1 candidate"]);
    expect(blocks!.summary).toEqual(["1 formalized"]);

    // No block declared → the Blocks group does not render.
    const plain = buildDesignSystemBrowserModel(fixtureView());
    expect(plain.components.groups.map((group) => group.id)).toEqual([
      "component"
    ]);
    // No components at all → no groups.
    const empty = buildDesignSystemBrowserModel(emptyView());
    expect(empty.components.groups).toEqual([]);
  });

  test("candidate items are flagged for the blue dot", () => {
    const model = buildDesignSystemBrowserModel(blockComponentView());
    const [components, blocks] = model.components.groups;
    expect(components!.items[0]).toMatchObject({
      leafId: "component:button",
      name: "Button",
      status: "candidate",
      candidate: true
    });
    expect(blocks!.items[0]).toMatchObject({
      status: "formalized",
      candidate: false
    });
  });

  test("landing leaf is the first component; null when no components", () => {
    expect(
      buildDesignSystemBrowserModel(blockComponentView()).components.landingLeaf
    ).toBe("component:button");
    expect(
      buildDesignSystemBrowserModel(emptyView()).components.landingLeaf
    ).toBeNull();
  });
});

describe("rich component detail parsing (09C-D03)", () => {
  test("parses string lines and object rows, dropping invalid items", () => {
    const view = fixtureView();
    view.components.specs[0] = richSpecEntry({
      anatomy: ["由标签与图标组成。", 42, { part: "label" }, ""],
      variants: [{ name: "default", gap: "20px" }, "text-only", null],
      tokenLinks: ["semantic.color.ink", { alias: "primitive.space.4" }]
    });
    const model = buildDesignSystemBrowserModel(view);
    const groups = model.components.list[0]!.detail!.groups;
    const byId = new Map(groups.map((group) => [group.id, group]));

    expect(byId.get("anatomy")).toEqual({
      id: "anatomy",
      label: "Anatomy",
      lines: ["由标签与图标组成。"],
      rows: [{ part: "label" }]
    });
    expect(byId.get("variants")).toEqual({
      id: "variants",
      label: "Variants",
      lines: ["text-only"],
      rows: [{ name: "default", gap: "20px" }]
    });
    expect(byId.get("token-links")).toEqual({
      id: "token-links",
      label: "Token links",
      lines: ["semantic.color.ink"],
      rows: [{ alias: "primitive.space.4" }]
    });
  });

  test("empty rich fields are silently omitted from the groups", () => {
    const view = fixtureView();
    view.components.specs[0] = richSpecEntry({
      anatomy: [],
      usageRules: ["One primary action per group."]
    });
    const model = buildDesignSystemBrowserModel(view);
    const groups = model.components.list[0]!.detail!.groups;
    expect(groups.map((group) => group.id)).toEqual(["usage-rules"]);
    // Legacy 09A specs have no rich fields at all.
    const legacy = buildDesignSystemBrowserModel(fixtureView());
    expect(legacy.components.list[0]!.detail!.groups).toEqual([]);
  });

  test("motion renders as its own rich group", () => {
    const view = fixtureView();
    view.components.specs[0] = richSpecEntry({
      motion: ["不自动轮播。"]
    });
    const model = buildDesignSystemBrowserModel(view);
    const groups = model.components.list[0]!.detail!.groups;
    expect(groups).toEqual([
      {
        id: "motion",
        label: "Motion",
        lines: ["不自动轮播。"],
        rows: []
      }
    ]);
  });

  test("hero state names come only from the state matrix", () => {
    const withStates = fixtureView();
    withStates.components.specs[0] = richSpecEntry({
      stateMatrix: [
        { state: "default", behavior: "静态呈现。" },
        { state: "hover", behavior: "指针悬停。" }
      ]
    });
    expect(
      buildDesignSystemBrowserModel(withStates).components.list[0]!.detail!
        .stateNames
    ).toEqual(["default", "hover"]);

    // Neither → no states row at all.
    const bare = fixtureView();
    bare.components.specs[0] = richSpecEntry({ stateMatrix: [] });
    expect(
      buildDesignSystemBrowserModel(bare).components.list[0]!.detail!.stateNames
    ).toEqual([]);
  });

  test("props carry an optional status chip flag", () => {
    const view = fixtureView();
    view.components.specs[0] = richSpecEntry({
      props: [
        { name: "variant", type: "string", status: "candidate" },
        { name: "size", type: "string", status: "weird" },
        { name: "label", type: "string" }
      ]
    });
    const props = buildDesignSystemBrowserModel(view).components.list[0]!
      .detail!.props;
    expect(props[0]).toMatchObject({ name: "variant", status: "candidate" });
    // Unknown status strings are dropped, not rendered.
    expect(props[1]).toEqual({ name: "size", type: "string" });
    expect(props[2]).toEqual({ name: "label", type: "string" });
  });

  test("group order is fixed: token links first, open gaps last", () => {
    const view = fixtureView();
    view.components.specs[0] = richSpecEntry({
      openGaps: ["生产组件映射待定。"],
      codeLinks: ["components/Button.tsx"],
      tokenLinks: ["semantic.color.ink"],
      anatomy: ["Label only."],
      responsiveBehavior: ["Keep one line."],
      contentRules: ["Verb-first labels."],
      usageRules: ["One per group."],
      sizes: [{ name: "sm" }],
      variants: [{ name: "primary" }],
      motion: ["Short feedback only."],
      verificationTargets: ["No filled background."]
    });
    const groups = buildDesignSystemBrowserModel(view).components.list[0]!
      .detail!.groups;
    expect(groups.map((group) => group.id)).toEqual([
      "token-links",
      "anatomy",
      "variants",
      "sizes",
      "motion",
      "usage-rules",
      "content-rules",
      "responsive-behavior",
      "code-links",
      "verification-targets",
      "open-gaps"
    ]);
    expect(groups.map((group) => group.label)).toEqual([
      "Token links",
      "Anatomy",
      "Variants",
      "Sizes",
      "Motion",
      "Usage rules",
      "Content rules",
      "Responsive behavior",
      "Code links",
      "Verification targets",
      "Open gaps"
    ]);
  });
});
