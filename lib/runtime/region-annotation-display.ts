// Browser-safe Region Annotation display geometry (Task 6).
//
// DB stores raw validated rects (`v2_raw`). Agent comfort padding is applied
// only at Workbench projection time. Legacy rows (`v1_padded`) already include
// create-time padding and must never be padded again.

/** Horizontal comfort padding as a fraction of media **width**. */
export const AGENT_REGION_MARGIN = 0.012;

export type RegionAnnotationGeometryVersion = "v1_padded" | "v2_raw";

export type RegionAnnotationDisplayAuthor = "designer" | "agent";

export interface RegionAnnotationDisplayRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Optional media box size (any positive units) for isotropic page padding. */
export interface AgentRegionMediaSize {
  w: number;
  h: number;
}

/**
 * Expand an Agent region rect with page-isotropic comfort padding, then clamp
 * to the unit media box.
 *
 * `AGENT_REGION_MARGIN` is the normalized **horizontal** inset (fraction of
 * media width). When `mediaSize` is provided, vertical inset is
 * `margin * mediaW / mediaH` so top/bottom page pixels match left/right.
 * Without media size, falls back to equal normalized insets (legacy).
 */
export function expandAgentRegionRect(
  rect: RegionAnnotationDisplayRect,
  mediaSize?: AgentRegionMediaSize
): RegionAnnotationDisplayRect {
  const mx = AGENT_REGION_MARGIN;
  let my = AGENT_REGION_MARGIN;
  if (mediaSize && mediaSize.w > 0 && mediaSize.h > 0) {
    my = (mx * mediaSize.w) / mediaSize.h;
  }
  const left = Math.max(0, rect.x - mx);
  const top = Math.max(0, rect.y - my);
  const right = Math.min(1, rect.x + rect.w + mx);
  const bottom = Math.min(1, rect.y + rect.h + my);
  return {
    x: left,
    y: top,
    w: Math.max(0, right - left),
    h: Math.max(0, bottom - top)
  };
}

export interface DisplayRectForRegionAnnotationInput {
  author: RegionAnnotationDisplayAuthor;
  rect: RegionAnnotationDisplayRect;
  geometry_version: RegionAnnotationGeometryVersion;
  from_point: boolean;
  mediaSize?: AgentRegionMediaSize;
}

/**
 * Resolve the normalized rect to project onto the Evidence Surface media box.
 *
 * - `v1_padded`: stored as already-padded → return as-is (any author).
 * - `v2_raw` + agent + explicit (!from_point): expand with page-isotropic margin.
 * - designer or from_point: return as-is.
 */
export function displayRectForRegionAnnotation(
  input: DisplayRectForRegionAnnotationInput
): RegionAnnotationDisplayRect {
  const { author, rect, geometry_version, from_point, mediaSize } = input;
  if (geometry_version === "v1_padded") {
    return { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
  }
  if (author === "agent" && !from_point) {
    return expandAgentRegionRect(rect, mediaSize);
  }
  return { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
}
