"use client";

// Issue 06 — Delete designer Region Annotation markers with Delete/Backspace.
//
// Rules:
// - Only when Annotate mode is OFF (select tool).
// - Only `author === "designer"` (green). Agent (grey) markers are never deleted.
// - Runtime is source of truth: DELETE /api/region-annotation?id=… then drop local.

import { useEffect, useRef } from "react";
import { useEditor, type TLShape, type TLShapeId } from "tldraw";
import {
  REGION_ANNOTATION_TYPE,
  type RegionAnnotationShape
} from "./region-annotation-shape";

function asRegionAnnotation(
  shape: TLShape
): RegionAnnotationShape | null {
  if (shape.type !== REGION_ANNOTATION_TYPE) return null;
  return shape as RegionAnnotationShape;
}

/**
 * Keyboard + beforeDelete guards for designer markers. Mount inside `<Tldraw>`.
 */
export function RegionAnnotationDeleteController({
  annotateMode,
  session,
  onDeleted
}: {
  annotateMode: boolean;
  session: string;
  /** Optimistic local remove after a designer marker is deleted. */
  onDeleted?: (annotationId: string) => void;
}) {
  const editor = useEditor();
  const annotateModeRef = useRef(annotateMode);
  annotateModeRef.current = annotateMode;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const onDeletedRef = useRef(onDeleted);
  onDeletedRef.current = onDeleted;

  // Block deletes while Annotate is on (except drafts), and always block Agent.
  useEffect(() => {
    return editor.sideEffects.registerBeforeDeleteHandler("shape", (shape) => {
      const marker = asRegionAnnotation(shape as TLShape);
      if (!marker) return;
      const rid = marker.meta.runtimeRecordId;
      const isDraft =
        !rid || rid === "draft" || String(rid).startsWith("draft");
      if (isDraft) return;
      if (marker.props.author !== "designer") return false;
      if (annotateModeRef.current) return false;
      return;
    });
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

      const ids: TLShapeId[] = [];
      const runtimeIds: string[] = [];
      for (const marker of designerMarkers) {
        const rid = marker.meta.runtimeRecordId;
        if (!rid || rid === "draft" || String(rid).startsWith("draft")) continue;
        ids.push(marker.id);
        runtimeIds.push(rid);
      }
      if (ids.length === 0) return;

      editor.deleteShapes(ids);

      for (const annotationId of runtimeIds) {
        onDeletedRef.current?.(annotationId);
        void (async () => {
          try {
            await fetch(
              `/api/region-annotation?id=${encodeURIComponent(annotationId)}`,
              {
                method: "DELETE",
                headers: { "x-ikran-session": sessionRef.current }
              }
            );
          } catch {
            // Poll restores if Runtime still has the row.
          }
        })();
      }
    };

    const container = editor.getContainer();
    container.addEventListener("keydown", onKeyDown, true);
    return () => container.removeEventListener("keydown", onKeyDown, true);
  }, [editor]);

  return null;
}
