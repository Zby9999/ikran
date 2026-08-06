// Focus an existing Seed Reference projection after duplicate paste (Issue 05B).

import type { Editor, TLShapeId } from "tldraw";
import {
  SEED_REFERENCE_PROJECTION_TYPE,
  type SeedReferenceProjectionShape
} from "./seed-reference-projection-shape";
import {
  PROTOTYPE_SURFACE_PROJECTION_TYPE,
  type PrototypeSurfaceProjectionShape
} from "./prototype-surface-shape";

/**
 * Select + zoom to the projection whose seedRecordId / runtimeRecordId
 * matches the given Seed Reference id. Returns false when no shape found.
 */
export function focusSeedReferenceProjection(
  editor: Editor,
  seedId: string
): boolean {
  if (!seedId) return false;

  const match = editor
    .getCurrentPageShapes()
    .find((shape) => {
      if (shape.type !== SEED_REFERENCE_PROJECTION_TYPE) return false;
      const seedShape = shape as SeedReferenceProjectionShape;
      const meta = seedShape.meta;
      return (
        meta.seedRecordId === seedId ||
        (meta.kind === "seed_reference_projection" &&
          meta.runtimeRecordId === seedId)
      );
    });

  if (!match) return false;
  return focusProjectionShape(editor, match.id as TLShapeId);
}

/**
 * Select + zoom to whichever projection carries `recordId` — a Seed Reference
 * frame or a Prototype Evidence Surface (Issue 30 Build panel page list).
 */
export function focusWorkbenchProjection(
  editor: Editor,
  recordId: string
): boolean {
  if (!recordId) return false;
  if (focusSeedReferenceProjection(editor, recordId)) return true;

  const match = editor.getCurrentPageShapes().find((shape) => {
    if (shape.type !== PROTOTYPE_SURFACE_PROJECTION_TYPE) return false;
    return (
      (shape as PrototypeSurfaceProjectionShape).meta.runtimeRecordId ===
      recordId
    );
  });
  if (!match) return false;
  return focusProjectionShape(editor, match.id as TLShapeId);
}

function focusProjectionShape(editor: Editor, shapeId: TLShapeId): boolean {
  editor.setSelectedShapes([shapeId]);
  const bounds = editor.getSelectionPageBounds();
  if (bounds) {
    // Instant camera move — no invented motion chrome (Issue 05B / AGENTS.md).
    editor.zoomToBounds(bounds, { inset: 48 });
  }
  return true;
}
