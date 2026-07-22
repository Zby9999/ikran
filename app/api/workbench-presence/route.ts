import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { commandErrorHttpStatus, requireActiveProjectCommand } from "../../../lib/runtime/commands";
import { reportWorkbenchPresence, type WorkbenchPresence } from "../../../lib/runtime/adaptive-agent-wait";
import { authorize } from "../../../lib/runtime/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.reason }, { status: auth.status });
  const active = requireActiveProjectCommand();
  if (!active.ok) return NextResponse.json({ ok: false, error: active.reason }, { status: commandErrorHttpStatus(active.reason) });
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: "invalid_presence" }, { status: 400 });
  }
  const raw = body as Record<string, unknown>;
  const keys: Array<keyof WorkbenchPresence> = ["visible", "focused", "recentInteraction", "dirty", "semanticActivity", "closed"];
  if (keys.some((key) => typeof raw[key] !== "boolean")) {
    return NextResponse.json({ ok: false, error: "invalid_presence" }, { status: 400 });
  }
  reportWorkbenchPresence(active.project.path, Object.fromEntries(keys.map((key) => [key, raw[key]])) as WorkbenchPresence);
  return NextResponse.json({ ok: true });
}
