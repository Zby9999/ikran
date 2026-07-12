// Unit: find/focus match rules for Seed Reference projections (Issue 05B).

import { expect, test } from "vitest";
import type { SeedReferenceProjectionMeta } from "../../components/workbench/seed-reference-projection-shape";

function matchesSeedProjection(
  meta: SeedReferenceProjectionMeta,
  seedId: string
): boolean {
  return (
    meta.seedRecordId === seedId ||
    (meta.kind === "seed_reference_projection" &&
      meta.runtimeRecordId === seedId)
  );
}

test("surface projection matches via seedRecordId", () => {
  const meta: SeedReferenceProjectionMeta = {
    canvasRecordId: "c1",
    runtimeRecordId: "surface-1",
    kind: "figma_evidence_surface",
    seedRecordId: "seed-abc",
    surfaceRecordId: "surface-1"
  };
  expect(matchesSeedProjection(meta, "seed-abc")).toBe(true);
  expect(matchesSeedProjection(meta, "surface-1")).toBe(false);
});

test("seed-only projection matches via runtimeRecordId", () => {
  const meta: SeedReferenceProjectionMeta = {
    canvasRecordId: "c2",
    runtimeRecordId: "seed-xyz",
    kind: "seed_reference_projection"
  };
  expect(matchesSeedProjection(meta, "seed-xyz")).toBe(true);
  expect(matchesSeedProjection(meta, "other")).toBe(false);
});
