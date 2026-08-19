// Browser-safe Region Annotation display geometry (Task 6).
//
// DB stores raw validated rects (`v2_raw`). Agent comfort padding is applied
// only at Workbench projection time. Legacy rows (`v1_padded`) already include
// create-time padding and must never be padded again.

/** Horizontal comfort padding as a fraction of media **width**. */
export const AGENT_REGION_MARGIN = 0.012;

/** Structure-overlay comfort padding: intentionally tighter than Agent regions. */
export const STRUCTURE_REGION_MARGIN = 0.006;

/** Focus-mode mask hole inset in screenshot pixels (Figma 177:679). */
export const FOCUS_HOLE_PADDING_PX = 2;

/** Focus-mode mask hole corner radius in screenshot pixels (Figma 177:679). */
export const FOCUS_HOLE_RADIUS_PX = 2;

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

function expandRect(
  rect: RegionAnnotationDisplayRect,
  mx: number,
  my: number
): RegionAnnotationDisplayRect {
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

function isotropicInsets(
  mx: number,
  mediaSize?: AgentRegionMediaSize
): { mx: number; my: number } {
  if (mediaSize && mediaSize.w > 0 && mediaSize.h > 0) {
    return { mx, my: (mx * mediaSize.w) / mediaSize.h };
  }
  return { mx, my: mx };
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
  const { mx, my } = isotropicInsets(AGENT_REGION_MARGIN, mediaSize);
  return expandRect(rect, mx, my);
}

/** Expand a structure-selected Designer region with the same isotropic rule. */
export function expandStructureRegionRect(
  rect: RegionAnnotationDisplayRect,
  mediaSize?: AgentRegionMediaSize
): RegionAnnotationDisplayRect {
  const { mx, my } = isotropicInsets(STRUCTURE_REGION_MARGIN, mediaSize);
  return expandRect(rect, mx, my);
}

/**
 * Expand a Focus Mode hole by 2 screenshot pixels per side, then clamp.
 * Runtime anchor rects stay raw; this is display-only.
 */
export function expandFocusHoleRect(
  rect: RegionAnnotationDisplayRect,
  mediaSize?: AgentRegionMediaSize
): RegionAnnotationDisplayRect {
  if (!mediaSize || mediaSize.w <= 0 || mediaSize.h <= 0) {
    return { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
  }
  return expandRect(
    rect,
    FOCUS_HOLE_PADDING_PX / mediaSize.w,
    FOCUS_HOLE_PADDING_PX / mediaSize.h
  );
}

/** Normalized SVG rx/ry so the hole radius stays 2 screenshot pixels. */
export function focusHoleMaskRadius(mediaSize: AgentRegionMediaSize): {
  rx: number;
  ry: number;
} {
  if (mediaSize.w <= 0 || mediaSize.h <= 0) {
    return { rx: 0, ry: 0 };
  }
  return {
    rx: FOCUS_HOLE_RADIUS_PX / mediaSize.w,
    ry: FOCUS_HOLE_RADIUS_PX / mediaSize.h
  };
}

export interface DisplayRectForRegionAnnotationInput {
  author: RegionAnnotationDisplayAuthor;
  rect: RegionAnnotationDisplayRect;
  geometry_version: RegionAnnotationGeometryVersion;
  from_point: boolean;
  /** Explicit persisted target kind; node targets use the structure margin. */
  targetKind?: "figma-surface" | "figma-node" | "figma-region";
  mediaSize?: AgentRegionMediaSize;
}

/**
 * Resolve the normalized rect to project onto the Evidence Surface media box.
 *
 * - `v1_padded`: stored as already-padded → return as-is (any author).
 * - `v2_raw` + figma-node: use the tighter Structure margin for hover parity.
 * - `v2_raw` + non-node agent + explicit (!from_point): larger Agent margin.
 * - freeform designer regions or point markers: return as-is.
 */
export function displayRectForRegionAnnotation(
  input: DisplayRectForRegionAnnotationInput
): RegionAnnotationDisplayRect {
  const {
    author,
    rect,
    geometry_version,
    from_point,
    targetKind,
    mediaSize
  } = input;
  if (geometry_version === "v1_padded") {
    return { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
  }
  if (!from_point && targetKind === "figma-node") {
    return expandStructureRegionRect(rect, mediaSize);
  }
  if (author === "agent" && !from_point) {
    return expandAgentRegionRect(rect, mediaSize);
  }
  return { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
}
