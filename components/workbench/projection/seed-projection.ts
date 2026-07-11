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
  originalDesignIntent: string;
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
  props: SeedReferenceProjectionShape["props"];
  meta: SeedReferenceProjectionMeta;
};

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

/** Default 4-column grid placement for newly created seed shapes. */
export function defaultSeedProjectionLayout(index: number): {
  x: number;
  y: number;
} {
  const column = index % 4;
  const row = Math.floor(index / 4);
  return {
    x: 120 + column * 420,
    y: 140 + row * 560
  };
}

export function buildSeedProjectionTargets(
  seeds: SeedReferenceRecord[],
  surfaces: FigmaEvidenceSurfaceRecord[],
  session: string
): SeedProjectionTarget[] {
  const targets: SeedProjectionTarget[] = [];
  const claimedSurfaceIds = new Set<string>();

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
 */
export function planSeedProjectionOps(
  targets: SeedProjectionTarget[],
  existing: SeedProjectionExisting[],
  shapeIdForKey: (shapeKey: string) => string
): SeedProjectionOp[] {
  const ops: SeedProjectionOp[] = [];
  const existingById = new Map(existing.map((s) => [s.id, s]));
  const wantIds = new Set<string>();

  targets.forEach((target, index) => {
    const shapeId = shapeIdForKey(target.shapeKey);
    wantIds.add(shapeId);
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
      return;
    }

    const layout = defaultSeedProjectionLayout(index);
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
        frameName: target.frameName,
        screenshotDataUrl: target.screenshotDataUrl,
        hasScreenshotArtifact: target.hasScreenshotArtifact,
        awaitingEvidence: target.awaitingEvidence,
        awaitingUx: target.awaitingUx,
        naturalMediaW: 0,
        naturalMediaH: 0
      },
      meta: target.meta
    });
  });

  for (const shape of existing) {
    if (!wantIds.has(shape.id)) {
      ops.push({ type: "delete", id: shape.id });
    }
  }

  return ops;
}
