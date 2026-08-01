// GET /api/evidence-screenshot?id=<evidence-surface-id>&session=...
//
// Serves the stored frame screenshot of one Evidence Surface (09C-D02), so
// the Design System Browser's "View in frame" lightbox can show the full
// source frame without embedding data URLs in the /api/design-system
// payload. Auth mirrors /api/artifacts: same authorize(), screenshots stay
// behind the session token. Runtime only reads what capture already stored —
// it never fetches Figma here.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorize } from "../../../lib/runtime/session";
import { getActiveProjectState } from "../../../lib/runtime/project";
import { openProjectDb, closeProjectDb } from "../../../lib/runtime/db";
import { commandErrorHttpStatus } from "../../../lib/runtime/commands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA_URL_PATTERN = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,(.+)$/;

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
      { status: commandErrorHttpStatus(state.reason) }
    );
  }

  const id = request.nextUrl.searchParams.get("id")?.trim() ?? "";
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "missing_id" },
      { status: commandErrorHttpStatus("missing_id") }
    );
  }

  let dataUrl = "";
  const db = openProjectDb(state.project.path);
  try {
    const row = db
      .prepare(
        `SELECT screenshot_data_url FROM figma_evidence_surfaces WHERE id = ?`
      )
      .get(id) as { screenshot_data_url: string | null } | undefined;
    dataUrl = row?.screenshot_data_url?.trim() ?? "";
  } finally {
    closeProjectDb(db);
  }

  const match = DATA_URL_PATTERN.exec(dataUrl);
  if (!match) {
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: commandErrorHttpStatus("not_found") }
    );
  }

  return new NextResponse(new Uint8Array(Buffer.from(match[2]!, "base64")), {
    status: 200,
    headers: {
      "Content-Type": match[1]!,
      "Cache-Control": "private, max-age=60",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
