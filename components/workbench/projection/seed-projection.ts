// Pure seed / Evidence Surface → tldraw projection planning (Task 12).
// React-free: targets, equality, default layout, reconcile ops.

import {
  SEED_REFERENCE_PROJECTION_DEFAULT_H,
  SEED_REFERENCE_PROJECTION_DEFAULT_W,
  type SeedReferenceProjectionMeta,
  type SeedReferenceProjectionShape
} from "../seed-reference-projection-shape";
import { findSurfaceForSeed } from "../find-surface-for-seed";
import type { SeedReferenceRecord } from "@/lib/runtime/seed-reference";
import type { FigmaEvidenceSurfaceRecord } from "@/lib/runtime/evidence-package";

export type SeedProjectionTarget = {
  /** Stable tldraw shape id key (seed id preferred when linked). */
  shapeKey: string;
  canvasRecordId: string;
  figmaSeedReference: string;
  /** Per-seed Reference Note (historical prop name on the shape). */
  originalDesignIntent: string;
  /** Project-level Design Language Description (shared; Info tip only). */
  designLanguageDescription: string;
  frameName: string;
  /** <img src>: data URL or authenticated /api/artifacts URL. */
  screenshotDataUrl: string;
  /** True when src comes from artifactPath (not an inline data URL). */
  hasScreenshotArtifact: boolean;
  /**
   * Seed (or surface) is projected but there is not yet a screenshot src to
   * show — Workbench media shows awaiting UX until Evidence Surface screenshot
   * arrives.
   */
  awaitingEvidence: boolean;
  /**
   * How to present awaiting state:
   * - `spinner` — Agent-registered seed (loading while Agent continues)
   * - `guide` — UI-registered seed (tell designer to ask Agents for screenshot)
   */
  awaitingUx: "spinner" | "guide";
  meta: SeedReferenceProjectionMeta;
  /** Placeholder size until screenshot onLoad resizes to natural pixels. */
  w: number;
  h: number;
};

export type SeedProjectionExisting = {
  id: string;
  /** Page-space origin — local geometry; may be restored from workbench-layout. */
  x: number;
  y: number;
  props: SeedReferenceProjectionShape["props"];
  meta: SeedReferenceProjectionMeta;
};

/** Persisted frame geometry from `.ikran/workbench-layout.json` (UX only). */
export type SeedProjectionSavedFrame = {
  x: number;
  y: number;
  w: number;
  h: number;
  layoutLocked: boolean;
};

/** Axis-aligned bounds used only for create-time collision packing. */
export type SeedProjectionBounds = {
  x: number;
  y: number;
  w: number;
  h: number;
};

/** Gap between newly placed projections and occupied bounds. */
export const SEED_PROJECTION_LAYOUT_GAP = 60;

export const SEED_PROJECTION_LAYOUT_ORIGIN_X = 120;
export const SEED_PROJECTION_LAYOUT_ORIGIN_Y = 140;

/**
 * Footprint reserved for creates (and for existing shapes that have not yet
 * loaded natural screenshot size). Placeholder 380×520 underestimates real
 * frames after onLoad resize; packing with this reserve keeps siblings from
 * overlapping by default for typical Evidence Surface screenshots.
 */
export const SEED_PROJECTION_LAYOUT_RESERVE_W = 720;
export const SEED_PROJECTION_LAYOUT_RESERVE_H = 960;

export type SeedProjectionCreateOp = {
  type: "create";
  id: string;
  x: number;
  y: number;
  props: SeedReferenceProjectionShape["props"];
  meta: SeedReferenceProjectionMeta;
};

export type SeedProjectionUpdateOp = {
  type: "update";
  id: string;
  props?: Partial<SeedReferenceProjectionShape["props"]>;
  meta?: SeedReferenceProjectionMeta;
};

export type SeedProjectionDeleteOp = {
  type: "delete";
  id: string;
};

export type SeedProjectionOp =
  | SeedProjectionCreateOp
  | SeedProjectionUpdateOp
  | SeedProjectionDeleteOp;

/** Build a same-origin Workbench URL for a project-relative artifact path. */
export function artifactScreenshotUrl(
  relativePath: string,
  session: string
): string {
  const segments = relativePath
    .split(/[/\\]/)
    .filter((s) => s.length > 0)
    .map((s) => encodeURIComponent(s));
  return `/api/artifacts/${segments.join("/")}?session=${encodeURIComponent(session)}`;
}

