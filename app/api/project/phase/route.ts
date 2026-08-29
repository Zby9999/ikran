// PATCH /api/project/phase
//
// Thin HTTP adapter for Workbench-owned phase confirmations.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorize } from "../../../../lib/runtime/session";
import {
  commandErrorHttpStatus,
  confirmPrototypeCommand,
  requireActiveProjectCommand
} from "../../../../lib/runtime/commands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.reason },
      { status: auth.status }
    );
  }
  const active = requireActiveProjectCommand();
  if (!active.ok) {
    return NextResponse.json(
      { ok: false, error: active.reason },
      { status: commandErrorHttpStatus(active.reason) }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const action =
    body && typeof body === "object"
      ? (body as Record<string, unknown>).action
      : undefined;
  if (action !== "confirm-prototype") {
    return NextResponse.json({ ok: false, error: "invalid_action" }, { status: 400 });
  }

  const result = confirmPrototypeCommand(active.project.path, {
    source: "workbench"
  });
  if (result.ok) return NextResponse.json(result);
  return NextResponse.json(
    result.reason === "phase_gate"
      ? { ok: false, error: result.reason, phase: result.phase }
      : { ok: false, error: result.reason },
    { status: commandErrorHttpStatus(result.reason) }
  );
}
