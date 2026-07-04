// GET /api/tasks/[id] — one task detail (refresh rebuild source).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorize } from "../../../../lib/runtime/session";
import { getActiveProjectState } from "../../../../lib/runtime/project";
import { getTask } from "../../../../lib/runtime/task-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authorize(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.reason },
      { status: auth.status }
    );
  }

  const { id } = await params;
  const state = getActiveProjectState();
  if (!state.ok) {
    return NextResponse.json(
      { ok: false, error: state.reason },
      { status: 400 }
    );
  }

  const task = getTask(state.project.path, id);
  if (!task) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, task });
}