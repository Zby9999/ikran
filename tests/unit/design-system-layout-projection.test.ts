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

function entry(partial: Partial<DesignSystemEntryView>): DesignSystemEntryView {
  return {
    id: `uuid-${partial.entry_id ?? "e"}`,
    entry_id: "e1",
    file_kind: "layout-rules.json",
    section: "layout",
    name: null,
    value: "",
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

describe("projectLayoutLeaf prose", () => {
  it("keeps the meaning title and prose body verbatim", () => {
    const body = "Keep the reading column narrow.\nBreak media out deliberately.";
    const model = projectLayoutLeaf([
      layoutRow("editorial-column", null, body, { meaning: "Editorial column" })
    ]);
    expect(model.rules[0]).toMatchObject({ headline: "Editorial column", body });
  });

  it("degrades a legacy object to readable lines without raw JSON", () => {
    const model = projectLayoutLeaf([
      layoutRow(
        "grid-page",
        "grid.page",
        { columns: 12, responsiveBehavior: ["Collapse below 720px"] },
        { meaning: "Page grid" }
      )
    ]);
    expect(model.rules[0]!.body).toBe(
      "columns: 12\nresponsiveBehavior:\n  • Collapse below 720px"
    );
    expect(model.rules[0]!.body).not.toContain("{");
  });
});

describe("projectLayoutLeaf captures", () => {
  it("keeps source order and carries captures per rule", () => {
    const model = projectLayoutLeaf([
      layoutRow("grid-page", "grid.page", "Use twelve columns."),
      layoutRow("nav-mobile", "nav.mobile", "Open gap.", {
        status: "gap",
        layoutCaptures: [capture()]
      }),
      layoutRow("bp", "breakpoints", "Use evidence-backed breakpoints.")
    ]);
    expect(model.rules.map((rule) => rule.row.entryId)).toEqual([
      "grid-page",
      "nav-mobile",
      "bp"
    ]);
    expect(model.rules.map((rule) => rule.captures.length)).toEqual([0, 1, 0]);
  });

  it("passes decorated captures through verbatim", () => {
    const captures = [
      capture({ nodeName: "Hero", stale: true, surfaceId: "surface-1" }),
      capture({ nodeName: "Grid", nodeId: "1:99" })
    ];
    const model = projectLayoutLeaf([
      layoutRow("grid-page", "grid.page", "Use the observed grid.", {
        layoutCaptures: captures
      })
    ]);
    expect(model.rules[0]!.captures).toEqual(captures);
  });
});

describe("projectLayoutLeaf headline", () => {
  it("prefers meaning and falls back to the source identity", () => {
    const model = projectLayoutLeaf([
      layoutRow("grid-page", "grid.page", "Body", { meaning: "Page grid" }),
      layoutRow("nav-mobile", "nav.mobile", "Body")
    ]);
    expect(model.rules[0]!.headline).toBe("Page grid");
    expect(model.rules[0]!.concern).toBe("grid.page");
    expect(model.rules[1]!.headline).toBe("nav.mobile");
  });
});

describe("captureOrientation", () => {
  it("picks landscape for wide nodes, portrait for tall ones", () => {
    expect(
      captureOrientation(capture({ nodeRect: { x: 0, y: 0, width: 1, height: 0.05 } }))
    ).toBe("landscape");
    expect(
      captureOrientation(capture({ nodeRect: { x: 0, y: 0, width: 0.36, height: 1 } }))
    ).toBe("portrait");
  });

  it("defaults to landscape without nodeRect", () => {
    expect(captureOrientation(capture())).toBe("landscape");
  });
});

describe("captureNodeMark", () => {
  it("returns a partial-node rect", () => {
    const rect = { x: 0, y: 0.02, width: 1, height: 0.06 };
    expect(captureNodeMark(capture({ nodeRect: rect }))).toEqual(rect);
  });

  it("omits absent and nearly full marks", () => {
    expect(captureNodeMark(capture())).toBeNull();
    expect(
      captureNodeMark(
        capture({ nodeRect: { x: 0.02, y: 0.02, width: 0.95, height: 0.93 } })
      )
    ).toBeNull();
    expect(
      captureNodeMark(capture({ nodeRect: { x: 0, y: 0, width: 1, height: 0.84 } }))
    ).not.toBeNull();
  });
});
