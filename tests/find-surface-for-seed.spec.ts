import { test, expect } from "@playwright/test";
import {
  compareSurfacesForSeedProjection,
  findSurfaceForSeed,
  matchesSeed,
  surfaceHasScreenshot
} from "../components/workbench/find-surface-for-seed";
import type { FigmaEvidenceSurfaceRecord } from "../lib/runtime/evidence-package";
import type { SeedReferenceRecord } from "../lib/runtime/seed-reference";

const SEED: SeedReferenceRecord = {
  id: "seed-1",
  figma_seed_reference: "https://www.figma.com/design/abc/File",
  original_design_intent: "intent",
  created_at: "2026-01-01T00:00:00.000Z",
  registered_via: "agent"
};

const SEED_B: SeedReferenceRecord = {
  id: "seed-2",
  figma_seed_reference: SEED.figma_seed_reference,
  original_design_intent: "other intent",
  created_at: "2026-01-01T01:00:00.000Z",
  registered_via: "ui"
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

  test("prefers screenshot-bearing surface over older missing one", () => {
    const missing = surface({
      id: "old-missing",
      created_at: "2026-01-01T00:00:00.000Z"
    });
    const withShot = surface({
      id: "new-shot",
      created_at: "2026-01-02T00:00:00.000Z",
      screenshot_data_url: "data:image/png;base64,aa"
    });
    // ASC list order: missing first (the bug case).
    const claimed = new Set<string>();
    const { surface: picked, claimIds } = findSurfaceForSeed(
      SEED,
      [missing, withShot],
      claimed
    );
    expect(picked?.id).toBe("new-shot");
    expect(claimIds.sort()).toEqual(["new-shot", "old-missing"].sort());
  });

  test("when both lack screenshots, prefers newer created_at", () => {
    const older = surface({
      id: "older",
      created_at: "2026-01-01T00:00:00.000Z"
    });
    const newer = surface({
      id: "newer",
      created_at: "2026-01-03T00:00:00.000Z"
    });
    const { surface: picked } = findSurfaceForSeed(
      SEED,
      [older, newer],
      new Set()
    );
    expect(picked?.id).toBe("newer");
  });

  test("compareSurfacesForSeedProjection: screenshot beats recency", () => {
    const oldShot = surface({
      id: "old-shot",
      created_at: "2026-01-01T00:00:00.000Z",
      screenshot_artifact_path: "a.png"
    });
    const newMissing = surface({
      id: "new-missing",
      created_at: "2026-01-09T00:00:00.000Z"
    });
    expect(
      compareSurfacesForSeedProjection(oldShot, newMissing, SEED)
    ).toBeLessThan(0);
  });

  test("same screenshot/time bucket: explicit seed_reference_id beats URL-only", () => {
    const urlOnly = surface({
      id: "url-only",
      seed_reference_id: null,
      created_at: "2026-01-02T00:00:00.000Z",
      screenshot_data_url: "data:image/png;base64,aa"
    });
    const linked = surface({
      id: "linked",
      seed_reference_id: SEED.id,
      created_at: "2026-01-02T00:00:00.000Z",
      screenshot_data_url: "data:image/png;base64,bb"
    });
    // id would prefer "url-only" if linked tie-break were after id — must pick linked.
    expect(compareSurfacesForSeedProjection(urlOnly, linked, SEED)).toBeGreaterThan(
      0
    );
    const { surface: picked } = findSurfaceForSeed(
      SEED,
      [urlOnly, linked],
      new Set()
    );
    expect(picked?.id).toBe("linked");
  });

  test("URL fallback does not match / claim a surface linked to another seed", () => {
    const forSeedB = surface({
      id: "for-b",
      seed_reference_id: SEED_B.id,
      screenshot_data_url: "data:image/png;base64,bb"
    });
    expect(matchesSeed(forSeedB, SEED)).toBe(false);

    const claimed = new Set<string>();
    const forA = findSurfaceForSeed(SEED, [forSeedB], claimed);
    expect(forA.surface).toBeNull();
    expect(forA.claimIds).toEqual([]);

    const forB = findSurfaceForSeed(SEED_B, [forSeedB], claimed);
    expect(forB.surface?.id).toBe("for-b");
    expect(forB.claimIds).toEqual(["for-b"]);
  });

  test("two seeds sharing a Figma URL: each keeps its own explicit surface", () => {
    const surfaceA = surface({
      id: "surf-a",
      seed_reference_id: SEED.id,
      screenshot_data_url: "data:image/png;base64,aa"
    });
    const surfaceB = surface({
      id: "surf-b",
      seed_reference_id: SEED_B.id,
      created_at: "2026-01-02T00:00:00.000Z",
      screenshot_data_url: "data:image/png;base64,bb"
    });
    const claimed = new Set<string>();
    // Process seed A first (would previously steal B's surface via URL match).
    const a = findSurfaceForSeed(SEED, [surfaceA, surfaceB], claimed);
    for (const id of a.claimIds) claimed.add(id);
    const b = findSurfaceForSeed(SEED_B, [surfaceA, surfaceB], claimed);
    expect(a.surface?.id).toBe("surf-a");
    expect(a.claimIds).toEqual(["surf-a"]);
    expect(b.surface?.id).toBe("surf-b");
    expect(b.claimIds).toEqual(["surf-b"]);
  });

  test("URL fallback still matches unlinked surfaces with the same Figma URL", () => {
    const unlinked = surface({
      id: "unlinked",
      seed_reference_id: null,
      screenshot_data_url: "data:image/png;base64,aa"
    });
    expect(matchesSeed(unlinked, SEED)).toBe(true);
    const { surface: picked } = findSurfaceForSeed(SEED, [unlinked], new Set());
    expect(picked?.id).toBe("unlinked");
  });

  test("skips already-claimed surfaces", () => {
    const a = surface({
      id: "a",
      screenshot_data_url: "data:image/png;base64,aa"
    });
    const b = surface({
      id: "b",
      created_at: "2026-01-02T00:00:00.000Z",
      screenshot_data_url: "data:image/png;base64,bb"
    });
    const claimed = new Set(["b"]);
    const { surface: picked, claimIds } = findSurfaceForSeed(SEED, [a, b], claimed);
    expect(picked?.id).toBe("a");
    expect(claimIds).toEqual(["a"]);
  });
});
