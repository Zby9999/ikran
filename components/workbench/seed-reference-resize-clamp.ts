import type { TLResizeHandle } from "tldraw";

/**
 * Frame chrome around the media bitmap (padding + header + media border).
 * Matches `.seed-ref-frame` / `__header` / `__media` in seed-evidence-workbench.css.
 */
export const SEED_REF_FRAME_CHROME_W = 10; // pad 4+4 + media border 1+1
export const SEED_REF_FRAME_CHROME_H = 34; // pad top 4 + header 20 + gap 4 + media border 1+1 + pad bottom 4

/** Cap the longer media edge in page pixels (downscale only; never upscale).
 *  Align with Figma MCP get_screenshot maxDimension guidance (4096). */
const MAX_SCREENSHOT_MEDIA_EDGE = 4096;

export function sizeFromNaturalPixels(
  naturalWidth: number,
  naturalHeight: number
): { w: number; h: number } {
  let mediaW = naturalWidth;
  let mediaH = naturalHeight;
  const longEdge = Math.max(mediaW, mediaH);
  if (longEdge > MAX_SCREENSHOT_MEDIA_EDGE) {
    const scale = MAX_SCREENSHOT_MEDIA_EDGE / longEdge;
    mediaW = Math.round(mediaW * scale);
    mediaH = Math.round(mediaH * scale);
  }
  return {
    w: mediaW + SEED_REF_FRAME_CHROME_W,
    h: mediaH + SEED_REF_FRAME_CHROME_H
  };
}

export function clampSeedReferenceResizeToNaturalSize({
  x,
  y,
  rotation,
  handle,
  w,
  h,
  maxW,
  maxH
}: {
  x: number;
  y: number;
  rotation: number;
  handle: TLResizeHandle;
  w: number;
  h: number;
  maxW: number;
  maxH: number;
}): { x: number; y: number; w: number; h: number } {
  if (maxW <= 0 || maxH <= 0 || w <= maxW && h <= maxH) {
    return { x, y, w, h };
  }

  const scale = Math.min(1, maxW / w, maxH / h);
  const nextW = w * scale;
  const nextH = h * scale;
  const overflowW = w - nextW;
  const overflowH = h - nextH;

  const offsetX =
    handle === "top_left" || handle === "left" || handle === "bottom_left"
      ? overflowW
      : handle === "top" || handle === "bottom"
        ? overflowW / 2
        : 0;
  const offsetY =
    handle === "top_left" || handle === "top" || handle === "top_right"
      ? overflowH
      : handle === "left" || handle === "right"
        ? overflowH / 2
        : 0;

  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  return {
    x: x + offsetX * cos - offsetY * sin,
    y: y + offsetX * sin + offsetY * cos,
    w: nextW,
    h: nextH
  };
}
