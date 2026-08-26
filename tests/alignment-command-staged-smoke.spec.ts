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

const SECTIONS = [
  "design-concept",
  "visual-language",
  "token",
  "layout",
  "component",
  "interaction"
] as const;

test("07G staged one-process Agent command handoff survives abandon and restart", async ({
  page
}) => {
  test.setTimeout(180_000);
  const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-07g-state-"));
  const projectDir = mkdtempSync(path.join(tmpdir(), "ikran-07g-project-"));
  let client: Client | null = null;

  try {
    let handle = await spawnMcpClient(stateDir);
    client = handle.client;
    const opened = sc(await client.callTool({
      name: "create_or_open_project",
      arguments: { path: projectDir }
    }));
    const firstWorkbenchUrl = String(opened.workbench_url);

    const seed = registerSeedReference(projectDir, {
      figmaSeedReference:
        "https://www.figma.com/design/AlignmentSmoke/Fixture?node-id=1:2",
      originalDesignIntent: "07G staged real-Agent smoke fixture"
    });
    expect(seed.ok).toBe(true);
    if (!seed.ok) return;
    const evidence = recordEvidencePackage(projectDir, {
      seedReferenceId: seed.record.id,
      frame: { nodeId: "1:2", name: "Alignment smoke fixture" },
      evidenceViews: { rawData: "available", screenshot: "missing" }
    });
    expect(evidence.ok).toBe(true);
    if (!evidence.ok) return;
    expect(
      setDesignLanguageDescription(projectDir, "A calm, precise product language").ok
    ).toBe(true);

    await page.goto(firstWorkbenchUrl);
    await enterCanvas(page);
    const workbench = page.getByTestId("seed-workbench");
    await expect(workbench).toHaveAttribute(
      "data-alignment-workflow-stage",
      "seed-reference-registration"
    );
    await expect(page.getByTestId("sign-seed-next-phase")).toBeEnabled();

    // The Agent starts waiting before the designer crosses the Next phase boundary.
    const firstWait = client.callTool(
      { name: "wait_for_agent_command", arguments: {} },
      undefined,
      { timeout: 20_000 }
    );
    await page.getByRole("button", { name: "Select (V)" }).click();
    await page.getByTestId("sign-seed-next-phase").click();
    const firstCommand = sc(await firstWait);
    expect(firstCommand).toMatchObject({
      reason: "command_available",
      command: { command_type: "prepare_design_intent_alignment" }
    });
    const firstAttemptId = String(
      (firstCommand.command as { alignment_attempt_id: string })
        .alignment_attempt_id
    );
    expect(sc(await client.callTool({
      name: "claim_alignment_preparation",
      arguments: {}
    }))).toMatchObject({
      ok: true,
      attempt: { id: firstAttemptId, status: "preparing" }
    });

    const anchor = {
      kind: "single",
      target: {
        kind: "surface",
        seedReferenceId: seed.record.id,
        evidenceSurfaceId: evidence.record.id,
        evidenceVersionId: evidence.record.id
      }
    };
    expect(sc(await client.callTool({
      name: "create_agent_annotation",
      arguments: {
        alignmentAttemptId: firstAttemptId,
        idempotencyKey: "07g:abandoned:first:assumption",
        section: "design-concept",
        inference: "reasonable",
        title: "Initial Hypothesis",
        body: "The initial design concept appears intentional.",
        anchor
      }
    }))).toMatchObject({ ok: true });
    expect(sc(await client.callTool({
      name: "create_alignment_question_card",
      arguments: {
        alignmentAttemptId: firstAttemptId,
        idempotencyKey: "07g:abandoned:first",
        section: "design-concept",
        observation: "Initial concept",
        question: "Which concept should lead the system?",
        proposedAnswer: "Clarity before ornament",
        anchor
      }
    }))).toMatchObject({ ok: true });

    // Returning to Seed Reference invalidates the whole attempt and its questions.
    await page.getByRole("button", { name: "Back to Seed Reference" }).click();
    await expect(workbench).toHaveAttribute(
      "data-alignment-workflow-stage",
      "seed-reference-registration"
    );
    await page.getByTestId("sign-seed-next-phase").click();
    const secondCommand = sc(await client.callTool({
      name: "wait_for_agent_command",
      arguments: {}
    }));
    const secondAttemptId = String(
      (secondCommand.command as { alignment_attempt_id: string })
        .alignment_attempt_id
    );
    expect(secondAttemptId).not.toBe(firstAttemptId);
    expect(sc(await client.callTool({
      name: "create_alignment_question_card",
      arguments: {
        alignmentAttemptId: firstAttemptId,
        idempotencyKey: "07g:stale-write",
        section: "visual-language",
        observation: "Stale visual",
        question: "Can the abandoned attempt still write?",
        proposedAnswer: "It must not",
        anchor
      }
    }))).toMatchObject({ ok: false, error: "stale_alignment_attempt" });

    const claimed = sc(await client.callTool({
      name: "claim_alignment_preparation",
      arguments: {}
    }));
    expect(claimed).toMatchObject({
      ok: true,
      attempt: { id: secondAttemptId },
      input_snapshot: {
        data: {
          design_language_description: "A calm, precise product language",
          seed_references: [{ id: seed.record.id }]
        }
      }
    });

    const proposedCards: Array<{ id: string; answer: string }> = [];
    for (const section of SECTIONS) {
      expect(sc(await client.callTool({
        name: "create_agent_annotation",
        arguments: {
          alignmentAttemptId: secondAttemptId,
          idempotencyKey: `07g:${secondAttemptId}:${section}:assumption`,
          section,
          inference: "reasonable",
          title: "Section Hypothesis",
          body: `The current ${section} choices appear intentional.`,
          anchor
        }
      }))).toMatchObject({ ok: true });
      for (let index = 1; index <= 2; index += 1) {
        const proposedAnswer = `Proposal ${index} for ${section}`;
        const created = sc(await client.callTool({
          name: "create_alignment_question_card",
          arguments: {
            alignmentAttemptId: secondAttemptId,
            idempotencyKey: `07g:${secondAttemptId}:${section}:${index}`,
            section,
            observation: `${section} ${index}`,
            question: `Question ${index} for ${section}?`,
            proposedAnswer,
            anchor
          }
        }));
        expect(created).toMatchObject({ ok: true });
        proposedCards.push({
          id: String((created.record as { id: string }).id),
          answer: proposedAnswer
        });
      }
    }

    expect(sc(await client.callTool({
      name: "finalize_alignment_preparation",
      arguments: { alignmentAttemptId: secondAttemptId }
    }))).toMatchObject({
      ok: true,
      workflow: { stage: "alignment-answering" }
    });

    // No reload: this transition is projected through the live SSE connection.
    await expect(workbench).toHaveAttribute(
      "data-alignment-workflow-stage",
      "alignment-answering"
    );
    const stageNavigation = page.getByRole("navigation", {
      name: "Design intent alignment stages"
    });
    await stageNavigation.hover();
    for (const label of ["Visual language", "Token", "Layout", "Component", "Interaction"]) {
      const stageButton = page.getByRole("button", { name: label, exact: true });
      await stageButton.click();
      await expect(stageButton).toHaveAttribute("aria-current", "step");
    }
    await page.getByRole("button", { name: "Design Concept", exact: true }).click();
    await page.getByRole("button", { name: "Open question 2 editor" }).click();
    await page.getByRole("textbox", { name: "Answer question 2" })
      .fill("Designer-edited smoke answer");
    await page.getByRole("button", { name: "Submit answer 2" }).click();
    for (const proposed of proposedCards.slice(1)) {
      expect(sc(await client.callTool({
        name: "record_designer_answer",
        arguments: {
          questionCardId: proposed.id,
          finalAnswer: proposed.answer
        }
      }))).toMatchObject({ ok: true });
    }

    // Complete advances Runtime immediately and wakes the same still-active waiter.
    const completionWait = client.callTool(
      { name: "wait_for_agent_command", arguments: {} },
      undefined,
      { timeout: 20_000 }
    );
    await stageNavigation.hover();
    await page.getByRole("button", { name: "Complete alignment" }).click();
    await expect(workbench).toHaveAttribute(
      "data-alignment-workflow-stage",
      "initial-design-system-preparing"
    );
    expect(sc(await completionWait)).toMatchObject({
      reason: "command_available",
      command: {
        command_type: "prepare_initial_design_system",
        alignment_attempt_id: secondAttemptId
      }
    });

    await page.reload();
    await enterCanvas(page);
    await expect(page.getByTestId("seed-workbench")).toHaveAttribute(
      "data-alignment-workflow-stage",
      "initial-design-system-preparing"
    );
    await expect(page.getByTestId("seed-workbench")).toHaveAttribute(
      "data-agent-command-status",
      "pending"
    );

    // Disconnect the MCP transport and restart the one-process Runtime.
    const stoppedPid = handle.pid;
    await client.close();
    client = null;
    killRecordedRuntime(stateDir);
    for (let retry = 0; retry < 50; retry += 1) {
      try {
        process.kill(stoppedPid, 0);
        await new Promise((resolve) => setTimeout(resolve, 20));
      } catch {
        break;
      }
    }
    // The old process may exit after stdio closes; do not let the replacement
    // briefly reuse its now-stale endpoint advertisement.
    rmSync(path.join(stateDir, "runtime-endpoint.json"), { force: true });
    handle = await spawnMcpClient(stateDir);
    client = handle.client;
    expect(sc(await client.callTool({
      name: "create_or_open_project",
      arguments: { path: projectDir }
    }))).toMatchObject({ ok: true });
    expect(sc(await client.callTool({
      name: "read_design_intent_alignment",
      arguments: {}
    }))).toMatchObject({
      preparation: {
        workflow: { stage: "initial-design-system-preparing" },
        current_attempt: { id: secondAttemptId, status: "completed" },
        commands: expect.arrayContaining([
          expect.objectContaining({
            command_type: "prepare_initial_design_system",
            status: "pending"
          })
        ])
      }
    });
    expect(sc(await client.callTool({
      name: "wait_for_agent_command",
      arguments: {}
    }))).toMatchObject({
      reason: "command_available",
      command: {
        command_type: "prepare_initial_design_system",
        alignment_attempt_id: secondAttemptId
      }
    });
  } finally {
    try {
      await client?.close();
    } catch {
      // best-effort test cleanup
    }
    killRecordedRuntime(stateDir);
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  }
});
