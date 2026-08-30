import { expect, test } from "vitest";

import { studyKitStartHere } from "../../scripts/release/study-kit-start-here.mjs";

test("participant instructions make the Agent own exact installation and both MCP preflights", () => {
  const markdown = studyKitStartHere("ikran-study-kit-1", [
    {
      id: "kit-1",
      workspaceNumber: 1,
      displayName: "Workspace 1",
      path: "workspace-1",
      frame: { fileKey: "file-1", nodeId: "12:34", name: "Seed" }
    }
  ]);

  expect(markdown).toContain("You own the complete setup");
  expect(markdown).toContain("Do not ask the participant to copy a path");
  expect(markdown).toContain("Step 1 — install this exact bundled plugin");
  expect(markdown).toContain("ikran@ikran-study-kit");
  expect(markdown).toContain("Workspace 1");
  expect(markdown).toContain("workspace-1");
  expect(markdown).toContain("fileKey `file-1`, nodeId `12:34`");
  expect(markdown).toContain("Step 2 — create the study task yourself");
  expect(markdown).toContain("standalone, user-visible Codex task");
  expect(markdown).toContain("`create_thread`");
  expect(markdown).toContain("Do not use `spawn_agent`, a subagent, or `fork_thread`");
  expect(markdown).toContain("absolute `MANIFEST_PATH`");
  expect(markdown).toContain("distinct `threadId`");
  expect(markdown).toContain("`navigate_to_codex_page`");
  expect(markdown).toContain("STUDY_SETUP_BLOCKED_TASK_CREATION");
  expect(markdown).toContain("Step 3 — verify native Ikran MCP");
  expect(markdown).toContain("`activate_study_workspace`");
  expect(markdown).toContain("`manifestPath`");
  expect(markdown).toContain("`workspaceId`");
  expect(markdown).toContain("`list_working_folders`");
  expect(markdown).toContain("`open_workbench`");
  expect(markdown).toContain("STUDY_SETUP_BLOCKED_IKRAN_MCP");
  expect(markdown).toContain("Step 4 — verify the host-native Figma MCP");
  expect(markdown).toContain("Tool presence alone is not sufficient");
  expect(markdown).toContain("STUDY_SETUP_BLOCKED_FIGMA_MCP");
  expect(markdown).toContain("Never request credentials through Ikran");
  expect(markdown).toContain("Step 5 — present the Workbench");
  expect(markdown).toContain("use Draft revision tools");
  expect(markdown).toContain("do not abandon the project phase or return to Seed");
});
