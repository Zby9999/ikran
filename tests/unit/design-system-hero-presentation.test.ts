import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "vitest";

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(
    new RegExp(`${escaped}\\s*\\{(?<declarations>[^}]*)\\}`)
  );
  return match?.groups?.declarations ?? "";
}

test("component hero source capture keeps locator ratio instead of stretching with the sheet", () => {
  const css = readFileSync(
    path.join(
      process.cwd(),
      "components/workbench/design-system-browser.css"
    ),
    "utf8"
  );
  const heroFigure = ruleBody(css, ".dsb-hero-figure");
  expect(heroFigure.length).toBeGreaterThan(0);

  // Locator crops are object-fit: fill inside a 3:2 / 2:3 figure. A full-width
  // figure plus max-height makes both axes definite, so aspect-ratio is
  // dropped and the screenshot stretches with the Browser sheet.
  expect(/^\s*width:\s*100%/m.test(heroFigure)).toBe(false);
  expect(heroFigure).toMatch(/max-width:\s*100%/);
  expect(heroFigure).toMatch(/max-height:\s*420px/);
  expect(heroFigure).toMatch(/aspect-ratio:/);

  const landscapeHero = ruleBody(
    css,
    ".dsb-hero-figure[data-orientation=\"landscape\"]"
  );
  const portraitHero = ruleBody(
    css,
    ".dsb-hero-figure[data-orientation=\"portrait\"]"
  );
  expect(landscapeHero).toMatch(/3\s*\/\s*2/);
  expect(portraitHero).toMatch(/2\s*\/\s*3/);
  expect(portraitHero).not.toMatch(/height:\s*480px/);
});
