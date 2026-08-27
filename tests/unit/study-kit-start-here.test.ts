import { expect, test } from "vitest";

import { studyKitStartHere } from "../../scripts/release/study-kit-start-here.mjs";

test("participant instructions require a native Ikran MCP preflight before project work", () => {
  const markdown = studyKitStartHere("ikran-study-kit-1", [
    { id: "study-1", path: "workspace" }
  ]);

  expect(markdown).toContain("Step 0 — verify the native Ikran MCP connection");
  expect(markdown).toContain("`list_working_folders`");
  expect(markdown).toContain("`open_workbench`");
  expect(markdown).toContain("If either Ikran MCP tool is unavailable");
  expect(markdown).toContain("stop and report the connection failure");
  expect(markdown).toContain("Do not create an ad-hoc MCP client");
  expect(markdown).toContain("Before reading project state or continuing Alignment");
});
