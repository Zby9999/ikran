import { describe, expect, it } from "vitest";

import type {
  DesignSystemEntryView,
  DesignSystemLayoutCapture
} from "@/lib/runtime/design-system-view";
import {
  captureNodeMark,
  captureOrientation,
  projectLayoutLeaf
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

function capture(partial: Partial<DesignSystemLayoutCapture> = {}) {
  return {
    nodeId: null,
    nodeName: "Work grid",
    artifactPath: "design-system/captures/grid-page-work-grid.png",
    capturedAt: "2026-08-01T04:00:00.000Z",
    surfaceId: null,
    stale: false,
    nodeRect: null,
    ...partial
  };
}

/* --------------------------- composite recognition -------------------------- */

describe("projectLayoutLeaf key-driven fact recognition", () => {
  it("derives container + columns + gutter facts from one composite grid rule", () => {
    const model = projectLayoutLeaf([
      layoutRow("grid-page", "grid.page", {
        columns: "12",
        gutter: { alias: "spacing.200" },
        maxWidth: "1120px"
      })
    ]);
    expect(model.rules[0]!.facts).toEqual([
      { kind: "columns", label: "12" },
      { kind: "gutter", label: "→ spacing.200" },
      { kind: "container", label: "1120px" }
    ]);
  });

  it("reads declared region arrays and separator-joined region strings", () => {
    const model = projectLayoutLeaf([
      layoutRow("shell-regions", "shell.regions", {
        regions: ["header", "hero", "content", "footer"]
      }),
      layoutRow("shell-marketing", "shell.marketing", {
        stack: "header · content · footer"
      })
    ]);
    expect(model.rules[0]!.facts[0]).toEqual({
      kind: "regions",
      label: "header, hero, content, footer"
    });
    expect(model.rules[1]!.facts[0]).toEqual({
      kind: "regions",
      label: "header · content · footer"
    });
  });

  it("labels breakpoints from px arrays, named entries, and name→px maps", () => {
    const model = projectLayoutLeaf([
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
    expect(model.rules[0]!.facts[0]).toEqual({
      kind: "breakpoints",
      label: "640, 768, 1024, 1280"
    });
    expect(model.rules[1]!.facts[0]).toEqual({
      kind: "breakpoints",
      label: "md 768px, lg 1024"
    });
    expect(model.rules[2]!.facts[0]).toEqual({
      kind: "breakpoints",
      label: "sm 640, md 768"
    });
  });

  it("reads section rhythm values verbatim, arrows included", () => {
    const model = projectLayoutLeaf([
      layoutRow("section-rhythm", "section.heroToNext", {
        heroToNext: "96 → 56px"
      })
    ]);
    expect(model.rules[0]!.facts[0]).toEqual({
      kind: "rhythm",
      label: "96 → 56px"
    });
  });

  it("ignores rich metadata and capture provenance — lineage is not a measurement", () => {
    const model = projectLayoutLeaf([
      layoutRow("container-max", "container.maxWidth", {
        maxWidth: "1200px",
        responsiveBehavior: ["24px page padding below 768px"],
        tokenLinks: ["spacing.300"],
        acceptanceChecks: ["Verified against page-shell code"],
        sourceCaptures: [capture({ stale: true })]
      })
    ]);
    expect(model.rules[0]!.facts).toEqual([
      { kind: "container", label: "1200px" }
    ]);
  });

  it("keeps the first fact per kind when a value repeats one", () => {
    const model = projectLayoutLeaf([
      layoutRow("grid-two", "grid", { columns: "12", gridColumns: "6" })
    ]);
    expect(model.rules[0]!.facts).toEqual([{ kind: "columns", label: "12" }]);
  });
});

/* ----------------------------- name-driven fallback ----------------------------- */

describe("projectLayoutLeaf name-driven fallback", () => {
  it("classifies single-field objects by their concern name", () => {
    const model = projectLayoutLeaf([
      layoutRow("container-max", "container.maxWidth", { width: "1200px" })
    ]);
    expect(model.rules[0]!.facts).toEqual([
      { kind: "container", label: "1200px" }
    ]);
  });

  it("joins responsive pairs verbatim for gutter and rhythm concerns", () => {
    const model = projectLayoutLeaf([
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

  it("keeps aliased containers readable without inventing a pixel value", () => {
    const model = projectLayoutLeaf([
      layoutRow("container-max", "container.maxWidth", {
        width: { alias: "spacing.900" }
      })
    ]);
    expect(model.rules[0]!.facts).toEqual([
      { kind: "container", label: "→ spacing.900" }
    ]);
  });

  it("does not guess measurements from non-composite values", () => {
    const model = projectLayoutLeaf([
      layoutRow("odd-scalar", "container.maxWidth", "1200px"),
      layoutRow("odd-alias", "grid.gap", { alias: "spacing.200" }, {
        alias: "spacing.200",
        value: { alias: "spacing.200" }
      } as Partial<DesignSystemEntryView>)
    ]);
    expect(model.rules[0]!.facts).toEqual([]);
    expect(model.rules[1]!.facts).toEqual([]);
  });
});

/* ------------------------------ capture provenance ------------------------------ */

describe("projectLayoutLeaf captures", () => {
  it("keeps source order and carries captures per rule, not by measurements", () => {
    const model = projectLayoutLeaf([
      layoutRow("grid-page", "grid.page", { columns: "12" }),
      layoutRow(
        "nav-mobile",
        "nav.mobile",
        { layout: "—" },
        { status: "gap", layoutCaptures: [capture()] }
      ),
      layoutRow("bp", "breakpoints", { breakpoints: ["768"] })
    ]);
    expect(model.rules.map((rule) => rule.row.entryId)).toEqual([
      "grid-page",
      "nav-mobile",
      "bp"
    ]);
    expect(model.rules.map((rule) => rule.captures.length)).toEqual([0, 1, 0]);
  });

  it("passes the decorated captures through verbatim", () => {
    const captures = [
      capture({ nodeName: "Hero", stale: true, surfaceId: "surface-1" }),
      capture({ nodeName: "Grid", nodeId: "1:99" })
    ];
    const model = projectLayoutLeaf([
      layoutRow("grid-page", "grid.page", { columns: "12" }, {
        layoutCaptures: captures
      })
    ]);
    expect(model.rules[0]!.captures).toEqual(captures);
  });

  it("treats a missing decoration as no captures", () => {
    const model = projectLayoutLeaf([
      layoutRow("grid-page", "grid.page", { columns: "12" })
    ]);
    expect(model.rules[0]!.captures).toEqual([]);
  });
});

/* --------------------------------- headline --------------------------------- */

describe("projectLayoutLeaf headline", () => {
  it("prefers the rule's meaning, falling back to its name", () => {
    const model = projectLayoutLeaf([
      layoutRow("grid-page", "grid.page", { columns: "12" }, {
        meaning: "Page grid — 12 columns with 24px gutters"
      }),
      layoutRow("nav-mobile", "nav.mobile", { layout: "—" })
    ]);
    expect(model.rules[0]!.headline).toBe(
      "Page grid — 12 columns with 24px gutters"
    );
    expect(model.rules[0]!.concern).toBe("grid.page");
    expect(model.rules[1]!.headline).toBe("nav.mobile");
  });
});

/* ----------------------- v2: orientation + position mark ----------------------- */

describe("captureOrientation", () => {
  it("picks landscape for wide nodes, portrait for tall ones", () => {
    expect(
      captureOrientation(
        capture({ nodeRect: { x: 0, y: 0, width: 1, height: 0.05 } })
      )
    ).toBe("landscape");
    expect(
      captureOrientation(
        capture({ nodeRect: { x: 0, y: 0, width: 0.36, height: 1 } })
      )
    ).toBe("portrait");
  });

  it("defaults to landscape when no nodeRect is declared", () => {
    expect(captureOrientation(capture())).toBe("landscape");
  });
});

describe("captureNodeMark", () => {
  it("returns the rect for a node that occupies part of the capture", () => {
    const rect = { x: 0, y: 0.02, width: 1, height: 0.06 };
    expect(captureNodeMark(capture({ nodeRect: rect }))).toEqual(rect);
  });

  it("returns null when no nodeRect is declared", () => {
    expect(captureNodeMark(capture())).toBeNull();
  });

  it("returns null when the node nearly fills the capture (mark would be noise)", () => {
    expect(
      captureNodeMark(
        capture({ nodeRect: { x: 0.02, y: 0.02, width: 0.95, height: 0.93 } })
      )
    ).toBeNull();
    // Boundary: 0.85 area is still "nearly fills".
    expect(
      captureNodeMark(
        capture({ nodeRect: { x: 0, y: 0, width: 1, height: 0.85 } })
      )
    ).toBeNull();
    // Just under the threshold keeps the mark.
    expect(
      captureNodeMark(
        capture({ nodeRect: { x: 0, y: 0, width: 1, height: 0.84 } })
      )
    ).not.toBeNull();
  });
});
