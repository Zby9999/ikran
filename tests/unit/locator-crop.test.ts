import { describe, expect, test } from "vitest";

import {
  computeLocatorCrop,
  pickLocatorOrientation
} from "../../lib/runtime/locator-crop";

describe("pickLocatorOrientation", () => {
  test("wide and near-square nodes take 3:2 landscape", () => {
    expect(pickLocatorOrientation(1240, 46)).toBe("landscape");
    expect(pickLocatorOrientation(100, 100)).toBe("landscape");
    expect(pickLocatorOrientation(150, 100)).toBe("landscape");
  });

  test("nodes taller than 2:3 take portrait", () => {
    expect(pickLocatorOrientation(100, 300)).toBe("portrait");
    expect(pickLocatorOrientation(2, 4)).toBe("portrait");
  });
});

describe("computeLocatorCrop", () => {
  const frame = { x: 0, y: 0, width: 1200, height: 800 };

  test("contains a wide node in a 3:2 window centered on it", () => {
    const result = computeLocatorCrop(frame, {
      x: 150,
      y: 200,
      width: 300,
      height: 100
    });
    expect(result).toEqual({
      orientation: "landscape",
      crop: { x: 0.125, y: 0.1875, width: 0.25, height: 0.25 },
      nodeRect: { x: 0, y: 0.25, width: 1, height: 0.5 }
    });
  });

  test("contains a tall node in a 2:3 window centered on it", () => {
    const result = computeLocatorCrop(frame, {
      x: 200,
      y: 100,
      width: 100,
      height: 300
    });
    expect(result).toEqual({
      orientation: "portrait",
      crop: {
        x: 0.125,
        y: 0.125,
        width: 200 / 1200,
        height: 0.375
      },
      nodeRect: { x: 0.25, y: 0, width: 0.5, height: 1 }
    });
  });

  test("keeps the top of a node taller than the frame crop", () => {
    const result = computeLocatorCrop(frame, {
      x: 100,
      y: 0,
      width: 400,
      height: 900
    });
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.orientation).toBe("portrait");
    expect(result.crop.y).toBe(0);
    expect(result.nodeRect.y).toBe(0);
    expect(result.nodeRect.height).toBeGreaterThan(1);
  });

  test("a thin sticky bar keeps page context under a 3:2 crop from the top", () => {
    const result = computeLocatorCrop(
      { x: 0, y: 0, width: 1280, height: 800 },
      { x: 20, y: 0, width: 1240, height: 46 }
    );
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.orientation).toBe("landscape");
    expect(result.crop.y).toBe(0);
    expect(result.nodeRect.y).toBe(0);
    expect(result.nodeRect.height).toBeLessThan(0.2);
    expect(result.nodeRect.width).toBeGreaterThan(0.9);
  });

  test("rejects empty frame or node bounds", () => {
    expect(
      computeLocatorCrop(
        { x: 0, y: 0, width: 0, height: 800 },
        { x: 0, y: 0, width: 10, height: 10 }
      )
    ).toBeNull();
    expect(
      computeLocatorCrop(frame, { x: 0, y: 0, width: 10, height: 0 })
    ).toBeNull();
  });
});
