import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

describe("Design System Browser specimen fonts", () => {
  test("self-hosts every Instrument Sans weight used by typography specimens", () => {
    const layout = readFileSync(path.join(ROOT, "app/layout.tsx"), "utf8");

    for (const weight of [400, 500, 600, 700]) {
      expect(layout).toContain(
        `import "@fontsource/instrument-sans/${weight}.css";`
      );
    }
  });

  test("declares the licensed self-hosted font package", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(ROOT, "package.json"), "utf8")
    ) as { dependencies?: Record<string, string> };

    expect(pkg.dependencies?.["@fontsource/instrument-sans"]).toBe("^5.3.0");
  });
});
