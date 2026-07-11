// POST /api/project/bind
//
// Thin HTTP adapter: authorize + shared bindProjectCommand.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorize } from "../../../../lib/runtime/session";
import {
  bindProjectCommand,
  commandErrorHttpStatus
} from "../../../../lib/runtime/commands";

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

  let body: { path?: string };
  try {
    body = (await request.json()) as { path?: string };
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: commandErrorHttpStatus("invalid_json") }
    );
  }

  if (!body.path || typeof body.path !== "string") {
    return NextResponse.json(
      { ok: false, error: "missing_path" },
      { status: commandErrorHttpStatus("missing_path") }
    );
  }

  const result = await bindProjectCommand(body.path);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason },
      { status: commandErrorHttpStatus(result.reason) }
    );
  }

  return NextResponse.json({
    ok: true,
    project: result.config,
    events: result.events
  });
}
