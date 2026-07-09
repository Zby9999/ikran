// GET / POST /api/evidence-package
//
// Semantic MCP tool boundary for Figma Evidence Surfaces (Issue 05).
//
// GET lists the Runtime-owned `figma_evidence_surfaces` records for the active
// project so the tldraw Workbench can rebuild its projection from the semantic
// source-of-truth after a page refresh. The tldraw geometry is NEVER the fact
// source — records are. Requires an active project (fail closed).
//
// POST records an Agent-declared evidence package (frame + evidenceViews +
// optional screenshot / designSignals). Performs LOCAL schema validation only;
// it does NOT access Figma, fetch, or oEmbed. On validation failure returns a
// structured error and writes NO surface row (may write `invalid_output`).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorize } from "../../../lib/runtime/session";
import { getActiveProjectState } from "../../../lib/runtime/project";
import {
  recordEvidencePackage,
  listFigmaEvidenceSurfaces
} from "../../../lib/runtime/evidence-package";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/evidence-package — list the active project's Figma Evidence Surface
// records. Used by the tldraw Workbench to rebuild its projection from the
// Runtime semantic record (source-of-truth) after a refresh, and to poll for
// records a real Agent writes via the `record_evidence_package` MCP tool.
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

  const records = listFigmaEvidenceSurfaces(state.project.path);
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

  let body: unknown;
  try {
    body = await request.json();
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

  const result = recordEvidencePackage(state.project.path, body);

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
