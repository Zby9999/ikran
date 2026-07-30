import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function cssRule(css: string, selector: string): string {
  const start = css.indexOf(selector);
  expect(start, `Missing CSS selector: ${selector}`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

describe("Workbench motion contract", () => {
  test("defines the exact shared motion curves and aliases DSB to them", () => {
    const globals = source("app/globals.css");
    const dsb = source("components/workbench/design-system-browser.css");

    expect(globals).toContain(
      "--motion-ease-out: cubic-bezier(0.23, 1, 0.32, 1)"
    );
    expect(globals).toContain(
      "--motion-ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)"
    );
    expect(globals).toContain(
      "--motion-ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)"
    );
    expect(dsb).toContain("--dsc-ease: var(--motion-ease-out)");
    expect(dsb).toContain("--dsc-drawer-ease: var(--motion-ease-drawer)");
  });

  test("keeps F/V mode state immediate while retaining transform press feedback", () => {
    const css = source("components/workbench/seed-evidence-workbench.css");
    const rule = cssRule(css, ".small-icon-button {");

    expect(rule).toContain(
      "transition: transform 150ms var(--motion-ease-out)"
    );
    const transition = rule.match(/transition:\s*([^;]+);/)?.[1] ?? "";
    expect(transition).not.toMatch(/\bbackground\b/);
    expect(transition).not.toMatch(/\bborder-color\b/);
    expect(transition).not.toMatch(/\bcolor\b/);
  });

  test("does not use transition-all in shared button primitives", () => {
    const shared = source("components/ui/button.tsx");
    const workbench = source("components/workbench/button.tsx");

    expect(shared).not.toContain("transition-all");
    expect(workbench).not.toContain("transition-all");
    expect(shared).toContain(
      "transition-[color,background-color,border-color,box-shadow,opacity,transform]"
    );
    expect(workbench).toContain(
      "transition-[color,background-color,border-color,box-shadow,opacity,transform]"
    );
  });

  test("does not animate Alignment layout properties or the stage-panel width", () => {
    const css = source("components/workbench/alignment-ui.module.css");
    const stage = cssRule(css, ".stagePanel {");
    const question = cssRule(css, ".questionCard {");
    const answer = cssRule(css, ".answerRegion {");
    const annotation = cssRule(css, ".annotationCard {");

    expect(stage).not.toContain("transition:");
    expect(question).not.toMatch(/transition:[^;]*(?:width|height)/s);
    expect(answer).not.toMatch(/transition:[^;]*grid-template-rows/s);
    expect(annotation).not.toMatch(/transition:[^;]*(?:width|height)/s);
  });

  test("covers Alignment movement and Workbench spinners under Reduced Motion", () => {
    const alignment = source("components/workbench/alignment-ui.module.css");
    const workbench = source("components/workbench/seed-evidence-workbench.css");

    expect(alignment).toContain("@media (prefers-reduced-motion: reduce)");
    expect(alignment).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.answerRegion[\s\S]*opacity 150ms var\(--motion-ease-out\)/
    );
    expect(workbench).toContain("@keyframes workbench-loading-pulse");
    expect(workbench).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.small-icon-button__spinner[\s\S]*\.seed-ref-frame__refresh-spinner[\s\S]*\.seed-ref-frame__awaiting-spinner[\s\S]*workbench-loading-pulse/
    );
  });

  test("contains no standalone ease-in UI easing", () => {
    const files = [
      "components/workbench/seed-evidence-workbench.css",
      "components/workbench/design-system-browser.css",
      "components/workbench/alignment-ui.module.css",
      "components/workbench/focus-target-mask.css"
    ];

    for (const file of files) {
      const cssWithoutComments = source(file).replace(/\/\*[\s\S]*?\*\//g, "");
      expect(cssWithoutComments, file).not.toMatch(/\bease-in(?!-out)\b/);
    }
  });
});
