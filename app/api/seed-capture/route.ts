// POST /api/seed-capture — Workbench paste path for Runtime-owned Figma capture.

import type { NextRequest } from "next/server";
import { postAddSeedReference } from "../../../lib/runtime/commands/http-add-seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return postAddSeedReference(request, "ui");
}
