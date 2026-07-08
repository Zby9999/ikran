// POST /api/seed-reference
//
// Semantic MCP tool boundary: registers a Figma seed reference + the
// designer's original design intent for the active Ikran project. Performs a
// LOCAL-only format check (https, figma.com / www.figma.com, /design/ or
// /file/ path); it does NOT access Figma, fetch, or oEmbed. Stores the
// original URL verbatim. On validation failure returns a structured error and
// writes NO record/event. Requires an active project (fail closed).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorize } from "../../../lib/runtime/session";
import { getActiveProjectState } from "../../../lib/runtime/project";
import {
  registerSeedReference,
  type SeedReferenceInput
} from "../../../lib/runtime/seed-reference";

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

  let body: Partial<SeedReferenceInput>;
  try {
    body = (await request.json()) as Partial<SeedReferenceInput>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 }
    );
  }

  const state = getActiveProjectState();
  if (!state.ok) {
    return NextResponse.json(
      { ok: false, error: state.reason },
      { status: 400 }
    );
  }

  const result = registerSeedReference(state.project.path, {
    figmaSeedReference: body.figmaSeedReference ?? "",
    originalDesignIntent: body.originalDesignIntent ?? ""
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason },
      { status: 400 }
    );
  }

  return NextResponse.json({
    ok: true,
    record: result.record,
    event_id: result.event_id,
    ...(result.audit_warning ? { audit_warning: result.audit_warning } : {})
  });
}