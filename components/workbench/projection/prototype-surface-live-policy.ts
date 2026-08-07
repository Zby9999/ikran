// Single-live policy (Issue 30): at most one surface mounts a live iframe.
//
// Pure and React-free so the decision is unit-testable; the shape component
// only renders the outcome.
//
// - A selected ready surface is always the live one (focus wins).
// - With exactly one ready surface and nothing selected, it defaults to live
//   so a one-surface canvas shows the site without a ceremonial click —
//   unless the designer explicitly exited it (`autoLiveExitedShapeIds`),
//   which sticks until they select it again.
// - Two or more ready surfaces with no selection: none is live; live must be
//   an explicit choice.

export function planPrototypeSurfaceLiveShapeId(input: {
  surfaces: ReadonlyArray<{
    shapeId: string;
    readiness: string;
    stale: boolean;
    previewUrl: string;
  }>;
  selectedShapeIds: readonly string[];
  autoLiveExitedShapeIds: ReadonlySet<string>;
}): string | null {
  const readyIds = input.surfaces
    .filter(
      (surface) =>
        surface.readiness === "ready" &&
        !surface.stale &&
        surface.previewUrl.trim().length > 0
    )
    .map((surface) => surface.shapeId);
  for (const selectedId of input.selectedShapeIds) {
    if (readyIds.includes(selectedId)) return selectedId;
  }
  if (readyIds.length === 1 && !input.autoLiveExitedShapeIds.has(readyIds[0])) {
    return readyIds[0];
  }
  return null;
}
