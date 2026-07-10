/**
 * Region Annotation visual projection geometry (Issue 06).
 *
 * Coordinate space A: normalized rect (0–1) relative to the Evidence Surface
 * **screenshot media box** — the content area of `.seed-ref-frame__media`
 * inside seed-reference-projection chrome (not the full frame including header).
 *
 * Chrome totals live in `seed-reference-resize-clamp.ts` as
 * `SEED_REF_FRAME_CHROME_W` / `SEED_REF_FRAME_CHROME_H`. Horizontal chrome is
 * symmetric; vertical chrome is top-heavy (pad + header + media border).
 */

import {
  SEED_REF_FRAME_CHROME_H,
  SEED_REF_FRAME_CHROME_W
} from "./seed-reference-resize-clamp";

/** Page-space axis-aligned rect. */
export interface PageRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Normalized rect in coordinate space A (media box, 0–1). */
export interface NormalizedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Inset from seed-reference-projection shape origin to media content box.
 * Left: pad 4 + media border 1. Top: pad 2 + header 24 + media border 1.
 * Matches `SEED_REF_FRAME_CHROME_*` (left+right = W, top+bottom = H).
 */
export const SEED_REF_MEDIA_INSET_X = 5;
export const SEED_REF_MEDIA_INSET_Y = 27;

/** Tiny square side for point-click → marker (matches Runtime `POINT_SIDE`). */
export const REGION_ANNOTATION_POINT_SIDE = 0.02;

/**
 * Screenshot media box in page space for a seed-reference-projection shape
 * at `(shapePageX, shapePageY)` with size `(shapeW, shapeH)`.
 */
export function mediaBoxInPage(
  shapePageX: number,
  shapePageY: number,
  shapeW: number,
  shapeH: number
): PageRect {
  return {
    x: shapePageX + SEED_REF_MEDIA_INSET_X,
    y: shapePageY + SEED_REF_MEDIA_INSET_Y,
    w: Math.max(0, shapeW - SEED_REF_FRAME_CHROME_W),
    h: Math.max(0, shapeH - SEED_REF_FRAME_CHROME_H)
  };
}

/** Map a normalized rect (0–1 in media box) to page-space pixels. */
export function normalizedRectToPage(
  mediaBox: PageRect,
  rect: NormalizedRect
): PageRect {
  return {
    x: mediaBox.x + rect.x * mediaBox.w,
    y: mediaBox.y + rect.y * mediaBox.h,
    w: rect.w * mediaBox.w,
    h: rect.h * mediaBox.h
  };
}

/**
 * Map a page-space rect to normalized (0–1) relative to the media box.
 * Degenerate media (w/h ≤ 0) yields zeros for the corresponding axes.
 */
export function pageRectToNormalized(
  mediaBox: PageRect,
  pageRect: PageRect
): NormalizedRect {
  const w = mediaBox.w > 0 ? pageRect.w / mediaBox.w : 0;
  const h = mediaBox.h > 0 ? pageRect.h / mediaBox.h : 0;
  const x = mediaBox.w > 0 ? (pageRect.x - mediaBox.x) / mediaBox.w : 0;
  const y = mediaBox.h > 0 ? (pageRect.y - mediaBox.y) / mediaBox.h : 0;
  return { x, y, w, h };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Clamp a normalized rect so it stays fully inside [0,1]×[0,1] with
 * non-negative size. Shrinks overflow rather than shifting origin when both
 * origin and size would exceed the unit square.
 */
export function clampNormalizedRect(rect: NormalizedRect): NormalizedRect {
  const x = clamp01(rect.x);
  const y = clamp01(rect.y);
  const w = Math.max(0, Math.min(clamp01(rect.w), 1 - x));
  const h = Math.max(0, Math.min(clamp01(rect.h), 1 - y));
  return { x, y, w, h };
}

/** Clamp a page rect to the intersection with `mediaBox` (AABB clip). */
export function clampPageRectToMediaBox(
  mediaBox: PageRect,
  pageRect: PageRect
): PageRect {
  if (mediaBox.w <= 0 || mediaBox.h <= 0) {
    return { x: mediaBox.x, y: mediaBox.y, w: 0, h: 0 };
  }
  const left = Math.max(pageRect.x, mediaBox.x);
  const top = Math.max(pageRect.y, mediaBox.y);
  const right = Math.min(pageRect.x + pageRect.w, mediaBox.x + mediaBox.w);
  const bottom = Math.min(pageRect.y + pageRect.h, mediaBox.y + mediaBox.h);
  return {
    x: left,
    y: top,
    w: Math.max(0, right - left),
    h: Math.max(0, bottom - top)
  };
}

/**
 * Expand a point-click to a **visually square** marker in page pixels.
 *
 * `REGION_ANNOTATION_POINT_SIDE` is the normalized **width** (fraction of media
 * width). Height is derived from the media aspect so page `w === h`. Using the
 * same normalized value for both axes on a tall Figma frame made markers look
 * like vertical rectangles (`h_page = 0.02 * mediaH` ≫ `w_page`).
 *
 * Pass `mediaBox` (at least `w`/`h`) whenever available. Without it, falls back
 * to equal normalized sides (legacy / tests without aspect).
 */
export function expandNormalizedPointToRect(
  point: { x: number; y: number },
  mediaBox?: Pick<PageRect, "w" | "h">
): NormalizedRect {
  const w = REGION_ANNOTATION_POINT_SIDE;
  let h = REGION_ANNOTATION_POINT_SIDE;
  if (mediaBox && mediaBox.w > 0 && mediaBox.h > 0) {
    // pageSide = w * mediaBox.w  →  h = pageSide / mediaBox.h
    h = (w * mediaBox.w) / mediaBox.h;
  }
  // Keep the marker fully inside the unit square (very wide/short media).
  h = Math.min(h, 1);
  const halfW = w / 2;
  const halfH = h / 2;
  const maxX = Math.max(0, 1 - w);
  const maxY = Math.max(0, 1 - h);
  const x = Math.min(Math.max(0, point.x - halfW), maxX);
  const y = Math.min(Math.max(0, point.y - halfH), maxY);
  return { x, y, w, h };
}
