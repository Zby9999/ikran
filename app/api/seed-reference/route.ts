// GET / POST /api/seed-reference
//
// Semantic MCP tool boundary for seed references (Issue 02/03 + 02/04).
//
// GET lists the Runtime-owned `seed_references` records for the active project
// so the tldraw Workbench can rebuild its projection from the semantic
// source-of-truth after a page refresh (Issue 02/04). The tldraw geometry is
// NEVER the fact source — records are. Requires an active project (fail closed).
//
// POST registers a Figma seed reference + the designer's original design
// intent. Performs a LOCAL-only format check (https, figma.com / www.figma.com,
// /design/ or /file/ path); it does NOT access Figma, fetch, or oEmbed. Stores
// the original URL verbatim. On validation failure returns a structured error
// and writes NO record/event.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorize } from "../../../lib/runtime/session";
import { getActiveProjectState } from "../../../lib/runtime/project";
import {
  registerSeedReference,
  listSeedReferences,
  type SeedReferenceInput
} from "../../../lib/runtime/seed-reference";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/seed-reference — list the active project's seed reference records.
// Used by the tldraw Workbench to rebuild its projection from the Runtime
// semantic record (source-of-truth) after a refresh, and to poll for records a
// real Agent writes via the `register_seed_reference` MCP tool. tldraw geometry
// is never read back here — only the records are.
export async function GET(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.reason },
      { status: auth.status }
    );
  }

  const state = getActiveProjectState();
  if (!state.ok) {
    return NextResponse.json(
      { ok: false, error: state.reason },
      { status: 400 }
    );
  }

  const records = listSeedReferences(state.project.path);
  return NextResponse.json({ ok: true, records });
}

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

  const registeredVia =
    body.registeredVia === "ui" || body.registeredVia === "agent"
      ? body.registeredVia
      : undefined;

  const result = registerSeedReference(state.project.path, {
    figmaSeedReference: body.figmaSeedReference ?? "",
    originalDesignIntent: body.originalDesignIntent ?? "",
    ...(registeredVia ? { registeredVia } : {})
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