// Pick the Evidence Surface to project for a seed via seed.current_surface_id.
// Append-only history is retained; Workbench only projects the current tip.

import type { FigmaEvidenceSurfaceRecord } from "@/lib/runtime/evidence-package";
import type { SeedReferenceRecord } from "@/lib/runtime/seed-reference";

export function surfaceHasScreenshot(
  surface: FigmaEvidenceSurfaceRecord
): boolean {
  const dataUrl = surface.screenshot_data_url?.trim() ?? "";
  if (dataUrl.length > 0) return true;
  const artifactPath = surface.screenshot_artifact_path?.trim() ?? "";
  return artifactPath.length > 0;
}

/**
 * Resolve the current surface for `seed` via `current_surface_id` only.
 * `claimIds` includes every surface linked to this seed so superseded history
 * rows are not projected as orphan shapes.
 */
export function findSurfaceForSeed(
  seed: SeedReferenceRecord,
  surfaces: FigmaEvidenceSurfaceRecord[]
): {
  surface: FigmaEvidenceSurfaceRecord | null;
  claimIds: string[];
} {
  const claimIds = surfaces
    .filter((s) => s.seed_reference_id === seed.id)
    .map((s) => s.id);

  if (
    typeof seed.current_surface_id !== "string" ||
    seed.current_surface_id.trim().length === 0
  ) {
    return { surface: null, claimIds };
  }

  const surface =
    surfaces.find((s) => s.id === seed.current_surface_id) ?? null;
  return { surface, claimIds };
}
