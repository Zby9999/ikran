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
import { SEED_REFERENCE_PROJECTION_TYPE } from "../seed-reference-projection-shape";
import {
  isFigmaEvidenceSurfaceMeta,
  isSeedReferenceProjectionShape,
  seedReferenceMetaMatchesSurfaceId,
  type SeedReferenceSurfaceShapeLike
} from "../seed-reference-surface-match";
import { displayRectForRegionAnnotation } from "@/lib/runtime/region-annotation-display";
import type { RegionAnnotationRecord } from "@/lib/runtime/region-annotation";

export type AnnotationSurfaceShapeLike = SeedReferenceSurfaceShapeLike & {
  id: string;
};

export type AnnotationPagePlacement = {
  pageRect: PageRect;
  author: "designer" | "agent";
  meta: RegionAnnotationMeta;
  nextW: number;
  nextH: number;
  /** Parent media-box width (page px) for proportional stroke/radius. */
  surfaceMediaW: number;
};

export type AnnotationProjectionExisting = {
  id: string;
  x: number;
  y: number;
  props: RegionAnnotationShape["props"];
  meta: RegionAnnotationMeta;
  /** tldraw lock — persisted markers must stay locked against user drag. */
  isLocked?: boolean;
};

export type AnnotationProjectionCreateOp = {
  type: "create";
  id: string;
  x: number;
  y: number;
  props: RegionAnnotationShape["props"];
  meta: RegionAnnotationMeta;
  /** Always true for Runtime-backed markers — not user-draggable. */
  isLocked: true;
};

export type AnnotationProjectionUpdateOp = {
  type: "update";
  id: string;
  x: number;
  y: number;
  props: RegionAnnotationShape["props"];
  meta?: RegionAnnotationMeta;
  /** Always true — re-locks any marker that drifted unlocked. */
  isLocked: true;
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
  record: Pick<
    RegionAnnotationRecord,
    | "surface_id"
    | "surface_artifact_id"
    | "current_evidence_version_id"
    | "target_kind"
    | "correspondence_status"
  >
): T | undefined {
  // The semantic target remains anchored to the captured version, while the
  // Workbench only projects the current surface for a seed after refresh.
  const surfaceId =
    record.target_kind === "figma-node" &&
    record.correspondence_status === "corresponding"
      ? record.current_evidence_version_id
      : record.surface_id ?? record.surface_artifact_id;
  if (!surfaceId) return undefined;

  return shapes.find((shape) => {
    if (!isSeedReferenceProjectionShape(shape)) return false;
    const meta = shape.meta;
    return (
      isFigmaEvidenceSurfaceMeta(meta) &&
      seedReferenceMetaMatchesSurfaceId(meta, surfaceId)
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
  mediaBox: PageRect,
  /** Fitted screenshot content box; node geometry is normalized to this box. */
  imageBox: PageRect = mediaBox
): AnnotationPagePlacement {
  const nodeRect =
    record.target_kind === "figma-node" &&
    record.correspondence_status === "corresponding" &&
    record.current_rect_x != null &&
    record.current_rect_y != null &&
    record.current_rect_w != null &&
    record.current_rect_h != null
      ? {
          x: record.current_rect_x,
          y: record.current_rect_y,
          w: record.current_rect_w,
          h: record.current_rect_h
        }
      : {
          x: record.rect_x,
          y: record.rect_y,
          w: record.rect_w,
          h: record.rect_h
        };
  const semanticRect =
    record.target_kind === "figma-node"
      ? {
          x:
            (imageBox.x - mediaBox.x + nodeRect.x * imageBox.w) /
            mediaBox.w,
          y:
            (imageBox.y - mediaBox.y + nodeRect.y * imageBox.h) /
            mediaBox.h,
          w: (nodeRect.w * imageBox.w) / mediaBox.w,
          h: (nodeRect.h * imageBox.h) / mediaBox.h
        }
      : {
          x: record.rect_x,
          y: record.rect_y,
          w: record.rect_w,
          h: record.rect_h
        };
  const displayRect = displayRectForRegionAnnotation({
    author: record.author === "agent" ? "agent" : "designer",
    rect: semanticRect,
    geometry_version:
      record.geometry_version === "v1_padded" ? "v1_padded" : "v2_raw",
    from_point: Boolean(record.from_point),
    targetKind: record.target_kind,
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
    nextH: Math.max(1, pageRect.h),
    surfaceMediaW: Math.max(0, mediaBox.w)
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
    const { pageRect, author, meta, nextW, nextH, surfaceMediaW } = placement;

    if (current) {
      const propsChanged =
        current.props.w !== nextW ||
        current.props.h !== nextH ||
        current.props.author !== author ||
        current.props.surfaceMediaW !== surfaceMediaW ||
        current.x !== pageRect.x ||
        current.y !== pageRect.y;
      const metaChanged = !annotationMetaEqual(current.meta, meta);
      // Persisted markers must stay locked so select-tool drag is a no-op.
      const lockNeeded = current.isLocked !== true;
      if (propsChanged || metaChanged || lockNeeded) {
        ops.push({
          type: "update",
          id: shapeId,
          x: pageRect.x,
          y: pageRect.y,
          props: {
            w: nextW,
            h: nextH,
            author,
            label: "",
            surfaceMediaW
          },
          isLocked: true,
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
        label: "",
        surfaceMediaW
      },
      meta,
      isLocked: true
    });
  }

  for (const shape of existing) {
    // Keep in-progress drafts from the annotate tool. Committing drafts stay
    // until a create lands in this same plan (handoff below) so pointer-up
    // does not flash an empty canvas while Runtime create + reload finish.
    if (isAnnotationDraftRuntimeId(shape.meta.runtimeRecordId)) continue;
    if (!wantIds.has(shape.id)) {
      ops.push({ type: "delete", id: shape.id });
    }
  }

  // Same-batch handoff: drop committing drafts when Runtime markers are created.
  if (ops.some((op) => op.type === "create")) {
    for (const shape of existing) {
      if (isAnnotationCommittingDraftRuntimeId(shape.meta.runtimeRecordId)) {
        ops.push({ type: "delete", id: shape.id });
      }
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

/** Persisted Runtime-backed marker — not an annotate-tool draft / handoff. */
function isAnnotationDraftRuntimeId(runtimeId: unknown): boolean {
  return (
    runtimeId == null ||
    runtimeId === "" ||
    (typeof runtimeId === "string" &&
      (runtimeId === "draft" || runtimeId.startsWith("draft")))
  );
}

function isAnnotationCommittingDraftRuntimeId(runtimeId: unknown): boolean {
  return (
    typeof runtimeId === "string" && runtimeId.startsWith("draft:committing")
  );
}

/** Persisted Runtime-backed marker — not an in-progress annotate-tool draft. */
function isPersistedAnnotationShapeRecord(record: unknown): boolean {
  if (!isRegionAnnotationShapeRecord(record)) return false;
  const runtimeId = asShapeRecord(record)?.meta?.runtimeRecordId;
  return typeof runtimeId === "string" && !isAnnotationDraftRuntimeId(runtimeId);
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
 * - persisted region-annotation marker geometry drifted (defense in depth if
 *   a marker is unlocked) — snap back to Runtime authoritative rect
 *
 * Annotation drafts, annotation create/delete, unrelated props, and other
 * shapes do not qualify. Sync writes use mergeRemoteChanges (source remote),
 * so the user-scoped store listener does not re-enter on its own corrections.
 * Persisted markers are created/updated with isLocked so user drag is a no-op.
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
