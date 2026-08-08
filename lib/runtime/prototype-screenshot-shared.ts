// Browser-safe screenshot viewport helpers shared by Runtime capture and the
// Workbench projection. The viewport width is encoded in the managed artifact
// name so the client can tell whether a cached bitmap matches the shared
// presentation viewport without adding screenshot geometry to the research
// schema. Live iframes use this same width: a single stable bitmap can only
// preserve responsive layout when both modes render at the same viewport.

export const PROTOTYPE_PRESENTATION_VIEWPORT_WIDTH = 1133;
export const PROTOTYPE_SCREENSHOT_DEFAULT_VIEWPORT_WIDTH =
  PROTOTYPE_PRESENTATION_VIEWPORT_WIDTH;
export const PROTOTYPE_SCREENSHOT_VIEWPORT_HEIGHT = 900;
export const PROTOTYPE_SCREENSHOT_MIN_VIEWPORT_WIDTH = 320;
export const PROTOTYPE_SCREENSHOT_MAX_VIEWPORT_WIDTH = 4096;

export function normalizePrototypeScreenshotViewportWidth(
  width: number | undefined
): number {
  if (typeof width !== "number" || !Number.isFinite(width)) {
    return PROTOTYPE_SCREENSHOT_DEFAULT_VIEWPORT_WIDTH;
  }
  return Math.min(
    PROTOTYPE_SCREENSHOT_MAX_VIEWPORT_WIDTH,
    Math.max(PROTOTYPE_SCREENSHOT_MIN_VIEWPORT_WIDTH, Math.round(width))
  );
}

export function prototypeScreenshotFileName(
  surfaceId: string,
  viewportWidth: number
): string {
  return `${encodeURIComponent(surfaceId)}-${normalizePrototypeScreenshotViewportWidth(
    viewportWidth
  )}.png`;
}

export function prototypeScreenshotViewportWidthFromPath(
  artifactPath: string | null | undefined
): number | null {
  const match = artifactPath?.trim().match(/-(\d+)\.png$/i);
  if (!match) return null;
  const width = Number(match[1]);
  if (
    !Number.isInteger(width) ||
    width < PROTOTYPE_SCREENSHOT_MIN_VIEWPORT_WIDTH ||
    width > PROTOTYPE_SCREENSHOT_MAX_VIEWPORT_WIDTH
  ) {
    return null;
  }
  return width;
}
