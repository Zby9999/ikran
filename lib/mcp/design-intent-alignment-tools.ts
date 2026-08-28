import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  appendAgentAnnotationInformationCommand,
  appendAgentAnnotationInformationInputSchema,
  claimAlignmentPreparationCommand,
  createAgentAnnotationCommand,
  createAgentAnnotationInputSchema,
  createAlignmentQuestionCardCommand,
  createAlignmentQuestionCardInputSchema,
  finalizeAlignmentPreparationCommand,
  finalizeAlignmentPreparationInputSchema,
  readAlignmentSemanticDeltaCommand,
  readAlignmentSemanticDeltaInputSchema,
  readCurrentIncrementalPlanningStatusCommand,
  readIncrementalPlanningStatusCommand,
  recordIncrementalDesignSystemPlanCommand,
  recordIncrementalDesignSystemPlanInputSchema,
  waitForAlignmentSemanticDeltaCommand,
  readDesignIntentAlignmentCommand,
  recordDesignerAnswerCommand,
  recordDesignerAnswerToolInputSchema,
  updateAlignmentQuestionAnchorCommand,
  updateAlignmentQuestionAnchorInputSchema,
  updateAlignmentQuestionTitleCommand,
  updateAlignmentQuestionTitleInputSchema,
  requireActiveProjectCommand
} from "../runtime/commands";
import { failureResult, successResult, type RegisterIkranToolsDeps } from "./shared";
import { waitForAgentCommand } from "../runtime/adaptive-agent-wait";

const ALIGNMENT_CONTINUATION = {
  continuationRequired: true as const,
  terminalBoundary: "draft_design_system_review" as const
};

