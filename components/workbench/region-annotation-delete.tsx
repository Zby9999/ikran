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

function asRegionAnnotation(
  shape: TLShape
): RegionAnnotationShape | null {
  if (shape.type !== REGION_ANNOTATION_TYPE) return null;
  return shape as RegionAnnotationShape;
}

/**
 * Keyboard + beforeDelete guards for designer markers. Mount inside `<Tldraw>`.
 *
 * User-initiated deletes: Agent markers blocked; designer requires Runtime HTTP.
 * Authoritative projection deletes (store source `"remote"`) are allowed.
 */
export function RegionAnnotationDeleteController({
  annotateMode,
  onDelete
}: {
  annotateMode: boolean;
  /** Injected Runtime mutation — HTTP success required before shape remove. */
  onDelete?: (
    annotationId: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const editor = useEditor();
  const annotateModeRef = useRef(annotateMode);
  annotateModeRef.current = annotateMode;
  const onDeleteRef = useRef(onDelete);
  onDeleteRef.current = onDelete;

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
        const removed: TLShapeId[] = [];
        for (const target of targets) {
          const result = await mutate(target.annotationId);
          if (result.ok) {
            removed.push(target.shapeId);
          }
          // On failure: keep marker; mutation sets Workbench error state.
        }
        if (removed.length > 0) {
          editor.deleteShapes(removed);
        }
      })();
    };

    const container = editor.getContainer();
    container.addEventListener("keydown", onKeyDown, true);
    return () => container.removeEventListener("keydown", onKeyDown, true);
  }, [editor]);

  return null;
}
