import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import {
  ALIGNMENT_STAGES,
  AlignmentStagePanel,
  getAlignmentCoverage
} from "../../components/workbench/alignment-stage-panel";

describe("AlignmentStagePanel", () => {
  test("projects the fixed six-part gate and enables Complete only with full coverage", () => {
    expect(ALIGNMENT_STAGES.map((stage) => stage.label)).toEqual([
      "Design principle",
      "Visual language",
      "Token",
      "Layout",
      "Component",
      "Interaction"
    ]);

    const coverage = getAlignmentCoverage({
      "design-principle": [true, true],
      "visual-language": [true],
      token: [true],
      layout: [true],
      component: [true],
      interaction: [false]
    });

    const html = renderToStaticMarkup(
      createElement(AlignmentStagePanel, {
        currentStage: "design-principle",
        coverage,
        onStageChange: vi.fn(),
        onComplete: vi.fn()
      })
    );

    expect(coverage["design-principle"]).toBe(true);
    expect(coverage.interaction).toBe(false);
    expect(html).toContain('data-stage-count="6"');
    expect(html).toContain('data-current-stage="design-principle"');
    expect(html).toContain('data-default-view="current"');
    expect(html).toContain('data-complete="true"');
    expect(html).toContain('data-stage="interaction"');
    expect(html).toContain("Complete");
    expect(html).toContain("disabled");
    expect(html).toContain("<svg");
    expect(html).not.toContain(">✓<");
  });

  test("marks every covered stage and exposes an enabled global Complete action", () => {
    const coverage = getAlignmentCoverage(
      Object.fromEntries(ALIGNMENT_STAGES.map(({ id }) => [id, [true]]))
    );
    const html = renderToStaticMarkup(
      createElement(AlignmentStagePanel, {
        currentStage: "interaction",
        coverage,
        onStageChange: vi.fn(),
        onComplete: vi.fn()
      })
    );

    expect(Object.values(coverage).every(Boolean)).toBe(true);
    expect(html).toContain('aria-label="Complete alignment"');
    expect(html).not.toMatch(/aria-label="Complete alignment"[^>]*disabled/);
  });

  test("keeps completed alignment reviewable without allowing Complete twice", () => {
    const coverage = getAlignmentCoverage(
      Object.fromEntries(ALIGNMENT_STAGES.map(({ id }) => [id, [true]]))
    );
    const html = renderToStaticMarkup(
      createElement(AlignmentStagePanel, {
        currentStage: "layout",
        coverage,
        completed: true,
        onStageChange: vi.fn(),
        onComplete: vi.fn()
      })
    );

    expect(html).toContain("Completed");
    expect(html).toMatch(/aria-label="Complete alignment"[^>]*disabled/);
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
import { readFileSync } from "node:fs";
