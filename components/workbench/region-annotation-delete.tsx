"use client";

// Issue 06 — Delete designer Region Annotation markers with Delete/Backspace.
//
// Rules:
// - Only when Annotate mode is OFF (select tool).
// - Only `author === "designer"` (green) on the user path. Agent (grey)
//   markers are never deleted by keyboard/UI.
// - Authoritative projection sync may remove Agent / stale markers via
//   tldraw `mergeRemoteChanges` (beforeDelete source `"remote"`).
// - Runtime is source of truth: HTTP DELETE must succeed before local remove.
// - Failure keeps the marker and surfaces a structured error via the mutation.

import { useEffect, useRef } from "react";
import { useEditor, type TLShape, type TLShapeId } from "tldraw";
import {
  REGION_ANNOTATION_TYPE,
  type RegionAnnotationShape
} from "./region-annotation-shape";
import { allowRegionAnnotationDelete } from "./region-annotation-delete-guard";
import { DESIGNER_ANNOTATION_CARD_TYPE } from "./designer-annotation-card-shape";
import { DESIGNER_ANNOTATION_CONNECTOR_TYPE } from "./designer-annotation-connector-shape";

function asRegionAnnotation(
  shape: TLShape
): RegionAnnotationShape | null {
  if (shape.type !== REGION_ANNOTATION_TYPE) return null;
  return shape as RegionAnnotationShape;
}

type AnnotationProjectionShape = {
  id: string;
  type: string;
  meta: unknown;
};

/** All canvas projections owned by the given Runtime annotation records. */
export function annotationProjectionShapeIds(
  shapes: readonly AnnotationProjectionShape[],
  annotationIds: readonly string[]
): TLShapeId[] {
  const wanted = new Set(annotationIds);
  return shapes.flatMap((shape) => {
    if (
      shape.type !== REGION_ANNOTATION_TYPE &&
      shape.type !== DESIGNER_ANNOTATION_CARD_TYPE &&
      shape.type !== DESIGNER_ANNOTATION_CONNECTOR_TYPE
    ) {
      return [];
    }
    const runtimeRecordId = (shape.meta as { runtimeRecordId?: unknown })
      .runtimeRecordId;
    return typeof runtimeRecordId === "string" &&
      wanted.has(runtimeRecordId)
      ? [shape.id as TLShapeId]
      : [];
  });
}

/**
 * Keyboard + beforeDelete guards for designer markers. Mount inside `<Tldraw>`.
 *
 * User-initiated deletes: Agent markers blocked; designer requires Runtime HTTP.
 * Authoritative projection deletes (store source `"remote"`) are allowed.
 */
export function RegionAnnotationDeleteController({
  annotateMode,
  onDelete,
  onRestore
}: {
  annotateMode: boolean;
  /** Injected Runtime mutation — HTTP success required before shape remove. */
  onDelete?: (
    annotationId: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Runtime tombstone restore used by Command-Z after a successful delete. */
  onRestore?: (
    annotationId: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const editor = useEditor();
  const annotateModeRef = useRef(annotateMode);
  annotateModeRef.current = annotateMode;
  const onDeleteRef = useRef(onDelete);
  onDeleteRef.current = onDelete;
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;
  const pendingUndoIdsRef = useRef<string[]>([]);

  // Block user deletes while Annotate is on (except drafts), and always block
  // Agent on the user path. Projection sync uses mergeRemoteChanges so source
  // is "remote" and can clean up Agent / stale markers.
  useEffect(() => {
    return editor.sideEffects.registerBeforeDeleteHandler(
      "shape",
      (shape, source) => {
        const marker = asRegionAnnotation(shape as TLShape);
        if (!marker) return;
        if (
          !allowRegionAnnotationDelete({
            author: marker.props.author,
            runtimeRecordId: marker.meta.runtimeRecordId,
            source,
            annotateMode: annotateModeRef.current
          })
        ) {
          return false;
        }
        return;
      }
    );
  }, [editor]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const undo =
        event.key.toLowerCase() === "z" &&
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey;
      if (undo && pendingUndoIdsRef.current.length > 0) {
        const restore = onRestoreRef.current;
        if (!restore) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        const annotationIds = [...pendingUndoIdsRef.current];
        void (async () => {
          const failed: string[] = [];
          for (const annotationId of annotationIds) {
            const result = await restore(annotationId);
            if (!result.ok) failed.push(annotationId);
          }
          pendingUndoIdsRef.current = failed;
        })();
        return;
      }

      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (annotateModeRef.current) return;
      if (editor.getCurrentToolId() !== "select") return;

      const designerMarkers = editor
        .getSelectedShapes()
        .map(asRegionAnnotation)
        .filter(
          (s): s is RegionAnnotationShape =>
            s != null && s.props.author === "designer"
        );
      if (designerMarkers.length === 0) return;

      event.preventDefault();
      event.stopPropagation();

      const targets: Array<{ shapeId: TLShapeId; annotationId: string }> = [];
      for (const marker of designerMarkers) {
        const rid = marker.meta.runtimeRecordId;
        if (!rid || rid === "draft" || String(rid).startsWith("draft")) continue;
        targets.push({ shapeId: marker.id, annotationId: rid });
      }
      if (targets.length === 0) return;

      const mutate = onDeleteRef.current;
      if (!mutate) return;

      void (async () => {
        const removedAnnotationIds: string[] = [];
        for (const target of targets) {
          const result = await mutate(target.annotationId);
          if (result.ok) {
            removedAnnotationIds.push(target.annotationId);
          }
          // On failure: keep marker; mutation sets Workbench error state.
        }
        if (removedAnnotationIds.length > 0) {
          const projectionIds = annotationProjectionShapeIds(
            editor.getCurrentPageShapes(),
            removedAnnotationIds
          );
          // The marker, text card, and connector are one projection family.
          // Remove all three immediately after Runtime accepts the delete;
          // the background authoritative reload remains consistency healing.
          editor.run(
            () => {
              editor.deleteShapes(projectionIds);
            },
            { ignoreShapeLock: true, history: "ignore" }
          );
          pendingUndoIdsRef.current.push(...removedAnnotationIds);
        }
      })();
    };

    const container = editor.getContainer();
    container.addEventListener("keydown", onKeyDown, true);
    return () => container.removeEventListener("keydown", onKeyDown, true);
  }, [editor]);

  return null;
}
