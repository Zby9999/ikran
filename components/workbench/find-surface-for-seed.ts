// Pick which Figma Evidence Surface to project for a seed when multiple
// surfaces may exist (e.g. Agent first declared screenshot:missing, then a
// later package with a real screenshot). List order is created_at ASC, so
// "first match" would stick on the old awaiting surface.

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
 * A surface matches a seed when:
 * - `seed_reference_id` explicitly points at this seed, OR
 * - URL matches AND the surface is unlinked (`seed_reference_id` null/empty).
 *
 * Never treat a surface that is explicitly linked to *another* seed as a URL
 * fallback — two seeds can share the same Figma URL.
 */
export function matchesSeed(
  surface: FigmaEvidenceSurfaceRecord,
  seed: SeedReferenceRecord
): boolean {
  if (surface.seed_reference_id === seed.id) return true;
  const linkedElsewhere =
    typeof surface.seed_reference_id === "string" &&
    surface.seed_reference_id.trim().length > 0 &&
    surface.seed_reference_id !== seed.id;
  if (linkedElsewhere) return false;
  return surface.figma_seed_reference === seed.figma_seed_reference;
}

function isExplicitlyLinkedToSeed(
  surface: FigmaEvidenceSurfaceRecord,
  seed: SeedReferenceRecord
): boolean {
  return surface.seed_reference_id === seed.id;
}

/**
 * Rank candidates for a seed:
 * 1. screenshot-bearing first
 * 2. newer `created_at`
 * 3. explicit `seed_reference_id` link to this seed
 * 4. id (stable tie-break)
 */
export function compareSurfacesForSeedProjection(
  a: FigmaEvidenceSurfaceRecord,
  b: FigmaEvidenceSurfaceRecord,
  seed: SeedReferenceRecord
): number {
  const aShot = surfaceHasScreenshot(a) ? 1 : 0;
  const bShot = surfaceHasScreenshot(b) ? 1 : 0;
  if (aShot !== bShot) return bShot - aShot;
  if (a.created_at !== b.created_at) {
    return a.created_at < b.created_at ? 1 : -1;
  }
  const aLinked = isExplicitlyLinkedToSeed(a, seed) ? 1 : 0;
  const bLinked = isExplicitlyLinkedToSeed(b, seed) ? 1 : 0;
  if (aLinked !== bLinked) return bLinked - aLinked;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * Choose the best unclaimed surface for `seed`, or null.
 * Also returns every matching surface id that should be claimed so older
 * missing-screenshot rows do not project as orphan shapes.
 */
export function findSurfaceForSeed(
  seed: SeedReferenceRecord,
  surfaces: FigmaEvidenceSurfaceRecord[],
  claimedSurfaceIds: Set<string>
): {
  surface: FigmaEvidenceSurfaceRecord | null;
  claimIds: string[];
} {
  const candidates = surfaces.filter(
    (s) => !claimedSurfaceIds.has(s.id) && matchesSeed(s, seed)
  );
  if (candidates.length === 0) {
    return { surface: null, claimIds: [] };
  }

  candidates.sort((a, b) => compareSurfacesForSeedProjection(a, b, seed));

  return {
    surface: candidates[0],
    claimIds: candidates.map((s) => s.id)
  };
}
