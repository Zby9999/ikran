import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorize } from "../../../lib/runtime/session";
import {
  appendAgentAnnotationInformationCommand,
  appendAgentAnnotationInformationInputSchema,
  commandErrorHttpStatus,
  completeDesignIntentAlignmentCommand,
  createAgentAnnotationCommand,
  createAgentAnnotationInputSchema,
  createAlignmentQuestionCardCommand,
  createAlignmentQuestionCardInputSchema,
  parseCommandInput,
  prepareDesignIntentAlignmentCommand,
  readDesignIntentAlignmentCommand,
  recordDesignerAnswerCommand,
  recordDesignerAnswerInputSchema,
  updateAlignmentQuestionAnchorCommand,
  updateAlignmentQuestionAnchorInputSchema,
  updateAlignmentQuestionTitleCommand,
  updateAlignmentQuestionTitleInputSchema,
  requireActiveProjectCommand
} from "../../../lib/runtime/commands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function context(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) return { response: NextResponse.json({ ok: false, error: auth.reason }, { status: auth.status }) };
  const active = requireActiveProjectCommand();
  if (!active.ok) {
    return {
      response: NextResponse.json(
        { ok: false, error: active.reason },
        { status: commandErrorHttpStatus(active.reason) }
      )
    };
  }
  return { projectPath: active.project.path };
}

export async function GET(request: NextRequest) {
  const ctx = context(request);
  if ("response" in ctx) return ctx.response;
  return NextResponse.json({ ok: true, ...readDesignIntentAlignmentCommand(ctx.projectPath) });
}

export async function POST(request: NextRequest) {
  const ctx = context(request);
  if ("response" in ctx) return ctx.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const action = body && typeof body === "object" ? (body as Record<string, unknown>).action : undefined;
  const payload = body && typeof body === "object" ? (body as Record<string, unknown>).input : undefined;
  const schema = action === "create-question-card"
    ? createAlignmentQuestionCardInputSchema
    : action === "create-agent-annotation"
      ? createAgentAnnotationInputSchema
      : null;
  if (!schema) return NextResponse.json({ ok: false, error: "invalid_action" }, { status: 400 });
  const parsed = parseCommandInput(schema, payload);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.reason }, { status: 400 });
  const result = action === "create-question-card"
    ? createAlignmentQuestionCardCommand(ctx.projectPath, parsed.data)
    : createAgentAnnotationCommand(ctx.projectPath, parsed.data);
  return result.ok
    ? NextResponse.json(result, { status: 201 })
    : NextResponse.json({ ok: false, error: result.reason }, { status: commandErrorHttpStatus(result.reason) });
}

export async function PATCH(request: NextRequest) {
  const ctx = context(request);
  if ("response" in ctx) return ctx.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const raw = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const action = raw.action;
  if (action === "prepare") {
    const result = prepareDesignIntentAlignmentCommand(ctx.projectPath);
    return result.ok
      ? NextResponse.json(result)
      : NextResponse.json(
          { ok: false, error: result.reason },
          { status: commandErrorHttpStatus(result.reason) }
        );
  }
  if (action === "complete") {
    const result = completeDesignIntentAlignmentCommand(ctx.projectPath);
    return result.ok
      ? NextResponse.json(result)
      : NextResponse.json({ ok: false, error: result.reason }, { status: commandErrorHttpStatus(result.reason) });
  }
  let result;
  if (action === "record-designer-answer") {
    const parsed = parseCommandInput(recordDesignerAnswerInputSchema, raw.input);
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.reason }, { status: 400 });
    result = recordDesignerAnswerCommand(ctx.projectPath, parsed.data);
  } else if (action === "update-question-card-title") {
    const parsed = parseCommandInput(updateAlignmentQuestionTitleInputSchema, raw.input);
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.reason }, { status: 400 });
    result = updateAlignmentQuestionTitleCommand(ctx.projectPath, parsed.data);
  } else if (action === "update-question-card-anchor") {
    const parsed = parseCommandInput(updateAlignmentQuestionAnchorInputSchema, raw.input);
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.reason }, { status: 400 });
    result = updateAlignmentQuestionAnchorCommand(ctx.projectPath, parsed.data);
  } else if (action === "append-agent-annotation-information") {
    const parsed = parseCommandInput(appendAgentAnnotationInformationInputSchema, raw.input);
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.reason }, { status: 400 });
    result = appendAgentAnnotationInformationCommand(
      ctx.projectPath,
      parsed.data.annotationId,
      parsed.data.information
    );
  } else {
    return NextResponse.json({ ok: false, error: "invalid_action" }, { status: 400 });
  }
  return result.ok
    ? NextResponse.json(result)
    : NextResponse.json({ ok: false, error: result.reason }, { status: commandErrorHttpStatus(result.reason) });
}