function screenshotSrcForSurface(
  surface: FigmaEvidenceSurfaceRecord,
  session: string
): { src: string; hasArtifactOnly: boolean } {
  const dataUrl = surface.screenshot_data_url?.trim() ?? "";
  if (dataUrl) return { src: dataUrl, hasArtifactOnly: false };
  const artifactPath = surface.screenshot_artifact_path?.trim() ?? "";
  if (artifactPath && session) {
    return {
      src: artifactScreenshotUrl(artifactPath, session),
      hasArtifactOnly: true
    };
  }
  return { src: "", hasArtifactOnly: false };
}

/** Default 380×520 placeholder — not Figma design-unit bounds. */
function projectionSize(_surface: FigmaEvidenceSurfaceRecord | null): {
  w: number;
  h: number;
} {
  return {
    w: SEED_REFERENCE_PROJECTION_DEFAULT_W,
    h: SEED_REFERENCE_PROJECTION_DEFAULT_H
  };
}

/**
 * Legacy index grid (placeholder stride). Prefer
 * `findNonOverlappingSeedProjectionLayout` for create-time placement.
 */
export function defaultSeedProjectionLayout(index: number): {
  x: number;
  y: number;
} {
  const column = index % 4;
  const row = Math.floor(index / 4);
  return {
    x: SEED_PROJECTION_LAYOUT_ORIGIN_X + column * 420,
    y: SEED_PROJECTION_LAYOUT_ORIGIN_Y + row * 560
  };
}

/** True when two rects overlap or sit closer than `gap` on either axis. */
export function seedProjectionBoundsOverlap(
  a: SeedProjectionBounds,
  b: SeedProjectionBounds,
  gap: number = SEED_PROJECTION_LAYOUT_GAP
): boolean {
  return !(
    a.x + a.w + gap <= b.x ||
    b.x + b.w + gap <= a.x ||
    a.y + a.h + gap <= b.y ||
    b.y + b.h + gap <= a.y
  );
}

/**
 * Packing size for collision checks. Uses natural/current size when known;
 * otherwise reserves space large enough that post-load screenshot resize
 * usually still clears the default gap.
 */
export function seedProjectionLayoutFootprint(
  w: number,
  h: number,
  opts?: { hasNaturalSize?: boolean }
): { w: number; h: number } {
  if (opts?.hasNaturalSize) {
    return { w, h };
  }
  return {
    w: Math.max(w, SEED_PROJECTION_LAYOUT_RESERVE_W),
    h: Math.max(h, SEED_PROJECTION_LAYOUT_RESERVE_H)
  };
}

/** Occupied packing rect for an existing projection shape. */
export function seedProjectionOccupiedBounds(
  shape: {
    x: number;
    y: number;
    props: Pick<
      SeedReferenceProjectionShape["props"],
      "w" | "h" | "naturalMediaW" | "naturalMediaH"
    >;
  }
): SeedProjectionBounds {
  const hasNaturalSize =
    shape.props.naturalMediaW > 0 && shape.props.naturalMediaH > 0;
  const footprint = seedProjectionLayoutFootprint(
    shape.props.w,
    shape.props.h,
    { hasNaturalSize }
  );
  return {
    x: shape.x,
    y: shape.y,
    w: footprint.w,
    h: footprint.h
  };
}

/**
 * Find top-left for a new `w`×`h` rect that clears `occupied` by `gap`.
 * Packs toward the top-left: try origin, then right of / below each occupied
 * rect; fall back to past the rightmost edge.
 */
export function findNonOverlappingSeedProjectionLayout(
  occupied: SeedProjectionBounds[],
  w: number,
  h: number,
  gap: number = SEED_PROJECTION_LAYOUT_GAP
): { x: number; y: number } {
  const origin = {
    x: SEED_PROJECTION_LAYOUT_ORIGIN_X,
    y: SEED_PROJECTION_LAYOUT_ORIGIN_Y
  };
  if (occupied.length === 0) return origin;

  const candidates: Array<{ x: number; y: number }> = [origin];
  for (const o of occupied) {
    candidates.push({ x: o.x + o.w + gap, y: o.y });
    candidates.push({ x: o.x, y: o.y + o.h + gap });
    candidates.push({ x: o.x + o.w + gap, y: origin.y });
    candidates.push({ x: origin.x, y: o.y + o.h + gap });
  }
  candidates.sort((a, b) => a.y - b.y || a.x - b.x);

  for (const c of candidates) {
    const next: SeedProjectionBounds = { x: c.x, y: c.y, w, h };
    if (!occupied.some((o) => seedProjectionBoundsOverlap(next, o, gap))) {
      return c;
    }
  }

  const maxRight = Math.max(
    ...occupied.map((o) => o.x + o.w),
    SEED_PROJECTION_LAYOUT_ORIGIN_X
  );
  return { x: maxRight + gap, y: origin.y };
}

