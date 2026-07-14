/** Shared designer-annotation chrome calibrated to the Figma reference. */
export const REGION_ANNOTATION_STROKE_AT_REF = 1;
export const REGION_ANNOTATION_RADIUS_AT_REF = 4;
export const REGION_ANNOTATION_REF_MEDIA_W = 695;

export function annotationChromeForMediaWidth(mediaW: number): {
  stroke: number;
  radius: number;
} {
  const scale = mediaW > 0 ? mediaW / REGION_ANNOTATION_REF_MEDIA_W : 1;
  return {
    stroke: Math.max(0, REGION_ANNOTATION_STROKE_AT_REF * scale),
    radius: Math.max(0, REGION_ANNOTATION_RADIUS_AT_REF * scale)
  };
}
