// GET /api/artifacts/<project-relative-path>?session=...
//
// Serves Agent-declared evidence screenshots (and other project-local
// artifacts) to the Workbench. Auth: same authorize() as other privileged
// routes (localhost + session header or ?session=). Path must stay under the
// active project root (reuse evidence-package escape check). Runtime never
// fetches Figma — only reads files the Agent already wrote into the project.

import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorize } from "../../../../lib/runtime/session";
import { getActiveProjectState } from "../../../../lib/runtime/project";
import { resolveProjectArtifactPath } from "../../../../lib/runtime/evidence-package";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml"
};

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
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
      { status: 400 }
    );
  }

  const { path: segments } = await context.params;
  if (!Array.isArray(segments) || segments.length === 0) {
    return NextResponse.json(
      { ok: false, error: "missing_path" },
      { status: 400 }
    );
  }

  // Join URL segments into a project-relative path. Reject empty / "." / ".."
  // segments early; resolveProjectArtifactPath still enforces root escape.
  for (const seg of segments) {
    if (!seg || seg === "." || seg === "..") {
      return NextResponse.json(
        { ok: false, error: "artifact_path_escape" },
        { status: 400 }
      );
    }
  }
  const relativePath = segments.join("/");

  const absolute = resolveProjectArtifactPath(state.project.path, relativePath);
  if (absolute === null) {
    return NextResponse.json(
      { ok: false, error: "artifact_path_escape" },
      { status: 400 }
    );
  }

  if (!existsSync(absolute)) {
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: 404 }
    );
  }

  let st;
  try {
    st = statSync(absolute);
  } catch {
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: 404 }
    );
  }
  if (!st.isFile()) {
    return NextResponse.json(
      { ok: false, error: "not_a_file" },
      { status: 400 }
    );
  }

  let bytes: Buffer;
  try {
    bytes = readFileSync(absolute);
  } catch {
    return NextResponse.json(
      { ok: false, error: "read_failed" },
      { status: 500 }
    );
  }

  // NextResponse BodyInit rejects Node Buffer typings; Uint8Array is accepted.
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": contentTypeFor(absolute),
      "Cache-Control": "private, max-age=60",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
