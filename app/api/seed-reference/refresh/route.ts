import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  commandErrorHttpStatus,
  parseCommandInput,
  refreshSeedReferenceCommand,
  refreshSeedReferenceInputSchema,
  requireActiveProjectCommand
} from "@/lib/runtime/commands";
import { authorize } from "@/lib/runtime/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.reason },
      { status: auth.status }
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: commandErrorHttpStatus("invalid_json") }
    );
  }
  const parsed = parseCommandInput(refreshSeedReferenceInputSchema, body);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: parsed.reason },
      { status: commandErrorHttpStatus(parsed.reason) }
    );
  }
  const active = requireActiveProjectCommand();
  if (!active.ok) {
    return NextResponse.json(
      { ok: false, error: active.reason },
      { status: commandErrorHttpStatus(active.reason) }
    );
  }
  const result = await refreshSeedReferenceCommand(active.project.path, {
    seedReferenceId: parsed.data.seedReferenceId,
    initiator: "ui"
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason },
      { status: commandErrorHttpStatus(result.reason) }
    );
  }
  return NextResponse.json(result);
}
