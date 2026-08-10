import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, expect, test, vi } from "vitest";

const activeFixture = vi.hoisted(() => ({ projectPath: "" }));

vi.mock("../../lib/runtime/commands", async () => {
  const actual = await vi.importActual<
    typeof import("../../lib/runtime/commands")
  >("../../lib/runtime/commands");
  const project = () => ({
    path: activeFixture.projectPath,
    name: "wait-gate-fixture",
    created_at: "2026-08-10T00:00:00.000Z",
    updated_at: "2026-08-10T00:00:00.000Z"
  });
  return {
    ...actual,
    requireActiveProjectCommand: () => ({ ok: true, project: project() }),
    getProjectStateCommand: async () => ({
      ok: true,
      project: project(),
      cwd_candidate: null,
      cwd_matches_active: true
    })
  };
});

import { registerDesignIntentAlignmentTools } from "../../lib/mcp/design-intent-alignment-tools";
import { registerProjectWorkspaceTools } from "../../lib/mcp/project-workspace-tools";
import {
  closeProjectDb,
  initializeProjectDb,
  openProjectDb
} from "../../lib/runtime/db";
import { registerSeedReference } from "../../lib/runtime/seed-reference";

type ToolHandler = (...args: any[]) => Promise<{
  content: Array<{ type: string; text: string }>;
  structuredContent: Record<string, unknown>;
}>;

const cleanup: string[] = [];

afterEach(() => {
  for (const projectPath of cleanup.splice(0)) {
    rmSync(projectPath, { recursive: true, force: true });
  }
  activeFixture.projectPath = "";
});

function createProjectAtStage(
  stage: "alignment-answering" | "initial-design-system-preparing"
): string {
  const projectPath = mkdtempSync(path.join(tmpdir(), "ikran-wait-gate-"));
  cleanup.push(projectPath);
  initializeProjectDb(projectPath);
  const seed = registerSeedReference(projectPath, {
    figmaSeedReference:
      "https://www.figma.com/design/WaitGate/Mock?node-id=1:2",
    originalDesignIntent: "Wait gate fixture"
  });
  if (!seed.ok) throw new Error(seed.reason);
  const db = openProjectDb(projectPath);
  try {
    db.prepare(
      `UPDATE project_workflow SET stage = ?, updated_at = ?
       WHERE singleton = 1`
    ).run(stage, "2026-08-10T00:00:00.000Z");
  } finally {
    closeProjectDb(db);
  }
  activeFixture.projectPath = projectPath;
  return projectPath;
}

function registeredHandlers(): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();
  const mcp = {
    registerTool(
      name: string,
      _definition: unknown,
      handler: ToolHandler
    ) {
      handlers.set(name, handler);
    }
  } as unknown as McpServer;
  const deps = {
    ensureRuntime: async () => ({
      host: "127.0.0.1",
      port: 3000,
      token: "wait-gate-token",
      url: "http://127.0.0.1:3000/?session=wait-gate-token",
      spawned: false
    }),
    discoverWorkingFolder: async () => ({
      folder: null,
      source: "none",
      roots: []
    }),
    host: "127.0.0.1",
    prod: false,
    mcpEntryPath: "/tmp/ikran-mcp.mjs"
  };
  registerProjectWorkspaceTools(mcp, deps);
  registerDesignIntentAlignmentTools(mcp, deps);
  return handlers;
}

test("project response re-arms wait during Alignment answering", async () => {
  createProjectAtStage("alignment-answering");
  const handler = registeredHandlers().get("create_or_open_project");
  if (!handler) throw new Error("create_or_open_project not registered");

  const response = await handler({});
  expect(response.structuredContent.next_action).toEqual({
    tool: "wait_for_agent_command"
  });
  expect(response.content[0].text).toContain(
    "Call `wait_for_agent_command` now"
  );
});

test("post-Alignment project response and direct wait both fail closed without a lease", async () => {
  createProjectAtStage("initial-design-system-preparing");
  const handlers = registeredHandlers();
  const openProject = handlers.get("create_or_open_project");
  const wait = handlers.get("wait_for_agent_command");
  if (!openProject || !wait) throw new Error("wait gate tools not registered");

  const projectResponse = await openProject({});
  expect(projectResponse.structuredContent.next_action).toBeUndefined();
  expect(projectResponse.content[0].text).toContain("No wait needed");

  const waitResponse = await wait({ signal: new AbortController().signal });
  expect(waitResponse.structuredContent).toMatchObject({
    ok: true,
    reason: "not_applicable",
    command: null,
    stage: "initial-design-system-preparing",
    not_applicable_reason: "outside_designer_handoff"
  });
});

test("direct wait reports state_unavailable instead of starting a lease", async () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "ikran-wait-bad-state-"));
  cleanup.push(fixtureRoot);
  const invalidProjectPath = path.join(fixtureRoot, "not-a-project-directory");
  writeFileSync(invalidProjectPath, "not a directory", "utf8");
  activeFixture.projectPath = invalidProjectPath;
  const wait = registeredHandlers().get("wait_for_agent_command");
  if (!wait) throw new Error("wait_for_agent_command not registered");

  const response = await wait({ signal: new AbortController().signal });
  expect(response.structuredContent).toMatchObject({
    ok: false,
    error: "state_unavailable",
    detail: "state_unavailable",
    details: { command: null }
  });
  expect(response.content[0].text).toContain(
    "wait_for_agent_command failed: state_unavailable"
  );
});
