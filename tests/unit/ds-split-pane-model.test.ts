import { describe, expect, it } from "vitest";
import {
  DEFAULT_DS_SPLIT_RATIO,
  DS_SPLIT_DIVIDER_PX,
  DS_SPLIT_MIN_LEFT_PX,
  DS_SPLIT_MIN_RIGHT_PX,
  DS_SPLIT_STACKED_MAX_PX,
  clampSplitRatio,
  isSplitStacked,
  nextKeyboardRatio,
  ratioFromPointer
} from "@/components/workbench/ds-split-pane-model";

const WIDE = 1200;

describe("isSplitStacked", () => {
  it("stacks below the combined minimum width", () => {
    expect(isSplitStacked(DS_SPLIT_STACKED_MAX_PX - 1)).toBe(true);
    expect(isSplitStacked(500)).toBe(true);
  });

  it("splits at and above the combined minimum width", () => {
    expect(isSplitStacked(DS_SPLIT_STACKED_MAX_PX)).toBe(false);
    expect(isSplitStacked(WIDE)).toBe(false);
  });

  it("threshold is exactly left min + right min + divider", () => {
    expect(DS_SPLIT_STACKED_MAX_PX).toBe(
      DS_SPLIT_MIN_LEFT_PX + DS_SPLIT_MIN_RIGHT_PX + DS_SPLIT_DIVIDER_PX
    );
  });
});

describe("clampSplitRatio", () => {
  it("keeps the default ratio inside the range", () => {
    expect(clampSplitRatio(DEFAULT_DS_SPLIT_RATIO, WIDE)).toBeCloseTo(0.42, 5);
  });

  it("clamps so the left pane never goes below its minimum", () => {
    const usable = WIDE - DS_SPLIT_DIVIDER_PX;
    expect(clampSplitRatio(0.01, WIDE)).toBeCloseTo(
      DS_SPLIT_MIN_LEFT_PX / usable,
      5
    );
  });

  it("clamps so the right pane never goes below its minimum", () => {
    const usable = WIDE - DS_SPLIT_DIVIDER_PX;
    expect(clampSplitRatio(0.99, WIDE)).toBeCloseTo(
      1 - DS_SPLIT_MIN_RIGHT_PX / usable,
      5
    );
  });

  it("falls back to the default when the container cannot satisfy minimums", () => {
    expect(clampSplitRatio(0.7, 500)).toBe(DEFAULT_DS_SPLIT_RATIO);
  });

  it("falls back to the default for non-finite input", () => {
    expect(clampSplitRatio(Number.NaN, WIDE)).toBe(DEFAULT_DS_SPLIT_RATIO);
  });
});

describe("ratioFromPointer", () => {
  it("maps the container midpoint to ~0.5 of the usable width", () => {
    expect(ratioFromPointer(600, 0, WIDE)).toBeCloseTo(
      600 / (WIDE - DS_SPLIT_DIVIDER_PX),
      5
    );
  });

  it("respects the container's left offset", () => {
    expect(ratioFromPointer(700, 100, WIDE)).toBeCloseTo(
      600 / (WIDE - DS_SPLIT_DIVIDER_PX),
      5
    );
  });

  it("clamps pointers dragged past the pane minimums", () => {
    const usable = WIDE - DS_SPLIT_DIVIDER_PX;
    expect(ratioFromPointer(0, 0, WIDE)).toBeCloseTo(
      DS_SPLIT_MIN_LEFT_PX / usable,
      5
    );
    expect(ratioFromPointer(5000, 0, WIDE)).toBeCloseTo(
      1 - DS_SPLIT_MIN_RIGHT_PX / usable,
      5
    );
  });
});

describe("nextKeyboardRatio", () => {
  it("ArrowLeft narrows the left pane by the small step", () => {
    expect(nextKeyboardRatio(0.42, "ArrowLeft", false, WIDE)).toBeCloseTo(
      0.4,
      5
    );
  });

  it("ArrowRight widens the left pane by the small step", () => {
    expect(nextKeyboardRatio(0.42, "ArrowRight", false, WIDE)).toBeCloseTo(
      0.44,
      5
    );
  });

  it("Shift applies the large step", () => {
    expect(nextKeyboardRatio(0.42, "ArrowRight", true, WIDE)).toBeCloseTo(
      0.52,
      5
    );
  });

  it("Home restores the default ratio", () => {
    expect(nextKeyboardRatio(0.7, "Home", false, WIDE)).toBe(
      DEFAULT_DS_SPLIT_RATIO
    );
  });

  it("clamps at the pane minimums", () => {
    const usable = WIDE - DS_SPLIT_DIVIDER_PX;
    expect(nextKeyboardRatio(0.99, "ArrowRight", false, WIDE)).toBeCloseTo(
      1 - DS_SPLIT_MIN_RIGHT_PX / usable,
      5
    );
  });

  it("returns null for keys the divider does not handle", () => {
    expect(nextKeyboardRatio(0.42, "Enter", false, WIDE)).toBeNull();
    expect(nextKeyboardRatio(0.42, "ArrowUp", false, WIDE)).toBeNull();
    expect(nextKeyboardRatio(0.42, "Escape", false, WIDE)).toBeNull();
  });
});
