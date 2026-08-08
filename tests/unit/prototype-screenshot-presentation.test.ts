import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "vitest";

test("the screenshot bitmap scales by width like the live iframe", () => {
  const css = readFileSync(
    path.join(
      process.cwd(),
      "components/workbench/seed-evidence-workbench.css"
    ),
    "utf8"
  );
  const rule = css.match(
    /\.prototype-surface-frame__screenshot\s*\{(?<declarations>[^}]*)\}/
  )?.groups?.declarations;

  expect(rule).toBeDefined();
  expect(rule).toMatch(/width:\s*100%/);
  expect(rule).toMatch(/height:\s*auto/);
  expect(rule).not.toMatch(/object-fit:\s*cover/);
});
