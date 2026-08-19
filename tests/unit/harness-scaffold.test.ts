import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { afterEach, expect, test } from "vitest";

import {
  IKRAN_COMPONENT_SIZING_HELPER_SOURCE,
  LIVE_HERO_CONTRACT,
  LIVE_HERO_CONTRACT_VERSION,
  scaffoldComponentHarness
} from "../../lib/runtime/harness-scaffold";

const dirs: string[] = [];

function projectDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "ikran-harness-scaffold-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

test("writes the canonical sizing helper at the declared path", () => {
  const dir = projectDir();
  const result = scaffoldComponentHarness(dir, {
    helperPath: "prototype/src/lib/ikran-component-harness.ts"
  });
  expect(result).toEqual({
    ok: true,
    helper_path: "prototype/src/lib/ikran-component-harness.ts",
    already_present: false,
    protocol_version: 2,
    live_hero_contract: LIVE_HERO_CONTRACT
  });
  expect(result.ok && result.live_hero_contract.version).toBe(
    LIVE_HERO_CONTRACT_VERSION
  );
  expect(LIVE_HERO_CONTRACT.layout).toContain("data-ikran-component-root");
  expect(LIVE_HERO_CONTRACT.sizing).toContain("ikran:component-size");
  expect(LIVE_HERO_CONTRACT.browser).toContain("presentation viewport");
  expect(LIVE_HERO_CONTRACT.nextjs_chrome).toContain("nextjs-portal");
  const written = readFileSync(
    path.join(dir, "prototype/src/lib/ikran-component-harness.ts"),
    "utf8"
  );
  expect(written).toBe(IKRAN_COMPONENT_SIZING_HELPER_SOURCE);
  // The helper speaks the exact v2 contract the Workbench validates.
  expect(written).toContain('type: "ikran:component-size"');
  expect(written).toContain("version: 2");
  expect(written).toContain("window.location.href");
});

test("is idempotent: an identical existing file reports already_present", () => {
  const dir = projectDir();
  const helperPath = "prototype/src/lib/ikran-component-harness.ts";
  scaffoldComponentHarness(dir, { helperPath });
  const result = scaffoldComponentHarness(dir, { helperPath });
  expect(result).toMatchObject({
    ok: true,
    already_present: true,
    live_hero_contract: LIVE_HERO_CONTRACT
  });
});

test("never clobbers a hand-edited file", () => {
  const dir = projectDir();
  const helperPath = "prototype/src/lib/ikran-component-harness.ts";
  const absolute = path.join(dir, helperPath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, "// hand-maintained variant\n", "utf8");
  const result = scaffoldComponentHarness(dir, { helperPath });
  expect(result).toEqual({
    ok: false,
    reason: "helper_file_conflict",
    details: { path: helperPath }
  });
  expect(readFileSync(absolute, "utf8")).toBe("// hand-maintained variant\n");
});

test("rejects paths escaping the project", () => {
  const dir = projectDir();
  expect(
    scaffoldComponentHarness(dir, { helperPath: "../outside.ts" })
  ).toMatchObject({ ok: false, reason: "artifact_path_escape" });
  expect(
    scaffoldComponentHarness(dir, { helperPath: "/absolute/helper.ts" })
  ).toMatchObject({ ok: false, reason: "artifact_path_escape" });
});

test("rejects an empty helper path", () => {
  const dir = projectDir();
  expect(scaffoldComponentHarness(dir, { helperPath: "  " })).toEqual({
    ok: false,
    reason: "invalid_input"
  });
});
