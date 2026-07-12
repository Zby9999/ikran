// GET / PATCH /api/project/readiness
//
// Issue 05B: project Design Language Description + readiness preconditions.
// GET returns preconditions (e.g. description_missing) for Issue 07.
// PATCH updates the single project-level Description (not per Seed Reference).

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authorize } from "../../../../lib/runtime/session";
import {
  commandErrorHttpStatus,
  getProjectReadinessCommand,
  parseCommandInput,
  requireActiveProjectCommand,
  setDesignLanguageDescriptionCommand,
  setDesignLanguageDescriptionInputSchema
} from "../../../../lib/runtime/commands";

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

  const readiness = getProjectReadinessCommand(state.project.path);
  return NextResponse.json({
    ok: true,
    preconditions: readiness.preconditions,
    designLanguageDescription: readiness.designLanguageDescription
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

  const parsed = parseCommandInput(
    setDesignLanguageDescriptionInputSchema,
    body
  );
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: parsed.reason },
      { status: commandErrorHttpStatus(parsed.reason) }
    );
  }

  const result = setDesignLanguageDescriptionCommand(
    state.project.path,
    parsed.data.designLanguageDescription
  );
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason },
      { status: commandErrorHttpStatus(result.reason) }
    );
  }

  const readiness = getProjectReadinessCommand(state.project.path);
  return NextResponse.json({
    ok: true,
    designLanguageDescription: result.designLanguageDescription,
    preconditions: readiness.preconditions
  });
}
