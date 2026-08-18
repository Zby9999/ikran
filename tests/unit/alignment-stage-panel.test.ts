import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import {
  ALIGNMENT_STAGES,
  DEFAULT_ALIGNMENT_STAGE,
  AlignmentStagePanel,
  getAlignmentCoverage,
  getAlignmentQuestionProgress,
  getAlignmentQuestionSegments
} from "../../components/workbench/alignment-stage-panel";

describe("AlignmentStagePanel", () => {
  test("starts extraction from the first Figma stage", () => {
    expect(DEFAULT_ALIGNMENT_STAGE).toBe("design-concept");
  });

  test("derives current-section and overall completed question counts", () => {
    expect(
      getAlignmentQuestionProgress(
        {
          sections: [
            {
              section: "token",
              question_count: 5,
              covered_count: 3,
              complete: false
            },
            {
              section: "layout",
              question_count: 4,
              covered_count: 4,
              complete: true
            }
          ],
          total_questions: 9,
          can_complete: false
        },
        "token"
      )
    ).toEqual({
      stageCompleted: 3,
      stageTotal: 5,
      overallCompleted: 7,
      overallTotal: 9
    });
  });

  test("orders Extraction segments by section, not answer chronology", () => {
    const segments = getAlignmentQuestionSegments([
      {
        id: "later-interaction",
        section: "interaction",
        final_answer: "done"
      },
      {
        id: "first-principle",
        section: "design-concept",
        final_answer: "done"
      },
      {
        id: "open-visual",
        section: "visual-language",
        final_answer: null
      },
      {
        id: "blank-principle",
        section: "design-concept",
        final_answer: "   "
      }
    ]);

    expect(segments.map((segment) => segment.id)).toEqual([
      "first-principle",
      "blank-principle",
      "open-visual",
      "later-interaction"
    ]);
    expect(segments.map((segment) => segment.answered)).toEqual([
      true,
      false,
      false,
      true
    ]);
    expect(segments[0]?.color).toBe("#e78460");
    expect(segments[3]?.color).toBe("#c1d03c");
  });

  test("projects the fixed six-part gate and enables Complete only with full coverage", () => {
    expect(ALIGNMENT_STAGES.map((stage) => stage.label)).toEqual([
      "Design Concept",
      "Visual language",
      "Token",
      "Layout",
      "Component",
      "Interaction"
    ]);

    const coverage = getAlignmentCoverage({
      "design-concept": [true, true],
      "visual-language": [true],
      token: [true],
      layout: [true],
      component: [true],
      interaction: [false]
    });

    const html = renderToStaticMarkup(
      createElement(AlignmentStagePanel, {
        currentStage: "design-concept",
        coverage,
        onStageChange: vi.fn()
      })
    );

    expect(coverage["design-concept"]).toBe(true);
    expect(coverage.interaction).toBe(false);
    expect(html).toContain('data-stage-count="6"');
    expect(html).toContain('data-current-stage="design-concept"');
    expect(html).toContain('data-default-view="current"');
    expect(html).toContain('data-complete="true"');
    expect(html).toContain('data-stage="interaction"');
    expect(html).toContain("<svg");
    expect(html).not.toContain(">✓<");
    expect(html).not.toContain('aria-label="Complete alignment"');
  });

  test("does not keep a Complete action in the stage panel", () => {
    const coverage = getAlignmentCoverage(
      Object.fromEntries(ALIGNMENT_STAGES.map(({ id }) => [id, [true]]))
    );
    const html = renderToStaticMarkup(
      createElement(AlignmentStagePanel, {
        currentStage: "interaction",
        coverage,
        onStageChange: vi.fn()
      })
    );

    expect(Object.values(coverage).every(Boolean)).toBe(true);
    expect(html).not.toContain('aria-label="Complete alignment"');
    expect(html).not.toContain("Complete");
  });

  test("is only the 180x32 current pill until hover or keyboard focus expands chrome", () => {
    const css = readFileSync(
      new URL("../../components/workbench/alignment-ui.module.css", import.meta.url),
      "utf8"
    );

    expect(css).toMatch(
      /\.stagePanel\s*{[^}]*width:\s*180px[^}]*padding:\s*0[^}]*border:\s*0[^}]*background:\s*transparent[^}]*box-shadow:\s*none/s
    );
    expect(css).toMatch(
      /\.stagePanel:hover\s*,\s*\.stagePanel:focus-within\s*{[^}]*width:\s*188px[^}]*padding:\s*4px[^}]*background:\s*#f1f1f1[^}]*box-shadow:\s*inset 0 0 0 1px #fff/s
    );
  });
});
