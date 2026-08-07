// GET /api/prototype-surface
//
// Thin HTTP adapter: authorize + active project + shared prototype command.
// Read-only. Prototype Evidence Surfaces are created only by the Agent through
// the record_preview MCP tool (Issue 30) — the Workbench never writes one.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorize } from "../../../lib/runtime/session";
import { restorePrototypePreviewsOnce } from "../../../lib/runtime/prototype-surface";
import {
  commandErrorHttpStatus,
  listPrototypeSurfacesCommand,
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

  // Session restore (fire-and-forget, at most once per project per Runtime):
  // surfaces parked by the previous Runtime's shutdown flip to `starting` —
  // synchronously, so this very response is honest — then are adopted or
  // respawned while the Workbench follows the normal record-event refresh.
  void restorePrototypePreviewsOnce(state.project.path);

  const listed = listPrototypeSurfacesCommand(state.project.path);
  return NextResponse.json({ ok: true, records: listed.records });
}
