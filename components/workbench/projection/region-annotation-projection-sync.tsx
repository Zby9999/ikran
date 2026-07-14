"use client";

// One-way Region Annotation projection sync (Task 12).
// Runtime records → marker shapes. Re-projects when parent seed surfaces
// are created / moved / resized / deleted, or when a persisted marker's
// local geometry drifts (defense if unlocked) so Runtime rect is re-applied
// — not on annotation drafts or unrelated document changes. Committing
// drafts (post pointer-up stand-ins) are dropped in the same batch as
// authoritative creates so create never flashes empty. Sync writes go
// through mergeRemoteChanges + ignoreShapeLock (markers are isLocked so
// select-tool drag is a no-op); the listener is user-scoped, so corrections
// do not re-enter.

import { useEffect, useRef } from "react";
import { createShapeId, useEditor, type TLShapeId } from "tldraw";
import {
  REGION_ANNOTATION_TYPE,
  type RegionAnnotationMeta,
  type RegionAnnotationShape
} from "../region-annotation-shape";
import { SEED_REFERENCE_PROJECTION_TYPE } from "../seed-reference-projection-shape";
import {
  computeAnnotationPagePlacement,
  findSurfaceShapeForAnnotation,
  mediaBoxInPage,
  planAnnotationProjectionOps,
  shouldResyncAnnotationsForStoreChanges,
  type AnnotationProjectionExisting
} from "./annotation-projection";
import type { RegionAnnotationRecord } from "@/lib/runtime/region-annotation";

function syncRegionAnnotationShapes(
  editor: ReturnType<typeof useEditor>,
  annotations: RegionAnnotationRecord[]
): void {
  const seedShapes = editor
    .getCurrentPageShapes()
    .filter((s) => s.type === SEED_REFERENCE_PROJECTION_TYPE);

  const placed: Array<{
    record: RegionAnnotationRecord;
    placement: ReturnType<typeof computeAnnotationPagePlacement>;
  }> = [];

  for (const record of annotations) {
    const parent = findSurfaceShapeForAnnotation(seedShapes, record);
    if (!parent) continue;

    const pageBounds = editor.getShapePageBounds(parent);
    if (!pageBounds) continue;

    const mediaBox = mediaBoxInPage(
      pageBounds.x,
      pageBounds.y,
      pageBounds.w,
      pageBounds.h
    );
    if (mediaBox.w <= 0 || mediaBox.h <= 0) continue;

    placed.push({
      record,
      placement: computeAnnotationPagePlacement(record, mediaBox)
    });
  }

  const existing: AnnotationProjectionExisting[] = editor
    .getCurrentPageShapes()
    .filter((s) => s.type === REGION_ANNOTATION_TYPE)
    .map((s) => {
      const shape = s as RegionAnnotationShape;
      return {
        id: String(shape.id),
        x: shape.x,
        y: shape.y,
        props: shape.props,
        meta: shape.meta as RegionAnnotationMeta,
        isLocked: shape.isLocked
      };
    });

  const ops = planAnnotationProjectionOps(
    placed,
    existing,
    (recordId) => String(createShapeId(`region-annotation:${recordId}`))
  );

  // Apply as remote so beforeDelete allows Agent / stale marker cleanup
  // (user path still blocks Agent deletes). ignoreShapeLock: markers are
  // locked against user drag but still need projection updates.
  editor.store.mergeRemoteChanges(() => {
    editor.run(
      () => {
        for (const op of ops) {
          if (op.type === "create") {
            editor.createShape<RegionAnnotationShape>({
              id: op.id as TLShapeId,
              type: REGION_ANNOTATION_TYPE,
              x: op.x,
              y: op.y,
              isLocked: op.isLocked,
              props: op.props,
              meta: op.meta
            });
          } else if (op.type === "update") {
            editor.updateShape<RegionAnnotationShape>({
              id: op.id as TLShapeId,
              type: REGION_ANNOTATION_TYPE,
              x: op.x,
              y: op.y,
              isLocked: op.isLocked,
              props: op.props,
              ...(op.meta ? { meta: op.meta } : {})
            });
          } else {
            editor.deleteShape(op.id as TLShapeId);
          }
        }
      },
      { ignoreShapeLock: true }
    );
  });
}

export function RegionAnnotationProjectionSync({
  annotations
}: {
  annotations: RegionAnnotationRecord[];
}) {
  const editor = useEditor();
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;

  useEffect(() => {
    if (!editor) return;
    syncRegionAnnotationShapes(editor, annotations);
  }, [editor, annotations]);

  useEffect(() => {
    if (!editor) return;
    const unsub = editor.store.listen(
      (entry) => {
        if (!shouldResyncAnnotationsForStoreChanges(entry.changes)) return;
        syncRegionAnnotationShapes(editor, annotationsRef.current);
      },
      { source: "user", scope: "document" }
    );
    return () => unsub();
  }, [editor]);

  return null;
}
