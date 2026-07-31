import { describe, expect, it } from "vitest";

import type { DesignSystemEntryView } from "@/lib/runtime/design-system-view";
import {
  firstFactOfKind,
  projectLayoutBlueprint,
  sliceLayoutBlueprint
} from "@/components/workbench/design-system-layout-projection";
import { toRow, type DsRow } from "@/components/workbench/design-system-view-model";

function entry(
  partial: Partial<DesignSystemEntryView>
): DesignSystemEntryView {
  return {
    id: `uuid-${partial.entry_id ?? "e"}`,
    entry_id: "e1",
    file_kind: "layout-rules.json",
    section: "layout",
    name: null,
    value: {},
    alias: null,
    meaning: "",
    status: "candidate",
    links: [],
    source_artifact_path: "design-system/layout-rules.json",
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

function layoutRow(
  entryId: string,
  name: string | null,
  value: unknown,
  extra: Partial<DesignSystemEntryView> = {}
): DsRow {
  return toRow(entry({ entry_id: entryId, name, value, ...extra }));
}

/* --------------------------- composite recognition -------------------------- */

describe("projectLayoutBlueprint key-driven recognition", () => {
  it("derives container + columns + gutter facts from one composite grid rule", () => {
    // The 09C-A e2e fixture shape: one rule carrying three spatial facts.
    const model = projectLayoutBlueprint([
      layoutRow("grid-page", "grid.page", {
        columns: "12",
        gutter: { alias: "spacing.200" },
        maxWidth: "1120px"
      })
    ]);
    expect(model.drawable).toHaveLength(1);
    expect(model.unavailable).toHaveLength(0);
    const rule = model.rules[0]!;
    expect(rule.anchor).toBe(1);
    expect(rule.facts).toEqual([
      { kind: "columns", label: "12", columns: 12 },
      { kind: "gutter", label: "→ spacing.200" },
      { kind: "container", label: "1120px", maxWidthPx: 1120 }
    ]);
  });

  it("reads declared region arrays and separator-joined region strings", () => {
    const model = projectLayoutBlueprint([
      layoutRow("shell-regions", "shell.regions", {
        regions: ["header", "hero", "content", "footer"]
      }),
      layoutRow("shell-marketing", "shell.marketing", {
        stack: "header · content · footer"
      })
    ]);
    expect(model.rules[0]!.facts[0]).toEqual({
      kind: "regions",
      label: "header, hero, content, footer",
      regions: ["header", "hero", "content", "footer"]
    });
    expect(model.rules[1]!.facts[0]).toEqual({
      kind: "regions",
      label: "header · content · footer",
      regions: ["header", "content", "footer"]
    });
  });

  it("reads breakpoints as px arrays, named entries, and name→px maps", () => {
    const model = projectLayoutBlueprint([
      layoutRow("bp-array", "breakpoints", {
        breakpoints: ["640", "768", "1024", "1280"]
      }),
      layoutRow("bp-named", "breakpoints.named", {
        breakpoints: [
          { name: "md", value: "768px" },
          { name: "lg", value: 1024 }
        ]
      }),
      layoutRow("bp-map", "breakpoints.map", {
        breakpoints: { sm: 640, md: 768 }
      })
    ]);
    expect(model.rules[0]!.facts[0]!.breakpoints).toEqual([
      { name: null, px: 640, label: "640" },
      { name: null, px: 768, label: "768" },
      { name: null, px: 1024, label: "1024" },
      { name: null, px: 1280, label: "1280" }
    ]);
    expect(model.rules[1]!.facts[0]!.breakpoints).toEqual([
      { name: "md", px: 768, label: "md 768px" },
      { name: "lg", px: 1024, label: "lg 1024" }
    ]);
    expect(model.rules[2]!.facts[0]!.breakpoints).toEqual([
      { name: "sm", px: 640, label: "sm 640" },
      { name: "md", px: 768, label: "md 768" }
    ]);
  });

  it("reads section rhythm values verbatim, arrows included", () => {
    const model = projectLayoutBlueprint([
      layoutRow("section-rhythm", "section.heroToNext", {
        heroToNext: "96 → 56px"
      })
    ]);
    expect(model.rules[0]!.facts[0]).toEqual({
      kind: "rhythm",
      label: "96 → 56px"
    });
  });

  it("ignores rich metadata fields — lineage is not geometry", () => {
    const model = projectLayoutBlueprint([
      layoutRow("container-max", "container.maxWidth", {
        maxWidth: "1200px",
        responsiveBehavior: ["24px page padding below 768px"],
        tokenLinks: ["spacing.300"],
        acceptanceChecks: ["Verified against page-shell code"]
      })
    ]);
    expect(model.rules[0]!.facts).toEqual([
      { kind: "container", label: "1200px", maxWidthPx: 1200 }
    ]);
  });

  it("keeps the first fact per kind when a value repeats one", () => {
    const model = projectLayoutBlueprint([
      layoutRow("grid-two", "grid", { columns: "12", gridColumns: "6" })
    ]);
    expect(model.rules[0]!.facts).toEqual([
      { kind: "columns", label: "12", columns: 12 }
    ]);
  });
});

/* ----------------------------- name-driven fallback ----------------------------- */

describe("projectLayoutBlueprint name-driven fallback", () => {
  it("classifies single-field objects by their concern name", () => {
    const model = projectLayoutBlueprint([
      layoutRow("container-max", "container.maxWidth", { width: "1200px" })
    ]);
    expect(model.rules[0]!.facts).toEqual([
      { kind: "container", label: "1200px", maxWidthPx: 1200 }
    ]);
  });

  it("joins responsive pairs verbatim for gutter and rhythm concerns", () => {
    const model = projectLayoutBlueprint([
      layoutRow("grid-gap", "grid.gap", { desktop: "24px", mobile: "16px" }),
      layoutRow("rhythm", "section.heroToNext", { desktop: "96px", below768: "56px" })
    ]);
    expect(model.rules[0]!.facts).toEqual([
      { kind: "gutter", label: "24px / 16px" }
    ]);
    expect(model.rules[1]!.facts).toEqual([
      { kind: "rhythm", label: "96px / 56px" }
    ]);
  });

  it("keeps aliased containers drawable but unscaled", () => {
    const model = projectLayoutBlueprint([
      layoutRow("container-max", "container.maxWidth", {
        width: { alias: "spacing.900" }
      })
    ]);
    expect(model.rules[0]!.facts).toEqual([
      { kind: "container", label: "→ spacing.900", maxWidthPx: null }
    ]);
    expect(model.drawable).toHaveLength(1);
  });
});

/* ------------------------------- honest gaps ------------------------------- */

describe("projectLayoutBlueprint honest unavailable partition", () => {
  it("leaves rules with unrecognized values undrawn", () => {
    const model = projectLayoutBlueprint([
      layoutRow("nav-mobile", "nav.mobile", { layout: "—" }, { status: "gap" })
    ]);
    expect(model.drawable).toHaveLength(0);
    expect(model.unavailable).toHaveLength(1);
    expect(model.unavailable[0]!.row.status).toBe("gap");
    expect(model.unavailable[0]!.anchor).toBe(1);
  });

  it("does not guess geometry from non-composite values", () => {
    const model = projectLayoutBlueprint([
      layoutRow("odd-scalar", "container.maxWidth", "1200px"),
      layoutRow("odd-alias", "grid.gap", { alias: "spacing.200" }, {
        alias: "spacing.200",
        value: { alias: "spacing.200" }
      } as Partial<DesignSystemEntryView>)
    ]);
    expect(model.unavailable.map((rule) => rule.row.entryId)).toEqual([
      "odd-scalar",
      "odd-alias"
    ]);
  });

  it("anchors every rule in source order, drawable or not", () => {
    const model = projectLayoutBlueprint([
      layoutRow("grid-page", "grid.page", { columns: "12" }),
      layoutRow("nav-mobile", "nav.mobile", { layout: "—" }, { status: "gap" }),
      layoutRow("bp", "breakpoints", { breakpoints: ["768"] })
    ]);
    expect(model.rules.map((rule) => rule.anchor)).toEqual([1, 2, 3]);
    expect(model.drawable.map((rule) => rule.anchor)).toEqual([1, 3]);
    expect(model.unavailable.map((rule) => rule.anchor)).toEqual([2]);
  });
});

/* ------------------------------ drawing lookup ------------------------------ */

describe("firstFactOfKind", () => {
  it("returns the first drawable fact of a kind in rule order", () => {
    const model = projectLayoutBlueprint([
      layoutRow("grid-a", "grid.a", { columns: "12" }),
      layoutRow("container", "container.maxWidth", { maxWidth: "1200px" }),
      layoutRow("grid-b", "grid.b", { columns: "6" })
    ]);
    expect(firstFactOfKind(model, "columns")!.rule.row.entryId).toBe("grid-a");
    expect(firstFactOfKind(model, "container")!.fact.maxWidthPx).toBe(1200);
    expect(firstFactOfKind(model, "rhythm")).toBeNull();
  });
});

/* --------------------------- isolate / compose slice --------------------------- */

describe("sliceLayoutBlueprint", () => {
  function fixture() {
    return projectLayoutBlueprint([
      layoutRow("grid-page", "grid.page", { columns: "12" }),
      layoutRow("nav-mobile", "nav.mobile", { layout: "—" }, { status: "gap" }),
      layoutRow("shell", "shell.regions", { regions: ["header", "footer"] })
    ]);
  }

  it("keeps only the requested anchors across every rule list", () => {
    const sliced = sliceLayoutBlueprint(fixture(), new Set([1, 3]));
    expect(sliced.rules.map((rule) => rule.anchor)).toEqual([1, 3]);
    expect(sliced.drawable.map((rule) => rule.anchor)).toEqual([1, 3]);
    expect(sliced.unavailable).toEqual([]);
  });

  it("preserves original anchor numbers instead of renumbering the slice", () => {
    const sliced = sliceLayoutBlueprint(fixture(), new Set([3]));
    expect(sliced.rules.map((rule) => rule.anchor)).toEqual([3]);
    expect(sliced.rules[0]!.row.entryId).toBe("shell");
  });

  it("slicing to an undrawable rule yields an honest unavailable-only model", () => {
    const sliced = sliceLayoutBlueprint(fixture(), new Set([2]));
    expect(sliced.drawable).toEqual([]);
    expect(sliced.unavailable.map((rule) => rule.row.entryId)).toEqual([
      "nav-mobile"
    ]);
  });

  it("unknown anchors and an empty set both produce an empty model", () => {
    const model = fixture();
    expect(sliceLayoutBlueprint(model, new Set([99])).rules).toEqual([]);
    expect(sliceLayoutBlueprint(model, new Set()).rules).toEqual([]);
  });
});
