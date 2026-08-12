import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  commandErrorHttpStatus,
  decideRuleUpdateProposalCommand,
  decideRuleUpdateProposalInputSchema,
  getRuleUpdateReviewProjectionCommand,
  parseCommandInput,
  requireActiveProjectCommand,
  reviseRuleUpdateProposalCommand,
  reviseRuleUpdateProposalInputSchema
} from "../../../lib/runtime/commands";
import { authorize } from "../../../lib/runtime/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function context(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) {
    return {
      response: NextResponse.json(
        { ok: false, error: auth.reason },
        { status: auth.status }
      )
    };
  }
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
  const result = getRuleUpdateReviewProjectionCommand(ctx.projectPath);
  return result.ok
    ? NextResponse.json(result)
    : NextResponse.json(
        { ok: false, error: result.reason },
        { status: commandErrorHttpStatus(result.reason) }
      );
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
  const raw = body && typeof body === "object" ? body as Record<string, unknown> : {};
  if (raw.action === "revise") {
    const parsed = parseCommandInput(reviseRuleUpdateProposalInputSchema, raw.input);
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.reason }, { status: 400 });
    const result = reviseRuleUpdateProposalCommand(ctx.projectPath, parsed.data);
    return result.ok
      ? NextResponse.json(result)
      : NextResponse.json(
          { ok: false, error: result.reason },
          { status: commandErrorHttpStatus(result.reason) }
        );
  }
  if (raw.action === "decide") {
    const parsed = parseCommandInput(decideRuleUpdateProposalInputSchema, raw.input);
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.reason }, { status: 400 });
    const result = decideRuleUpdateProposalCommand(ctx.projectPath, parsed.data);
    return result.ok
      ? NextResponse.json(result)
      : NextResponse.json(
          { ok: false, error: result.reason },
          { status: commandErrorHttpStatus(result.reason) }
        );
  }
  return NextResponse.json({ ok: false, error: "invalid_action" }, { status: 400 });
}
