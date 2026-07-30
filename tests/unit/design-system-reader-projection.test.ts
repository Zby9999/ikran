import { describe, expect, it } from "vitest";

import type { DesignSystemEntryView } from "@/lib/runtime/design-system-view";
import {
  cssFontStack,
  formatTextStyleSummary,
  formatValueField,
  projectObjectFields,
  projectInteractionLeaf,
  projectPrinciple,
  projectTypographyLeaf,
  pxOf,
  toTechnicalDetail,
  typeScaleSteps,
  typographyAtlasItems,
  typographyLayersFromView,
  type TypographyProjection
} from "@/components/workbench/design-system-reader-projection";
import { toRow } from "@/components/workbench/design-system-view-model";
import type { DesignSystemView } from "@/components/workbench/design-system-view-model";

function entry(
  partial: Partial<DesignSystemEntryView>
): DesignSystemEntryView {
  return {
    id: `uuid-${partial.entry_id ?? "e"}`,
    entry_id: "e1",
    file_kind: "token.json",
    section: "token.semantic",
    name: null,
    value: "16px",
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

/* ------------------------------ fixture layers ----------------------------- */

const FAMILY_SANS = entry({
  entry_id: "primitive.font-family-sans",
  name: "font.family.sans",
  section: "token.primitive",
  value: "Instrument Sans, system-ui, sans-serif"
});
const SIZE_400 = entry({
  entry_id: "primitive.font-size-400",
  name: "font.size.400",
  section: "token.primitive",
  value: "16px"
});
const WEIGHT_BOLD = entry({
  entry_id: "primitive.font-weight-bold",
  name: "font.weight.bold",
  section: "token.primitive",
  value: "700",
  status: "gap"
});
const DISPLAY_LARGE = entry({
  entry_id: "semantic.display-large",
  name: "display.large",
  value: {
    fontFamily: { alias: "primitive.font-family-sans" },
    fontSize: "64px",
    fontWeight: "700",
    lineHeight: "1.05"
  }
});
const BODY = entry({
  entry_id: "semantic.body",
  name: "body",
  status: "candidate",
  // Tolerant key spellings (family/size/weight/tracking) must read the same.
  value: { family: "Inter", size: "16px", weight: "400", tracking: "0.01em" }
});
const FAMILY_SERIF = entry({
  entry_id: "semantic.font-family-serif",
  name: "font.family.serif",
  value: { fontFamily: "Source Serif 4, serif" }
});

function fixtureLayers() {
  return [
    {
      layer: "primitive" as const,
      entries: [FAMILY_SANS, SIZE_400, WEIGHT_BOLD]
    },
    { layer: "semantic" as const, entries: [DISPLAY_LARGE, BODY, FAMILY_SERIF] },
    { layer: "component" as const, entries: [] }
  ];
}

const ALL_ENTRIES = [
  FAMILY_SANS,
  SIZE_400,
  WEIGHT_BOLD,
  DISPLAY_LARGE,
  BODY,
  FAMILY_SERIF
];

describe("Interaction Reader Projection (09C-B)", () => {
  it("projects a source-backed live specimen without adding undeclared states", () => {
    const source = entry({
      entry_id: "primary-button",
      file_kind: "interaction-rules.json",
      section: "interaction",
      name: "Primary button",
      value: {
        appliesTo: ["Buttons", "Icon buttons"],
        stateBehavior: [
          { state: "default", behavior: "Filled ink surface" },
          { state: "hover", behavior: "Surface darkens 4%" },
          { state: "disabled", behavior: "35% opacity, no pointer" }
        ],
        motion: [
          {
            duration: "160ms",
            easing: "ease-out",
            target: "background-color"
          }
        ],
        layoutInvariants: ["Press never shifts layout"],
        accessibility: ["Space + Enter activate"],
        acceptanceChecks: ["Disabled is skipped"]
      },
      meaning: "Commit actions across the workbench",
      status: "candidate",
      source_artifact_path: "design-system/interaction-rules.json"
    });

    expect(projectInteractionLeaf([toRow(source)])).toEqual([
      expect.objectContaining({
        anchor: 1,
        name: "Primary button",
        meaning: "Commit actions across the workbench",
        status: "candidate",
        origin: "source-generated",
        control: "button",
        states: [
          { state: "default", behavior: "Filled ink surface" },
          { state: "hover", behavior: "Surface darkens 4%" },
          { state: "disabled", behavior: "35% opacity, no pointer" }
        ],
        motion: [
          {
            duration: "160ms",
            easing: "ease-out",
            target: "background-color"
          }
        ],
        layoutInvariants: ["Press never shifts layout"],
        unavailableReason: null
      })
    ]);
  });

  it("keeps a gap with no declared states unavailable", () => {
    const source = entry({
      entry_id: "loading-state",
      file_kind: "interaction-rules.json",
      section: "interaction",
      name: "Loading behavior",
      value: {
        appliesTo: ["Buttons", "Panels"],
        stateBehavior: [],
        motion: [],
        layoutInvariants: []
      },
      meaning: "Async wait feedback",
      status: "gap",
      source_artifact_path: "design-system/interaction-rules.json"
    });

    expect(projectInteractionLeaf([toRow(source)])[0]).toEqual(
      expect.objectContaining({
        anchor: 1,
        status: "gap",
        origin: "unavailable",
        control: null,
        states: [],
        motion: [],
        unavailableReason: "No states are declared for this interaction rule."
      })
    );
  });

  it("selects the link adapter from the source taxonomy's TextLink name", () => {
    const source = entry({
      entry_id: "navigation-link",
      file_kind: "interaction-rules.json",
      section: "interaction",
      name: "Navigation link",
      value: {
        appliesTo: ["TextLink"],
        stateBehavior: [{ state: "hover", behavior: "Underline" }]
      },
      status: "formalized",
      source_artifact_path: "design-system/interaction-rules.json"
    });

    expect(projectInteractionLeaf([toRow(source)])[0]).toEqual(
      expect.objectContaining({
        control: "link",
        origin: "source-generated",
        unavailableReason: null
      })
    );
  });

  it("explains when declared states have no supported preview adapter", () => {
    const source = entry({
      entry_id: "canvas-gesture",
      file_kind: "interaction-rules.json",
      section: "interaction",
      name: "Canvas gesture",
      value: {
        appliesTo: ["InfiniteCanvas"],
        stateBehavior: [{ state: "dragging", behavior: "Pans the viewport" }]
      },
      status: "candidate",
      source_artifact_path: "design-system/interaction-rules.json"
    });

    expect(projectInteractionLeaf([toRow(source)])[0]).toEqual(
      expect.objectContaining({
        control: null,
        origin: "unavailable",
        unavailableReason:
          "No preview adapter supports the declared applies-to targets: InfiniteCanvas."
      })
    );
  });

  it("does not render an unsupported declared state as a generic control", () => {
    const source = entry({
      entry_id: "button-loading",
      file_kind: "interaction-rules.json",
      section: "interaction",
      name: "Button loading",
      value: {
        appliesTo: ["Button"],
        stateBehavior: [
          { state: "default", behavior: "Ready" },
          { state: "loading", behavior: "Wait feedback" }
        ]
      },
      status: "gap",
      source_artifact_path: "design-system/interaction-rules.json"
    });

    expect(projectInteractionLeaf([toRow(source)])[0]).toEqual(
      expect.objectContaining({
        control: null,
        origin: "unavailable",
        unavailableReason:
          "The button preview adapter does not support these declared states: loading."
      })
    );
  });

  it("distinguishes narrative behavior notes from structured state pairs", () => {
    const source = entry({
      entry_id: "interaction.linkHover",
      file_kind: "interaction-rules.json",
      section: "interaction",
      name: null,
      value: {
        appliesTo: ["Text Link"],
        stateBehavior: [
          "Slightly deepen the text color.",
          "Do not introduce a filled background."
        ]
      },
      status: "candidate",
      source_artifact_path: "design-system/interaction-rules.json"
    });

    expect(projectInteractionLeaf([toRow(source)])[0]).toEqual(
      expect.objectContaining({
        name: "Link hover",
        control: null,
        origin: "unavailable",
        unavailableReason:
          "No structured state and behavior pairs are declared for this interaction rule."
      })
    );
  });
});

function projectedEntryIds(projection: TypographyProjection): string[] {
  return [
    ...projection.families.map((family) => family.row.entryId),
    ...projection.styles.map((style) => style.row.entryId),
    ...projection.metricGroups.flatMap((group) =>
      group.rows.map((row) => row.entryId)
    )
  ];
}

/* --------------------------------- pxOf ---------------------------------- */

describe("pxOf", () => {
  it("parses px strings, bare numbers and numeric strings", () => {
    expect(pxOf("16px")).toBe(16);
    expect(pxOf(16)).toBe(16);
    expect(pxOf("16")).toBe(16);
    expect(pxOf("1.05")).toBe(1.05);
  });

  it("rejects non-px units and non-numeric values", () => {
    expect(pxOf("1.05em")).toBeNull();
    expect(pxOf("auto")).toBeNull();
    expect(pxOf(null)).toBeNull();
    expect(pxOf({})).toBeNull();
  });
});

/* ---------------------------- formatValueField ---------------------------- */

describe("formatValueField", () => {
  it("renders alias objects as arrows, never as JSON", () => {
    expect(formatValueField({ alias: "primitive.font-family-sans" })).toBe(
      "→ primitive.font-family-sans"
    );
    expect(formatValueField({ $ref: "spacing.200" })).toBe("→ spacing.200");
  });

  it("renders scalars verbatim and null as a dash", () => {
    expect(formatValueField("Instrument Sans")).toBe("Instrument Sans");
    expect(formatValueField(700)).toBe("700");
    expect(formatValueField(true)).toBe("true");
    expect(formatValueField(null)).toBe("—");
    expect(formatValueField(undefined)).toBe("—");
  });

  it("summarizes arrays and nested objects without JSON", () => {
    expect(formatValueField(["sm", "md", "lg"])).toBe("sm, md, lg");
    expect(formatValueField([{ a: 1 }, { b: 2 }])).toBe("2 entries");
    expect(formatValueField({ nested: { deep: true } })).toBe("…");
  });
});

/* ------------------------------ cssFontStack ------------------------------ */

describe("cssFontStack", () => {
  it("quotes families with spaces, keeps generics bare", () => {
    expect(
      cssFontStack(["Instrument Sans", "system-ui", "sans-serif"])
    ).toBe('"Instrument Sans", system-ui, sans-serif');
  });

  it("keeps already-quoted and single-word families untouched", () => {
    expect(cssFontStack(['"Source Serif 4"', "Inter", "serif"])).toBe(
      '"Source Serif 4", Inter, serif'
    );
  });

  it("drops empty segments", () => {
    expect(cssFontStack(["Inter", " ", "sans-serif"])).toBe("Inter, sans-serif");
  });
});

/* -------------------------- formatTextStyleSummary ------------------------ */

describe("formatTextStyleSummary", () => {
  const field = (text: string, aliasTarget: string | null = null) => ({
    text,
    aliasTarget
  });

  it("joins size / line-height · weight", () => {
    expect(
      formatTextStyleSummary({
        fontSize: field("64px"),
        fontSizePx: 64,
        lineHeight: field("1.05"),
        fontWeight: field("700"),
        letterSpacing: null,
        textTransform: null
      })
    ).toBe("64 / 1.05 · 700");
  });

  it("drops missing parts without dangling separators", () => {
    expect(
      formatTextStyleSummary({
        fontSize: field("16px"),
        fontSizePx: 16,
        lineHeight: null,
        fontWeight: field("400"),
        letterSpacing: null,
        textTransform: null
      })
    ).toBe("16 · 400");
    expect(
      formatTextStyleSummary({
        fontSize: null,
        fontSizePx: null,
        lineHeight: null,
        fontWeight: field("700"),
        letterSpacing: null,
        textTransform: null
      })
    ).toBe("700");
    expect(
      formatTextStyleSummary({
        fontSize: null,
        fontSizePx: null,
        lineHeight: null,
        fontWeight: null,
        letterSpacing: null,
        textTransform: null
      })
    ).toBe("");
  });

  it("appends tracking and transform so the left column carries them", () => {
    expect(
      formatTextStyleSummary({
        fontSize: field("13px"),
        fontSizePx: 13,
        lineHeight: null,
        fontWeight: field("500"),
        letterSpacing: field("0.06em"),
        textTransform: field("uppercase")
      })
    ).toBe("13 · 500 · tracking 0.06em · uppercase");
  });

  it("keeps alias text for aliased parts instead of guessing a number", () => {
    expect(
      formatTextStyleSummary({
        fontSize: field("→ primitive.font-size-800", "primitive.font-size-800"),
        fontSizePx: null,
        lineHeight: field("1.2"),
        fontWeight: null,
        letterSpacing: null,
        textTransform: null
      })
    ).toBe("→ primitive.font-size-800 / 1.2");
  });
});

/* ------------------------------ classification ---------------------------- */

describe("projectTypographyLeaf classification", () => {
  it("sorts entries into families, styles and metric groups", () => {
    const projection = projectTypographyLeaf(fixtureLayers());

    expect(projection.families.map((family) => family.row.entryId)).toEqual([
      "primitive.font-family-sans",
      "semantic.font-family-serif"
    ]);
    expect(projection.styles.map((style) => style.row.entryId)).toEqual([
      "semantic.display-large",
      "semantic.body"
    ]);
    expect(projection.metricGroups).toHaveLength(1);
    expect(projection.metricGroups[0]!.layer).toBe("primitive");
    expect(
      projection.metricGroups[0]!.rows.map((row) => row.entryId)
    ).toEqual(["primitive.font-size-400", "primitive.font-weight-bold"]);
  });

  it("parses family stacks in declared order", () => {
    const projection = projectTypographyLeaf(fixtureLayers());
    const sans = projection.families.find(
      (family) => family.row.entryId === "primitive.font-family-sans"
    );
    expect(sans?.stack).toEqual(["Instrument Sans", "system-ui", "sans-serif"]);
    expect(sans?.primary).toBe("Instrument Sans");
    const serif = projection.families.find(
      (family) => family.row.entryId === "semantic.font-family-serif"
    );
    expect(serif?.stack).toEqual(["Source Serif 4", "serif"]);
  });

  it("reads tolerant composite style keys", () => {
    const projection = projectTypographyLeaf(fixtureLayers());
    const body = projection.styles.find(
      (style) => style.row.entryId === "semantic.body"
    );
    expect(body?.fontFamily?.text).toBe("Inter");
    expect(body?.fontSize?.text).toBe("16px");
    expect(body?.fontSizePx).toBe(16);
    expect(body?.fontWeight?.text).toBe("400");
    expect(body?.letterSpacing?.text).toBe("0.01em");
    expect(body?.summary).toBe("16 · 400 · tracking 0.01em");
  });

  it("renders aliased style fields as arrows and resolves the specimen family", () => {
    const projection = projectTypographyLeaf(fixtureLayers());
    const display = projection.styles.find(
      (style) => style.row.entryId === "semantic.display-large"
    );
    expect(display?.fontFamily?.text).toBe("→ primitive.font-family-sans");
    expect(display?.fontFamily?.aliasTarget).toBe("primitive.font-family-sans");
    expect(display?.specimenFamily).toBe(
      '"Instrument Sans", system-ui, sans-serif'
    );
    expect(display?.summary).toBe("64 / 1.05 · 700");
    expect(display?.fontSizePx).toBe(64);
  });

  it("orders styles largest-first, unknown sizes last alphabetically", () => {
    const projection = projectTypographyLeaf([
      {
        layer: "semantic" as const,
        entries: [
          entry({ entry_id: "s.small", name: "small", value: { fontSize: "12px" } }),
          entry({ entry_id: "s.alias-b", name: "beta", value: { fontSize: { alias: "x" } } }),
          entry({ entry_id: "s.big", name: "big", value: { fontSize: "48px" } }),
          entry({ entry_id: "s.alias-a", name: "alpha", value: { fontSize: { alias: "y" } } })
        ]
      }
    ]);
    expect(projection.styles.map((style) => style.role)).toEqual([
      "big",
      "small",
      "alpha",
      "beta"
    ]);
  });

  it("carries status through to the chips", () => {
    const projection = projectTypographyLeaf(fixtureLayers());
    expect(projection.chips).toEqual(["4 formalized", "1 candidate", "1 open gap"]);
  });
});

/* --------------------------- specimen family fallback ---------------------- */

describe("specimen family fallback", () => {
  it("does not infer the single declared family for family-less composite styles", () => {
    const projection = projectTypographyLeaf([
      { layer: "primitive" as const, entries: [FAMILY_SANS] },
      {
        layer: "semantic" as const,
        entries: [
          entry({ entry_id: "s.caption", name: "caption", value: { fontSize: "12px" } })
        ]
      }
    ]);
    expect(projection.styles[0]!.specimenFamily).toBeNull();
  });

  it("stays honest (null) when several families are declared", () => {
    const projection = projectTypographyLeaf(fixtureLayers());
    const caption = entry({
      entry_id: "s.caption",
      name: "caption",
      value: { fontSize: "12px" }
    });
    const withCaption = projectTypographyLeaf([
      { layer: "primitive" as const, entries: [FAMILY_SANS] },
      { layer: "semantic" as const, entries: [FAMILY_SERIF, caption] }
    ]);
    expect(
      withCaption.styles.find((style) => style.row.entryId === "s.caption")
        ?.specimenFamily
    ).toBeNull();
    expect(projection.styles.length).toBeGreaterThan(0);
  });

  it("stays honest (null) when the alias target is unknown", () => {
    const projection = projectTypographyLeaf([
      {
        layer: "semantic" as const,
        entries: [
          entry({
            entry_id: "s.display",
            name: "display",
            value: {
              fontFamily: { alias: "primitive.missing-family" },
              fontSize: "40px"
            }
          })
        ]
      }
    ]);
    expect(projection.styles[0]!.specimenFamily).toBeNull();
  });
});

/* ------------------------------- losslessness ------------------------------ */

describe("projectTypographyLeaf losslessness", () => {
  it("every entry lands in exactly one reading group AND in technical details", () => {
    const projection = projectTypographyLeaf(fixtureLayers());

    const grouped = projectedEntryIds(projection);
    expect(grouped.sort()).toEqual(ALL_ENTRIES.map((e) => e.entry_id).sort());

    const detailIds = projection.technicalDetails.map((detail) => detail.entryId);
    expect(detailIds.sort()).toEqual(ALL_ENTRIES.map((e) => e.entry_id).sort());
  });

  it("leaks no raw JSON into reading-layer display fields", () => {
    const projection = projectTypographyLeaf(fixtureLayers());
    const displayTexts = [
      ...projection.families.flatMap((family) => [family.name, ...family.stack]),
      ...projection.styles.flatMap((style) => [
        style.role,
        style.summary,
        ...[style.fontFamily, style.fontSize, style.fontWeight, style.lineHeight, style.letterSpacing, style.textTransform]
          .filter((f): f is NonNullable<typeof f> => f !== null)
          .map((f) => f.text)
      ]),
      ...projection.metricGroups.flatMap((group) =>
        group.rows.flatMap((row) => [row.name, row.value])
      )
    ];
    for (const text of displayTexts) {
      expect(text).not.toMatch(/[{}[\]]/);
    }
  });
});

/* ----------------------------- technical details --------------------------- */

describe("toTechnicalDetail", () => {
  it("keys on source path + entry id and keeps the full envelope", () => {
    const detail = toTechnicalDetail(DISPLAY_LARGE);
    expect(detail.key).toBe(
      "design-system/token.json::semantic.display-large"
    );
    expect(detail.sourcePath).toBe("design-system/token.json");
    expect(detail.name).toBe("display.large");
    expect(detail.status).toBe("formalized");
    const raw = JSON.parse(detail.rawJson) as Record<string, unknown>;
    expect(raw.value).toEqual(DISPLAY_LARGE.value);
    expect(raw.status).toBe("formalized");
    expect(raw).toHaveProperty("meaning");
    expect(raw).toHaveProperty("links");
    expect(raw).not.toHaveProperty("alias");
  });

  it("includes the alias target when the entry itself is an alias", () => {
    const detail = toTechnicalDetail(
      entry({ entry_id: "s.alias", value: { alias: "primitive.x" }, alias: "primitive.x" })
    );
    const raw = JSON.parse(detail.rawJson) as Record<string, unknown>;
    expect(raw.alias).toBe("primitive.x");
  });
});

/* ------------------------------- type scale -------------------------------- */

describe("typeScaleSteps", () => {
  it("merges style sizes and px metric tokens, deduplicated and ascending", () => {
    const projection = projectTypographyLeaf(fixtureLayers());
    const steps = typeScaleSteps(projection);
    expect(steps.map((step) => step.px)).toEqual([16, 64]);
    const sixteen = steps.find((step) => step.px === 16);
    expect(sixteen?.sourceKeys).toContain(
      "design-system/token.json::semantic.body"
    );
    expect(sixteen?.sourceKeys).toContain(
      "design-system/token.json::primitive.font-size-400"
    );
  });

  it("ignores non-px metric values and zero", () => {
    const projection = projectTypographyLeaf([
      {
        layer: "primitive" as const,
        entries: [
          entry({ entry_id: "p.a", name: "font.tracking.wide", value: "0.01em" }),
          entry({ entry_id: "p.b", name: "font.size.zero", value: "0px" })
        ]
      }
    ]);
    expect(typeScaleSteps(projection)).toEqual([]);
  });

  it("resolves whole-token size aliases and keeps every source key", () => {
    const sizeBase = entry({
      entry_id: "primitive.font-size-500",
      name: "font.size.500",
      value: "20px"
    });
    const sizeAlias = entry({
      entry_id: "semantic.font-size-navigation",
      name: "font.size.navigation",
      value: { alias: "primitive.font-size-500" },
      alias: "primitive.font-size-500",
      meaning: "Navigation size",
      status: "candidate"
    });
    const projection = projectTypographyLeaf([
      {
        layer: "primitive" as const,
        entries: [FAMILY_SANS, sizeBase]
      },
      { layer: "semantic" as const, entries: [sizeAlias] }
    ]);
    const steps = typeScaleSteps(projection);
    expect(steps).toEqual([
      {
        px: 20,
        sourceKeys: [
          "design-system/token.json::primitive.font-size-500",
          "design-system/token.json::semantic.font-size-navigation"
        ]
      }
    ]);
    const atlasItem = typographyAtlasItems(projection)[0]!;
    expect(atlasItem).toMatchObject({
      kind: "scale",
      label: "Navigation",
      usage: "Navigation size",
      fontSize: "20px",
      status: "candidate"
    });
    expect(atlasItem.sourceRows.map((row) => row.entryId)).toEqual([
      "semantic.font-size-navigation",
      "primitive.font-size-500",
      "primitive.font-family-sans"
    ]);
  });
});

/* ------------------------------- type atlas ------------------------------- */

describe("typographyAtlasItems", () => {
  it("projects composite styles with their declared construction data and alias sources", () => {
    const projection = projectTypographyLeaf([
      { layer: "primitive" as const, entries: [FAMILY_SANS] },
      { layer: "semantic" as const, entries: [DISPLAY_LARGE] }
    ]);
    const atlas = typographyAtlasItems(projection);
    const display = atlas.find((item) => item.label === "display.large");

    expect(display).toMatchObject({
      kind: "style",
      usage: DISPLAY_LARGE.meaning,
      fontFamily:
        "→ primitive.font-family-sans · Instrument Sans, system-ui, sans-serif",
      specimenFamily: '"Instrument Sans", system-ui, sans-serif',
      fontSize: "64px",
      fontSizePx: 64,
      fontWeight: "700",
      lineHeight: "1.05",
      letterSpacing: null,
      status: "formalized"
    });
    expect(display?.sourceRows.map((row) => row.entryId)).toEqual([
      "semantic.display-large",
      "primitive.font-family-sans"
    ]);
  });

  it("renders uncovered atomic sizes without inventing weight, leading or tracking", () => {
    const projection = projectTypographyLeaf([
      { layer: "primitive" as const, entries: [FAMILY_SANS, SIZE_400] },
      { layer: "semantic" as const, entries: [] }
    ]);
    const atlas = typographyAtlasItems(projection);
    const scale = atlas.find((item) => item.kind === "scale");

    expect(scale).toMatchObject({
      fontFamily: "Instrument Sans",
      specimenFamily: '"Instrument Sans", system-ui, sans-serif',
      fontSize: "16px",
      fontSizePx: 16,
      fontWeight: null,
      lineHeight: null,
      letterSpacing: null,
      textTransform: null
    });
    expect(scale?.sourceRows.map((row) => row.entryId)).toEqual([
      "primitive.font-size-400",
      "primitive.font-family-sans"
    ]);
  });

  it("reattaches uniquely role-matched atomic tracking to a scale specimen", () => {
    const heroSize = entry({
      entry_id: "semantic.typography-hero-size",
      name: "typography.heroSize",
      section: "token.semantic",
      value: { alias: "primitive.font-size-hero" },
      alias: "primitive.font-size-hero",
      meaning: "Hero statement size role"
    });
    const primitiveHeroSize = entry({
      entry_id: "primitive.font-size-hero",
      name: "fontSize.64",
      section: "token.primitive",
      value: "64px",
      meaning: "Primary hero statement size"
    });
    const tightTracking = entry({
      entry_id: "primitive.letter-spacing-tight",
      name: "letterSpacing.tight",
      section: "token.primitive",
      value: "-0.05em",
      meaning: "Hero, display and navigation tracking"
    });
    const supportingTracking = entry({
      entry_id: "primitive.letter-spacing-supporting",
      name: "letterSpacing.supporting",
      section: "token.primitive",
      value: "-0.02em",
      meaning: "Supporting statement tracking"
    });
    const projection = projectTypographyLeaf([
      {
        layer: "primitive" as const,
        entries: [
          FAMILY_SANS,
          primitiveHeroSize,
          tightTracking,
          supportingTracking
        ]
      },
      { layer: "semantic" as const, entries: [heroSize] }
    ]);

    expect(typographyAtlasItems(projection)[0]).toMatchObject({
      kind: "scale",
      label: "Hero statement",
      fontSize: "64px",
      letterSpacing: "-0.05em",
      specimenLetterSpacing: "-0.05em",
      sourceRows: expect.arrayContaining([
        expect.objectContaining({
          entryId: "primitive.letter-spacing-tight"
        })
      ])
    });
  });

  it("does not choose atomic tracking when role matches are tied", () => {
    const heroSize = entry({
      entry_id: "primitive.font-size-hero",
      name: "fontSize.64",
      section: "token.primitive",
      value: "64px",
      meaning: "Hero statement size"
    });
    const trackingA = entry({
      entry_id: "primitive.tracking-a",
      name: "letterSpacing.a",
      section: "token.primitive",
      value: "-0.05em",
      meaning: "Hero tracking"
    });
    const trackingB = entry({
      entry_id: "primitive.tracking-b",
      name: "letterSpacing.b",
      section: "token.primitive",
      value: "-0.03em",
      meaning: "Hero tracking"
    });
    const projection = projectTypographyLeaf([
      {
        layer: "primitive" as const,
        entries: [FAMILY_SANS, heroSize, trackingA, trackingB]
      }
    ]);

    expect(typographyAtlasItems(projection)[0]).toMatchObject({
      letterSpacing: null,
      specimenLetterSpacing: null
    });
  });

  it("does not treat shared layout context as a typography-role match", () => {
    const navigationSize = entry({
      entry_id: "primitive.font-size-footer-navigation",
      name: "fontSize.footerNavigation",
      section: "token.primitive",
      value: "20px",
      meaning: "Footer navigation size"
    });
    const metadataTracking = entry({
      entry_id: "primitive.tracking-footer-metadata",
      name: "letterSpacing.footerMetadata",
      section: "token.primitive",
      value: "-0.03em",
      meaning: "Footer metadata tracking"
    });
    const projection = projectTypographyLeaf([
      {
        layer: "primitive" as const,
        entries: [FAMILY_SANS, navigationSize, metadataTracking]
      }
    ]);

    expect(typographyAtlasItems(projection)[0]).toMatchObject({
      letterSpacing: null,
      specimenLetterSpacing: null
    });
  });

  it("does not duplicate a px size already represented by a composite style", () => {
    const projection = projectTypographyLeaf([
      { layer: "primitive" as const, entries: [FAMILY_SANS, SIZE_400] },
      { layer: "semantic" as const, entries: [BODY] }
    ]);
    const atlas = typographyAtlasItems(projection);
    expect(atlas.filter((item) => item.fontSizePx === 16)).toHaveLength(1);
    expect(atlas[0]?.kind).toBe("style");
  });

  it("uses the least-complete consumed status for each visual form", () => {
    const candidateFamily = entry({
      ...FAMILY_SANS,
      id: "uuid-candidate-family",
      status: "candidate"
    });
    const projection = projectTypographyLeaf([
      { layer: "primitive" as const, entries: [candidateFamily] },
      { layer: "semantic" as const, entries: [DISPLAY_LARGE] }
    ]);
    expect(typographyAtlasItems(projection)[0]?.status).toBe("candidate");
  });

  it("resolves multi-hop metric aliases for the specimen and retains the full evidence chain", () => {
    const familyAlias = entry({
      entry_id: "semantic.font-family-brand",
      name: "font.family.brand",
      value: { alias: "primitive.font-family-sans" },
      alias: "primitive.font-family-sans"
    });
    const sizeBase = entry({
      entry_id: "primitive.font-size-hero",
      name: "font.size.hero",
      value: "72px"
    });
    const sizeAlias = entry({
      entry_id: "semantic.font-size-hero",
      name: "font.size.hero",
      value: { alias: "primitive.font-size-hero" },
      alias: "primitive.font-size-hero",
      status: "candidate"
    });
    const weightBase = entry({
      entry_id: "primitive.font-weight-hero",
      name: "font.weight.hero",
      value: "600"
    });
    const style = entry({
      entry_id: "component.hero-title",
      name: "hero.title",
      value: {
        fontFamily: { alias: "semantic.font-family-brand" },
        fontSize: { alias: "semantic.font-size-hero" },
        fontWeight: { alias: "primitive.font-weight-hero" },
        lineHeight: "1.1"
      }
    });
    const projection = projectTypographyLeaf([
      {
        layer: "primitive" as const,
        entries: [FAMILY_SANS, sizeBase, weightBase]
      },
      {
        layer: "semantic" as const,
        entries: [familyAlias, sizeAlias]
      },
      { layer: "component" as const, entries: [style] }
    ]);
    const atlasItem = typographyAtlasItems(projection).find(
      (item) => item.label === "hero.title"
    );

    expect(atlasItem).toMatchObject({
      fontSize: "→ semantic.font-size-hero · 72px",
      fontSizePx: 72,
      fontWeight: "→ primitive.font-weight-hero · 600",
      specimenFontWeight: "600",
      specimenLineHeight: "1.1",
      specimenFamily: '"Instrument Sans", system-ui, sans-serif',
      status: "candidate"
    });
    expect(atlasItem?.sourceRows.map((row) => row.entryId)).toEqual([
      "component.hero-title",
      "semantic.font-family-brand",
      "primitive.font-family-sans",
      "semantic.font-size-hero",
      "primitive.font-size-hero",
      "primitive.font-weight-hero"
    ]);
  });
});

/* --------------------------- typographyLayersFromView ---------------------- */

describe("typographyLayersFromView", () => {
  it("classifies by domain first, then by name pattern (color wins)", () => {
    const view: DesignSystemView = {
      generated_at: "2026-07-29T00:00:00.000Z",
      name: "",
      foundations: { visualLanguage: null, principles: [] },
      tokens: {
        primitive: [
          entry({ entry_id: "p.font", name: "anything", domain: "typography", section: "token.primitive" }),
          entry({ entry_id: "p.color", name: "blue.500", domain: "color", section: "token.primitive" })
        ],
        semantic: [
          entry({ entry_id: "s.display", name: "display.large", domain: null }),
          entry({ entry_id: "s.text", name: "text.primary", domain: null })
        ],
        component: []
      },
      layout: [],
      interaction: [],
      components: { inventory: [], specs: [] }
    };
    const layers = typographyLayersFromView(view);
    expect(layers.map((layer) => layer.layer)).toEqual([
      "primitive",
      "semantic",
      "component"
    ]);
    expect(layers[0]!.entries.map((e) => e.entry_id)).toEqual(["p.font"]);
    expect(layers[1]!.entries.map((e) => e.entry_id)).toEqual(["s.display"]);
    expect(layers[2]!.entries).toEqual([]);
  });
});

/* ------------------------------ object fields ------------------------------ */

describe("projectObjectFields", () => {
  it("flattens top-level keys into labeled field lines", () => {
    const fields = projectObjectFields({
      columns: "12",
      gutter: { alias: "spacing.200" },
      breakpoints: ["sm", "md"],
      nested: { deep: true }
    });
    expect(fields).toEqual([
      { label: "columns", text: "12" },
      { label: "gutter", text: "→ spacing.200" },
      { label: "breakpoints", text: "sm, md" },
      { label: "nested", text: "…" }
    ]);
  });

  it("returns null for non-object values", () => {
    expect(projectObjectFields("12")).toBeNull();
    expect(projectObjectFields(["a"])).toBeNull();
    expect(projectObjectFields(null)).toBeNull();
  });
});

/* ------------------------------ rich principle ----------------------------- */

describe("projectPrinciple", () => {
  it("projects rich statement objects with all fields", () => {
    const projection = projectPrinciple(
      entry({
        entry_id: "principle.1",
        file_kind: "design-system.json",
        section: "foundations.principles",
        value: {
          statement: "Design with intent.",
          rationale: "Every choice needs a reason.",
          scope: "All product surfaces",
          use: ["Do this", "And this"],
          avoid: ["Not that"],
          exceptions: ["Unless legacy"]
        }
      })
    );
    expect(projection.isRich).toBe(true);
    expect(projection.statement).toBe("Design with intent.");
    expect(projection.rationale).toBe("Every choice needs a reason.");
    expect(projection.scope).toBe("All product surfaces");
    expect(projection.use).toEqual(["Do this", "And this"]);
    expect(projection.avoid).toEqual(["Not that"]);
    expect(projection.exceptions).toEqual(["Unless legacy"]);
  });

  it("treats partially rich objects as rich, falling back to meaning", () => {
    const projection = projectPrinciple(
      entry({
        entry_id: "principle.2",
        meaning: "Fallback statement",
        value: { avoid: ["Don't"] }
      })
    );
    expect(projection.isRich).toBe(true);
    expect(projection.statement).toBe("Fallback statement");
    expect(projection.rationale).toBeNull();
    expect(projection.use).toEqual([]);
    expect(projection.avoid).toEqual(["Don't"]);
  });

  it("keeps legacy strings and single-key statements flat", () => {
    const legacy = projectPrinciple(
      entry({ entry_id: "p.legacy", value: "Keep it simple." })
    );
    expect(legacy.isRich).toBe(false);
    expect(legacy.statement).toBe("Keep it simple.");

    const singleKey = projectPrinciple(
      entry({ entry_id: "p.single", value: { statement: "Only text." } })
    );
    expect(singleKey.isRich).toBe(false);
    expect(singleKey.statement).toBe("Only text.");
  });

  it("keeps alias principles as arrow rows", () => {
    const projection = projectPrinciple(
      entry({
        entry_id: "p.alias",
        value: { alias: "principle.canonical" },
        alias: "principle.canonical"
      })
    );
    expect(projection.isRich).toBe(false);
    expect(projection.statement).toBe("→ principle.canonical");
  });

  it("keeps unknown keys alongside a rich shape as labeled extra fields", () => {
    const projection = projectPrinciple(
      entry({
        entry_id: "principle.extra",
        value: {
          statement: "Design with intent.",
          origin: "Brand workshop 2026",
          priority: 2
        }
      })
    );
    expect(projection.isRich).toBe(true);
    expect(projection.statement).toBe("Design with intent.");
    expect(projection.extraFields).toEqual([
      { label: "origin", text: "Brand workshop 2026" },
      { label: "priority", text: "2" }
    ]);
  });

  it("projects unrecognized objects as field lines, never as JSON", () => {
    const projection = projectPrinciple(
      entry({
        entry_id: "principle.oddball",
        name: "Oddball principle",
        value: {
          philosophy: "Less, but better",
          lineage: { alias: "principle.rams" }
        }
      })
    );
    expect(projection.isRich).toBe(true);
    expect(projection.statement).toBe("Oddball principle");
    expect(projection.extraFields).toEqual([
      { label: "philosophy", text: "Less, but better" },
      { label: "lineage", text: "→ principle.rams" }
    ]);
    for (const field of projection.extraFields ?? []) {
      expect(field.text).not.toMatch(/[{}[\]]/);
    }
  });
});
