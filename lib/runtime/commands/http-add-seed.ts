// Shared HTTP POST body for Active add-seed (Workbench paste + Agent route).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorize } from "../session";
import { addSeedReferenceCommand } from "./seed-capture";
import { addSeedReferenceInputSchema, parseCommandInput } from "./schemas";
import { commandErrorHttpStatus } from "./http-status";
import { requireActiveProjectCommand } from "./project";
import type { SeedCaptureInitiator } from "../seed-capture";

/**
 * Authorize + active project + parse + `addSeedReferenceCommand`.
 * `initiator` is fixed by the calling route (`ui` vs `agent`).
 */
export async function postAddSeedReference(
  request: NextRequest,
  initiator: SeedCaptureInitiator,
  options?: {
    /** Extra gate before command (e.g. reject registeredVia:ui on Agent route). */
    rejectBody?: (body: unknown) => NextResponse | null;
  }
): Promise<NextResponse> {
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

  const rejected = options?.rejectBody?.(body);
  if (rejected) return rejected;

  const state = requireActiveProjectCommand();
  if (!state.ok) {
    return NextResponse.json(
      { ok: false, error: state.reason },
      { status: commandErrorHttpStatus(state.reason) }
    );
  }

  const parsed = parseCommandInput(addSeedReferenceInputSchema, body);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: parsed.reason },
      { status: commandErrorHttpStatus(parsed.reason) }
    );
  }

  const result = await addSeedReferenceCommand(state.project.path, {
    figmaSeedReference: parsed.data.figmaSeedReference,
    referenceNote: parsed.data.referenceNote,
    initiator
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.reason },
      { status: commandErrorHttpStatus(result.reason) }
    );
  }

  return NextResponse.json({
    ok: true,
    record: result.record,
    surface: result.surface,
    event_id: result.event_id,
    ...(result.reused ? { reused: true } : {})
  });
}
