// GET / POST /api/evidence-package
//
// Thin HTTP adapter: authorize + active project + shared evidence commands.
// Active Agent evidence writes are retired (Issue 05D / ADR 0003). New Figma
// Surfaces are created only via Runtime seed capture (POST /api/seed-capture
// or POST /api/seed-reference → addSeedReferenceCommand). GET remains for
// reading historical Evidence Surfaces.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorize } from "../../../lib/runtime/session";
import {
  commandErrorHttpStatus,
  listEvidenceSurfacesCommand,
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

  const listed = listEvidenceSurfacesCommand(state.project.path);
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

  // Drain body so clients that POST JSON are not left with a hung connection.
  try {
    await request.json();
  } catch {
    /* invalid / empty body — still retired */
  }

  return NextResponse.json(
    { ok: false, error: "endpoint_retired" },
    { status: commandErrorHttpStatus("endpoint_retired") }
  );
}
