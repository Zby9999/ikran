import type { TLResizeHandle } from "tldraw";

/**
 * Frame chrome around the media bitmap (padding + header + media border).
 * Matches `.seed-ref-frame` / `__header` / `__media` in seed-evidence-workbench.css.
 */
export const SEED_REF_FRAME_CHROME_W = 12; // frame border 1+1 + pad 4+4 + media border 1+1
export const SEED_REF_FRAME_CHROME_H = 36; // frame border 1+1 + pad top 4 + header 20 + gap 4 + media border 1+1 + pad bottom 4

/**
 * Asset / grow ceiling for screenshot media (page pixels). Aligns with Figma
 * MCP get_screenshot maxDimension guidance — never upscale past this.
 */
export const MAX_SCREENSHOT_MEDIA_EDGE = 4096;

/**
 * Default on-canvas display: fit the longer media edge to this size so a
 * 4096 capture does not dominate the Workbench. The <img> still loads full
 * resolution; only the frame's page size is smaller. Designers can resize
 * up to {@link MAX_SCREENSHOT_MEDIA_EDGE} / natural size.
 */
export const DEFAULT_DISPLAY_MEDIA_EDGE = 1080;

function fitMediaToMaxEdge(
  naturalWidth: number,
  naturalHeight: number,
  maxEdge: number
): { mediaW: number; mediaH: number } {
  let mediaW = naturalWidth;
  let mediaH = naturalHeight;
  const longEdge = Math.max(mediaW, mediaH);
  if (longEdge > maxEdge) {
    const scale = maxEdge / longEdge;
    mediaW = Math.round(mediaW * scale);
    mediaH = Math.round(mediaH * scale);
  }
  return { mediaW, mediaH };
}

function frameSizeFromMedia(
  mediaW: number,
  mediaH: number
): { w: number; h: number } {
  return {
    w: mediaW + SEED_REF_FRAME_CHROME_W,
    h: mediaH + SEED_REF_FRAME_CHROME_H
  };
}

/** Initial / preferred on-canvas frame size (long edge ≤ 1080). */
export function defaultDisplaySizeFromNaturalPixels(
  naturalWidth: number,
  naturalHeight: number
): { w: number; h: number } {
  const { mediaW, mediaH } = fitMediaToMaxEdge(
    naturalWidth,
    naturalHeight,
    DEFAULT_DISPLAY_MEDIA_EDGE
  );
  return frameSizeFromMedia(mediaW, mediaH);
}

/**
 * Maximum frame size when the designer grows a corner handle (long edge ≤
 * natural, and never above the 4096 asset cap).
 */
export function maxDisplaySizeFromNaturalPixels(
  naturalWidth: number,
  naturalHeight: number
): { w: number; h: number } {
  const { mediaW, mediaH } = fitMediaToMaxEdge(
    naturalWidth,
    naturalHeight,
    MAX_SCREENSHOT_MEDIA_EDGE
  );
  return frameSizeFromMedia(mediaW, mediaH);
}

/**
 * @deprecated Prefer {@link defaultDisplaySizeFromNaturalPixels} for import
 * sizing and {@link maxDisplaySizeFromNaturalPixels} for resize clamps.
 * Kept as the default-display helper for existing call sites.
 */
export function sizeFromNaturalPixels(
  naturalWidth: number,
  naturalHeight: number
): { w: number; h: number } {
  return defaultDisplaySizeFromNaturalPixels(naturalWidth, naturalHeight);
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
  if (maxW <= 0 || maxH <= 0 || (w <= maxW && h <= maxH)) {
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
