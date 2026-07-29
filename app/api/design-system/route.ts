import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorize } from "../../../lib/runtime/session";
import {
  approveDesignSystemEntryCommand,
  approveDesignSystemEntryInputSchema,
  commandErrorHttpStatus,
  getDesignSystemComponentCommand,
  getDesignSystemComponentInputSchema,
  getDesignSystemViewCommand,
  parseCommandInput,
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

// Browser design-system read surface (Issue 09 / 09A decision 2): the view
// model comes from the DB with the evidence chain joined in real time — the
// Browser never reads design-system source files or the derived view.json
// export. POST also carries the v1 write action (09A decision 5, Task D):
// "approve-entry" — the only Browser write, candidate → formalized.
export async function GET(request: NextRequest) {
  const ctx = context(request);
  if ("response" in ctx) return ctx.response;
  const result = getDesignSystemViewCommand(ctx.projectPath);
  return result.ok
    ? NextResponse.json({ ok: true, view: result.view })
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
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (raw.action === "get-component") {
    const parsed = parseCommandInput(getDesignSystemComponentInputSchema, raw.input);
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.reason }, { status: 400 });
    const result = getDesignSystemComponentCommand(ctx.projectPath, parsed.data.componentId);
    return result.ok
      ? NextResponse.json(result)
      : NextResponse.json(
          { ok: false, error: result.reason },
          { status: commandErrorHttpStatus(result.reason) }
        );
  }
  // v1's only write (09A decision 5): candidate → formalized approval.
  // Writes the DB row AND the JSON source file (canonical serialization),
  // logs design_system_entry_approved, emits the design-system record-bus
  // invalidation and regenerates the derived export — all in the command.
  if (raw.action === "approve-entry") {
    const parsed = parseCommandInput(approveDesignSystemEntryInputSchema, raw.input);
    if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.reason }, { status: 400 });
    const result = approveDesignSystemEntryCommand(ctx.projectPath, parsed.data);
    return result.ok
      ? NextResponse.json(result)
      : NextResponse.json(
          { ok: false, error: result.reason, details: result.details },
          { status: commandErrorHttpStatus(result.reason) }
        );
  }
  return NextResponse.json({ ok: false, error: "invalid_action" }, { status: 400 });
}
