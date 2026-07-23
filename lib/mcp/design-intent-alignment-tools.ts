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
  readDesignIntentAlignmentCommand,
  recordDesignerAnswerCommand,
  recordDesignerAnswerInputSchema,
  updateAlignmentQuestionAnchorCommand,
  updateAlignmentQuestionAnchorInputSchema,
  updateAlignmentQuestionTitleCommand,
  updateAlignmentQuestionTitleInputSchema,
  requireActiveProjectCommand
} from "../runtime/commands";
import { failureResult, type RegisterIkranToolsDeps } from "./shared";
import { waitForAgentCommand } from "../runtime/adaptive-agent-wait";

function success(rt: Awaited<ReturnType<RegisterIkranToolsDeps["ensureRuntime"]>>, value: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: { ...value, session: rt.token, workbench_url: rt.url }
  };
}

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
    description: "Wait for the next durable Ikran Agent command. Returns immediately when a pending command exists; otherwise keeps an adaptive three-minute lease while the visible, focused Workbench reports real designer interaction, unsubmitted edits, or submitted semantic activity. Background connection/heartbeat alone does not renew. Cancellation or idle ends only this wait and never advances workflow or consumes a later command. No arguments."
  }, async (extra) => {
    const ctx = await active("wait_for_agent_command");
    if (!ctx.ok) return ctx.result;
    const result = await waitForAgentCommand(ctx.projectPath, {
      signal: extra.signal
    });
    return success(ctx.rt, result);
  });

  mcp.registerTool("claim_alignment_preparation", {
    description: "Claim the current durable prepare_design_intent_alignment command. Returns the stable command, Alignment attempt, immutable input snapshot, exact Seed Reference notes, and captured evidence identities needed to prepare all six sections. In each section, create its gray Agent Annotation hypotheses first, then its colored Question cards, before moving to the next section. Safe to retry after disconnect; a repeated claim returns the same claimed work. No arguments."
  }, async () => {
    const ctx = await active("claim_alignment_preparation");
    if (!ctx.ok) return ctx.result;
    const result = claimAlignmentPreparationCommand(ctx.projectPath);
    return result.ok ? success(ctx.rt, result) : failureResult("claim_alignment_preparation", result.reason, ctx.rt);
  });

  mcp.registerTool("create_alignment_question_card", {
    description: "Create one Runtime-owned Design Intent Alignment Question card for the claimed current attempt. Before the first Question in a section, create at least one gray Agent Annotation for that same section; Runtime rejects the Question otherwise. Pass the alignmentAttemptId returned by claim_alignment_preparation and a stable idempotencyKey for this semantic question. The evidence anchor must belong to that attempt's immutable snapshot. The observation field is the card title: use a concise 2–5 word noun phrase (48 characters maximum), never a sentence. Each of the six sections must end with 2–5 questions and every question needs a non-empty proposedAnswer before finalize. For a whole-Frame question use a single surface target; never approximate it with a nearly full-size region. For one specific element or component, prefer its exact positional node; use a free region only when no exact node represents the target. Use focus-target-set for repeated or shared elements across components/Frames.",
    inputSchema: createAlignmentQuestionCardInputSchema
  }, async (args) => {
    const ctx = await active("create_alignment_question_card");
    if (!ctx.ok) return ctx.result;
    const result = createAlignmentQuestionCardCommand(ctx.projectPath, args);
    return result.ok ? success(ctx.rt, result) : failureResult("create_alignment_question_card", result.reason, ctx.rt);
  });

  mcp.registerTool("finalize_alignment_preparation", {
    description: "Explicitly finish the claimed Alignment preparation attempt only after every one of the six sections contains at least one gray Agent Annotation followed by 2–5 valid colored Question cards with proposed answers. Both card kinds are mandatory in each section. Atomically completes the durable Agent command and moves the same attempt from preparing to answering. Safe to retry with the same alignmentAttemptId.",
    inputSchema: finalizeAlignmentPreparationInputSchema
  }, async (args) => {
    const ctx = await active("finalize_alignment_preparation");
    if (!ctx.ok) return ctx.result;
    const result = finalizeAlignmentPreparationCommand(
      ctx.projectPath,
      args.alignmentAttemptId
    );
    return result.ok ? success(ctx.rt, result) : failureResult("finalize_alignment_preparation", result.reason, ctx.rt);
  });

  mcp.registerTool("create_agent_annotation", {
    description: "Create an attempt-bound, section-bound, idempotent gray Agent Annotation with a short non-empty title and a meaningful confirmed observation or reasonable assumption body. For each section, create its Annotation before creating that section's colored Question cards. Use the same three evidence anchor modes as Questions: a single node/region for one specific target, a single surface for a whole Frame, or focus-target-set for repeated/shared elements. At least one gray Agent Annotation is mandatory in every section before Alignment preparation can finish.",
    inputSchema: createAgentAnnotationInputSchema
  }, async (args) => {
    const ctx = await active("create_agent_annotation");
    if (!ctx.ok) return ctx.result;
    const result = createAgentAnnotationCommand(ctx.projectPath, args);
    return result.ok ? success(ctx.rt, result) : failureResult("create_agent_annotation", result.reason, ctx.rt);
  });

  mcp.registerTool("append_agent_annotation_information", {
    description: "Append designer or Agent information to an existing Agent Annotation without affecting Alignment coverage.",
    inputSchema: appendAgentAnnotationInformationInputSchema
  }, async (args) => {
    const ctx = await active("append_agent_annotation_information");
    if (!ctx.ok) return ctx.result;
    const result = appendAgentAnnotationInformationCommand(ctx.projectPath, args.annotationId, args.information);
    return result.ok ? success(ctx.rt, result) : failureResult("append_agent_annotation_information", result.reason, ctx.rt);
  });

  mcp.registerTool("record_designer_answer", {
    description: "Persist an explicit non-empty designer confirmation for a Question card. Submitting the unchanged proposed answer records agent-proposed-designer-accepted; submitting an edited answer records designer-edited. A proposed answer alone never counts toward Alignment coverage.",
    inputSchema: recordDesignerAnswerInputSchema
  }, async (args) => {
    const ctx = await active("record_designer_answer");
    if (!ctx.ok) return ctx.result;
    const result = recordDesignerAnswerCommand(ctx.projectPath, args);
    return result.ok ? success(ctx.rt, result) : failureResult("record_designer_answer", result.reason, ctx.rt);
  });

  mcp.registerTool("update_alignment_question_title", {
    description: "Replace a Question card's title with a concise 2–5 word noun phrase (48 characters maximum). Use this to correct a verbose or sentence-like generated title.",
    inputSchema: updateAlignmentQuestionTitleInputSchema
  }, async (args) => {
    const ctx = await active("update_alignment_question_title");
    if (!ctx.ok) return ctx.result;
    const result = updateAlignmentQuestionTitleCommand(ctx.projectPath, args);
    return result.ok ? success(ctx.rt, result) : failureResult("update_alignment_question_title", result.reason, ctx.rt);
  });

  mcp.registerTool("update_alignment_question_anchor", {
    description: "Replace a Question card's evidence anchor. Use a single surface target for a whole-Frame question (no Annotation, Focus Mode, or connector), a node/region for one specific element or component, and a focus-target-set for repeated/shared elements across components or Frames. Focus Mode activates on hover or click without moving the camera.",
    inputSchema: updateAlignmentQuestionAnchorInputSchema
  }, async (args) => {
    const ctx = await active("update_alignment_question_anchor");
    if (!ctx.ok) return ctx.result;
    const result = updateAlignmentQuestionAnchorCommand(ctx.projectPath, args);
    return result.ok ? success(ctx.rt, result) : failureResult("update_alignment_question_anchor", result.reason, ctx.rt);
  });

  mcp.registerTool("read_design_intent_alignment", {
    description: "Read the latest Runtime-owned Agent Annotations, Question cards, final answers, answer sources, coverage, and Alignment status. No arguments."
  }, async () => {
    const ctx = await active("read_design_intent_alignment");
    if (!ctx.ok) return ctx.result;
    return success(ctx.rt, { ok: true, ...readDesignIntentAlignmentCommand(ctx.projectPath) });
  });
}
