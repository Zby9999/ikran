import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { expect, test } from "./fixtures";
import { killRecordedRuntime, sc, spawnMcpClient } from "./helpers/mcp";
import { registerSeedReference } from "../lib/runtime/seed-reference";
import { recordEvidencePackage } from "../lib/runtime/evidence-package";
import { setDesignLanguageDescription } from "../lib/runtime/project-readiness";
import { openRecordSse } from "./helpers/sse";

test("Issue 07 semantic MCP surface is discoverable", async () => {
  test.setTimeout(120_000);
  const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-alignment-mcp-"));
  const projectDir = mkdtempSync(path.join(tmpdir(), "ikran-alignment-project-"));
  let client: Client | null = null;
  try {
    const handle = await spawnMcpClient(stateDir);
    client = handle.client;
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "create_alignment_question_card",
        "claim_alignment_preparation",
        "finalize_alignment_preparation",
        "create_agent_annotation",
        "append_agent_annotation_information",
        "record_designer_answer",
        "complete_design_intent_alignment",
        "read_design_intent_alignment"
      ])
    );

    const opened = sc(await client.callTool({
      name: "create_or_open_project",
      arguments: { path: projectDir }
    }));
    expect(opened.ok).toBe(true);
    const token = String(opened.session);
    const workbenchUrl = String(opened.workbench_url);
    const runtimePort = Number(new URL(workbenchUrl).port);

    expect(
      setDesignLanguageDescription(projectDir, "A calm, precise product language").ok
    ).toBe(true);
    const seed = registerSeedReference(projectDir, {
      figmaSeedReference: "https://www.figma.com/design/AbCdEf/Checkout?node-id=1:2",
      originalDesignIntent: "Alignment MCP fixture"
    });
    expect(seed.ok).toBe(true);
    if (!seed.ok) return;
    const evidence = recordEvidencePackage(projectDir, {
      seedReferenceId: seed.record.id,
      frame: { nodeId: "1:2", name: "Checkout" },
      evidenceViews: { rawData: "available", screenshot: "missing" }
    });
    expect(evidence.ok).toBe(true);
    if (!evidence.ok) return;

    const preparedResponse = await fetch(
      new URL("/api/design-intent-alignment", workbenchUrl),
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-ikran-session": token
        },
        body: JSON.stringify({ action: "prepare" })
      }
    );
    expect(preparedResponse.status).toBe(200);

    const claimed = sc(await client.callTool({
      name: "claim_alignment_preparation",
      arguments: {}
    }));
    expect(claimed.ok).toBe(true);
    const attemptId = String((claimed.attempt as { id: string }).id);
    expect(claimed).toMatchObject({
      command: { status: "claimed" },
      attempt: { status: "preparing" },
      input_snapshot: {
        data: { design_language_description: "A calm, precise product language" }
      }
    });

    const sse = await openRecordSse(runtimePort, token);
    let firstCardId = "";
    for (const section of [
      "design-principle",
      "visual-language",
      "token",
      "layout",
      "component",
      "interaction"
    ]) {
      for (let index = 1; index <= 2; index += 1) {
        const recordEvent = sse.waitForRecord();
        const created = sc(await client.callTool({
          name: "create_alignment_question_card",
          arguments: {
            alignmentAttemptId: attemptId,
            idempotencyKey: `${section}-${index}`,
            section,
            observation: `${section} ${index}`,
            question: `Question ${index} for ${section}?`,
            proposedAnswer: `Proposed answer ${index}`,
            anchor: {
              kind: "single",
              target: {
                kind: "surface",
                seedReferenceId: seed.record.id,
                evidenceSurfaceId: evidence.record.id,
                evidenceVersionId: evidence.record.id
              }
            }
          }
        }));
        expect(created.ok).toBe(true);
        const cardId = String((created.record as { id: string }).id);
        if (!firstCardId) firstCardId = cardId;
        await expect(recordEvent).resolves.toMatchObject({
          kind: "alignment",
          action: "created",
          id: cardId
        });
      }
    }

    const preparingRead = await fetch(
      new URL("/api/design-intent-alignment", workbenchUrl),
      { headers: { "x-ikran-session": token } }
    );
    expect(preparingRead.status).toBe(200);
    const preparingBody = await preparingRead.json() as {
      preparation: { workflow: { stage: string } };
      question_cards: unknown[];
      coverage: { can_complete: boolean };
    };
    expect(preparingBody.preparation.workflow.stage).toBe("alignment-preparing");
    expect(preparingBody.question_cards).toHaveLength(12);
    expect(preparingBody.coverage.can_complete).toBe(false);

    const answeredResponse = await fetch(
      new URL("/api/design-intent-alignment", workbenchUrl),
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-ikran-session": token
        },
        body: JSON.stringify({
          action: "record-designer-answer",
          input: { questionCardId: firstCardId, finalAnswer: "同意" }
        })
      }
    );
    expect(answeredResponse.status).toBe(409);

    const finalizedEvent = sse.waitForRecord();
    const finalized = sc(await client.callTool({
      name: "finalize_alignment_preparation",
      arguments: { alignmentAttemptId: attemptId }
    }));
    expect(finalized).toMatchObject({
      ok: true,
      workflow: { stage: "alignment-answering" },
      attempt: { status: "answering" },
      command: { status: "completed" }
    });
    await expect(finalizedEvent).resolves.toMatchObject({
      kind: "alignment",
      action: "updated",
      id: attemptId
    });

    const answeredAfterFinalize = await fetch(
      new URL("/api/design-intent-alignment", workbenchUrl),
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-ikran-session": token
        },
        body: JSON.stringify({
          action: "record-designer-answer",
          input: { questionCardId: firstCardId, finalAnswer: "同意" }
        })
      }
    );
    expect(answeredAfterFinalize.status).toBe(200);

    const read = sc(await client.callTool({
      name: "read_design_intent_alignment",
      arguments: {}
    }));
    const card = (read.question_cards as Array<Record<string, unknown>>)
      .find((candidate) => candidate.id === firstCardId);
    expect(card).toMatchObject({
      final_answer: "同意",
      answer_source: "designer-edited",
      status: "answered"
    });
    expect((read.preparation as { workflow: { stage: string } }).workflow.stage)
      .toBe("alignment-answering");
    sse.close();
  } finally {
    try {
      await client?.close();
    } catch {
      // ignore cleanup failure
    }
    killRecordedRuntime(stateDir);
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  }
});
