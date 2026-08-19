// Display-time Agent padding (Task 6). DB-free / browser-safe.

import { expect, test } from "vitest";
import {
  AGENT_REGION_MARGIN,
  displayRectForRegionAnnotation,
  expandAgentRegionRect,
  expandFocusHoleRect
} from "../../lib/runtime/region-annotation-display";
import { normalizedRectToPage } from "../../components/workbench/region-annotation-geometry";

const RAW = { x: 0.2, y: 0.25, w: 0.6, h: 0.08 };
const TALL = { w: 390, h: 1560 };

test.describe("displayRectForRegionAnnotation", () => {
  test("v1_padded agent row is never padded again (compat)", () => {
    const padded = expandAgentRegionRect(RAW, TALL);
    const display = displayRectForRegionAnnotation({
      author: "agent",
      rect: padded,
      geometry_version: "v1_padded",
      from_point: false,
      mediaSize: TALL
    });
    expect(display).toEqual(padded);
  });

  test("v1_padded designer row is unchanged", () => {
    const display = displayRectForRegionAnnotation({
      author: "designer",
      rect: RAW,
      geometry_version: "v1_padded",
      from_point: false,
      mediaSize: TALL
    });
    expect(display).toEqual(RAW);
  });

  test("v2_raw agent explicit expands with page-isotropic margin", () => {
    const display = displayRectForRegionAnnotation({
      author: "agent",
      rect: RAW,
      geometry_version: "v2_raw",
      from_point: false,
      mediaSize: TALL
    });
    const expected = expandAgentRegionRect(RAW, TALL);
    expect(display).toEqual(expected);
    const my = (AGENT_REGION_MARGIN * TALL.w) / TALL.h;
    expect(display.x).toBeCloseTo(RAW.x - AGENT_REGION_MARGIN, 6);
    expect(display.y).toBeCloseTo(RAW.y - my, 6);
    expect(display.h - RAW.h).toBeLessThan(display.w - RAW.w);
  });

  test("v2_raw designer explicit is unchanged", () => {
    const display = displayRectForRegionAnnotation({
      author: "designer",
      rect: RAW,
      geometry_version: "v2_raw",
      from_point: false,
      mediaSize: TALL
    });
    expect(display).toEqual(RAW);
  });

  test("v2_raw agent from_point is unchanged", () => {
    const pointRect = { x: 0, y: 0, w: 0.02, h: 0.02 };
    const display = displayRectForRegionAnnotation({
      author: "agent",
      rect: pointRect,
      geometry_version: "v2_raw",
      from_point: true,
      mediaSize: TALL
    });
    expect(display).toEqual(pointRect);
  });

  test("Workbench projection uses display rect before normalizedRectToPage", () => {
    const mediaBox = { x: 10, y: 20, w: 390, h: 1560 };
    const display = displayRectForRegionAnnotation({
      author: "agent",
      rect: RAW,
      geometry_version: "v2_raw",
      from_point: false,
      mediaSize: { w: mediaBox.w, h: mediaBox.h }
    });
    const page = normalizedRectToPage(mediaBox, display);
    const rawPage = normalizedRectToPage(mediaBox, RAW);
    expect(page.w).toBeGreaterThan(rawPage.w);
    expect(page.h).toBeGreaterThan(rawPage.h);
    expect(page.x).toBeLessThan(rawPage.x);
    expect(page.y).toBeLessThan(rawPage.y);
  });
});

test.describe("expandFocusHoleRect", () => {
  test("expands 2 screenshot pixels per side and clamps to the media box", () => {
    const media = { w: 695, h: 1851 };
    const display = expandFocusHoleRect(RAW, media);
    const padX = 2 / 695;
    const padY = 2 / 1851;

    expect(display.x).toBeCloseTo(RAW.x - padX, 6);
    expect(display.y).toBeCloseTo(RAW.y - padY, 6);
    expect(display.w).toBeCloseTo(RAW.w + padX * 2, 6);
    expect(display.h).toBeCloseTo(RAW.h + padY * 2, 6);

    const flush = expandFocusHoleRect({ x: 0, y: 0, w: 0.01, h: 0.01 }, media);
    expect(flush.x).toBe(0);
    expect(flush.y).toBe(0);
    expect(flush.w).toBeCloseTo(0.01 + padX, 6);
    expect(flush.h).toBeCloseTo(0.01 + padY, 6);
  });
});
