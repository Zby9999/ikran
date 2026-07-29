"use client";

// ExclusiveDialogController — the editor-side implementation behind
// ExclusiveDialogProvider (mounted inside <Tldraw> so it can useEditor).
//
// Enforces the single-active-dialog rule across all canvas input dialogs:
//   - opening an alignment card (answer / append form) closes every
//     designer-annotation edit form and cancels any pending entry draft;
//   - opening a designer-annotation edit form closes every alignment card
//     and cancels any pending entry draft;
//   - a pending entry draft becoming active closes all card dialogs (it
//     never cancels itself);
//   - closeDialogs (canvas pointer-down) closes card dialogs only — a
//     pending entry draft keeps its own lifecycle (annotate-tool pointer
//     down, Esc, or leaving the tool sweeps it).
//
// Cancelling a pending draft from here must also delete its draft marker
// shape — entry.cancel() alone would leave a voiceless marker on canvas
// (same contract as the annotate tool's idle pointer-down).

import { useEffect } from "react";
import { useEditor, type TLShapeId } from "tldraw";
import { setOnlyOpenAlignmentCard } from "./alignment-card-shape";
import { setOnlyOpenDesignerAnnotationCard } from "./designer-annotation-card-shape";
import { useDesignerAnnotationEntry } from "./designer-annotation-entry-context";
import {
  useRegisterExclusiveDialogImpl,
  type ExclusiveDialogRequest
} from "./exclusive-dialog-context";

export function ExclusiveDialogController() {
  const editor = useEditor();
  const entry = useDesignerAnnotationEntry();
  const registerImpl = useRegisterExclusiveDialogImpl();

  useEffect(() => {
    registerImpl({
      openDialog: (request: ExclusiveDialogRequest) => {
        setOnlyOpenAlignmentCard(
          editor,
          request.family === "alignment" ? request.id : null
        );
        setOnlyOpenDesignerAnnotationCard(
          editor,
          request.family === "designer-annotation" ? request.id : null
        );
        if (request.family === "designer-annotation-entry") return;
        const draftShapeId = entry?.pending?.payload.draftShapeId;
        if (!draftShapeId) return;
        entry?.cancel();
        const draft = editor.getShape(draftShapeId as TLShapeId);
        if (draft) editor.deleteShape(draft.id);
      },
      closeDialogs: () => {
        setOnlyOpenAlignmentCard(editor, null);
        setOnlyOpenDesignerAnnotationCard(editor, null);
      }
    });
    return () => registerImpl(null);
  }, [editor, entry, registerImpl]);

  return null;
}
