// Pure Prototype Evidence Surface → tldraw projection planning (Issue 30).
// React-free: targets, equality, create packing, reconcile ops.

import {
  PROTOTYPE_SURFACE_PROJECTION_DEFAULT_H,
  PROTOTYPE_SURFACE_PROJECTION_DEFAULT_W,
  type PrototypeSurfaceProjectionMeta,
  type PrototypeSurfaceProjectionShape
} from "../prototype-surface-shape";
import {
  findNonOverlappingSeedProjectionLayout,
  type SeedProjectionBounds
} from "./seed-projection";
import type { PrototypeSurfaceRecord } from "@/lib/runtime/prototype-surface";

export type PrototypeSurfaceProjectionTarget = {
  /** Stable tldraw shape id key — the Runtime surface id. */
  shapeKey: string;
  props: Omit<PrototypeSurfaceProjectionShape["props"], "w" | "h">;
  meta: PrototypeSurfaceProjectionMeta;
  w: number;
  h: number;
};

export type PrototypeSurfaceProjectionExisting = {
  id: string;
  x: number;
  y: number;
  props: PrototypeSurfaceProjectionShape["props"];
  meta: PrototypeSurfaceProjectionMeta;
};

export type PrototypeSurfaceProjectionOp =
  | {
      type: "create";
      id: string;
      x: number;
      y: number;
      props: PrototypeSurfaceProjectionShape["props"];
      meta: PrototypeSurfaceProjectionMeta;
    }
  | {
      type: "update";
      id: string;
      props?: Partial<PrototypeSurfaceProjectionShape["props"]>;
      meta?: PrototypeSurfaceProjectionMeta;
    }
  | { type: "delete"; id: string };

export function buildPrototypeSurfaceProjectionTargets(
  surfaces: PrototypeSurfaceRecord[]
): PrototypeSurfaceProjectionTarget[] {
  return surfaces.map((surface) => ({
    shapeKey: surface.id,
    w: PROTOTYPE_SURFACE_PROJECTION_DEFAULT_W,
    h: PROTOTYPE_SURFACE_PROJECTION_DEFAULT_H,
    props: {
      previewUrl: surface.preview_url,
      readiness: surface.readiness,
      readinessReason: surface.readiness_reason ?? "",
      stale: surface.stale,
      staleReason: surface.stale_reason ?? "",
      surfaceName: surface.name
    },
    meta: {
      canvasRecordId: `prototype-surface:${surface.id}`,
      runtimeRecordId: surface.id,
      kind: "prototype_surface",
      runId: surface.run_id,
      surfaceKey: surface.surface_key
    }
  }));
}

export function prototypeSurfacePropsEqual(
  a: PrototypeSurfaceProjectionShape["props"],
  b: PrototypeSurfaceProjectionTarget["props"]
): boolean {
  return (
    a.previewUrl === b.previewUrl &&
    a.readiness === b.readiness &&
    a.readinessReason === b.readinessReason &&
    a.stale === b.stale &&
    a.staleReason === b.staleReason &&
    a.surfaceName === b.surfaceName
  );
}

export function prototypeSurfaceMetaEqual(
  a: PrototypeSurfaceProjectionMeta,
  b: PrototypeSurfaceProjectionMeta
): boolean {
  return (
    a.canvasRecordId === b.canvasRecordId &&
    a.runtimeRecordId === b.runtimeRecordId &&
    a.kind === b.kind &&
    a.runId === b.runId &&
    a.surfaceKey === b.surfaceKey
  );
}

/**
 * Reconcile prototype surface shapes against Runtime records. Geometry is
 * assigned only on create (packed clear of everything already on the page, seed
 * frames included) so a readiness update never moves a frame the designer
 * positioned.
 */
export function planPrototypeSurfaceProjectionOps(
  targets: PrototypeSurfaceProjectionTarget[],
  existing: PrototypeSurfaceProjectionExisting[],
  shapeIdForKey: (shapeKey: string) => string,
  occupiedByOtherShapes: SeedProjectionBounds[] = []
): PrototypeSurfaceProjectionOp[] {
  const ops: PrototypeSurfaceProjectionOp[] = [];
  const existingById = new Map(existing.map((shape) => [shape.id, shape]));
  const wantIds = new Set(targets.map((t) => shapeIdForKey(t.shapeKey)));
  const occupied: SeedProjectionBounds[] = [
    ...occupiedByOtherShapes,
    ...existing
      .filter((shape) => wantIds.has(shape.id))
      .map((shape) => ({
        x: shape.x,
        y: shape.y,
        w: shape.props.w,
        h: shape.props.h
      }))
  ];

  for (const target of targets) {
    const shapeId = shapeIdForKey(target.shapeKey);
    const current = existingById.get(shapeId);

    if (current) {
      const propsChanged = !prototypeSurfacePropsEqual(
        current.props,
        target.props
      );
      const metaChanged = !prototypeSurfaceMetaEqual(current.meta, target.meta);
      if (propsChanged || metaChanged) {
        ops.push({
          type: "update",
          id: shapeId,
          ...(propsChanged ? { props: { ...target.props } } : {}),
          ...(metaChanged ? { meta: target.meta } : {})
        });
      }
      continue;
    }

    const layout = findNonOverlappingSeedProjectionLayout(
      occupied,
      target.w,
      target.h
    );
    occupied.push({ x: layout.x, y: layout.y, w: target.w, h: target.h });
    ops.push({
      type: "create",
      id: shapeId,
      x: layout.x,
      y: layout.y,
      props: { w: target.w, h: target.h, ...target.props },
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
