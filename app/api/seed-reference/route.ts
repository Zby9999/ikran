// GET / POST /api/seed-reference
//
// Thin HTTP adapter: authorize + active project + shared seed commands.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorize } from "../../../lib/runtime/session";
import {
  commandErrorHttpStatus,
  listSeedReferencesCommand,
  parseCommandInput,
  registerSeedReferenceInputSchema,
  registerSeedReferenceCommand,
  requireActiveProjectCommand
} from "../../../lib/runtime/commands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.reason },
      { status: auth.status }
    );
  }

  const state = requireActiveProjectCommand();
  if (!state.ok) {
    return NextResponse.json(
      { ok: false, error: state.reason },
      { status: commandErrorHttpStatus(state.reason) }
    );
  }

  const listed = listSeedReferencesCommand(state.project.path);
  return NextResponse.json({ ok: true, records: listed.records });
}

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

  // HTTP source policy is deliberately outside the Agent command schema:
  // MCP never exposes registeredVia, while HTTP still cannot mint UI rows.
  if (
    body !== null &&
    typeof body === "object" &&
    (body as Record<string, unknown>).registeredVia === "ui"
  ) {
    return NextResponse.json(
      { ok: false, error: "ui_registration_disabled" },
      { status: commandErrorHttpStatus("ui_registration_disabled") }
    );
  }

  const parsed = parseCommandInput(registerSeedReferenceInputSchema, body);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: parsed.reason },
      { status: commandErrorHttpStatus(parsed.reason) }
    );
  }

  const state = requireActiveProjectCommand();
  if (!state.ok) {
    return NextResponse.json(
      { ok: false, error: state.reason },
      { status: commandErrorHttpStatus(state.reason) }
    );
  }

  const result = registerSeedReferenceCommand(state.project.path, parsed.data, {
    enforceHttpVia: true
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason },
      { status: commandErrorHttpStatus(result.reason) }
    );
  }

  return NextResponse.json({
    ok: true,
    record: result.record,
    event_id: result.event_id,
    ...(result.reused ? { reused: true } : {})
  });
}
