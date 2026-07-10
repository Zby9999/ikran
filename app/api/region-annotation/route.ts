// GET / POST /api/region-annotation
//
// Semantic MCP tool boundary for Region Annotations (Issue 06).
//
// GET lists the Runtime-owned `region_annotations` records for the active
// project so the tldraw Workbench can rebuild its projection from the semantic
// source-of-truth after a page refresh. The tldraw geometry is NEVER the fact
// source — records are. Requires an active project (fail closed).
//
// POST creates an anchored Region Annotation (figma-region: normalized rect on
// the Evidence Surface screenshot media box). Performs LOCAL schema validation
// only; it does NOT access Figma. On validation failure returns a structured
// error and writes NO annotation row (may write `invalid_output`).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorize } from "../../../lib/runtime/session";
import { getActiveProjectState } from "../../../lib/runtime/project";
import {
  createRegionAnnotation,
  deleteRegionAnnotation,
  listRegionAnnotations
} from "../../../lib/runtime/region-annotation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/region-annotation — list the active project's Region Annotation
// records. Used by the tldraw Workbench to rebuild its projection from the
// Runtime semantic record (source-of-truth) after a refresh, and to poll for
// records a real Agent writes via the `create_region_annotation` MCP tool.
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

  const records = listRegionAnnotations(state.project.path);
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

  const result = createRegionAnnotation(state.project.path, body);

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

// DELETE /api/region-annotation?id=<annotationId>
// Designer-authored markers only. Agent markers return not_deletable.
export async function DELETE(request: NextRequest) {
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

  const id = request.nextUrl.searchParams.get("id")?.trim() ?? "";
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "missing_annotation_id" },
      { status: 400 }
    );
  }

  const result = deleteRegionAnnotation(state.project.path, id);
  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 400;
    return NextResponse.json(
      { ok: false, error: result.reason },
      { status }
    );
  }

  return NextResponse.json({ ok: true, id: result.id });
}
