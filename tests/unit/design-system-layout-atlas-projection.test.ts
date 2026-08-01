import { describe, expect, it } from "vitest";

import type { DesignSystemEntryView } from "@/lib/runtime/design-system-view";
import { projectLayoutAtlasCards } from "@/components/workbench/design-system-layout-atlas-projection";
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

/* --------------------------- badge extraction --------------------------- */

describe("projectLayoutAtlasCards badges", () => {
  it("turns scalar structured keys into badges, skipping rich + Q&A keys", () => {
    // The rewritten ikran test 7 shape (09C-B02).
    const cards = projectLayoutAtlasCards([
      layoutRow("layout.horizontalProjectGallery", null, {
        gap: "20px",
        imageSize: "461.25 × 446px",
        relationship: ["项目图片组成横向溢出画廊。"],
        responsiveBehavior: [],
        tokenLinks: ["semantic.color.canvas"],
        acceptanceChecks: ["保持横向溢出浏览。", "首屏保留右侧裁切。"],
        openQuestions: ["窄屏是否必须支持触控横向滚动？"],
        openQuestionAnswers: [{ question: "q", answer: "a" }]
      })
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.badges).toEqual([
      { key: "gap", label: "20px" },
      { key: "imageSize", label: "461.25 × 446px" }
    ]);
    // Rich fields, openQuestions and openQuestionAnswers never become badges.
    const keys = cards[0]!.badges.map((b) => b.key);
    expect(keys).not.toContain("relationship");
    expect(keys).not.toContain("tokenLinks");
    expect(keys).not.toContain("acceptanceChecks");
    expect(keys).not.toContain("openQuestions");
    expect(keys).not.toContain("openQuestionAnswers");
  });

  it("joins string-array facts and renders aliases verbatim", () => {
    const cards = projectLayoutAtlasCards([
      layoutRow("layout.stickyTopBar", null, {
        regions: ["navigation", "content"],
        height: "46px",
        gutter: { alias: "spacing.200" }
      })
    ]);
    expect(cards[0]!.badges).toEqual([
      { key: "regions", label: "navigation · content" },
      { key: "height", label: "46px" },
      { key: "gutter", label: "→ spacing.200" }
    ]);
  });
});

/* ------------------------- questions and answers ------------------------- */

describe("projectLayoutAtlasCards questions", () => {
  it("parses openQuestions and openQuestionAnswers, tolerating malformed entries", () => {
    const cards = projectLayoutAtlasCards([
      layoutRow("layout.pageNarrative", null, {
        regions: ["navigation", "footer"],
        openQuestions: ["问题一？", "问题二？", 42],
        openQuestionAnswers: [
          { question: "旧问题？", answer: "设计师的回答" },
          { question: "missing answer" },
          "not-an-object"
        ]
      })
    ]);
    expect(cards[0]!.openQuestions).toEqual(["问题一？", "问题二？"]);
    expect(cards[0]!.answeredQuestions).toEqual([
      { question: "旧问题？", answer: "设计师的回答" }
    ]);
  });

  it("defaults to empty lists when the entry declares neither", () => {
    const cards = projectLayoutAtlasCards([
      layoutRow("layout.statsDualColumn", null, { columns: "2" })
    ]);
    expect(cards[0]!.openQuestions).toEqual([]);
    expect(cards[0]!.answeredQuestions).toEqual([]);
  });
});

/* ------------------------- rich fields + schematic ------------------------- */

describe("projectLayoutAtlasCards rich fields and schematic", () => {
  it("keeps relationship/responsive/checks/tokenLinks as collapsed detail lines", () => {
    const cards = projectLayoutAtlasCards([
      layoutRow("layout.statsDualColumn", null, {
        columns: "2",
        relationship: ["左侧放短文案，右侧竖排关键数据。"],
        responsiveBehavior: ["小屏改为上下堆叠。"],
        acceptanceChecks: ["桌面保持清晰的双栏层级。"],
        tokenLinks: ["semantic.color.ink"]
      })
    ]);
    expect(cards[0]!.constraintLines).toEqual(["左侧放短文案，右侧竖排关键数据。"]);
    expect(cards[0]!.responsiveLines).toEqual(["小屏改为上下堆叠。"]);
    expect(cards[0]!.acceptanceChecks).toEqual(["桌面保持清晰的双栏层级。"]);
    expect(cards[0]!.tokenLinks).toEqual(["semantic.color.ink"]);
  });

  it("reuses the blueprint spatial facts per rule (gutter recognized from gap)", () => {
    const cards = projectLayoutAtlasCards([
      layoutRow("layout.horizontalProjectGallery", null, { gap: "20px" })
    ]);
    expect(cards[0]!.drawable).toBe(true);
    expect(cards[0]!.schematicFacts.some((f) => f.kind === "gutter")).toBe(true);
  });

  it("marks rules without spatial values as not drawable instead of failing", () => {
    const cards = projectLayoutAtlasCards([
      layoutRow("layout.pageNarrative", null, {
        relationship: ["主要区块之间保留大幅纵向留白。"]
      })
    ]);
    expect(cards[0]!.drawable).toBe(false);
    expect(cards[0]!.schematicFacts).toEqual([]);
  });

  it("never throws on non-object values", () => {
    const cards = projectLayoutAtlasCards([
      layoutRow("layout.legacy", null, "a plain string value")
    ]);
    expect(cards[0]!.badges).toEqual([]);
    expect(cards[0]!.drawable).toBe(false);
    expect(cards[0]!.openQuestions).toEqual([]);
  });
});

/* ------------------------------ identity/order ---------------------------- */

describe("projectLayoutAtlasCards identity", () => {
  it("strips the layout. prefix for the display name and keeps source order + anchors", () => {
    const cards = projectLayoutAtlasCards([
      layoutRow("layout.first", null, { gap: "8px" }, { meaning: "一" }),
      layoutRow("layout.second", null, { gap: "9px" }, { meaning: "二" })
    ]);
    expect(cards.map((c) => c.name)).toEqual(["first", "second"]);
    expect(cards.map((c) => c.anchor)).toEqual([1, 2]);
    expect(cards[0]!.meaning).toBe("一");
    expect(cards[0]!.row.entryId).toBe("layout.first");
  });
});
