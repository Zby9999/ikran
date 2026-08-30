// GET / POST / DELETE /api/figma-connection — installation-scoped Figma Connection Gate.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorize } from "../../../lib/runtime/session";
import {
  commandErrorHttpStatus,
  connectFigmaCommand,
  connectFigmaInputSchema,
  disconnectFigmaCommand,
  getFigmaConnectionStatusCommand,
  parseCommandInput
} from "../../../lib/runtime/commands";
import { studyModeEnabled } from "../../../lib/runtime/study-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function studyFrozenResponse() {
  return NextResponse.json(
    { ok: false, error: "study_frozen" },
    { status: 404 }
  );
}

export async function GET(request: NextRequest) {
  if (studyModeEnabled()) return studyFrozenResponse();
  const auth = authorize(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.reason },
      { status: auth.status }
    );
  }

  const status = await getFigmaConnectionStatusCommand();
  return NextResponse.json({ ok: true, ...status });
}

export async function POST(request: NextRequest) {
  if (studyModeEnabled()) return studyFrozenResponse();
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

  const parsed = parseCommandInput(connectFigmaInputSchema, body);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: parsed.reason },
      { status: commandErrorHttpStatus(parsed.reason) }
    );
  }

  const result = await connectFigmaCommand(parsed.data.token);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason },
      { status: commandErrorHttpStatus(result.reason) }
    );
  }

  // Never echo the token.
  return NextResponse.json({ ok: true, ...result.status });
}

export async function DELETE(request: NextRequest) {
  if (studyModeEnabled()) return studyFrozenResponse();
  const auth = authorize(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.reason },
      { status: auth.status }
    );
  }

  await disconnectFigmaCommand();
  return NextResponse.json({ ok: true, connected: false });
}
