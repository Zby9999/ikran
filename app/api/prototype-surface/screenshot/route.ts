// POST /api/prototype-surface/screenshot
// Refresh a rebuildable Prototype Surface placeholder at the Workbench
// canonical CSS viewport width. A surface has one effective bitmap globally;
// using each Workbench tab's width would make multiple tabs continuously
// overwrite one another and visibly rescale the canvas image.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  commandErrorHttpStatus,
  requireActiveProjectCommand
} from "../../../../lib/runtime/commands";
import {
  capturePrototypeSurfaceScreenshot,
  defaultPrototypeScreenshotDeps
} from "../../../../lib/runtime/prototype-screenshot";
import {
  prototypeScreenshotViewportWidthFromPath,
  PROTOTYPE_SCREENSHOT_DEFAULT_VIEWPORT_WIDTH
} from "../../../../lib/runtime/prototype-screenshot-shared";
import { getPrototypeSurface } from "../../../../lib/runtime/prototype-surface";
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
  const active = requireActiveProjectCommand();
  if (!active.ok) {
    return NextResponse.json(
      { ok: false, error: active.reason },
      { status: commandErrorHttpStatus(active.reason) }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 }
    );
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { ok: false, error: "invalid_screenshot_request" },
      { status: 400 }
    );
  }
  const raw = body as Record<string, unknown>;
  const surfaceId =
    typeof raw.surfaceId === "string" ? raw.surfaceId.trim() : "";
  if (surfaceId.length === 0) {
    return NextResponse.json(
      { ok: false, error: "invalid_screenshot_request" },
      { status: 400 }
    );
  }

  const surface = getPrototypeSurface(active.project.path, surfaceId);
  if (!surface) {
    return NextResponse.json(
      { ok: false, error: "prototype_surface_not_found" },
      { status: 404 }
    );
  }
  if (
    surface.readiness !== "ready" ||
    surface.stale ||
    surface.surface_url.trim().length === 0
  ) {
    return NextResponse.json(
      { ok: false, error: "preview_unavailable" },
      { status: 409 }
    );
  }
  if (
    prototypeScreenshotViewportWidthFromPath(
      surface.screenshot_artifact_path
    ) === PROTOTYPE_SCREENSHOT_DEFAULT_VIEWPORT_WIDTH
  ) {
    return NextResponse.json({
      ok: true,
      artifactPath: surface.screenshot_artifact_path,
      reused: true
    });
  }

  const result = await capturePrototypeSurfaceScreenshot(
    active.project.path,
    surface.id,
    surface.surface_url,
    defaultPrototypeScreenshotDeps
  );
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason },
      { status: 503 }
    );
  }
  return NextResponse.json({ ok: true, artifactPath: result.artifact_path });
}
