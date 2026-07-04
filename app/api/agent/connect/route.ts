import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { connectAgent, isAgentId } from "../../../../lib/runtime/agent-connect";
import {
  getActiveProjectState,
  projectPathsMatch,
  setProjectConnectedAgent
} from "../../../../lib/runtime/project";
import { authorize } from "../../../../lib/runtime/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.reason },
      { status: auth.status }
    );
  }

  let body: { agent?: string; projectPath?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 }
    );
  }

  const agent = body.agent ?? "";
  if (!isAgentId(agent)) {
    return NextResponse.json(
      { ok: false, error: "invalid_agent" },
      { status: 400 }
    );
  }

  const projectPath = body.projectPath ?? "";
  if (!projectPath || typeof projectPath !== "string") {
    return NextResponse.json(
      { ok: false, error: "missing_project_path" },
      { status: 400 }
    );
  }

  const state = getActiveProjectState();
  if (!state.ok) {
    return NextResponse.json(
      { ok: false, error: "agent_requires_project" },
      { status: 400 }
    );
  }

  if (!projectPathsMatch(projectPath, state.project.path)) {
    return NextResponse.json(
      { ok: false, error: "project_mismatch" },
      { status: 409 }
    );
  }

  const result = await connectAgent(agent);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason },
      { status: 503 }
    );
  }

  setProjectConnectedAgent(state.project.path, result.agent);

  return NextResponse.json({
    ok: true,
    agent: result.agent,
    projectPath: state.project.path
  });
}
