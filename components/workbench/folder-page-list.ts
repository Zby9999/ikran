// Page list shown in the post-confirm Build panel (Issue 30, Figma 735:1555).
//
// A "page" is one thing the designer can look at on the canvas: a captured
// Figma seed surface, or a Prototype Evidence Surface reconstructed from it.
// The list is derived from Runtime records only — the panel never invents a
// page that has no record behind it.

import type { SeedReferenceRecord } from "@/lib/runtime/seed-reference";
import type { FigmaEvidenceSurfaceRecord } from "@/lib/runtime/evidence-package";
import type { PrototypeSurfaceRecord } from "@/lib/runtime/prototype-surface";
import { findSurfaceForSeed } from "./find-surface-for-seed";

export type FolderPageKind = "figma" | "website";

export type FolderPageItem = {
  /** Runtime record id — also the canvas focus target. */
  id: string;
  label: string;
  /** `figma` → FigmaIcon (seed page); `website` → GridIcon (prototype page). */
  kind: FolderPageKind;
};

const SEED_PAGE_FALLBACK_LABEL = "Seed Page";
const PROTOTYPE_PAGE_FALLBACK_LABEL = "Page";

export function buildFolderPageItems(input: {
  seeds: readonly SeedReferenceRecord[];
  surfaces: readonly FigmaEvidenceSurfaceRecord[];
  prototypeSurfaces: readonly PrototypeSurfaceRecord[];
}): FolderPageItem[] {
  const items: FolderPageItem[] = [];
  const claimed = new Set<string>();
  const surfaces = [...input.surfaces];

  for (const seed of input.seeds) {
    const { surface, claimIds } = findSurfaceForSeed(seed, surfaces);
    for (const id of claimIds) claimed.add(id);
    items.push({
      id: seed.id,
      label: surface?.frame_name?.trim() || SEED_PAGE_FALLBACK_LABEL,
      kind: "figma"
    });
  }

  for (const surface of surfaces) {
    if (claimed.has(surface.id)) continue;
    items.push({
      id: surface.id,
      label: surface.frame_name.trim() || SEED_PAGE_FALLBACK_LABEL,
      kind: "figma"
    });
  }

  for (const surface of input.prototypeSurfaces) {
    items.push({
      id: surface.id,
      label: surface.name.trim() || PROTOTYPE_PAGE_FALLBACK_LABEL,
      kind: "website"
    });
  }

  return items;
}
