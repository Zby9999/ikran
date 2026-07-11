// Pure Region Annotation → marker projection planning + store-change filter
// (Task 12). React-free.

import {
  mediaBoxInPage,
  normalizedRectToPage,
  type PageRect
} from "../region-annotation-geometry";
import {
  REGION_ANNOTATION_TYPE,
  type RegionAnnotationMeta,
  type RegionAnnotationShape
} from "../region-annotation-shape";
import {
  SEED_REFERENCE_PROJECTION_TYPE,
  type SeedReferenceProjectionMeta
} from "../seed-reference-projection-shape";
import { displayRectForRegionAnnotation } from "@/lib/runtime/region-annotation-display";
import type { RegionAnnotationRecord } from "@/lib/runtime/region-annotation";

export type AnnotationSurfaceShapeLike = {
  id: string;
  type: string;
  meta: unknown;
};

export type AnnotationPagePlacement = {
  pageRect: PageRect;
  author: "designer" | "agent";
  meta: RegionAnnotationMeta;
  nextW: number;
  nextH: number;
};

export type AnnotationProjectionExisting = {
  id: string;
  x: number;
  y: number;
  props: RegionAnnotationShape["props"];
  meta: RegionAnnotationMeta;
};

export type AnnotationProjectionCreateOp = {
  type: "create";
  id: string;
  x: number;
  y: number;
  props: RegionAnnotationShape["props"];
  meta: RegionAnnotationMeta;
};

export type AnnotationProjectionUpdateOp = {
  type: "update";
  id: string;
  x: number;
  y: number;
  props: RegionAnnotationShape["props"];
  meta?: RegionAnnotationMeta;
};

export type AnnotationProjectionDeleteOp = {
  type: "delete";
  id: string;
};

export type AnnotationProjectionOp =
  | AnnotationProjectionCreateOp
  | AnnotationProjectionUpdateOp
  | AnnotationProjectionDeleteOp;

/** Minimal RecordsDiff shape used by the store-listener filter. */
export type StoreRecordsDiffLike = {
  added: Record<string, unknown>;
  updated: Record<string, [unknown, unknown]>;
  removed: Record<string, unknown>;
};

export function findSurfaceShapeForAnnotation<T extends AnnotationSurfaceShapeLike>(
  shapes: T[],
  record: Pick<RegionAnnotationRecord, "surface_id" | "surface_artifact_id">
): T | undefined {
  const surfaceId = record.surface_id ?? record.surface_artifact_id;
  if (!surfaceId) return undefined;

  return shapes.find((shape) => {
    if (shape.type !== SEED_REFERENCE_PROJECTION_TYPE) return false;
    const meta = shape.meta as SeedReferenceProjectionMeta;
    return (
      meta.kind === "figma_evidence_surface" &&
      (meta.surfaceRecordId === surfaceId || meta.runtimeRecordId === surfaceId)
    );
  });
}

export function annotationMetaEqual(
  a: RegionAnnotationMeta,
  b: RegionAnnotationMeta
): boolean {
  return (
    a.canvasRecordId === b.canvasRecordId &&
    a.runtimeRecordId === b.runtimeRecordId &&
    a.surfaceRecordId === b.surfaceRecordId
  );
}

/**
 * Resolve display rect (incl. Agent padding) then map to page space for a
 * known media box.
 */
export function computeAnnotationPagePlacement(
  record: RegionAnnotationRecord,
  mediaBox: PageRect
): AnnotationPagePlacement {
  const displayRect = displayRectForRegionAnnotation({
    author: record.author === "agent" ? "agent" : "designer",
    rect: {
      x: record.rect_x,
      y: record.rect_y,
      w: record.rect_w,
      h: record.rect_h
    },
    geometry_version:
      record.geometry_version === "v1_padded" ? "v1_padded" : "v2_raw",
    from_point: Boolean(record.from_point),
    mediaSize: { w: mediaBox.w, h: mediaBox.h }
  });
  const pageRect = normalizedRectToPage(mediaBox, displayRect);
  const surfaceRecordId =
    record.surface_id ?? record.surface_artifact_id ?? "";
  const meta: RegionAnnotationMeta = {
    canvasRecordId: `region-annotation:${record.id}`,
    runtimeRecordId: record.id,
    surfaceRecordId
  };
  const author = record.author === "agent" ? "agent" : "designer";
  return {
    pageRect,
    author,
    meta,
    nextW: Math.max(1, pageRect.w),
    nextH: Math.max(1, pageRect.h)
  };
}

/** Media box helper re-export for sync controllers (same chrome insets). */
export { mediaBoxInPage };

