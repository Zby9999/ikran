// POST /api/seed-capture — Workbench paste path for Runtime-owned Figma capture.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorize } from "../../../lib/runtime/session";
import {
  addSeedReferenceCommand,
  commandErrorHttpStatus,
  requireActiveProjectCommand
} from "../../../lib/runtime/commands";

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

  const state = requireActiveProjectCommand();
  if (!state.ok) {
    return NextResponse.json(
      { ok: false, error: state.reason },
      { status: commandErrorHttpStatus(state.reason) }
    );
  }

  const raw =
    body !== null && typeof body === "object"
      ? (body as Record<string, unknown>)
      : {};

  const result = await addSeedReferenceCommand(state.project.path, {
    figmaSeedReference: raw.figmaSeedReference,
    referenceNote: raw.referenceNote,
    initiator: "ui"
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
    surface: result.surface,
    event_id: result.event_id,
    ...(result.reused ? { reused: true } : {})
  });
}
