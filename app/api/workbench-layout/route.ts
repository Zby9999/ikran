// GET / PUT /api/workbench-layout
//
// Project-local Workbench UX layout (frame geometry + camera). Not research data.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorize } from "../../../lib/runtime/session";
import {
  commandErrorHttpStatus,
  getWorkbenchLayoutCommand,
  putWorkbenchLayoutCommand,
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

  const result = getWorkbenchLayoutCommand(state.project.path);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason },
      { status: commandErrorHttpStatus(result.reason) }
    );
  }

  return NextResponse.json({ ok: true, layout: result.layout });
}

export async function PUT(request: NextRequest) {
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

  const layoutInput =
    body !== null &&
    typeof body === "object" &&
    "layout" in (body as Record<string, unknown>)
      ? (body as { layout: unknown }).layout
      : body;
  const writeRevision =
    body !== null &&
    typeof body === "object" &&
    typeof (body as { writeRevision?: unknown }).writeRevision === "number"
      ? (body as { writeRevision: number }).writeRevision
      : undefined;

  const result = putWorkbenchLayoutCommand(
    state.project.path,
    layoutInput,
    writeRevision
  );
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason },
      { status: commandErrorHttpStatus(result.reason) }
    );
  }

  return NextResponse.json({ ok: true, layout: result.layout });
}
