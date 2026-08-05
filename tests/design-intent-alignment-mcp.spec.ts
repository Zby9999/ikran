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
        "read_design_intent_alignment",
        "wait_for_agent_command",
        "claim_initial_design_system_preparation",
        "record_design_system_extraction_work_unit",
        "record_design_system_extraction_audit",
        "finalize_initial_design_system_preparation"
      ])
    );
    expect(names).not.toContain("complete_design_intent_alignment");

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
    expect(sc(await client.callTool({
      name: "create_alignment_question_card",
      arguments: {
        alignmentAttemptId: attemptId,
        idempotencyKey: "premature-design-principle-question",
        section: "design-principle",
        observation: "Calm Hierarchy",
        question: "Should the hierarchy remain calm?",
        proposedAnswer: "Yes.",
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
    }))).toMatchObject({
      ok: false,
      error: "section_annotation_required"
    });
    const annotationEvent = sse.waitForRecord();
    expect(sc(await client.callTool({
      name: "create_agent_annotation",
      arguments: {
        alignmentAttemptId: attemptId,
        idempotencyKey: "alignment-assumption-1",
        section: "design-principle",
        inference: "reasonable",
        title: "Existing hierarchy",
        body: "The current visual hierarchy appears intentional.",
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
    }))).toMatchObject({
      ok: true,
      record: { alignment_attempt_id: attemptId }
    });
    await expect(annotationEvent).resolves.toMatchObject({
      kind: "alignment",
      action: "created"
    });
    let firstCardId = "";
    const proposedCards: Array<{ id: string; answer: string }> = [];
    for (const section of [
      "design-principle",
      "visual-language",
      "token",
      "layout",
      "component",
      "interaction"
    ]) {
      if (section !== "design-principle") {
        const sectionAnnotationEvent = sse.waitForRecord();
        expect(sc(await client.callTool({
          name: "create_agent_annotation",
          arguments: {
            alignmentAttemptId: attemptId,
            idempotencyKey: `alignment-assumption-${section}`,
            section,
            inference: "reasonable",
            title: "Section Hypothesis",
            body: `The current ${section} choices appear intentional.`,
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
        }))).toMatchObject({ ok: true });
        await expect(sectionAnnotationEvent).resolves.toMatchObject({
          kind: "alignment",
          action: "created"
        });
      }
      for (let index = 1; index <= 2; index += 1) {
        const recordEvent = sse.waitForRecord();
        const proposedAnswer = `Proposed answer ${index}`;
        const created = sc(await client.callTool({
          name: "create_alignment_question_card",
          arguments: {
            alignmentAttemptId: attemptId,
            idempotencyKey: `${section}-${index}`,
            section,
            observation: `${section} ${index}`,
            question: `Question ${index} for ${section}?`,
            proposedAnswer,
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
        proposedCards.push({ id: cardId, answer: proposedAnswer });
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

    const answeredEvent = sse.waitForRecord();
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
    await expect(answeredEvent).resolves.toMatchObject({
      kind: "alignment",
      action: "updated",
      id: firstCardId
    });

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

    for (const proposed of proposedCards.slice(1)) {
      const proposedEvent = sse.waitForRecord();
      expect(sc(await client.callTool({
        name: "record_designer_answer",
        arguments: {
          questionCardId: proposed.id,
          finalAnswer: proposed.answer
        }
      }))).toMatchObject({
        ok: true,
        record: {
          answer_source: "agent-proposed-designer-accepted",
          status: "answered"
        }
      });
      await expect(proposedEvent).resolves.toMatchObject({
        kind: "alignment",
        action: "updated",
        id: proposed.id
      });
    }

    const completedEvent = sse.waitForRecord();
    const completeResponse = await fetch(
      new URL("/api/design-intent-alignment", workbenchUrl),
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-ikran-session": token
        },
        body: JSON.stringify({ action: "complete" })
      }
    );
    expect(completeResponse.status).toBe(200);
    const completed = await completeResponse.json() as Record<string, unknown>;
    expect(completed).toMatchObject({
      ok: true,
      workflow: { stage: "initial-design-system-preparing" },
      attempt: { id: attemptId, status: "completed" },
      command: {
        command_type: "prepare_initial_design_system",
        status: "pending"
      }
    });
    await expect(completedEvent).resolves.toMatchObject({
      kind: "alignment",
      action: "updated",
      id: "design-intent-alignment"
    });

    const nextCommand = sc(await client.callTool({
      name: "wait_for_agent_command",
      arguments: {}
    }));
    expect(nextCommand).toMatchObject({
      ok: true,
      reason: "command_available",
      command: {
        command_type: "prepare_initial_design_system",
        alignment_attempt_id: attemptId
      }
    });
    const claimedInitialDesignSystem = sc(await client.callTool({
      name: "claim_initial_design_system_preparation",
      arguments: {}
    }));
    expect(claimedInitialDesignSystem).toMatchObject({
      ok: true,
      command: {
        command_type: "prepare_initial_design_system",
        status: "claimed"
      },
      attempt: { id: attemptId, status: "completed" },
      input_snapshot: {
        data: {
          design_language_description: "A calm, precise product language"
        }
      },
      required_artifacts: expect.arrayContaining([
        "design-system/token.json"
      ])
    });
    expect(
      (claimedInitialDesignSystem.question_cards as unknown[])
    ).toHaveLength(12);
    const incompleteManifest = sc(await client.callTool({
      name: "record_design_system_extraction_audit",
      arguments: {
        alignmentAttemptId: attemptId,
        idempotencyKey: "incomplete-mcp-audit",
        residualClaims: [
          {
            claimId: "only-first-card",
            statement: "The first answered decision.",
            sourceRecordIds: [firstCardId],
            sourceExcerpts: ["同意"],
            confidence: "confirmed",
            outcome: "omitted",
            reason: "Not reusable by itself.",
            targets: []
          }
        ],
        audit: {
          status: "passed",
          checkedClaimIds: ["only-first-card"],
          issues: []
        }
      }
    }));
    expect(incompleteManifest).toMatchObject({
      ok: false,
      error: "invalid_audit"
    });
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
