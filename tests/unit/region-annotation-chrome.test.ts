import { test, expect } from "vitest";
import {
  REGION_ANNOTATION_RADIUS_AT_REF,
  REGION_ANNOTATION_REF_MEDIA_W,
  REGION_ANNOTATION_STROKE_AT_REF,
  annotationChromeForMediaWidth
} from "../../components/workbench/region-annotation-shape";

test.describe("annotationChromeForMediaWidth", () => {
  test("matches Figma annotation chrome at the ref media width", () => {
    expect(annotationChromeForMediaWidth(REGION_ANNOTATION_REF_MEDIA_W)).toEqual({
      stroke: REGION_ANNOTATION_STROKE_AT_REF,
      radius: REGION_ANNOTATION_RADIUS_AT_REF
    });
  });

  test("at default seed-ref size (~370), chrome is thinner than Figma abs 1/8", () => {
    const defaultMediaW = 370;
    const chrome = annotationChromeForMediaWidth(defaultMediaW);
    expect(chrome.stroke).toBeCloseTo((1 * defaultMediaW) / 695);
    expect(chrome.radius).toBeCloseTo((8 * defaultMediaW) / 695);
    expect(chrome.stroke).toBeLessThan(1);
    expect(chrome.radius).toBeLessThan(8);
  });

  test("scales stroke and radius with media width (Seed Reference resize)", () => {
    const doubled = annotationChromeForMediaWidth(REGION_ANNOTATION_REF_MEDIA_W * 2);
    expect(doubled.stroke).toBe(REGION_ANNOTATION_STROKE_AT_REF * 2);
    expect(doubled.radius).toBe(REGION_ANNOTATION_RADIUS_AT_REF * 2);

    const half = annotationChromeForMediaWidth(REGION_ANNOTATION_REF_MEDIA_W / 2);
    expect(half.stroke).toBe(REGION_ANNOTATION_STROKE_AT_REF / 2);
    expect(half.radius).toBe(REGION_ANNOTATION_RADIUS_AT_REF / 2);
  });

  test("tiny media width yields sub-pixel chrome (no stuck large radius)", () => {
    const tiny = annotationChromeForMediaWidth(REGION_ANNOTATION_REF_MEDIA_W / 10);
    expect(tiny.stroke).toBeCloseTo(REGION_ANNOTATION_STROKE_AT_REF / 10);
    expect(tiny.radius).toBeCloseTo(REGION_ANNOTATION_RADIUS_AT_REF / 10);
    expect(tiny.radius).toBeLessThan(1);
  });
});
