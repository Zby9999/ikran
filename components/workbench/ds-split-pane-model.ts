// Design System Browser leaf split-pane state math (Issue 09C-A).
//
// Pure, DOM-free ratio logic for the resizable left/right leaf layout so the
// drag, keyboard, reset, min-width and stacking rules can be unit-tested
// without rendering. The LeafSplit component (ds-split-pane.tsx) owns the DOM
// side; this module owns the numbers.
//
// Locked product decisions honored here:
//   - 42% / 58% is the DEFAULT ratio, not a fixed one.
//   - Both panes have protected minimum widths; neither text nor samples may
//     be compressed below readability.
//   - When the container cannot fit both minimums + divider, the leaf stacks
//     (rules above, samples below) and the divider disappears.
//   - Double-click / Home restores the default ratio.

import { DEFAULT_DS_SPLIT_RATIO } from "../../lib/runtime/design-system-browser-preferences-shared";

// Single source: the persistence contract owns the default; re-exported here
// so interaction code keeps one import site.
export { DEFAULT_DS_SPLIT_RATIO };

export const DS_SPLIT_MIN_LEFT_PX = 340;
export const DS_SPLIT_MIN_RIGHT_PX = 420;
/* Divider hit area (spec: "足够的 pointer hit area"). The visible line stays
   1px centered — the extra pixels are dead space, not chrome. */
export const DS_SPLIT_DIVIDER_PX = 20;
export const DS_SPLIT_KEYBOARD_STEP = 0.02;
export const DS_SPLIT_KEYBOARD_STEP_LARGE = 0.1;

/** Below this content width the leaf can no longer keep both panes readable. */
export const DS_SPLIT_STACKED_MAX_PX =
  DS_SPLIT_MIN_LEFT_PX + DS_SPLIT_MIN_RIGHT_PX + DS_SPLIT_DIVIDER_PX;

/**
 * Whether the leaf must fall back to the single-column (rules above, samples
 * below) arrangement at this container width.
 */
export function isSplitStacked(containerWidth: number): boolean {
  return containerWidth < DS_SPLIT_STACKED_MAX_PX;
}

/**
 * Clamp a ratio so both panes keep their minimum pixel widths at the given
 * container width. The divider's own pixels are subtracted first — the ratio
 * always describes how the *remaining* width is shared.
 *
 * Degenerate containers (stacked range, or a width that cannot satisfy both
 * minimums) fall back to the default ratio: there is no meaningful draggable
 * range, and a stable value keeps persistence round-trips honest.
 */
export function clampSplitRatio(
  ratio: number,
  containerWidth: number
): number {
  if (!Number.isFinite(ratio)) return DEFAULT_DS_SPLIT_RATIO;
  const usable = containerWidth - DS_SPLIT_DIVIDER_PX;
  if (usable < DS_SPLIT_MIN_LEFT_PX + DS_SPLIT_MIN_RIGHT_PX) {
    return DEFAULT_DS_SPLIT_RATIO;
  }
  const min = DS_SPLIT_MIN_LEFT_PX / usable;
  const max = 1 - DS_SPLIT_MIN_RIGHT_PX / usable;
  return Math.min(max, Math.max(min, ratio));
}

/**
 * Ratio described by a pointer x position inside the split container.
 * Already clamped to the minimum-width range.
 */
export function ratioFromPointer(
  clientX: number,
  containerLeft: number,
  containerWidth: number
): number {
  const usable = containerWidth - DS_SPLIT_DIVIDER_PX;
  if (usable <= 0) return DEFAULT_DS_SPLIT_RATIO;
  const raw = (clientX - containerLeft) / usable;
  return clampSplitRatio(raw, containerWidth);
}

/**
 * Keyboard adjustment contract for the divider (role="separator"):
 * ArrowLeft/ArrowRight nudge the LEFT pane narrower/wider (small step,
 * Shift for a large step), Home restores the default. Returns null for keys
 * the divider does not handle, so the caller can leave them alone.
 */
export function nextKeyboardRatio(
  ratio: number,
  key: string,
  shiftKey: boolean,
  containerWidth: number
): number | null {
  if (key === "Home") return DEFAULT_DS_SPLIT_RATIO;
  const step = shiftKey
    ? DS_SPLIT_KEYBOARD_STEP_LARGE
    : DS_SPLIT_KEYBOARD_STEP;
  if (key === "ArrowLeft") {
    return clampSplitRatio(ratio - step, containerWidth);
  }
  if (key === "ArrowRight") {
    return clampSplitRatio(ratio + step, containerWidth);
  }
  return null;
}
