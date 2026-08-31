import { expect, test } from "vitest";

import { studyKitStartHere } from "../../scripts/release/study-kit-start-here.mjs";

test("participant instructions restart Codex, create an exact Project task, and continue Alignment", () => {
  const markdown = studyKitStartHere("ikran-study-kit-1-codex-0.1.0-alpha.27", [
    {
      id: "kit-1",
      workspaceNumber: 1,
      displayName: "Workspace 1",
      path: "workspace-1",
      frame: { fileKey: "file-1", nodeId: "12:34", name: "Seed" }
    }
  ]);

  expect(markdown).toContain("You own the complete setup");
  expect(markdown).toContain("fully quit and reopen Codex Desktop");
  expect(markdown).toContain("asks to continue the Ikran setup");
  expect(markdown).toContain("any clear equivalent wording, capitalization, and punctuation");
  expect(markdown).not.toContain("send only");
  expect(markdown).not.toContain("sends exactly");

  expect(markdown).toContain("Step 1 — install this exact bundled plugin");
  expect(markdown).toContain("ikran@ikran-study-kit");
  expect(markdown).toContain("Step 2 — complete pre-restart checks, then stop");
  expect(markdown).toContain("Step 3 — resume after restart");
  expect(markdown).toContain("STUDY_SETUP_HOST_NOT_REFRESHED");

  expect(markdown).toContain("Step 4 — create the study task yourself");
  expect(markdown).toContain("absolute `WORKSPACE_ROOT`");
  expect(markdown).toContain("registered as a local Codex Project");
  expect(markdown).toContain("inside that Project");
  expect(markdown).toContain("Do not use a projectless task");
  expect(markdown).not.toContain("Use a local projectless task");
  expect(markdown).toContain("`create_thread`");
  expect(markdown).toContain("distinct `threadId`");
  expect(markdown).toContain("`navigate_to_codex_page`");
  expect(markdown).toContain("STUDY_SETUP_BLOCKED_TASK_CREATION");

  expect(markdown).toContain("Step 5 — verify native Ikran MCP in the new task");
  expect(markdown).toContain("`activate_study_workspace`");
  expect(markdown).toContain("`list_working_folders`");
  expect(markdown).toContain("`open_workbench`");
  expect(markdown).toContain("STUDY_SETUP_BLOCKED_IKRAN_MCP");

  expect(markdown).toContain("Step 6 — verify the host-native Figma MCP in the new task");
  expect(markdown.match(/Perform a real read-only metadata or design-context request/g)).toHaveLength(1);
  expect(markdown).toContain("STUDY_SETUP_BLOCKED_FIGMA_MCP");

  expect(markdown).toContain("Step 7 — present the Workbench");
  expect(markdown).toContain("continue the current Alignment in this same task using the native Ikran tools");
  expect(markdown).not.toContain("`nextAction`");

  expect(markdown).toContain("Workspace 1");
  expect(markdown).toContain("workspace-1");
  expect(markdown).toContain("fileKey `file-1`, nodeId `12:34`");
  expect(markdown).toContain("ikran-study-kit-1-codex-0.1.0-alpha.27");
  expect(markdown).not.toContain("<PATH_TO_");
});
