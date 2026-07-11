import { expect, test } from "vitest";
import {
  clampSeedReferenceResizeToNaturalSize,
  sizeFromNaturalPixels
} from "../../components/workbench/seed-reference-resize-clamp";

test.describe("seed reference projection resize clamp", () => {
  test("allows shrinking below the screenshot natural size", () => {
    const max = sizeFromNaturalPixels(800, 600);
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
    const max = sizeFromNaturalPixels(800, 600);
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
