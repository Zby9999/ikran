import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getRuntimeControl } from "../../../../lib/runtime/runtime-lifecycle";
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

  const control = getRuntimeControl();
  if (!control) {
    return NextResponse.json(
      { ok: false, error: "runtime_control_unavailable" },
      { status: 503 }
    );
  }

  // Leave enough time for Next/Node to flush the small 202 response before the
  // Runtime closes its listening socket. Both the UI and CLI wait for this ack.
  setTimeout(() => void control.requestShutdown("user"), 100).unref?.();
  return NextResponse.json(
    { ok: true, status: "stopping" },
    { status: 202, headers: { "Cache-Control": "no-store" } }
  );
}
