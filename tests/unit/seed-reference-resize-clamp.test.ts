import { expect, test } from "vitest";
import {
  clampSeedReferenceResizeToNaturalSize,
  DEFAULT_DISPLAY_MEDIA_EDGE,
  defaultDisplaySizeFromNaturalPixels,
  MAX_SCREENSHOT_MEDIA_EDGE,
  maxDisplaySizeFromNaturalPixels,
  SEED_REF_FRAME_CHROME_H,
  SEED_REF_FRAME_CHROME_W,
  sizeFromNaturalPixels
} from "../../components/workbench/seed-reference-resize-clamp";

test.describe("seed reference projection resize clamp", () => {
  test("default display fits a 4096 capture to the 1080 long edge", () => {
    const display = defaultDisplaySizeFromNaturalPixels(4096, 2304);
    expect(display.w).toBe(DEFAULT_DISPLAY_MEDIA_EDGE + SEED_REF_FRAME_CHROME_W);
    expect(display.h).toBe(
      Math.round((2304 * DEFAULT_DISPLAY_MEDIA_EDGE) / 4096) +
        SEED_REF_FRAME_CHROME_H
    );
    // sizeFromNaturalPixels stays the default-display helper.
    expect(sizeFromNaturalPixels(4096, 2304)).toEqual(display);
  });

  test("max display keeps full natural size up to the 4096 asset cap", () => {
    const max = maxDisplaySizeFromNaturalPixels(4096, 2304);
    expect(max.w).toBe(MAX_SCREENSHOT_MEDIA_EDGE + SEED_REF_FRAME_CHROME_W);
    expect(max.h).toBe(2304 + SEED_REF_FRAME_CHROME_H);

    const over = maxDisplaySizeFromNaturalPixels(5000, 4000);
    expect(Math.max(over.w - SEED_REF_FRAME_CHROME_W, over.h - SEED_REF_FRAME_CHROME_H)).toBe(
      MAX_SCREENSHOT_MEDIA_EDGE
    );
  });

  test("allows shrinking below the screenshot natural size", () => {
    const max = maxDisplaySizeFromNaturalPixels(800, 600);
    const resized = clampSeedReferenceResizeToNaturalSize({
      x: 10,
      y: 20,
      rotation: 0,
      handle: "bottom_right",
      w: max.w / 2,
      h: max.h / 2,
      maxW: max.w,
      maxH: max.h
    });

    expect(resized).toEqual({
      x: 10,
      y: 20,
      w: max.w / 2,
      h: max.h / 2
    });
  });

  test("clamps corner growth to the screenshot natural size plus chrome", () => {
    const max = maxDisplaySizeFromNaturalPixels(800, 600);
    const resized = clampSeedReferenceResizeToNaturalSize({
      x: -200,
      y: -150,
      rotation: 0,
      handle: "top_left",
      w: max.w * 2,
      h: max.h * 2,
      maxW: max.w,
      maxH: max.h
    });

    expect(resized).toEqual({
      x: max.w - 200,
      y: max.h - 150,
      w: max.w,
      h: max.h
    });
  });

  test("designer can grow from default 1080 display toward full natural", () => {
    const display = defaultDisplaySizeFromNaturalPixels(4096, 2304);
    const max = maxDisplaySizeFromNaturalPixels(4096, 2304);
    expect(display.w).toBeLessThan(max.w);

    const grown = clampSeedReferenceResizeToNaturalSize({
      x: 0,
      y: 0,
      rotation: 0,
      handle: "bottom_right",
      w: max.w,
      h: max.h,
      maxW: max.w,
      maxH: max.h
    });
    expect(grown.w).toBe(max.w);
    expect(grown.h).toBe(max.h);
  });

  test("keeps free resize when no natural screenshot size is known", () => {
    const resized = clampSeedReferenceResizeToNaturalSize({
      x: 10,
      y: 20,
      rotation: 0,
      handle: "bottom_right",
      w: 1200,
      h: 900,
      maxW: 0,
      maxH: 0
    });

    expect(resized).toEqual({
      x: 10,
      y: 20,
      w: 1200,
      h: 900
    });
  });
});
