// Pure geometry unit tests for Region Annotation projection (Issue 06).
// No browser / Runtime — coordinate space A ↔ page mapping only.

import { expect, test } from "vitest";
import {
  REGION_ANNOTATION_POINT_SIDE,
  SEED_REF_MEDIA_INSET_X,
  SEED_REF_MEDIA_INSET_Y,
  clampNormalizedRect,
  clampPageRectToMediaBox,
  expandNormalizedPointToRect,
  mediaBoxInPage,
  normalizedRectToPage,
  pageRectToNormalized
} from "../../components/workbench/region-annotation-geometry";
import {
  SEED_REF_FRAME_CHROME_H,
  SEED_REF_FRAME_CHROME_W
} from "../../components/workbench/seed-reference-resize-clamp";

test.describe("region-annotation-geometry (unit)", () => {
  test("mediaBoxInPage insets chrome from the seed-reference frame", () => {
    const shapeW = 380;
    const shapeH = 520;
    const box = mediaBoxInPage(100, 200, shapeW, shapeH);

    expect(box).toEqual({
      x: 100 + SEED_REF_MEDIA_INSET_X,
      y: 200 + SEED_REF_MEDIA_INSET_Y,
      w: shapeW - SEED_REF_FRAME_CHROME_W,
      h: shapeH - SEED_REF_FRAME_CHROME_H
    });
    expect(SEED_REF_MEDIA_INSET_X * 2).toBe(SEED_REF_FRAME_CHROME_W);
    expect(SEED_REF_MEDIA_INSET_Y + 5).toBe(SEED_REF_FRAME_CHROME_H);
  });

  test("normalizedRectToPage and pageRectToNormalized round-trip", () => {
    const media = mediaBoxInPage(0, 0, 410, 532);
    const normalized = { x: 0.25, y: 0.1, w: 0.5, h: 0.2 };
    const page = normalizedRectToPage(media, normalized);
    const back = pageRectToNormalized(media, page);

    expect(page.x).toBeCloseTo(media.x + 0.25 * media.w);
    expect(page.y).toBeCloseTo(media.y + 0.1 * media.h);
    expect(page.w).toBeCloseTo(0.5 * media.w);
    expect(page.h).toBeCloseTo(0.2 * media.h);
    expect(back.x).toBeCloseTo(normalized.x);
    expect(back.y).toBeCloseTo(normalized.y);
    expect(back.w).toBeCloseTo(normalized.w);
    expect(back.h).toBeCloseTo(normalized.h);
  });

  test("full-media normalized rect fills the media box in page space", () => {
    const media = { x: 50, y: 80, w: 200, h: 400 };
    const page = normalizedRectToPage(media, { x: 0, y: 0, w: 1, h: 1 });
    expect(page).toEqual(media);
  });

  test("clampNormalizedRect keeps rect inside the unit square", () => {
    expect(clampNormalizedRect({ x: -0.1, y: 0.2, w: 0.5, h: 0.3 })).toEqual({
      x: 0,
      y: 0.2,
      w: 0.5,
      h: 0.3
    });
    const overflow = clampNormalizedRect({ x: 0.8, y: 0.8, w: 0.5, h: 0.5 });
    expect(overflow.x).toBeCloseTo(0.8);
    expect(overflow.y).toBeCloseTo(0.8);
    expect(overflow.w).toBeCloseTo(0.2);
    expect(overflow.h).toBeCloseTo(0.2);
  });

  test("clampPageRectToMediaBox clips overflow to the media box", () => {
    const media = { x: 10, y: 20, w: 100, h: 80 };
    // page [0,50]×[0,40] ∩ media [10,110]×[20,100] → [10,50]×[20,40]
    expect(
      clampPageRectToMediaBox(media, { x: 0, y: 0, w: 50, h: 40 })
    ).toEqual({ x: 10, y: 20, w: 40, h: 20 });
    expect(
      clampPageRectToMediaBox(media, { x: 90, y: 70, w: 50, h: 50 })
    ).toEqual({ x: 90, y: 70, w: 20, h: 30 });
  });

  test("expandNormalizedPointToRect builds a page-square using media aspect", () => {
    expect(REGION_ANNOTATION_POINT_SIDE).toBe(0.02);

    // Without media box: equal normalized sides (legacy).
    const mid = expandNormalizedPointToRect({ x: 0.5, y: 0.5 });
    expect(mid).toEqual({
      x: 0.5 - REGION_ANNOTATION_POINT_SIDE / 2,
      y: 0.5 - REGION_ANNOTATION_POINT_SIDE / 2,
      w: REGION_ANNOTATION_POINT_SIDE,
      h: REGION_ANNOTATION_POINT_SIDE
    });

    // Tall media (w=100, h=400): page square ⇒ h_norm = 0.02 * 100/400 = 0.005
    const tall = expandNormalizedPointToRect(
      { x: 0.5, y: 0.5 },
      { w: 100, h: 400 }
    );
    expect(tall.w).toBe(REGION_ANNOTATION_POINT_SIDE);
    expect(tall.h).toBeCloseTo(0.005, 6);
    expect(tall.x).toBeCloseTo(0.5 - tall.w / 2, 6);
    expect(tall.y).toBeCloseTo(0.5 - tall.h / 2, 6);
    const page = normalizedRectToPage(
      { x: 0, y: 0, w: 100, h: 400 },
      tall
    );
    expect(page.w).toBeCloseTo(page.h, 6);

    const corner = expandNormalizedPointToRect({ x: 0, y: 0 });
    expect(corner).toEqual({
      x: 0,
      y: 0,
      w: REGION_ANNOTATION_POINT_SIDE,
      h: REGION_ANNOTATION_POINT_SIDE
    });

    const far = expandNormalizedPointToRect({ x: 1, y: 1 });
    expect(far).toEqual({
      x: 1 - REGION_ANNOTATION_POINT_SIDE,
      y: 1 - REGION_ANNOTATION_POINT_SIDE,
      w: REGION_ANNOTATION_POINT_SIDE,
      h: REGION_ANNOTATION_POINT_SIDE
    });
  });

  test("pageRectToNormalized handles degenerate media without NaN", () => {
    const empty = pageRectToNormalized(
      { x: 0, y: 0, w: 0, h: 0 },
      { x: 10, y: 20, w: 5, h: 5 }
    );
    expect(empty).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});
