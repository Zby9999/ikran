import type { Editor } from "tldraw";

// Ephemeral, per-editor bridge between the React structural overlay and the
// tldraw Annotation tool. This state never enters Runtime records, canvas
// persistence, or research export.
const selections = new WeakMap<Editor, Map<string, string>>();

export function setStructuralSelection(
  editor: Editor,
  shapeId: string,
  nodeId: string | null
): void {
  let byShape = selections.get(editor);
  if (!byShape) {
    if (nodeId == null) return;
    byShape = new Map();
    selections.set(editor, byShape);
  }
  if (nodeId == null) {
    byShape.delete(shapeId);
    return;
  }
  byShape.set(shapeId, nodeId);
}

export function getStructuralSelection(
  editor: Editor,
  shapeId: string
): string | null {
  return selections.get(editor)?.get(shapeId) ?? null;
}
