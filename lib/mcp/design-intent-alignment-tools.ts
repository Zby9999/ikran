import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  appendAgentAnnotationInformationCommand,
  appendAgentAnnotationInformationInputSchema,
  completeDesignIntentAlignmentCommand,
  createAgentAnnotationCommand,
  createAgentAnnotationInputSchema,
  createAlignmentQuestionCardCommand,
  createAlignmentQuestionCardInputSchema,
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

  mcp.registerTool("create_alignment_question_card", {
    description: "Create one Runtime-owned Design Intent Alignment Question card in one of the six allowed sections. The observation field is the card title: use a concise 2–5 word noun phrase (48 characters maximum), never a sentence. For a whole-Frame question use a single surface target; never approximate it with a nearly full-size region. For one specific element or component, prefer its exact positional node; use a free region only when no exact node represents the target. Use focus-target-set for repeated or shared elements (such as color or typography) across one or more components/Frames; Workbench enters Focus Mode on card hover or click without moving the camera.",
    inputSchema: createAlignmentQuestionCardInputSchema
  }, async (args) => {
    const ctx = await active("create_alignment_question_card");
    if (!ctx.ok) return ctx.result;
    const result = createAlignmentQuestionCardCommand(ctx.projectPath, args);
    return result.ok ? success(ctx.rt, result) : failureResult("create_alignment_question_card", result.reason, ctx.rt);
  });

  mcp.registerTool("create_agent_annotation", {
    description: "Create a non-blocking gray Agent Annotation with a short non-empty title and assumption body. confirmed and reasonable inference retain audit provenance but share the same Workbench card kind.",
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
    description: "Immediately persist a non-empty designer-edited final answer for a Question card with auditable answer source.",
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

  mcp.registerTool("complete_design_intent_alignment", {
    description: "Atomically complete Alignment after all six sections have 2–5 covered questions, accepting every remaining non-empty Agent proposal as final with auditable source. No arguments."
  }, async () => {
    const ctx = await active("complete_design_intent_alignment");
    if (!ctx.ok) return ctx.result;
    const result = completeDesignIntentAlignmentCommand(ctx.projectPath);
    return result.ok ? success(ctx.rt, result) : failureResult("complete_design_intent_alignment", result.reason, ctx.rt);
  });

  mcp.registerTool("read_design_intent_alignment", {
    description: "Read the latest Runtime-owned Agent Annotations, Question cards, final answers, answer sources, coverage, and Alignment status. No arguments."
  }, async () => {
    const ctx = await active("read_design_intent_alignment");
    if (!ctx.ok) return ctx.result;
    return success(ctx.rt, { ok: true, ...readDesignIntentAlignmentCommand(ctx.projectPath) });
  });
}
