// Playwright workers must not dynamically import lib/runtime/*.mjs.
// Full-suite runs can fail with ESM named-export errors against adjacent
// .d.mts (reproduced: fileLockPath from file-lock.mjs via runtime-endpoint.mjs).
// Pure Runtime checks belong in Vitest (tests/unit).

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const TESTS = path.join(ROOT, "tests");

function walkSpecFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "unit" || name === "helpers" || name === "node_modules") continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkSpecFiles(full, out);
    else if (name.endsWith(".spec.ts")) out.push(full);
  }
  return out;
}

const RUNTIME_MJS_IMPORT =
  /import\s*\(\s*['"][^'"]*lib\/runtime\/[^'"]+\.mjs['"]\s*\)/;

describe("architecture — Playwright specs avoid Runtime .mjs dynamic import", () => {
  test("no *.spec.ts dynamically imports lib/runtime/*.mjs", () => {
    const offenders: string[] = [];
    for (const file of walkSpecFiles(TESTS)) {
      const src = readFileSync(file, "utf-8");
      if (RUNTIME_MJS_IMPORT.test(src)) {
        offenders.push(path.relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
