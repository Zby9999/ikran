import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorize } from "../../../../lib/runtime/session";
import { getActiveProjectState } from "../../../../lib/runtime/project";
import { parseFigmaReference } from "../../../../lib/runtime/figma-reference";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIGMA_OEMBED_TIMEOUT_MS = 8_000;

export async function POST(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.reason },
      { status: auth.status }
    );
  }

  let body: { figmaSeedReference?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const parsed = parseFigmaReference(body.figmaSeedReference ?? "");
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: parsed.reason },
      { status: 400 }
    );
  }

  const state = getActiveProjectState();
  if (!state.ok) {
    return NextResponse.json(
      { ok: false, error: state.reason },
      { status: 400 }
    );
  }

  // The oembed fetch is the only network call in this route. It is mockable
  // so e2e can test the LOCAL contract (parse + accept/reject + response
  // shape) without depending on figma.com (CI / offline / rate-limit / Figma
  // outage). Set IKRAN_FIGMA_OEMBED_MOCK=1 (or =true) to short-circuit with a
  // synthetic oembed derived from the parsed reference; leave it unset for the
  // real probe (manual smoke / a dedicated network test). Per ADR 0001 the
  // Runtime Figma contact surface is slated for retirement; this mock keeps it
  // testable meanwhile.
  const mockFlag = process.env.IKRAN_FIGMA_OEMBED_MOCK;
  const useMock = mockFlag === "1" || mockFlag === "true";
  const probe = useMock
    ? ({ ok: true as const, key: parsed.fileKey, title: "Ikran offline oembed mock" })
    : await fetchFigmaOembed(body.figmaSeedReference ?? "");
  if (!probe.ok || probe.key !== parsed.fileKey) {
    return NextResponse.json(
      { ok: false, error: probe.ok ? "figma_file_mismatch" : probe.error },
      { status: 422 }
    );
  }

  return NextResponse.json({
    ok: true,
    mode: "figma_oembed",
    figmaProbe: {
      status: "ok",
      fileKey: parsed.fileKey,
      nodeId: parsed.nodeId,
      title: probe.title
    }
  });
}

async function fetchFigmaOembed(
  figmaSeedReference: string
): Promise<
  | { ok: true; key: string; title: string }
  | {
      ok: false;
      error:
        | "figma_fetch_timeout"
        | "figma_fetch_failed"
        | "figma_not_found"
        | "invalid_figma_response";
    }
> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FIGMA_OEMBED_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://www.figma.com/api/oembed?url=${encodeURIComponent(figmaSeedReference)}`,
      { signal: controller.signal }
    );
    if (response.status === 404) return { ok: false, error: "figma_not_found" };
    if (!response.ok) return { ok: false, error: "figma_fetch_failed" };

    const data = (await response.json()) as { key?: unknown; title?: unknown };
    if (typeof data.key !== "string" || typeof data.title !== "string") {
      return { ok: false, error: "invalid_figma_response" };
    }
    return { ok: true, key: data.key, title: data.title };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, error: "figma_fetch_timeout" };
    }
    return { ok: false, error: "figma_fetch_failed" };
  } finally {
    clearTimeout(timeout);
  }
}
