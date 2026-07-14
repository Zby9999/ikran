// GET /api/pending-seed-evidence — retired Agent orchestration reader.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorize } from "../../../lib/runtime/session";
import { commandErrorHttpStatus } from "../../../lib/runtime/commands";

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

  return NextResponse.json(
    { ok: false, error: "endpoint_retired" },
    { status: commandErrorHttpStatus("endpoint_retired") }
  );
}
