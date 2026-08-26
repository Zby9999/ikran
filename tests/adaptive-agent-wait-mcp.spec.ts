import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { expect, test } from "./fixtures";
import { recordEvidencePackage } from "../lib/runtime/evidence-package";
import { setDesignLanguageDescription } from "../lib/runtime/project-readiness";
import { registerSeedReference } from "../lib/runtime/seed-reference";
import { killRecordedRuntime, sc, spawnMcpClient } from "./helpers/mcp";
import { enterCanvas } from "./helpers/workbench";

test("07C one-process Workbench presence wakes the MCP command waiter", async ({ page }) => {
  test.setTimeout(90_000);
  const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-wait-mcp-"));
  const projectDir = mkdtempSync(path.join(tmpdir(), "ikran-wait-project-"));
  let client: Client | null = null;
  try {
    const handle = await spawnMcpClient(stateDir);
    client = handle.client;
    expect((await client.listTools()).tools.map((tool) => tool.name))
      .toContain("wait_for_agent_command");
    const opened = sc(await client.callTool({
      name: "create_or_open_project",
      arguments: { path: projectDir }
    }));
    const workbenchUrl = String(opened.workbench_url);

    const seed = registerSeedReference(projectDir, {
      figmaSeedReference: "https://www.figma.com/design/WaitCmd/Mock?node-id=1:2",
      originalDesignIntent: "Adaptive waiter"
    });
    expect(seed.ok).toBe(true);
    if (!seed.ok) return;
    const evidence = recordEvidencePackage(projectDir, {
      seedReferenceId: seed.record.id,
      frame: { nodeId: "1:2", name: "Mock" },
      evidenceViews: { rawData: "available", screenshot: "missing" }
    });
    expect(evidence.ok).toBe(true);
    expect(setDesignLanguageDescription(projectDir, "Adaptive wait intent").ok)
      .toBe(true);

    const presenceBodies: Array<Record<string, unknown>> = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/workbench-presence")) {
        presenceBodies.push(request.postDataJSON() as Record<string, unknown>);
      }
    });
    await page.goto(workbenchUrl);
    await enterCanvas(page);
    await expect(page.getByTestId("sign-seed-next-phase")).toBeEnabled();

    const waiting = client.callTool(
      { name: "wait_for_agent_command", arguments: {} },
      undefined,
      { timeout: 20_000 }
    );
    await page.getByRole("button", { name: "Select (V)" }).click();
    await expect.poll(() => presenceBodies.some((body) =>
      body.visible === true &&
      body.focused === true &&
      body.recentInteraction === true
    )).toBe(true);

    await page.getByTestId("sign-seed-next-phase").click();
    const result = sc(await waiting);
    expect(result).toMatchObject({
      ok: true,
      reason: "command_available",
      command: { command_type: "prepare_design_intent_alignment" }
    });
    await expect(page.getByTestId("seed-workbench")).toHaveAttribute(
      "data-alignment-workflow-stage",
      "alignment-preparing"
    );

    const recovered = sc(await client.callTool(
      { name: "wait_for_agent_command", arguments: {} },
      undefined,
      { timeout: 5_000 }
    ));
    expect(recovered).toMatchObject({
      reason: "command_available",
      command: { id: (result.command as { id: string }).id }
    });
  } finally {
    try { await client?.close(); } catch { /* cleanup */ }
    killRecordedRuntime(stateDir);
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  }
});