/** Optimistic frame while Runtime `/api/seed-capture` is in flight (paste UX).
 *  Ephemeral Workbench UI only — not a persisted "pending Seed Reference". */
export type InFlightSeedCapture = {
  id: string;
  figmaSeedReference: string;
};

export function buildInFlightSeedProjectionTargets(
  inFlight: InFlightSeedCapture[],
  designLanguageDescription = ""
): SeedProjectionTarget[] {
  return inFlight.map((p) => {
    const size = projectionSize(null);
    return {
      shapeKey: `inflight-capture:${p.id}`,
      canvasRecordId: `inflight-capture:${p.id}`,
      figmaSeedReference: p.figmaSeedReference,
      originalDesignIntent: "",
      designLanguageDescription,
      frameName: "Capturing…",
      screenshotDataUrl: "",
      hasScreenshotArtifact: false,
      awaitingEvidence: true,
      awaitingUx: "spinner" as const,
      w: size.w,
      h: size.h,
      meta: {
        canvasRecordId: `inflight-capture:${p.id}`,
        runtimeRecordId: p.id,
        kind: "seed_reference_projection" as const
      }
    };
  });
}

export function buildSeedProjectionTargets(
  seeds: SeedReferenceRecord[],
  surfaces: FigmaEvidenceSurfaceRecord[],
  session: string,
  designLanguageDescription = ""
): SeedProjectionTarget[] {
  const targets: SeedProjectionTarget[] = [];
  const claimedSurfaceIds = new Set<string>();
  const description = designLanguageDescription;

  for (const seed of seeds) {
    const { surface, claimIds } = findSurfaceForSeed(seed, surfaces);
    for (const id of claimIds) claimedSurfaceIds.add(id);

    const size = projectionSize(surface);
    const awaitingUx: "spinner" | "guide" =
      seed.registered_via === "ui" ? "guide" : "spinner";
    if (surface) {
      const shot = screenshotSrcForSurface(surface, session);
      targets.push({
        shapeKey: seed.id,
        canvasRecordId: `seed-reference:${seed.id}`,
        figmaSeedReference: seed.figma_seed_reference,
        originalDesignIntent: seed.original_design_intent,
        designLanguageDescription: description,
        frameName: surface.frame_name,
        screenshotDataUrl: shot.src,
        hasScreenshotArtifact: shot.hasArtifactOnly,
        awaitingEvidence: !shot.src,
        awaitingUx,
        w: size.w,
        h: size.h,
        meta: {
          canvasRecordId: `seed-reference:${seed.id}`,
          runtimeRecordId: surface.id,
          kind: "figma_evidence_surface",
          seedRecordId: seed.id,
          surfaceRecordId: surface.id
        }
      });
    } else {
      targets.push({
        shapeKey: seed.id,
        canvasRecordId: `seed-reference:${seed.id}`,
        figmaSeedReference: seed.figma_seed_reference,
        originalDesignIntent: seed.original_design_intent,
        designLanguageDescription: description,
        frameName: "",
        screenshotDataUrl: "",
        hasScreenshotArtifact: false,
        awaitingEvidence: true,
        awaitingUx,
        w: size.w,
        h: size.h,
        meta: {
          canvasRecordId: `seed-reference:${seed.id}`,
          runtimeRecordId: seed.id,
          kind: "seed_reference_projection"
        }
      });
    }
  }

  for (const surface of surfaces) {
    if (claimedSurfaceIds.has(surface.id)) continue;
    const size = projectionSize(surface);
    const shot = screenshotSrcForSurface(surface, session);
    targets.push({
      shapeKey: `surface:${surface.id}`,
      canvasRecordId: `figma-evidence-surface:${surface.id}`,
      figmaSeedReference: surface.figma_seed_reference,
      originalDesignIntent: "",
      designLanguageDescription: description,
      frameName: surface.frame_name,
      screenshotDataUrl: shot.src,
      hasScreenshotArtifact: shot.hasArtifactOnly,
      awaitingEvidence: !shot.src,
      awaitingUx: "spinner",
      w: size.w,
      h: size.h,
      meta: {
        canvasRecordId: `figma-evidence-surface:${surface.id}`,
        runtimeRecordId: surface.id,
        kind: "figma_evidence_surface",
        seedRecordId: surface.seed_reference_id ?? undefined,
        surfaceRecordId: surface.id
      }
    });
  }

  return targets;
}

