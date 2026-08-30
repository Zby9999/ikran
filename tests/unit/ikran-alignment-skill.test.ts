import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

test("Alignment planning recovers missing inspectable Token facts from Figma", () => {
  const skill = readFileSync(
    path.join(process.cwd(), "skills", "ikran-alignment", "SKILL.md"),
    "utf8"
  );

  expect(skill).toMatch(
    /Before omitting, retiring, or downgrading an evidence-backed Color or Typography\s+item/
  );
  expect(skill).toContain("inspect the registered Seed Reference through the available Figma tools");
  expect(skill).toContain("Read only the relevant Seed node and at most once per planning turn");
  expect(skill).toContain("Do not infer semantic intent from implementation values");
  expect(skill).toContain("preserve the uncertainty as an explicit gap");
});