export function planAnnotationProjectionOps(
  placed: Array<{
    record: RegionAnnotationRecord;
    placement: AnnotationPagePlacement;
  }>,
  existing: AnnotationProjectionExisting[],
  shapeIdForRecordId: (recordId: string) => string
): AnnotationProjectionOp[] {
  const ops: AnnotationProjectionOp[] = [];
  const existingById = new Map(existing.map((s) => [s.id, s]));
  const wantIds = new Set<string>();

  for (const { record, placement } of placed) {
    const shapeId = shapeIdForRecordId(record.id);
    wantIds.add(shapeId);
    const current = existingById.get(shapeId);
    const { pageRect, author, meta, nextW, nextH } = placement;

    if (current) {
      const propsChanged =
        current.props.w !== nextW ||
        current.props.h !== nextH ||
        current.props.author !== author ||
        current.x !== pageRect.x ||
        current.y !== pageRect.y;
      const metaChanged = !annotationMetaEqual(current.meta, meta);
      if (propsChanged || metaChanged) {
        ops.push({
          type: "update",
          id: shapeId,
          x: pageRect.x,
          y: pageRect.y,
          props: {
            w: nextW,
            h: nextH,
            author,
            label: ""
          },
          ...(metaChanged ? { meta } : {})
        });
      }
      continue;
    }

    ops.push({
      type: "create",
      id: shapeId,
      x: pageRect.x,
      y: pageRect.y,
      props: {
        w: nextW,
        h: nextH,
        author,
        label: ""
      },
      meta
    });
  }

  for (const shape of existing) {
    // Keep in-progress drafts from the annotate tool.
    if (shape.meta.runtimeRecordId === "draft") continue;
    if (!wantIds.has(shape.id)) {
      ops.push({ type: "delete", id: shape.id });
    }
  }

  return ops;
}

type ShapeRecordLike = {
  typeName?: string;
  type?: string;
  x?: number;
  y?: number;
  rotation?: number;
  props?: { w?: number; h?: number; [key: string]: unknown };
  meta?: {
    kind?: unknown;
    runtimeRecordId?: unknown;
    surfaceRecordId?: unknown;
    seedRecordId?: unknown;
    [key: string]: unknown;
  };
};

function asShapeRecord(record: unknown): ShapeRecordLike | null {
  if (!record || typeof record !== "object") return null;
  return record as ShapeRecordLike;
}

function isSeedProjectionShapeRecord(record: unknown): boolean {
  const shape = asShapeRecord(record);
  return (
    !!shape &&
    shape.typeName === "shape" &&
    shape.type === SEED_REFERENCE_PROJECTION_TYPE
  );
}

function isRegionAnnotationShapeRecord(record: unknown): boolean {
  const shape = asShapeRecord(record);
  return (
    !!shape &&
    shape.typeName === "shape" &&
    shape.type === REGION_ANNOTATION_TYPE
  );
}

/** Persisted Runtime-backed marker — not an in-progress annotate-tool draft. */
function isPersistedAnnotationShapeRecord(record: unknown): boolean {
  if (!isRegionAnnotationShapeRecord(record)) return false;
  const runtimeId = asShapeRecord(record)?.meta?.runtimeRecordId;
  return typeof runtimeId === "string" && runtimeId !== "draft" && runtimeId.length > 0;
}

function shapeGeometryChanged(from: unknown, to: unknown): boolean {
  const a = asShapeRecord(from);
  const b = asShapeRecord(to);
  if (!a || !b) return false;
  return (
    a.x !== b.x ||
    a.y !== b.y ||
    a.rotation !== b.rotation ||
    a.props?.w !== b.props?.w ||
    a.props?.h !== b.props?.h
  );
}

function seedProjectionIdentityMetaChanged(
  from: unknown,
  to: unknown
): boolean {
  const a = asShapeRecord(from);
  const b = asShapeRecord(to);
  if (!a || !b) return false;
  return (
    a.meta?.kind !== b.meta?.kind ||
    a.meta?.runtimeRecordId !== b.meta?.runtimeRecordId ||
    a.meta?.surfaceRecordId !== b.meta?.surfaceRecordId ||
    a.meta?.seedRecordId !== b.meta?.seedRecordId
  );
}

/**
 * True when projection must re-apply Runtime rects:
 * - seed-reference-projection parent created / deleted / moved / resized /
 *   semantic surface identity change
 * - persisted region-annotation marker geometry drifted (user drag) — snap
 *   back to Runtime authoritative rect on the next pass
 *
 * Annotation drafts, annotation create/delete, unrelated props, and other
 * shapes do not qualify. Sync writes use mergeRemoteChanges (source remote),
 * so the user-scoped store listener does not re-enter on its own corrections.
 */
export function shouldResyncAnnotationsForStoreChanges(
  changes: StoreRecordsDiffLike
): boolean {
  for (const record of Object.values(changes.added)) {
    if (isSeedProjectionShapeRecord(record)) return true;
  }
  for (const record of Object.values(changes.removed)) {
    if (isSeedProjectionShapeRecord(record)) return true;
  }
  for (const pair of Object.values(changes.updated)) {
    const [from, to] = pair;
    if (
      (isSeedProjectionShapeRecord(from) || isSeedProjectionShapeRecord(to)) &&
      (shapeGeometryChanged(from, to) ||
        seedProjectionIdentityMetaChanged(from, to))
    ) {
      return true;
    }
    // Local drag/resize of a Runtime-backed marker: re-project from Runtime
    // so geometry does not permanently diverge until refresh.
    if (
      (isPersistedAnnotationShapeRecord(from) ||
        isPersistedAnnotationShapeRecord(to)) &&
      shapeGeometryChanged(from, to)
    ) {
      return true;
    }
  }
  return false;
}

/** Type id used when filtering existing projected annotation shapes. */
export { REGION_ANNOTATION_TYPE };