/** Geometry (w/h) is local-only — compare semantic projection fields only. */
export function seedProjectionPropsEqual(
  a: SeedReferenceProjectionShape["props"],
  b: SeedProjectionTarget
): boolean {
  return (
    a.figmaSeedReference === b.figmaSeedReference &&
    a.originalDesignIntent === b.originalDesignIntent &&
    a.designLanguageDescription === b.designLanguageDescription &&
    a.frameName === b.frameName &&
    a.screenshotDataUrl === b.screenshotDataUrl &&
    a.hasScreenshotArtifact === b.hasScreenshotArtifact &&
    a.awaitingEvidence === b.awaitingEvidence &&
    a.awaitingUx === b.awaitingUx
  );
}

export function seedProjectionMetaEqual(
  a: SeedReferenceProjectionMeta,
  b: SeedReferenceProjectionMeta
): boolean {
  return (
    a.canvasRecordId === b.canvasRecordId &&
    a.runtimeRecordId === b.runtimeRecordId &&
    a.kind === b.kind &&
    (a.seedRecordId ?? "") === (b.seedRecordId ?? "") &&
    (a.surfaceRecordId ?? "") === (b.surfaceRecordId ?? "")
  );
}

/**
 * Plan create/update/delete ops for seed-reference-projection shapes.
 * `shapeIdForKey` maps target.shapeKey → tldraw shape id string.
 * Geometry is assigned only on create: prefer `savedFrames` (Workbench UX
 * layout) when present, otherwise collision-aware packing. Updates never move
 * shapes the designer has already positioned.
 */
export function planSeedProjectionOps(
  targets: SeedProjectionTarget[],
  existing: SeedProjectionExisting[],
  shapeIdForKey: (shapeKey: string) => string,
  options?: {
    savedFrames?: ReadonlyMap<string, SeedProjectionSavedFrame> | Record<
      string,
      SeedProjectionSavedFrame
    >;
  }
): SeedProjectionOp[] {
  const ops: SeedProjectionOp[] = [];
  const existingById = new Map(existing.map((s) => [s.id, s]));
  const wantIds = new Set(targets.map((t) => shapeIdForKey(t.shapeKey)));
  // Only shapes that will remain occupy space for create packing (deletes free
  // their slots in the same plan pass).
  const occupied: SeedProjectionBounds[] = existing
    .filter((s) => wantIds.has(s.id))
    .map(seedProjectionOccupiedBounds);

  const savedFramesOption = options?.savedFrames;
  const savedForKey = (
    shapeKey: string
  ): SeedProjectionSavedFrame | undefined => {
    if (!savedFramesOption) return undefined;
    if (savedFramesOption instanceof Map) {
      return savedFramesOption.get(shapeKey);
    }
    const asRecord = savedFramesOption as Record<
      string,
      SeedProjectionSavedFrame
    >;
    return asRecord[shapeKey];
  };

  for (const target of targets) {
    const shapeId = shapeIdForKey(target.shapeKey);
    const current = existingById.get(shapeId);

    if (current) {
      const screenshotChanged =
        current.props.screenshotDataUrl !== target.screenshotDataUrl;
      const clearNatural =
        screenshotChanged || target.screenshotDataUrl.trim().length === 0;
      const propsChanged = !seedProjectionPropsEqual(current.props, target);
      const metaChanged = !seedProjectionMetaEqual(current.meta, target.meta);
      if (propsChanged || metaChanged) {
        const nextProps: Partial<SeedReferenceProjectionShape["props"]> = {
          figmaSeedReference: target.figmaSeedReference,
          originalDesignIntent: target.originalDesignIntent,
          designLanguageDescription: target.designLanguageDescription,
          frameName: target.frameName,
          screenshotDataUrl: target.screenshotDataUrl,
          hasScreenshotArtifact: target.hasScreenshotArtifact,
          awaitingEvidence: target.awaitingEvidence,
          awaitingUx: target.awaitingUx,
          ...(clearNatural ? { naturalMediaW: 0, naturalMediaH: 0 } : {})
        };
        ops.push({
          type: "update",
          id: shapeId,
          ...(propsChanged ? { props: nextProps } : {}),
          ...(metaChanged ? { meta: target.meta } : {})
        });
      }
      continue;
    }

    const saved = savedForKey(target.shapeKey);
    if (saved) {
      occupied.push({
        x: saved.x,
        y: saved.y,
        w: saved.w,
        h: saved.h
      });
      ops.push({
        type: "create",
        id: shapeId,
        x: saved.x,
        y: saved.y,
        props: {
          w: saved.w,
          h: saved.h,
          figmaSeedReference: target.figmaSeedReference,
          originalDesignIntent: target.originalDesignIntent,
          designLanguageDescription: target.designLanguageDescription,
          frameName: target.frameName,
          screenshotDataUrl: target.screenshotDataUrl,
          hasScreenshotArtifact: target.hasScreenshotArtifact,
          awaitingEvidence: target.awaitingEvidence,
          awaitingUx: target.awaitingUx,
          naturalMediaW: 0,
          naturalMediaH: 0,
          layoutLocked: saved.layoutLocked
        },
        meta: target.meta
      });
      continue;
    }

    const footprint = seedProjectionLayoutFootprint(target.w, target.h, {
      hasNaturalSize: false
    });
    const layout = findNonOverlappingSeedProjectionLayout(
      occupied,
      footprint.w,
      footprint.h
    );
    occupied.push({
      x: layout.x,
      y: layout.y,
      w: footprint.w,
      h: footprint.h
    });
    ops.push({
      type: "create",
      id: shapeId,
      x: layout.x,
      y: layout.y,
      props: {
        w: target.w,
        h: target.h,
        figmaSeedReference: target.figmaSeedReference,
        originalDesignIntent: target.originalDesignIntent,
        designLanguageDescription: target.designLanguageDescription,
        frameName: target.frameName,
        screenshotDataUrl: target.screenshotDataUrl,
        hasScreenshotArtifact: target.hasScreenshotArtifact,
        awaitingEvidence: target.awaitingEvidence,
        awaitingUx: target.awaitingUx,
        naturalMediaW: 0,
        naturalMediaH: 0,
        layoutLocked: false
      },
      meta: target.meta
    });
  }

  for (const shape of existing) {
    if (!wantIds.has(shape.id)) {
      ops.push({ type: "delete", id: shape.id });
    }
  }

  return ops;
}

