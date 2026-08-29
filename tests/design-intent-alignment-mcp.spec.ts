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
    const handle = await spawnMcpClient(stateDir, { prod: false });
    client = handle.client;
    const advertisedTools = (await client.listTools()).tools;
    const names = advertisedTools.map((tool) => tool.name);
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
        "commit_initial_design_system_semantics"
      ])
    );
    expect(names).not.toContain("complete_design_intent_alignment");
    expect(names).not.toContain("record_design_system_extraction_work_unit");
    expect(names).not.toContain("record_design_system_extraction_audit");
    expect(names).not.toContain("finalize_initial_design_system_preparation");
    const commitTool = advertisedTools.find(
      (tool) => tool.name === "commit_initial_design_system_semantics"
    );
    expect(commitTool?.inputSchema).toMatchObject({
      type: "object",
      properties: {
        alignmentAttemptId: { type: "string" },
        idempotencyKey: { type: "string" },
        designSystem: expect.any(Object)
      },
      required: expect.arrayContaining([
        "alignmentAttemptId",
        "idempotencyKey",
        "designSystem"
      ])
    });
    const advertisedCommitSchema = JSON.stringify(commitTool?.inputSchema);
    expect(advertisedCommitSchema).toContain("sourceRefs");
    expect(advertisedCommitSchema).toContain("foundationRules");
    expect(advertisedCommitSchema).toContain("categoryOmissions");
    expect(advertisedCommitSchema).toContain("sourceOmissions");
    expect(advertisedCommitSchema).toContain("usedFor");
    expect(advertisedCommitSchema).not.toContain("sourceRecordIds");
    expect(commitTool?.description).toContain("Typography role identity");
    const answerTool = advertisedTools.find(
      (tool) => tool.name === "record_designer_answer"
    );
    expect(answerTool?.inputSchema).toMatchObject({
      type: "object",
      properties: {
        questionCardId: { type: "string" },
        answer: expect.any(Object),
        finalAnswer: { type: "string" }
      },
      required: ["questionCardId"]
    });
    const advertisedAnswerSchema = JSON.stringify(answerTool?.inputSchema);
    expect(advertisedAnswerSchema).toContain("optionId");
    expect(advertisedAnswerSchema).toContain("custom");
    expect(advertisedAnswerSchema).toContain("exactly one");
    const confirmDraftTool = advertisedTools.find(
      (tool) => tool.name === "confirm_draft_design_system"
    );
    expect(confirmDraftTool?.inputSchema).toMatchObject({
      type: "object",
      required: ["designerConfirmation"]
    });
    expect(confirmDraftTool?.description).toContain("Never call automatically");
    const confirmPrototypeTool = advertisedTools.find(
      (tool) => tool.name === "confirm_prototype"
    );
    expect(confirmPrototypeTool?.inputSchema).toMatchObject({
      type: "object",
      required: ["designerConfirmation", "designerMessageId"]
    });
    expect(confirmPrototypeTool?.description).toContain(
      "Never call automatically after component registration"
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
    expect(sc(await client.callTool({
      name: "create_alignment_question_card",
      arguments: {
        alignmentAttemptId: attemptId,
        idempotencyKey: "premature-design-concept-question",
        section: "design-concept",
        observation: "Calm Hierarchy",
        question: "Should the hierarchy remain calm?",
        answerOptions: ["Yes, keep it calm.", "No, increase contrast."],
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
        section: "design-concept",
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
    const proposedCards: Array<{
      id: string;
      answer: string;
      optionId: string;
    }> = [];
    for (const section of [
      "design-concept",
      "visual-language",
      "token",
      "layout",
      "component",
      "interaction"
    ]) {
      if (section !== "design-concept") {
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
        const answerOptions = [
          proposedAnswer,
          `Alternative ${index} for ${section}`,
          ...(index === 2 ? [`Contextual option for ${section}`] : [])
        ];
        const created = sc(await client.callTool({
          name: "create_alignment_question_card",
          arguments: {
            alignmentAttemptId: attemptId,
            idempotencyKey: `${section}-${index}`,
            section,
            observation: `${section} ${index}`,
            question: `Question ${index} for ${section}?`,
            answerOptions,
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
        const createdRecord = created.record as {
          id: string;
          answer_options: Array<{ id: string; text: string }>;
        };
        const cardId = String(createdRecord.id);
        expect(createdRecord.answer_options.map((option) => option.text))
          .toEqual(answerOptions);
        proposedCards.push({
          id: cardId,
          answer: proposedAnswer,
          optionId: createdRecord.answer_options[0].id
        });
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
          input: {
            questionCardId: firstCardId,
            answer: { kind: "custom", text: "同意" }
          }
        })
      }
    );
    expect(answeredResponse.status).toBe(409);

    const finalizedEvent = sse.waitForRecord();
    const finalizeCall = client.callTool({
      name: "finalize_alignment_preparation",
      arguments: { alignmentAttemptId: attemptId }
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
          input: {
            questionCardId: firstCardId,
            answer: { kind: "custom", text: "同意" }
          }
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

    expect(sc(await client.callTool({
      name: "record_designer_answer",
      arguments: {
        questionCardId: proposedCards[1].id,
        answer: {
          kind: "option",
          optionId: proposedCards[0].optionId
        }
      }
    }))).toMatchObject({ ok: false, error: "invalid_answer_option" });

    for (const proposed of proposedCards.slice(1)) {
      const proposedEvent = sse.waitForRecord();
      expect(sc(await client.callTool({
        name: "record_designer_answer",
        arguments: {
          questionCardId: proposed.id,
          answer: { kind: "option", optionId: proposed.optionId }
        }
      }))).toMatchObject({
        ok: true,
        record: {
          answer_source: "agent-proposed-designer-accepted",
          selected_option_id: proposed.optionId,
          status: "answered"
        }
      });
      await expect(proposedEvent).resolves.toMatchObject({
        kind: "alignment",
        action: "updated",
        id: proposed.id
      });
    }
    const finalized = sc(await finalizeCall);
    expect(finalized).toMatchObject({
      ok: true,
      workflow: { stage: "alignment-answering" },
      attempt: { status: "answering" },
      command: { status: "completed" },
      incrementalPlanning: { reason: "delta_available" }
    });

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
    const claimedInitialDesignSystemResult = await client.callTool({
      name: "claim_initial_design_system_preparation",
      arguments: {}
    });
    const rawClaimContent = (
      claimedInitialDesignSystemResult as { content?: unknown }
    ).content;
    const modelVisibleClaim = Array.isArray(rawClaimContent)
      ? rawClaimContent.find((item): item is { type: "text"; text: string } =>
          item !== null &&
          typeof item === "object" &&
          (item as { type?: unknown }).type === "text" &&
          typeof (item as { text?: unknown }).text === "string"
        )
      : undefined;
    expect(modelVisibleClaim).toMatchObject({ type: "text" });
    if (modelVisibleClaim?.type !== "text") {
      throw new Error("claim response omitted model-visible text");
    }
    expect(modelVisibleClaim.text).toContain('"ref":"Q01"');
    expect(modelVisibleClaim.text).toContain('"section":"visual-language"');
    expect(modelVisibleClaim.text).toContain('"statement":');
    const claimedInitialDesignSystem = sc(claimedInitialDesignSystemResult);
    expect(claimedInitialDesignSystem).toMatchObject({
      ok: true,
      commandStatus: "claimed",
      alignmentAttemptId: attemptId,
      designLanguageDescription: "A calm, precise product language",
      nextAction: {
        tool: "commit_initial_design_system_semantics",
        sourceField: "sourceRefs"
      },
    });
    expect("outputLanguage" in claimedInitialDesignSystem).toBe(false);
    const compactSources = claimedInitialDesignSystem.sources as Array<Record<string, unknown>>;
    expect(compactSources).toHaveLength(18);
    expect(compactSources[0]).toMatchObject({ ref: "Q01", kind: "question" });
    expect(JSON.stringify(claimedInitialDesignSystem)).not.toContain(firstCardId);
    expect(JSON.stringify(claimedInitialDesignSystem)).not.toContain("source_contract");
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
