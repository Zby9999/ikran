// POST /api/tasks  — create + start a task.
// GET  /api/tasks  — list all tasks (refresh rebuild source).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorize } from "../../../lib/runtime/session";
import { getActiveProjectState } from "../../../lib/runtime/project";
import {
  createTask,
  listTasks,
  DEFAULT_TIMEOUT_MS
} from "../../../lib/runtime/task-runner";
import type { TaskFamily } from "../../../lib/runtime/adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FAMILY_WHITELIST: ReadonlySet<TaskFamily> = new Set<TaskFamily>([
  "project_setup",
  "generate_seed_alignment_questions",
  "draft_design_system",
  "reconstruct_seed_prototype",
  "generate_design_system_view",
  "create_new_prototype",
  "rule_update",
  "export_research_package"
]);

export async function GET(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.reason },
      { status: auth.status }
    );
  }

  const state = getActiveProjectState();
  if (!state.ok) return NextResponse.json({ ok: true, tasks: [] }); // nothing bound yet
  const tasks = listTasks(state.project.path);
  return NextResponse.json({ ok: true, tasks });
}

export async function POST(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.reason },
      { status: auth.status }
    );
  }

  let body: {
    family?: string;
    payload?: { input?: unknown; mock?: unknown };
    timeoutMs?: number;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 }
    );
  }

  const family = body.family as TaskFamily;
  if (!family || !FAMILY_WHITELIST.has(family)) {
    return NextResponse.json(
      { ok: false, error: "unknown_family" },
      { status: 400 }
    );
  }
  if (!body.payload || typeof body.payload !== "object") {
    return NextResponse.json(
      { ok: false, error: "invalid_payload" },
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

  const timeoutMs =
    typeof body.timeoutMs === "number" && body.timeoutMs > 0
      ? body.timeoutMs
      : DEFAULT_TIMEOUT_MS;

  const created = createTask(
    state.project.path,
    family,
    { input: body.payload.input, mock: body.payload.mock as never },
    timeoutMs
  );

  return NextResponse.json(
    { ok: true, taskId: created.taskId, status: created.status },
    { status: 201 }
  );
}