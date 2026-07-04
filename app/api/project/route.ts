// GET /api/project
//
// Returns the currently bound active project (if any) and the cwd project
// candidate (if `IKRAN_CWD` was forwarded by the launcher). The Browser UI
// uses this to recover state after a refresh and to auto-bind the folder the
// designer launched Ikran from (Issue 2 supplement).
//
// When there is no active project the response is still 200 with `project:
// null` so the UI can read `cwd_candidate` without a separate 404 path.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authorize } from "../../../lib/runtime/session";
import { getActiveProjectState } from "../../../lib/runtime/project";
import { getCwdCandidate } from "../../../lib/runtime/cwd-candidate";

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

  const cwdCandidate = await getCwdCandidate();

  const state = getActiveProjectState();
  const project = state.ok ? state.project : null;

  return NextResponse.json({
    ok: true,
    project,
    cwd_candidate: cwdCandidate
  });
}