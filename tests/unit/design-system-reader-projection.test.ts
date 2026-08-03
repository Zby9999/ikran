import { describe, expect, it } from "vitest";

import type { DesignSystemEntryView } from "@/lib/runtime/design-system-view";
import {
  cssFontStack,
  formatTextStyleSummary,
  formatValueField,
  projectDomainRuleLeaf,
  projectObjectFields,
  projectInteractionLeaf,
  projectPrinciple,
  projectTypographyLeaf,
  pxOf,
  toTechnicalDetail,
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

describe("prose rule projection", () => {
  it("uses meaning as the sole title and preserves prose body verbatim", () => {
    const body = "Use calm feedback.\nPreserve this line break exactly.";
    const interaction = projectInteractionLeaf([
      toRow(
        entry({
          entry_id: "interaction.feedback",
          file_kind: "interaction-rules.json",
          section: "interaction",
          value: body,
          meaning: "Calm feedback"
        })
      )
    ])[0]!;
    expect(interaction.title).toBe("Calm feedback");
    expect(interaction.body).toBe(body);

    const domain = projectDomainRuleLeaf([
      toRow(
        entry({
          entry_id: "domain.materials",
          kind: "domain-rule",
          domain: "other",
          value: body,
          meaning: "Material hierarchy"
        })
      )
    ])[0]!;
    expect(domain.title).toBe("Material hierarchy");
    expect(domain.body).toBe(body);
  });
});

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

describe("Interaction rule prose", () => {
  it("uses meaning as title and a generic readable fallback for a legacy object", () => {
    const source = entry({
      entry_id: "primary-button",
      file_kind: "interaction-rules.json",
      section: "interaction",
      name: "Quiet motion",
      value: {
        summary: "Motion stays quiet",
        details: "Routine feedback should not compete with content.",
        steps: [
          "Use motion to explain a state change.",
          "Avoid decorative loops."
        ],
        fallbacks: ["Preserve the same state information without motion."]
      },
      meaning: "Motion confirms change without becoming the subject.",
      status: "candidate",
      source_artifact_path: "design-system/interaction-rules.json"
    });

    expect(projectInteractionLeaf([toRow(source)])).toEqual([
      expect.objectContaining({
        anchor: 1,
        title: "Motion confirms change without becoming the subject.",
        status: "candidate",
        body:
          "summary: Motion stays quiet\n" +
          "details: Routine feedback should not compete with content.\n" +
          "steps:\n  • Use motion to explain a state change.\n  • Avoid decorative loops.\n" +
          "fallbacks:\n  • Preserve the same state information without motion."
      })
    ]);
  });

});

describe("Domain rule prose", () => {
  it("does not promote a legacy object field into the title", () => {
    const source = entry({
      entry_id: "semantic.no-shadow-regions",
      kind: "domain-rule",
      domain: "shadow",
      name: "no-shadow-regions",
      value: {
        summary: "Do not use shadows to separate regions.",
        reason: "Hierarchy should come from spacing.",
        alternatives: ["spacing", "border"],
        exception: "",
        examples: [],
        metadata: {}
      },
      meaning: "Keep material treatment flat.",
      status: "candidate"
    });

    expect(projectDomainRuleLeaf([toRow(source)])).toEqual([
      expect.objectContaining({
        anchor: 1,
        title: "Keep material treatment flat.",
        status: "candidate",
        body: expect.stringContaining("summary: Do not use shadows")
      })
    ]);
  });

  it("keeps nested legacy content readable without dotted-path projection", () => {
    const source = entry({
      entry_id: "semantic.responsive-spacing",
      kind: "domain-rule",
      domain: "spacing",
      value: {
        summary: "Spacing contracts on narrow screens.",
        constraints: {
          desktop: { min: "32px", max: "64px" },
          mobile: "20px"
        },
        examples: [
          { surface: "hero", gap: "48px" },
          { surface: "card", gap: "24px" }
        ]
      }
    });

    const body = projectDomainRuleLeaf([toRow(source)])[0]!.body;
    expect(body).toContain("constraints:");
    expect(body).toContain("desktop:");
    expect(body).toContain("min: 32px");
    expect(body).not.toContain("constraints.desktop.min");
    expect(body).not.toContain("{");
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

/* ------------------------------- type atlas ------------------------------- */

describe("typographyAtlasItems", () => {
  it("projects readable names, Type/Component groups, and canonical identities", () => {
    const typeRole = entry({
      entry_id: "semantic.typography.statisticalDisplay",
      section: "token.semantic",
      name: "typography.statisticalDisplay",
      value: { fontFamily: "Instrument Sans", fontSize: "105px" }
    });
    const componentRole = entry({
      entry_id: "component.textLink.compact",
      section: "token.component",
      name: "textLink.compact",
      value: { fontFamily: "Instrument Sans", fontSize: "16px" }
    });

    const atlas = typographyAtlasItems(
      projectTypographyLeaf([
        { layer: "semantic" as const, entries: [typeRole] },
        { layer: "component" as const, entries: [componentRole] }
      ])
    );

    expect(atlas).toEqual([
      expect.objectContaining({
        label: "Statistical Display",
        group: "type",
        canonicalIdentity: "semantic.typography.statisticalDisplay"
      }),
      expect.objectContaining({
        label: "Text Link Compact",
        group: "component",
        canonicalIdentity: "component.textLink.compact"
      })
    ]);
  });

  it("title-cases uppercase role segments instead of guessing acronyms", () => {
    const atlas = typographyAtlasItems(
      projectTypographyLeaf([
        {
          layer: "semantic" as const,
          entries: [
            entry({
              entry_id: "semantic.typography.STATISTICAL_DISPLAY",
              section: "token.semantic",
              name: "typography.STATISTICAL_DISPLAY",
              value: { fontFamily: "Instrument Sans", fontSize: "105px" }
            })
          ]
        }
      ])
    );

    expect(atlas[0]?.label).toBe("Statistical Display");
  });

  it("does not promote object-valued primitive construction facts to type styles", () => {
    const projection = projectTypographyLeaf([
      {
        layer: "primitive" as const,
        entries: [
          entry({
            entry_id: "p.observed-bundle",
            section: "token.primitive",
            name: "fontStyle.observedBundle",
            value: {
              fontFamily: "Instrument Sans",
              fontSize: "64px",
              fontWeight: 400,
              lineHeight: 1
            }
          })
        ]
      }
    ]);

    expect(typographyAtlasItems(projection)).toEqual([]);
  });

  it("projects composite styles with their declared construction data and alias sources", () => {
    const projection = projectTypographyLeaf([
      { layer: "primitive" as const, entries: [FAMILY_SANS] },
      { layer: "semantic" as const, entries: [DISPLAY_LARGE] }
    ]);
    const atlas = typographyAtlasItems(projection);
    const display = atlas.find(
      (item) => item.canonicalIdentity === "semantic.display-large"
    );

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

  it("does not turn atomic typography facts into Type styles", () => {
    const projection = projectTypographyLeaf([
      { layer: "primitive" as const, entries: [FAMILY_SANS, SIZE_400] },
      { layer: "semantic" as const, entries: [] }
    ]);
    expect(typographyAtlasItems(projection)).toEqual([]);
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
      (item) => item.canonicalIdentity === "component.hero-title"
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
          entry({ entry_id: "s.text", name: "text.primary", domain: null }),
          entry({
            entry_id: "s.negative-tracking-rule",
            name: "font.title.negative-tracking",
            kind: "domain-rule",
            domain: "typography",
            value: "Titles use negative tracking."
          })
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

/* ----------------------------- prose principle ---------------------------- */

describe("projectPrinciple", () => {
  it("projects meaning as title and prose value as body", () => {
    const projection = projectPrinciple(
      entry({
        entry_id: "principle.1",
        file_kind: "design-system.json",
        section: "foundations.principles",
        meaning: "Intentional choices",
        value: "Design with intent. Every choice needs an evidence-backed reason."
      })
    );
    expect(projection).toEqual({
      title: "Intentional choices",
      body: "Design with intent. Every choice needs an evidence-backed reason."
    });
  });

  it("keeps legacy persisted objects generic without semantic field reads", () => {
    const projection = projectPrinciple(
      entry({
        entry_id: "principle.2",
        meaning: "Legacy body",
        value: { first: "Do this", second: ["Then this"] }
      })
    );
    expect(projection.title).toBe("Legacy body");
    expect(projection.body).toContain("first: Do this");
    expect(projection.body).toContain("second:\n  • Then this");
    expect(projection.body).not.toMatch(/[{}[\]"]/);
  });

  it("keeps alias principles as arrow rows", () => {
    const projection = projectPrinciple(
      entry({
        entry_id: "p.alias",
        value: { alias: "principle.canonical" },
        alias: "principle.canonical"
      })
    );
    expect(projection.body).toBe("alias: principle.canonical");
  });
});
