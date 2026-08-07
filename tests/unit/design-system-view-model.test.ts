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
  syncWarningAppliesToRoute,
  withEntryStatus,
  type DesignSystemEntryView,
  type DesignSystemView,
  type DsLeafId,
  type DsRoute,
  type DsSectionId
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
    meaning: "",
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
          status: "gap"
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
            variants: [{ axis: "style", name: "primary" }],
            stateMatrix: [{ state: "hover", behavior: "Darken fill" }],
            guidelines: [
              {
                kind: "dont",
                text: "Never place two primary buttons in one group"
              }
            ],
            tokenLinks: ["semantic.action.primary"],
            codeLinks: ["components/Button.tsx"]
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
    expect(button.detail?.guidelines).toEqual([
      {
        kind: "dont",
        text: "Never place two primary buttons in one group"
      }
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
        entry_id: "primitive.gray.legacy-gap",
        section: "token.primitive",
        name: "gray.legacy-gap",
        kind: "token",
        domain: "color",
        value: "#AAAAAA",
        meaning: "",
        status: "gap"
      }),
      entry({
        entry_id: "primitive.font.body",
        section: "token.primitive",
        name: "font.body",
        kind: "token",
        domain: "typography",
        value: "16/1.6",
        meaning: ""
      })
    ];
    view.tokens.semantic = [
      entry({
        entry_id: "semantic.ink.primary",
        name: "ink.primary",
        kind: "token",
        domain: "color",
        value: {
          alias: "primitive.gray.800",
          usage: "主要文字与标题。"
        },
        alias: "primitive.gray.800",
        meaning: ""
      }),
      entry({
        entry_id: "semantic.accent.solid",
        name: "accent.solid",
        kind: "token",
        domain: "color",
        value: "#3A93FF",
        meaning: ""
      }),
      entry({
        entry_id: "semantic.divider.subtle",
        name: "divider.subtle",
        kind: "token",
        domain: "color",
        value: { usage: "面板边界。" },
        meaning: "",
        status: "gap"
      }),
      entry({
        entry_id: "semantic.legacy-gap-alias",
        name: "legacy-gap-alias",
        kind: "token",
        domain: "color",
        value: { alias: "primitive.gray.legacy-gap", usage: "Legacy row." },
        alias: "primitive.gray.legacy-gap",
        meaning: ""
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
        value: {
          alias: "semantic.ink.primary",
          usage: "Agent Annotation 标注色。"
        },
        alias: "semantic.ink.primary",
        meaning: ""
      }),
      entry({
        entry_id: "component.bridge.link",
        name: "bridge.link",
        kind: "token",
        domain: "color",
        value: {
          alias: "primitive.missing.999",
          usage: "Bridge 连接指示。"
        },
        alias: "primitive.missing.999",
        meaning: ""
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

  test("only resolved colors render; token gaps, aliases through gaps, and dangling aliases stay hidden", () => {
    const model = buildColorLeafModel(colorView());
    expect(model.semantic[1]).toMatchObject({
      name: "accent.solid",
      hex: "#3A93FF",
      source: null
    });
    expect(model.semantic.map((token) => token.name)).not.toContain(
      "divider.subtle"
    );
    expect(model.semantic.map((token) => token.name)).not.toContain(
      "legacy-gap-alias"
    );
    expect(model.component.map((token) => token.name)).not.toContain("bridge.link");
  });

  test("domain rules split out; rows keep the full DsRow for evidence/approval", () => {
    const model = buildColorLeafModel(colorView());
    expect(model.rules.map((row) => row.entryId)).toEqual([
      "semantic.color.no-warm"
    ]);
    expect(model.semantic[0]!.row.entryId).toBe("semantic.ink.primary");
    expect(model.component).toHaveLength(1);
  });

  test("projects unresolved color decisions into Rules as gap rows", () => {
    const model = buildColorLeafModel(fixtureView());
    expect(model.rules).toEqual([
      expect.objectContaining({
        status: "gap",
        meaning: "Image-led accent colors need broader evidence."
      })
    ]);
  });

  test("empty view → empty groups and rules", () => {
    const model = buildColorLeafModel(emptyView());
    expect(model.rules).toEqual([]);
    expect(model.semantic).toEqual([]);
    expect(model.component).toEqual([]);
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

  test("approval failures surface typed guidance; unknown reasons stay generic", () => {
    expect(approvalErrorMessage("source_db_drift")).toBe(
      "Source file changed outside this view. Reload and try again."
    );
    expect(approvalErrorMessage("concurrent_source_changed")).toBe(
      "Changed while you worked. Reload and try again."
    );
    expect(approvalErrorMessage("concurrent_edit_superseded")).toBe(
      "Changed while you worked. Reload and try again."
    );
    expect(approvalErrorMessage("already_formalized")).toBe(
      "Already up to date. Reload to refresh."
    );
    expect(approvalErrorMessage("already_candidate")).toBe(
      "Already up to date. Reload to refresh."
    );
    expect(approvalErrorMessage("gap_entry_not_approvable")).toBe(
      "Gaps can't be switched — the agent fills them first."
    );
    expect(approvalErrorMessage("not_found")).toBe(
      "Entry no longer exists. Reload to refresh."
    );
    expect(approvalErrorMessage("entry_not_in_source_file")).toBe(
      "Entry no longer exists. Reload to refresh."
    );
    for (const reason of [
      "formalized_requires_designer_edited_link",
      "db_error",
      "write_failed",
      "some_other_reason"
    ]) {
      expect(approvalErrorMessage(reason)).toBe("Couldn't update. Try again.");
    }
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
      variants: [{ axis: "style", name: "primary" }],
      stateMatrix: [{ state: "hover", behavior: "Darken fill" }],
      guidelines: [
        {
          kind: "dont",
          text: "Never place two primary buttons in one group"
        }
      ],
      tokenLinks: ["semantic.action.primary"],
      codeLinks: ["components/Button.tsx"],
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
        variants: [],
        stateMatrix: [],
        guidelines: [],
        tokenLinks: [],
        codeLinks: [],
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
        nodeRect: null,
        origin: "source" as const,
        codeLinks: null,
        codeDigest: null,
        harnessPath: null,
        previewUrl: null,
        surfaceReadiness: null,
        surfaceStale: false
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

describe("consolidated component detail projection", () => {
  test("projects every designer-facing field once without summarizing", () => {
    const view = fixtureView();
    view.components.specs[0] = richSpecEntry({
      variants: [
        { axis: "style", name: "primary", tone: "ink" },
        { axis: "size", name: "small", height: "32px" },
        { axis: "viewport", name: "narrow", behavior: "full width" }
      ],
      stateMatrix: [
        {
          state: "hover",
          behavior: "Darken fill",
          transition: "100ms ease-out",
          reducedMotion: "Change color immediately"
        }
      ],
      guidelines: [
        {
          kind: "do",
          text: "Use one primary action per group.",
          rationale: "Keeps the visual hierarchy unambiguous."
        },
        { kind: "dont", text: "Do not use a filled background." }
      ],
      tokenLinks: ["semantic.color.ink", { alias: "primitive.space.4" }],
      codeLinks: ["components/Button.tsx"]
    });
    const detail = buildDesignSystemBrowserModel(view).components.list[0]!
      .detail!;

    expect(detail.variants).toEqual([
      { axis: "style", name: "primary", tone: "ink" },
      { axis: "size", name: "small", height: "32px" },
      { axis: "viewport", name: "narrow", behavior: "full width" }
    ]);
    expect(detail.stateMatrix).toEqual([
      {
        state: "hover",
        behavior: "Darken fill",
        transition: "100ms ease-out",
        reducedMotion: "Change color immediately"
      }
    ]);
    expect(detail.guidelines).toEqual([
      {
        kind: "do",
        text: "Use one primary action per group.",
        rationale: "Keeps the visual hierarchy unambiguous."
      },
      { kind: "dont", text: "Do not use a filled background." }
    ]);
    expect(detail.referenceGroups).toEqual([
      {
        id: "token-links",
        label: "Token links",
        lines: ["semantic.color.ink"],
        rows: [{ alias: "primitive.space.4" }]
      },
      {
        id: "code-links",
        label: "Code links",
        lines: ["components/Button.tsx"],
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

    // No declared states → no hero state names.
    const bare = fixtureView();
    bare.components.specs[0] = richSpecEntry({ stateMatrix: [] });
    expect(
      buildDesignSystemBrowserModel(bare).components.list[0]!.detail!.stateNames
    ).toEqual([]);
  });

  test("props preserve every declared column", () => {
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
    expect(props[1]).toEqual({ name: "size", type: "string", status: "weird" });
    expect(props[2]).toEqual({ name: "label", type: "string" });
  });

  test("empty technical collections remain empty without synthesized content", () => {
    const view = fixtureView();
    view.components.specs[0] = richSpecEntry({
      tokenLinks: [],
      codeLinks: []
    });
    const detail = buildDesignSystemBrowserModel(view).components.list[0]!
      .detail!;
    expect(detail.referenceGroups).toEqual([]);
  });
});

describe("syncWarningAppliesToRoute (per-page warning mounting)", () => {
  const model = buildDesignSystemBrowserModel(fixtureView());
  const foundationsHome: DsRoute = { kind: "section", section: "foundations" };
  const componentsHome: DsRoute = { kind: "section", section: "components" };
  const leaf = (id: DsLeafId, section: DsSectionId = "foundations"): DsRoute => ({
    kind: "leaf",
    section,
    leaf: id
  });

  test("design-system.json flags only Foundations Home", () => {
    const path = "design-system/design-system.json";
    expect(syncWarningAppliesToRoute(path, foundationsHome, model)).toBe(true);
    expect(syncWarningAppliesToRoute(path, leaf("color"), model)).toBe(false);
    expect(syncWarningAppliesToRoute(path, componentsHome, model)).toBe(false);
  });

  test("token.json flags the three token leaves only", () => {
    const path = "design-system/token.json";
    expect(syncWarningAppliesToRoute(path, leaf("color"), model)).toBe(true);
    expect(syncWarningAppliesToRoute(path, leaf("typography"), model)).toBe(true);
    expect(syncWarningAppliesToRoute(path, leaf("materials"), model)).toBe(true);
    expect(syncWarningAppliesToRoute(path, leaf("layout"), model)).toBe(false);
    expect(syncWarningAppliesToRoute(path, foundationsHome, model)).toBe(false);
  });

  test("root-relative spelling is accepted too", () => {
    expect(syncWarningAppliesToRoute("token.json", leaf("color"), model)).toBe(true);
  });

  test("layout and interaction rule files flag their own leaves", () => {
    expect(
      syncWarningAppliesToRoute("design-system/layout-rules.json", leaf("layout"), model)
    ).toBe(true);
    expect(
      syncWarningAppliesToRoute("design-system/layout-rules.json", leaf("interaction"), model)
    ).toBe(false);
    expect(
      syncWarningAppliesToRoute(
        "design-system/interaction-rules.json",
        leaf("interaction"),
        model
      )
    ).toBe(true);
  });

  test("component-list.json flags the whole components section", () => {
    const path = "design-system/component-list.json";
    expect(syncWarningAppliesToRoute(path, componentsHome, model)).toBe(true);
    expect(
      syncWarningAppliesToRoute(path, leaf("component:button", "components"), model)
    ).toBe(true);
    expect(syncWarningAppliesToRoute(path, foundationsHome, model)).toBe(false);
  });

  test("a component spec flags its own page and the landing that renders it", () => {
    // Two components: button (inventory-anchored, landing) + a spec-only card.
    const view = fixtureView();
    view.components.specs.push(
      entry({
        entry_id: "card-spec",
        file_kind: "component-spec",
        section: "components.spec",
        name: "Card",
        source_artifact_path: "design-system/components/card.json",
        value: { description: "Card surfaces." }
      })
    );
    const two = buildDesignSystemBrowserModel(view);
    expect(two.components.landingLeaf).toBe("component:button");

    const buttonSpec = "design-system/components/button.json";
    const cardSpec = "design-system/components/card.json";
    expect(
      syncWarningAppliesToRoute(buttonSpec, leaf("component:button", "components"), two)
    ).toBe(true);
    expect(
      syncWarningAppliesToRoute(buttonSpec, leaf("component:card-spec", "components"), two)
    ).toBe(false);
    // The section landing renders the first component's detail, so only the
    // landing component's stale spec shows there.
    expect(syncWarningAppliesToRoute(buttonSpec, componentsHome, two)).toBe(true);
    expect(syncWarningAppliesToRoute(cardSpec, componentsHome, two)).toBe(false);
    expect(
      syncWarningAppliesToRoute(cardSpec, leaf("component:card-spec", "components"), two)
    ).toBe(true);
  });

  test("unknown paths flag nothing", () => {
    expect(
      syncWarningAppliesToRoute("design-system/readme.md", foundationsHome, model)
    ).toBe(false);
  });
});

/* ---------------------- hero live plan (Issue 33) ---------------------- */

import {
  componentHeroLiveKey,
  componentHeroLiveUrl,
  heroLiveFallbackCopy,
  heroLiveVerdictReducer,
  planComponentHero,
  type DesignSystemLayoutCapture,
  type DsHeroLiveVerdict
} from "@/components/workbench/design-system-view-model";

function heroCapture(
  partial: Partial<DesignSystemLayoutCapture> = {}
): DesignSystemLayoutCapture {
  return {
    nodeId: null,
    nodeName: "Button",
    artifactPath: "design-system/captures/button-code.png",
    capturedAt: "2026-08-07T14:00:00.000Z",
    surfaceId: "proto-surface-1",
    stale: false,
    nodeRect: null,
    origin: "code",
    codeLinks: ["components/Button.tsx"],
    codeDigest: "digest-1",
    harnessPath: "/__ikran/component/button",
    previewUrl: "http://127.0.0.1:4401",
    surfaceReadiness: "ready",
    surfaceStale: false,
    ...partial
  };
}

const LIVE_KEY =
  "http%3A%2F%2F127.0.0.1%3A4401|%2F__ikran%2Fcomponent%2Fbutton|design-system%2Fcaptures%2Fbutton-code.png|ready|false";

describe("componentHeroLiveKey (Issue 33)", () => {
  test("identifies target + readiness, URI-encoded per segment", () => {
    expect(componentHeroLiveKey(heroCapture())).toBe(LIVE_KEY);
    // No harness declared → no live attempt.
    expect(componentHeroLiveKey(heroCapture({ harnessPath: null }))).toBeNull();
  });

  test("a readiness / staleness flip forms a new key; unchanged state keeps it", () => {
    const ready = heroCapture();
    const starting = heroCapture({ surfaceReadiness: "starting" });
    const stale = heroCapture({ surfaceStale: true });
    expect(componentHeroLiveKey(starting)).not.toBe(LIVE_KEY);
    expect(componentHeroLiveKey(stale)).not.toBe(LIVE_KEY);
    expect(componentHeroLiveKey(heroCapture())).toBe(
      componentHeroLiveKey(ready)
    );
  });
});

describe("planComponentHero (Issue 33)", () => {
  test("no captures is the explicit unavailable tier", () => {
    expect(planComponentHero([], null)).toEqual({
      kind: "unavailable",
      liveKey: null
    });
  });

  test("harness + live surface renders live — digest staleness does not demote", () => {
    const capture = heroCapture();
    expect(planComponentHero([capture], null)).toEqual({
      kind: "live",
      capture,
      liveKey: LIVE_KEY
    });
    // A digest-stale capture still renders live: live always renders the
    // current code; the stale flag stays on the origin popover.
    const stale = heroCapture({ stale: true });
    expect(planComponentHero([stale], null)).toEqual({
      kind: "live",
      capture: stale,
      liveKey: LIVE_KEY
    });
  });

  test("a code capture without a harness is the plain static tier, no fallback reason", () => {
    const capture = heroCapture({ harnessPath: null });
    expect(planComponentHero([capture], null)).toEqual({
      kind: "static",
      capture,
      liveFallback: null,
      liveKey: null
    });
  });

  test("a surface that is not running falls back with surface_not_ready", () => {
    for (const partial of [
      { surfaceReadiness: "starting" as const },
      { surfaceReadiness: "failed" as const },
      { previewUrl: null, surfaceReadiness: null }
    ]) {
      const capture = heroCapture(partial);
      expect(planComponentHero([capture], null)).toEqual({
        kind: "static",
        capture,
        liveFallback: "surface_not_ready",
        liveKey: componentHeroLiveKey(capture)
      });
    }
  });

  test("a stale surface falls back with surface_stale — the server is running but not serving current code", () => {
    const capture = heroCapture({ surfaceStale: true });
    expect(planComponentHero([capture], null)).toEqual({
      kind: "static",
      capture,
      liveFallback: "surface_stale",
      liveKey: componentHeroLiveKey(capture)
    });
  });

  test("an unreachable iframe falls back with live_unreachable, pinned to its key", () => {
    const capture = heroCapture();
    expect(planComponentHero([capture], LIVE_KEY)).toEqual({
      kind: "static",
      capture,
      liveFallback: "live_unreachable",
      liveKey: LIVE_KEY
    });
    // A verdict pinned to a DIFFERENT key does not demote this attempt.
    expect(planComponentHero([capture], "some-other-key").kind).toBe("live");
  });

  test("the chain: code capture outranks source capture at every static tier", () => {
    const source = heroCapture({
      nodeId: "1:99",
      origin: "source",
      codeLinks: null,
      codeDigest: null,
      harnessPath: null,
      previewUrl: null,
      surfaceReadiness: null,
      artifactPath: "design-system/captures/button.png"
    });
    const code = heroCapture({ harnessPath: null });
    // Declared source-first; the code capture still leads.
    const plan = planComponentHero([source, code], null);
    expect(plan).toEqual({
      kind: "static",
      capture: code,
      liveFallback: null,
      liveKey: null
    });
    // Source only → static source capture.
    expect(planComponentHero([source], null)).toEqual({
      kind: "static",
      capture: source,
      liveFallback: null,
      liveKey: null
    });
  });
});

describe("componentHeroLiveUrl (Issue 33)", () => {
  test("builds the harness URL on the surface origin; state rides ?state=", () => {
    const capture = heroCapture();
    expect(componentHeroLiveUrl(capture, null)).toBe(
      "http://127.0.0.1:4401/__ikran/component/button"
    );
    expect(componentHeroLiveUrl(capture, "hover")).toBe(
      "http://127.0.0.1:4401/__ikran/component/button?state=hover"
    );
    expect(componentHeroLiveUrl(capture, "focus visible")).toBe(
      "http://127.0.0.1:4401/__ikran/component/button?state=focus%20visible"
    );
  });

  test("no preview URL or harness means no live URL", () => {
    expect(
      componentHeroLiveUrl(heroCapture({ previewUrl: null }), "hover")
    ).toBeNull();
    expect(
      componentHeroLiveUrl(heroCapture({ harnessPath: null }), "hover")
    ).toBeNull();
  });
});

describe("heroLiveVerdictReducer (Issue 33)", () => {
  const pending: DsHeroLiveVerdict = { key: LIVE_KEY, phase: "pending" };

  test("pending resolves once, terminally, per key", () => {
    expect(
      heroLiveVerdictReducer(pending, { type: "loaded", key: LIVE_KEY })
    ).toEqual({ key: LIVE_KEY, phase: "live" });
    expect(
      heroLiveVerdictReducer(pending, { type: "timeout", key: LIVE_KEY })
    ).toEqual({ key: LIVE_KEY, phase: "unreachable" });
    // Late events after a verdict are ignored (state switches re-fire load).
    const live = { key: LIVE_KEY, phase: "live" as const };
    expect(
      heroLiveVerdictReducer(live, { type: "timeout", key: LIVE_KEY })
    ).toEqual(live);
    const unreachable = { key: LIVE_KEY, phase: "unreachable" as const };
    expect(
      heroLiveVerdictReducer(unreachable, { type: "loaded", key: LIVE_KEY })
    ).toEqual(unreachable);
  });

  test("events from a superseded attempt never corrupt the current one", () => {
    // The key moved on (readiness flipped); a late timeout from the old
    // iframe must not demote the fresh attempt.
    expect(
      heroLiveVerdictReducer(pending, { type: "timeout", key: "old-key" })
    ).toEqual(pending);
  });

  test("a readiness flip retargets and re-arms the attempt (starting → ready retry)", () => {
    // The surface was starting: the hero fell back with surface_not_ready.
    const startingKey = componentHeroLiveKey(
      heroCapture({ surfaceReadiness: "starting" })
    )!;
    const before: DsHeroLiveVerdict = { key: startingKey, phase: "pending" };
    // Refetch reports ready → new key → retarget re-arms exactly once.
    const rearmed = heroLiveVerdictReducer(before, {
      type: "retarget",
      key: LIVE_KEY
    });
    expect(rearmed).toEqual({ key: LIVE_KEY, phase: "pending" });
    // Retargeting to the SAME key is a no-op — a demoted verdict stays
    // terminal, never loops back into the iframe.
    const demoted: DsHeroLiveVerdict = { key: LIVE_KEY, phase: "unreachable" };
    expect(
      heroLiveVerdictReducer(demoted, { type: "retarget", key: LIVE_KEY })
    ).toEqual(demoted);
  });
});

describe("heroLiveFallbackCopy (Issue 33)", () => {
  test("every reason says what happened and what is shown instead", () => {
    expect(heroLiveFallbackCopy("surface_not_ready")).toContain(
      "prototype surface is not running"
    );
    expect(heroLiveFallbackCopy("surface_stale")).toContain(
      "prototype surface is stale"
    );
    expect(heroLiveFallbackCopy("live_unreachable")).toContain(
      "harness stopped loading"
    );
    // Every caption lands on what is shown instead — never a blank hero.
    for (const reason of [
      "surface_not_ready",
      "surface_stale",
      "live_unreachable"
    ] as const) {
      expect(heroLiveFallbackCopy(reason)).toContain("showing the code render");
    }
  });
});
