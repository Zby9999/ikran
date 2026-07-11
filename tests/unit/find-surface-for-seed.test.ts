import { test, expect } from "vitest";
import {
  findSurfaceForSeed,
  surfaceHasScreenshot
} from "../../components/workbench/find-surface-for-seed";
import type { FigmaEvidenceSurfaceRecord } from "../../lib/runtime/evidence-package";
import type { SeedReferenceRecord } from "../../lib/runtime/seed-reference";

const SEED: SeedReferenceRecord = {
  id: "seed-1",
  figma_seed_reference: "https://www.figma.com/design/abc/File",
  original_design_intent: "intent",
  created_at: "2026-01-01T00:00:00.000Z",
  registered_via: "agent",
  file_key: "abc",
  node_id: "",
  current_surface_id: "surf-current"
};

const SEED_B: SeedReferenceRecord = {
  id: "seed-2",
  figma_seed_reference: SEED.figma_seed_reference,
  original_design_intent: "other intent",
  created_at: "2026-01-01T01:00:00.000Z",
  registered_via: "ui",
  file_key: "abc",
  node_id: "",
  current_surface_id: "surf-b"
};

function surface(
  partial: Partial<FigmaEvidenceSurfaceRecord> & Pick<FigmaEvidenceSurfaceRecord, "id">
): FigmaEvidenceSurfaceRecord {
  return {
    seed_reference_id: SEED.id,
    figma_seed_reference: SEED.figma_seed_reference,
    frame_node_id: "1:1",
    frame_name: "Frame",
    frame_bounds_json: null,
    evidence_views_json: "{}",
    screenshot_artifact_path: null,
    screenshot_data_url: null,
    design_signals_json: null,
    surface_bounds_json: null,
    created_at: "2026-01-01T00:00:00.000Z",
    superseded_by: null,
    ...partial
  };
}

test.describe("findSurfaceForSeed", () => {
  test("surfaceHasScreenshot: dataUrl or artifactPath", () => {
    expect(surfaceHasScreenshot(surface({ id: "a" }))).toBe(false);
    expect(
      surfaceHasScreenshot(
        surface({ id: "b", screenshot_data_url: "data:image/png;base64,aa" })
      )
    ).toBe(true);
    expect(
      surfaceHasScreenshot(
        surface({ id: "c", screenshot_artifact_path: "artifacts/a.png" })
      )
    ).toBe(true);
  });

  test("selects only seed.current_surface_id — ignores older screenshot heuristics", () => {
    const olderShot = surface({
      id: "surf-old",
      created_at: "2026-01-01T00:00:00.000Z",
      screenshot_data_url: "data:image/png;base64,old",
      superseded_by: "surf-current"
    });
    const currentMissing = surface({
      id: "surf-current",
      created_at: "2026-01-02T00:00:00.000Z",
      superseded_by: null
    });
    const { surface: picked, claimIds } = findSurfaceForSeed(SEED, [
      olderShot,
      currentMissing
    ]);
    expect(picked?.id).toBe("surf-current");
    expect(claimIds.sort()).toEqual(["surf-current", "surf-old"].sort());
  });

  test("null current_surface_id → no surface; still claims seed-linked history", () => {
    const seedNoCurrent: SeedReferenceRecord = {
      ...SEED,
      current_surface_id: null
    };
    const history = surface({ id: "orphan-hist", seed_reference_id: SEED.id });
    const { surface: picked, claimIds } = findSurfaceForSeed(seedNoCurrent, [
      history
    ]);
    expect(picked).toBeNull();
    expect(claimIds).toEqual(["orphan-hist"]);
  });

  test("does not use URL fallback for unlinked or other-seed surfaces", () => {
    const other = surface({
      id: "surf-b",
      seed_reference_id: SEED_B.id,
      screenshot_data_url: "data:image/png;base64,bb"
    });
    const seedNoCurrent: SeedReferenceRecord = {
      ...SEED,
      current_surface_id: null
    };
    const { surface: picked, claimIds } = findSurfaceForSeed(seedNoCurrent, [
      other
    ]);
    expect(picked).toBeNull();
    expect(claimIds).toEqual([]);
  });

  test("two seeds: each resolves only its own current_surface_id", () => {
    const surfaceA = surface({
      id: "surf-current",
      seed_reference_id: SEED.id,
      screenshot_data_url: "data:image/png;base64,aa"
    });
    const surfaceB = surface({
      id: "surf-b",
      seed_reference_id: SEED_B.id,
      created_at: "2026-01-02T00:00:00.000Z",
      screenshot_data_url: "data:image/png;base64,bb"
    });
    const a = findSurfaceForSeed(SEED, [surfaceA, surfaceB]);
    const b = findSurfaceForSeed(SEED_B, [surfaceA, surfaceB]);
    expect(a.surface?.id).toBe("surf-current");
    expect(a.claimIds).toEqual(["surf-current"]);
    expect(b.surface?.id).toBe("surf-b");
    expect(b.claimIds).toEqual(["surf-b"]);
  });

  test("current id missing from surfaces list → null surface, still claims linked rows", () => {
    const linked = surface({
      id: "surf-old",
      superseded_by: "surf-current"
    });
    const { surface: picked, claimIds } = findSurfaceForSeed(SEED, [linked]);
    expect(picked).toBeNull();
    expect(claimIds).toEqual(["surf-old"]);
  });
});
