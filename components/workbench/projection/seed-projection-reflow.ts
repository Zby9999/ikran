// Apply collision reflow after seed-reference screenshots load natural size.
// Canvas-owned geometry; Runtime may persist it only as disposable UX layout.

import type { Editor, TLShapeId } from "tldraw";
import {
  SEED_REFERENCE_PROJECTION_TYPE,
  type SeedReferenceProjectionShape
} from "../seed-reference-projection-shape";
import {
  planSeedProjectionReflowMoves,
  type SeedProjectionReflowShape
} from "./seed-projection";

/** Collect current seed projections and move unlocked ones that still overlap. */
export function applySeedProjectionReflow(editor: Editor): void {
  const shapes: SeedProjectionReflowShape[] = editor
    .getCurrentPageShapes()
    .filter((s) => s.type === SEED_REFERENCE_PROJECTION_TYPE)
    .map((s) => {
      const shape = s as SeedReferenceProjectionShape;
      return {
        id: String(shape.id),
        x: shape.x,
        y: shape.y,
        layoutLocked: shape.props.layoutLocked === true,
        props: {
          w: shape.props.w,
          h: shape.props.h,
          naturalMediaW: shape.props.naturalMediaW,
          naturalMediaH: shape.props.naturalMediaH
        }
      };
    });

  const moves = planSeedProjectionReflowMoves(shapes);
  if (moves.length === 0) return;

  editor.store.mergeRemoteChanges(() => {
    for (const move of moves) {
      editor.updateShape<SeedReferenceProjectionShape>({
        id: move.id as TLShapeId,
        type: SEED_REFERENCE_PROJECTION_TYPE,
        x: move.x,
        y: move.y
      });
    }
  });
}
