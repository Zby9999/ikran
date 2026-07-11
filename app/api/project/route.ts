// GET /api/project
//
// Thin HTTP adapter: authorize + shared getProjectStateCommand.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authorize } from "../../../lib/runtime/session";
import { getProjectStateCommand } from "../../../lib/runtime/commands";

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

  const state = await getProjectStateCommand();
  return NextResponse.json({
    ok: true,
    project: state.project,
    cwd_candidate: state.cwd_candidate,
    cwd_matches_active: state.cwd_matches_active
  });
}
