// GET / POST / DELETE / PATCH /api/seed-reference
//
// Thin HTTP adapter: authorize + active project + shared seed commands.
// Active POST writes go through Runtime capture (Figma Connection Gate +
// atomic Seed + Evidence Surface) — same kernel as /api/seed-capture and
// MCP add_seed_reference. Initiator is always "agent" on this route.
// PATCH updates optional Reference Note only (Issue 05B).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorize } from "../../../lib/runtime/session";
import { postAddSeedReference } from "../../../lib/runtime/commands/http-add-seed";
import {
  commandErrorHttpStatus,
  deleteSeedReferenceCommand,
  listSeedReferencesCommand,
  parseCommandInput,
  requireActiveProjectCommand,
  updateSeedReferenceNoteCommand,
  updateSeedReferenceNoteInputSchema
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

  const state = requireActiveProjectCommand();
  if (!state.ok) {
    return NextResponse.json(
      { ok: false, error: state.reason },
      { status: commandErrorHttpStatus(state.reason) }
    );
  }

  const listed = listSeedReferencesCommand(state.project.path);
  return NextResponse.json({ ok: true, records: listed.records });
}

export async function POST(request: NextRequest) {
  return postAddSeedReference(request, "agent", {
    rejectBody: (body) => {
      // HTTP source policy: this Agent write route must not mint UI rows.
      if (
        body !== null &&
        typeof body === "object" &&
        (body as Record<string, unknown>).registeredVia === "ui"
      ) {
        return NextResponse.json(
          { ok: false, error: "ui_registration_disabled" },
          { status: commandErrorHttpStatus("ui_registration_disabled") }
        );
      }
      return null;
    }
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

  const parsed = parseCommandInput(updateSeedReferenceNoteInputSchema, body);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: parsed.reason },
      { status: commandErrorHttpStatus(parsed.reason) }
    );
  }

  const result = updateSeedReferenceNoteCommand(state.project.path, parsed.data);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason },
      { status: commandErrorHttpStatus(result.reason) }
    );
  }

  return NextResponse.json({ ok: true, record: result.record });
}

export async function DELETE(request: NextRequest) {
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

  const id = request.nextUrl.searchParams.get("id")?.trim() ?? "";
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "missing_seed_id" },
      { status: commandErrorHttpStatus("missing_seed_id") }
    );
  }

  const result = deleteSeedReferenceCommand(state.project.path, id);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason },
      { status: commandErrorHttpStatus(result.reason) }
    );
  }

  return NextResponse.json({ ok: true, id: result.id });
}
