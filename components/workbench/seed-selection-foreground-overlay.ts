// Selection chrome for seed-reference projections: keep corner resize hit
// targets (aspect-locked drag) but do not paint the blue corner squares.
//
// tldraw couples `hideResizeHandles` to both rendering AND hit geometry. We
// leave handles enabled on the shape util and replace SelectionForeground so
// corners stay interactive while staying visually hidden.

import {
  SelectionForegroundOverlayUtil,
  type TLSelectionForegroundOverlay
} from "tldraw";

const RENDER_RESIZE_CORNERS = "_renderResizeCorners" as const;

export class SeedSelectionForegroundOverlayUtil extends SelectionForegroundOverlayUtil {
  // Same type as the default util so mergeArraysAndReplaceDefaults swaps it in.
  static override type = SelectionForegroundOverlayUtil.type;

  override render(
    ctx: CanvasRenderingContext2D,
    overlays: TLSelectionForegroundOverlay[]
  ): void {
    // Parent marks `_renderResizeCorners` private; at runtime it still exists.
    // Temporarily no-op it so hit overlays stay registered but squares are not drawn.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const self = this as any;
    const drawCorners = self[RENDER_RESIZE_CORNERS] as (...args: unknown[]) => void;
    self[RENDER_RESIZE_CORNERS] = () => {};
    try {
      super.render(ctx, overlays);
    } finally {
      self[RENDER_RESIZE_CORNERS] = drawCorners;
    }
  }
}
