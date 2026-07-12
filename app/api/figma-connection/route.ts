// GET / POST /api/figma-connection — installation-scoped Figma Connection Gate.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorize } from "../../../lib/runtime/session";
import {
  commandErrorHttpStatus,
  connectFigmaCommand,
  disconnectFigmaCommand,
  getFigmaConnectionStatusCommand
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

  const status = await getFigmaConnectionStatusCommand();
  return NextResponse.json({ ok: true, ...status });
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

  const token =
    body !== null &&
    typeof body === "object" &&
    typeof (body as Record<string, unknown>).token === "string"
      ? (body as Record<string, unknown>).token
      : "";

  const result = await connectFigmaCommand(token);
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
