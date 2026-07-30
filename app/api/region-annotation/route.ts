// GET / POST / PATCH / PUT / DELETE /api/region-annotation
//
// Thin HTTP adapter: authorize + active project + shared region commands.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorize } from "../../../lib/runtime/session";
import {
  commandErrorHttpStatus,
  confirmAnnotationPrimaryInputSchema,
  confirmAnnotationPrimaryNodeCommand,
  createRegionAnnotationCommand,
  createRegionAnnotationInputSchema,
  deleteRegionAnnotationCommand,
  listRegionAnnotationsCommand,
  parseCommandInput,
  requireActiveProjectCommand,
  restoreRegionAnnotationCommand,
  updateRegionAnnotationBodyCommand,
  updateRegionAnnotationBodyInputSchema
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

  const listed = listRegionAnnotationsCommand(state.project.path);
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

  const parsed = parseCommandInput(createRegionAnnotationInputSchema, body);
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

  const result = createRegionAnnotationCommand(
    state.project.path,
    parsed.data
  );

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason },
      { status: commandErrorHttpStatus(result.reason) }
    );
  }

  return NextResponse.json({
    ok: true,
    record: result.record,
    event_id: result.event_id
  });
}

export async function PATCH(request: NextRequest) {
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

  // Designer body edit dispatches on the presence of a string `body` field;
  // the confirm-primary payload carries no `body`.
  if (
    body !== null &&
    typeof body === "object" &&
    typeof (body as Record<string, unknown>).body === "string"
  ) {
    const parsed = parseCommandInput(updateRegionAnnotationBodyInputSchema, body);
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
    const result = updateRegionAnnotationBodyCommand(
      state.project.path,
      parsed.data
    );
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.reason },
        { status: commandErrorHttpStatus(result.reason) }
      );
    }
    return NextResponse.json({ ok: true, id: result.id });
  }

  const parsed = parseCommandInput(confirmAnnotationPrimaryInputSchema, body);
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
  const result = confirmAnnotationPrimaryNodeCommand(
    state.project.path,
    parsed.data
  );
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason },
      { status: commandErrorHttpStatus(result.reason) }
    );
  }
  return NextResponse.json(result);
}

export async function DELETE(request: NextRequest) {
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

  const id = request.nextUrl.searchParams.get("id")?.trim() ?? "";
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "missing_annotation_id" },
      { status: commandErrorHttpStatus("missing_annotation_id") }
    );
  }

  const result = deleteRegionAnnotationCommand(state.project.path, id);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason },
      { status: commandErrorHttpStatus(result.reason) }
    );
  }

  return NextResponse.json({ ok: true, id: result.id });
}

export async function PUT(request: NextRequest) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: commandErrorHttpStatus("invalid_json") }
    );
  }
  const id =
    body && typeof body === "object"
      ? String((body as Record<string, unknown>).annotationId ?? "").trim()
      : "";
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "missing_annotation_id" },
      { status: commandErrorHttpStatus("missing_annotation_id") }
    );
  }

  const result = restoreRegionAnnotationCommand(state.project.path, id);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason },
      { status: commandErrorHttpStatus(result.reason) }
    );
  }
  return NextResponse.json({ ok: true, id: result.id });
}
