// GET /api/pending-seed-evidence
//
// Lists active-project `seed_references` that still need an Agent-declared
// Evidence Surface screenshot (non-empty screenshot_data_url or
// screenshot_artifact_path). Used by MCP `list_pending_seed_evidence` so the
// Agent can fulfill UI-registered seeds without Runtime contacting Figma.
//
// Authorize + active project fail-closed. Oldest-first.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorize } from "../../../lib/runtime/session";
import { getActiveProjectState } from "../../../lib/runtime/project";
import { listPendingSeedEvidence } from "../../../lib/runtime/pending-seed-evidence";

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

  const state = getActiveProjectState();
  if (!state.ok) {
    return NextResponse.json(
      { ok: false, error: state.reason },
      { status: 400 }
    );
  }

  const records = listPendingSeedEvidence(state.project.path);
  return NextResponse.json({ ok: true, records });
}