/** Shape snapshot for post-screenshot-load overlap reflow. */
export type SeedProjectionReflowShape = {
  id: string;
  x: number;
  y: number;
  /** When true, designer positioned this frame — reflow must not move it. */
  layoutLocked: boolean;
  props: Pick<
    SeedReferenceProjectionShape["props"],
    "w" | "h" | "naturalMediaW" | "naturalMediaH"
  >;
};

export type SeedProjectionMoveOp = {
  type: "move";
  id: string;
  x: number;
  y: number;
};

/**
 * True when any unlocked frame overlaps another seed frame (locked or not)
 * closer than the layout gap. Used to skip no-op reflows after onLoad.
 */
export function seedProjectionNeedsReflow(
  shapes: SeedProjectionReflowShape[]
): boolean {
  const bounds = shapes.map((s) => ({
    id: s.id,
    locked: s.layoutLocked,
    ...seedProjectionOccupiedBounds(s)
  }));
  for (let i = 0; i < bounds.length; i++) {
    for (let j = i + 1; j < bounds.length; j++) {
      const a = bounds[i];
      const b = bounds[j];
      // Two locked frames may overlap if the designer stacked them — leave them.
      if (a.locked && b.locked) continue;
      if (seedProjectionBoundsOverlap(a, b)) return true;
    }
  }
  return false;
}

/**
 * Re-pack unlocked seed projections after natural screenshot size is known.
 * Locked frames stay put and act as obstacles. Deterministic order by id.
 * Returns only moves that change x/y.
 */
export function planSeedProjectionReflowMoves(
  shapes: SeedProjectionReflowShape[]
): SeedProjectionMoveOp[] {
  if (!seedProjectionNeedsReflow(shapes)) return [];

  const locked = shapes.filter((s) => s.layoutLocked);
  const movable = shapes
    .filter((s) => !s.layoutLocked)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));

  const occupied: SeedProjectionBounds[] = locked.map(
    seedProjectionOccupiedBounds
  );
  const moves: SeedProjectionMoveOp[] = [];

  for (const shape of movable) {
    const footprint = seedProjectionOccupiedBounds(shape);
    const layout = findNonOverlappingSeedProjectionLayout(
      occupied,
      footprint.w,
      footprint.h
    );
    occupied.push({
      x: layout.x,
      y: layout.y,
      w: footprint.w,
      h: footprint.h
    });
    if (layout.x !== shape.x || layout.y !== shape.y) {
      moves.push({ type: "move", id: shape.id, x: layout.x, y: layout.y });
    }
  }

  return moves;
}
