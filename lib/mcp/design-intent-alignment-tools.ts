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
    description: "Create one Runtime-owned Design Intent Alignment Question card in one of the six allowed sections. Requires a current evidence-linked single anchor or explicit focus target set.",
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