export function registerDesignIntentAlignmentTools(
  mcp: McpServer,
  { ensureRuntime }: RegisterIkranToolsDeps
): void {
  const active = async (tool: string) => {
    const rt = await ensureRuntime();
    const project = requireActiveProjectCommand();
    return project.ok ? { ok: true as const, rt, projectPath: project.project.path } : { ok: false as const, result: failureResult(tool, project.reason, rt) };
  };
  mcp.registerTool("wait_for_agent_command", {
    description: "Wait for the next scoped durable Ikran Agent command. Call this only after the Workbench URL is open in the host browser — this call blocks the turn and cannot open the page. A pending command always returns immediately in durable queue order, including in a later Agent turn. With no pending command, Runtime starts the adaptive three-minute lease only during Alignment preparation — including first-open seed-reference-registration with zero Seed References — or while one explicit Rule Update Review wait scope is active. Alignment answering uses resume_initial_design_system_planning instead and immediately returns not_applicable here. A post-Alignment project phase alone is not eligible. Outside those scopes it immediately returns not_applicable; unreadable state fails closed with state_unavailable. While eligible, visible and focused Workbench interaction, unsubmitted edits, or submitted semantic activity can renew the lease; background connection/heartbeat cannot. Cancellation, idle, page close, or transport loss never advances workflow or consumes a later command. This active-turn wait does not provide MCP reverse activation. No arguments."
  }, async (extra) => {
    const ctx = await active("wait_for_agent_command");
    if (!ctx.ok) return ctx.result;
    const result = await waitForAgentCommand(ctx.projectPath, {
      signal: extra.signal
    });
    return result.ok
      ? successResult(ctx.rt, result)
      : failureResult("wait_for_agent_command", result.reason, ctx.rt, {
          command: null
        });
  });

  mcp.registerTool("claim_alignment_preparation", {
    description: "Claim the current durable prepare_design_intent_alignment command. Returns the stable command, Alignment attempt, immutable input snapshot, exact Seed Reference notes, captured evidence identities, and the section_contract (card kinds and ordering, title format, output language, evidence target modes) needed to prepare all six sections — follow the returned contract rather than memory. In each section, create its gray Agent Annotation hypotheses first, then its colored Question cards, before moving to the next section. Safe to retry after disconnect; a repeated claim returns the same claimed work. No arguments."
  }, async () => {
    const ctx = await active("claim_alignment_preparation");
    if (!ctx.ok) return ctx.result;
    const result = claimAlignmentPreparationCommand(ctx.projectPath);
    return result.ok ? successResult(ctx.rt, result) : failureResult("claim_alignment_preparation", result.reason, ctx.rt);
  });

  mcp.registerTool("create_alignment_question_card", {
    description: "Create one Runtime-owned Design Intent Alignment Question card for the claimed current attempt. Pass the alignmentAttemptId returned by claim_alignment_preparation, a stable idempotencyKey, and ordered answerOptions. The evidence anchor must belong to that attempt's immutable snapshot. Section ordering, question title format, output language, per-section question counts, variable answer-choice contract, and evidence target modes are defined only by that claim's section_contract — follow it; Runtime rejects violations.",
    inputSchema: createAlignmentQuestionCardInputSchema
  }, async (args) => {
    const ctx = await active("create_alignment_question_card");
    if (!ctx.ok) return ctx.result;
    const result = createAlignmentQuestionCardCommand(ctx.projectPath, args);
    return result.ok ? successResult(ctx.rt, result) : failureResult("create_alignment_question_card", result.reason, ctx.rt);
  });

  mcp.registerTool("finalize_alignment_preparation", {
    description: "Finish Question Card preparation and atomically enter hidden section-level answer monitoring in the same active tool call. Do not call wait_for_agent_command after this succeeds. Every success before Draft review returns continuationRequired=true: execute nextAction immediately and do not end the turn. Each returned ready section must be analyzed once, then persisted with record_incremental_initial_design_system_plan, which immediately monitors the next section. Safe to retry with the same alignmentAttemptId after interruption.",
    inputSchema: finalizeAlignmentPreparationInputSchema
  }, async (args, extra) => {
    const ctx = await active("finalize_alignment_preparation");
    if (!ctx.ok) return ctx.result;
    const result = finalizeAlignmentPreparationCommand(
      ctx.projectPath,
      args.alignmentAttemptId
    );
    if (!result.ok) {
      return failureResult("finalize_alignment_preparation", result.reason, ctx.rt);
    }
    const monitoring = await waitForAlignmentSemanticDeltaCommand(
      ctx.projectPath,
      {
        alignmentAttemptId: args.alignmentAttemptId,
        afterRevision: 0,
        signal: extra.signal
      }
    );
    return successResult(ctx.rt, {
      ...result,
      ...ALIGNMENT_CONTINUATION,
      incrementalPlanning: monitoring,
      nextAction: monitoring.ok && monitoring.reason === "delta_available"
        ? { tool: "record_incremental_initial_design_system_plan" }
        : { tool: "resume_initial_design_system_planning" }
    });
  });

  mcp.registerTool("read_alignment_semantic_delta", {
      description: "Read the next ready Alignment section whose durable semantic digest differs from the persisted Incremental Plan. Returns only that section's current Question answers and Annotations with stable source ids and digests; it never returns the complete Alignment snapshot.",
      inputSchema: readAlignmentSemanticDeltaInputSchema
    }, async (args) => {
      const ctx = await active("read_alignment_semantic_delta");
      if (!ctx.ok) return ctx.result;
      const result = readAlignmentSemanticDeltaCommand(ctx.projectPath, args);
      return result.ok
        ? successResult(ctx.rt, result)
        : failureResult("read_alignment_semantic_delta", result.reason, ctx.rt);
  });

  mcp.registerTool("record_incremental_initial_design_system_plan", {
      description: "Persist the Agent's semantic decisions for the returned ready section against its revision and exact sectionDigest. Pass the exact basePlanVersion returned by the delta or checkpoint; a concurrent plan write fails with the latest checkpoint instead of overwriting cumulative work. Runtime accepts an older global baseRevision when this section and every cited source digest are still current, so unrelated answers do not discard useful work. Decisions are stable-id upserts across sections; use retireDecisionIds to remove invalidated decisions. Send cumulative draftBindings for every semantic output and omission path (for example /visualLanguage, /foundationRules/0, /components/0, /categoryOmissions/0, /sourceOmissions/0); every cited source must be a current dependency of that exact decision. The cumulative designSystemDraft must ultimately include name, explicit disposition of every source and empty category, evidence-backed color roles/foundationRules, and semantic/component typography roles with one scalar fontSize, at least one other style field, one stable job, and usedFor; never bundle a scale or step collection. A completed checkpoint with binding or invalidSemanticDraft gaps is not commit-ready: reuse nextAction.reconciliation to repair it. Every success returns continuationRequired=true: execute nextAction immediately and do not end the turn until Draft review. The plan is operational cache, not visible Draft or research export.",
      inputSchema: recordIncrementalDesignSystemPlanInputSchema
    }, async (args, extra) => {
      const ctx = await active("record_incremental_initial_design_system_plan");
      if (!ctx.ok) return ctx.result;
      const recorded = recordIncrementalDesignSystemPlanCommand(
        ctx.projectPath,
        args
      );
      if (!recorded.ok) {
        const details = recorded.reason === "stale_incremental_plan_version"
          ? {
              ...recorded.details as Record<string, unknown>,
              checkpoint: readIncrementalPlanningStatusCommand(
                ctx.projectPath,
                args.alignmentAttemptId
              )
            }
          : recorded.details;
        return failureResult(
          "record_incremental_initial_design_system_plan",
          recorded.reason,
          ctx.rt,
          details
        );
      }
      const monitoring = await waitForAlignmentSemanticDeltaCommand(
        ctx.projectPath,
        {
          alignmentAttemptId: args.alignmentAttemptId,
          afterRevision: recorded.processedRevision,
          signal: extra.signal
        }
      );
      const checkpoint = readIncrementalPlanningStatusCommand(
        ctx.projectPath,
        args.alignmentAttemptId
      );
      return successResult(ctx.rt, {
        ...recorded,
        ...ALIGNMENT_CONTINUATION,
        checkpoint,
        incrementalPlanning: monitoring,
        nextAction: monitoring.ok && monitoring.reason === "delta_available"
            ? { tool: "record_incremental_initial_design_system_plan" }
          : monitoring.ok && monitoring.reason === "alignment_completed" &&
              checkpoint.ok
            ? checkpoint.nextAction
            : { tool: "resume_initial_design_system_planning" }
      });
  });

  mcp.registerTool("resume_initial_design_system_planning", {
      description: "Resume hidden section-level Alignment answer checking after cancellation, disconnect, or a later Agent turn. No internal ids are required: Runtime restores the current attempt, plan version, acknowledged cursor, stale decisions, and durable backlog. Every success before Draft review returns continuationRequired=true: execute nextAction immediately and do not end the turn. Use this for the user instruction ‘打开 Ikran，恢复当前 Alignment 的答案检查。’ No arguments."
    }, async (extra) => {
      const ctx = await active("resume_initial_design_system_planning");
      if (!ctx.ok) return ctx.result;
      const status = readCurrentIncrementalPlanningStatusCommand(ctx.projectPath);
      if (!status.ok) {
        return failureResult(
          "resume_initial_design_system_planning",
          status.reason,
          ctx.rt
        );
      }
      const monitoring = await waitForAlignmentSemanticDeltaCommand(
        ctx.projectPath,
        {
          alignmentAttemptId: status.alignmentAttemptId,
          afterRevision: status.processedRevision,
          signal: extra.signal
        }
      );
      const latestCheckpoint = readIncrementalPlanningStatusCommand(
        ctx.projectPath,
        status.alignmentAttemptId
      );
      return successResult(ctx.rt, {
        ok: true,
        ...ALIGNMENT_CONTINUATION,
        checkpoint: latestCheckpoint.ok ? latestCheckpoint : status,
        incrementalPlanning: monitoring,
        nextAction: monitoring.ok && monitoring.reason === "delta_available"
            ? { tool: "record_incremental_initial_design_system_plan" }
          : monitoring.ok && monitoring.reason === "alignment_completed" &&
              latestCheckpoint.ok
            ? latestCheckpoint.nextAction
            : { tool: "resume_initial_design_system_planning" }
      });
  });

  mcp.registerTool("create_agent_annotation", {
    description: "Create an attempt-bound, section-bound, idempotent gray Agent Annotation with a short non-empty title and a meaningful confirmed observation or reasonable assumption body. Section ordering, output language, and evidence anchor modes follow the claim's section_contract. At least one gray Agent Annotation is mandatory in every section before Alignment preparation can finish.",
    inputSchema: createAgentAnnotationInputSchema
  }, async (args) => {
    const ctx = await active("create_agent_annotation");
    if (!ctx.ok) return ctx.result;
    const result = createAgentAnnotationCommand(ctx.projectPath, args);
    return result.ok ? successResult(ctx.rt, result) : failureResult("create_agent_annotation", result.reason, ctx.rt);
  });

  mcp.registerTool("append_agent_annotation_information", {
    description: "Append designer or Agent information to an existing Agent Annotation without affecting Alignment coverage.",
    inputSchema: appendAgentAnnotationInformationInputSchema
  }, async (args) => {
    const ctx = await active("append_agent_annotation_information");
    if (!ctx.ok) return ctx.result;
    const result = appendAgentAnnotationInformationCommand(ctx.projectPath, args.annotationId, args.information);
    return result.ok ? successResult(ctx.rt, result) : failureResult("append_agent_annotation_information", result.reason, ctx.rt);
  });

  mcp.registerTool("record_designer_answer", {
    description: "Persist explicit designer answer intent for a Question card. Send answer.kind=option with the owning card's stable optionId; Runtime derives canonical text and agent-proposed-designer-accepted provenance. Send answer.kind=custom with non-empty text for designer-edited provenance, even when the text equals an Agent choice. finalAnswer is deprecated and accepted only for persisted legacy cards without answer options.",
    inputSchema: recordDesignerAnswerToolInputSchema
  }, async (args) => {
    const ctx = await active("record_designer_answer");
    if (!ctx.ok) return ctx.result;
    const result = recordDesignerAnswerCommand(ctx.projectPath, args);
    return result.ok ? successResult(ctx.rt, result) : failureResult("record_designer_answer", result.reason, ctx.rt);
  });

  mcp.registerTool("update_alignment_question_title", {
    description: "Replace a Question card's title so it satisfies the claimed section_contract question_title format. Use this to correct a verbose or sentence-like generated title.",
    inputSchema: updateAlignmentQuestionTitleInputSchema
  }, async (args) => {
    const ctx = await active("update_alignment_question_title");
    if (!ctx.ok) return ctx.result;
    const result = updateAlignmentQuestionTitleCommand(ctx.projectPath, args);
    return result.ok ? successResult(ctx.rt, result) : failureResult("update_alignment_question_title", result.reason, ctx.rt);
  });

  mcp.registerTool("update_alignment_question_anchor", {
    description: "Replace a Question card's evidence anchor. Target modes and their rendering semantics follow the claimed section_contract evidence_target_modes.",
    inputSchema: updateAlignmentQuestionAnchorInputSchema
  }, async (args) => {
    const ctx = await active("update_alignment_question_anchor");
    if (!ctx.ok) return ctx.result;
    const result = updateAlignmentQuestionAnchorCommand(ctx.projectPath, args);
    return result.ok ? successResult(ctx.rt, result) : failureResult("update_alignment_question_anchor", result.reason, ctx.rt);
  });

  mcp.registerTool("read_design_intent_alignment", {
    description: "Read the latest Runtime-owned Agent Annotations, Question cards, final answers, answer sources, Designer Annotations (designer_annotations — the designer's own section-bound intent input, part of this Alignment; direction to respect, never Agent cards or coverage), coverage, and Alignment status. No arguments."
  }, async () => {
    const ctx = await active("read_design_intent_alignment");
    if (!ctx.ok) return ctx.result;
    return successResult(ctx.rt, { ok: true, ...readDesignIntentAlignmentCommand(ctx.projectPath) });
  });
}
