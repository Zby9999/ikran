// Pure seed / evidence projection targets + reconcile planning (Task 12).

import { test, expect } from "vitest";
import {
  artifactScreenshotUrl,
  buildSeedProjectionTargets,
  defaultSeedProjectionLayout,
  planSeedProjectionOps,
  seedProjectionMetaEqual,
  seedProjectionPropsEqual,
  type SeedProjectionExisting,
  type SeedProjectionTarget
} from "../../components/workbench/projection/seed-projection";
import type { FigmaEvidenceSurfaceRecord } from "../../lib/runtime/evidence-package";
import type { SeedReferenceRecord } from "../../lib/runtime/seed-reference";
import {
  SEED_REFERENCE_PROJECTION_DEFAULT_H,
  SEED_REFERENCE_PROJECTION_DEFAULT_W
} from "../../components/workbench/seed-reference-projection-shape";

const SEED: SeedReferenceRecord = {
  id: "seed-1",
  figma_seed_reference: "https://www.figma.com/design/abc/File",
  original_design_intent: "intent",
  created_at: "2026-01-01T00:00:00.000Z",
  registered_via: "agent",
  file_key: "abc",
  node_id: "",
  current_surface_id: "surf-1"
};

const UI_SEED: SeedReferenceRecord = {
  ...SEED,
  id: "seed-ui",
  registered_via: "ui",
  current_surface_id: ""
};

function surface(
  partial: Partial<FigmaEvidenceSurfaceRecord> &
    Pick<FigmaEvidenceSurfaceRecord, "id">
): FigmaEvidenceSurfaceRecord {
  return {
    seed_reference_id: SEED.id,
    figma_seed_reference: SEED.figma_seed_reference,
    frame_node_id: "1:1",
    frame_name: "Frame A",
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

test.describe("artifactScreenshotUrl", () => {
  test("encodes path segments and session query", () => {
    expect(artifactScreenshotUrl("artifacts/a b/shot.png", "tok")).toBe(
      "/api/artifacts/artifacts/a%20b/shot.png?session=tok"
    );
  });
});

test.describe("buildSeedProjectionTargets", () => {
  test("seed without surface → awaiting spinner + seed meta", () => {
    const targets = buildSeedProjectionTargets([SEED], [], "sess");
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      shapeKey: "seed-1",
      canvasRecordId: "seed-reference:seed-1",
      awaitingEvidence: true,
      awaitingUx: "spinner",
      screenshotDataUrl: "",
      w: SEED_REFERENCE_PROJECTION_DEFAULT_W,
      h: SEED_REFERENCE_PROJECTION_DEFAULT_H,
      meta: {
        kind: "seed_reference_projection",
        runtimeRecordId: "seed-1",
        canvasRecordId: "seed-reference:seed-1"
      }
    });
  });

  test("ui seed awaiting uses guide UX", () => {
    const [t] = buildSeedProjectionTargets([UI_SEED], [], "sess");
    expect(t.awaitingUx).toBe("guide");
  });

  test("seed + surface with data URL upgrades meta and clears awaiting", () => {
    const surf = surface({
      id: "surf-1",
      screenshot_data_url: "data:image/png;base64,aa"
    });
    const [t] = buildSeedProjectionTargets([SEED], [surf], "sess");
    expect(t.shapeKey).toBe("seed-1");
    expect(t.awaitingEvidence).toBe(false);
    expect(t.screenshotDataUrl).toBe("data:image/png;base64,aa");
    expect(t.hasScreenshotArtifact).toBe(false);
    expect(t.frameName).toBe("Frame A");
    expect(t.meta).toEqual({
      canvasRecordId: "seed-reference:seed-1",
      runtimeRecordId: "surf-1",
      kind: "figma_evidence_surface",
      seedRecordId: "seed-1",
      surfaceRecordId: "surf-1"
    });
  });

  test("artifact path builds authenticated screenshot URL", () => {
    const surf = surface({
      id: "surf-1",
      screenshot_artifact_path: "artifacts/shot.png"
    });
    const [t] = buildSeedProjectionTargets([SEED], [surf], "sess-1");
    expect(t.screenshotDataUrl).toBe(
      artifactScreenshotUrl("artifacts/shot.png", "sess-1")
    );
    expect(t.hasScreenshotArtifact).toBe(true);
    expect(t.awaitingEvidence).toBe(false);
  });

  test("orphan surface projects alone under surface: key", () => {
    const orphan = surface({
      id: "orphan",
      seed_reference_id: "no-matching-seed",
      screenshot_data_url: "data:image/png;base64,bb"
    });
    const targets = buildSeedProjectionTargets([], [orphan], "sess");
    expect(targets).toHaveLength(1);
    expect(targets[0].shapeKey).toBe("surface:orphan");
    expect(targets[0].canvasRecordId).toBe(
      "figma-evidence-surface:orphan"
    );
    expect(targets[0].meta.kind).toBe("figma_evidence_surface");
    expect(targets[0].awaitingUx).toBe("spinner");
  });
});

test.describe("seed projection equality + layout", () => {
  test("default layout is 4-column grid", () => {
    expect(defaultSeedProjectionLayout(0)).toEqual({ x: 120, y: 140 });
    expect(defaultSeedProjectionLayout(1)).toEqual({ x: 540, y: 140 });
    expect(defaultSeedProjectionLayout(4)).toEqual({ x: 120, y: 700 });
  });

  test("propsEqual ignores geometry; metaEqual compares ids", () => {
    const target: SeedProjectionTarget = {
      shapeKey: "seed-1",
      canvasRecordId: "seed-reference:seed-1",
      figmaSeedReference: "u",
      originalDesignIntent: "i",
      frameName: "F",
      screenshotDataUrl: "data:x",
      hasScreenshotArtifact: false,
      awaitingEvidence: false,
      awaitingUx: "spinner",
      meta: {
        canvasRecordId: "seed-reference:seed-1",
        runtimeRecordId: "surf-1",
        kind: "figma_evidence_surface",
        seedRecordId: "seed-1",
        surfaceRecordId: "surf-1"
      },
      w: 380,
      h: 520
    };
    expect(
      seedProjectionPropsEqual(
        {
          w: 999,
          h: 999,
          figmaSeedReference: "u",
          originalDesignIntent: "i",
          frameName: "F",
          screenshotDataUrl: "data:x",
          hasScreenshotArtifact: false,
          awaitingEvidence: false,
          awaitingUx: "spinner",
          naturalMediaW: 10,
          naturalMediaH: 10
        },
        target
      )
    ).toBe(true);
    expect(
      seedProjectionMetaEqual(target.meta, {
        ...target.meta,
        seedRecordId: undefined
      })
    ).toBe(false);
  });
});

test.describe("planSeedProjectionOps", () => {
  test("creates missing, updates changed props/meta, deletes extras", () => {
    const targets = buildSeedProjectionTargets(
      [SEED],
      [
        surface({
          id: "surf-1",
          screenshot_data_url: "data:image/png;base64,aa"
        })
      ],
      "sess"
    );
    const existing: SeedProjectionExisting[] = [
      {
        id: "shape:seed-1",
        props: {
          w: 380,
          h: 520,
          figmaSeedReference: SEED.figma_seed_reference,
          originalDesignIntent: SEED.original_design_intent,
          frameName: "",
          screenshotDataUrl: "",
          hasScreenshotArtifact: false,
          awaitingEvidence: true,
          awaitingUx: "spinner",
          naturalMediaW: 0,
          naturalMediaH: 0
        },
        meta: {
          canvasRecordId: "seed-reference:seed-1",
          runtimeRecordId: "seed-1",
          kind: "seed_reference_projection"
        }
      },
      {
        id: "shape:stale",
        props: {
          w: 380,
          h: 520,
          figmaSeedReference: "x",
          originalDesignIntent: "",
          frameName: "",
          screenshotDataUrl: "",
          hasScreenshotArtifact: false,
          awaitingEvidence: true,
          awaitingUx: "spinner",
          naturalMediaW: 0,
          naturalMediaH: 0
        },
        meta: {
          canvasRecordId: "seed-reference:stale",
          runtimeRecordId: "stale",
          kind: "seed_reference_projection"
        }
      }
    ];

    const ops = planSeedProjectionOps(targets, existing, (key) => `shape:${key}`);
    expect(ops.some((o) => o.type === "update" && o.id === "shape:seed-1")).toBe(
      true
    );
    expect(ops.some((o) => o.type === "delete" && o.id === "shape:stale")).toBe(
      true
    );
    expect(ops.some((o) => o.type === "create")).toBe(false);
  });

  test("create uses default layout and clears natural media", () => {
    const targets = buildSeedProjectionTargets([SEED], [], "sess");
    const ops = planSeedProjectionOps(targets, [], (key) => `shape:${key}`);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      type: "create",
      id: "shape:seed-1",
      x: 120,
      y: 140,
      props: {
        naturalMediaW: 0,
        naturalMediaH: 0,
        awaitingEvidence: true
      }
    });
  });

  test("screenshot change clears naturalMedia on update", () => {
    const targets = buildSeedProjectionTargets(
      [SEED],
      [
        surface({
          id: "surf-1",
          screenshot_data_url: "data:image/png;base64,NEW"
        })
      ],
      "sess"
    );
    const existing: SeedProjectionExisting[] = [
      {
        id: "shape:seed-1",
        props: {
          w: 380,
          h: 520,
          figmaSeedReference: SEED.figma_seed_reference,
          originalDesignIntent: SEED.original_design_intent,
          frameName: "Frame A",
          screenshotDataUrl: "data:image/png;base64,OLD",
          hasScreenshotArtifact: false,
          awaitingEvidence: false,
          awaitingUx: "spinner",
          naturalMediaW: 100,
          naturalMediaH: 200
        },
        meta: {
          canvasRecordId: "seed-reference:seed-1",
          runtimeRecordId: "surf-1",
          kind: "figma_evidence_surface",
          seedRecordId: "seed-1",
          surfaceRecordId: "surf-1"
        }
      }
    ];
    const ops = planSeedProjectionOps(targets, existing, (key) => `shape:${key}`);
    const update = ops.find((o) => o.type === "update");
    expect(update?.type).toBe("update");
    if (update?.type === "update") {
      expect(update.props).toMatchObject({
        screenshotDataUrl: "data:image/png;base64,NEW",
        naturalMediaW: 0,
        naturalMediaH: 0
      });
    }
  });
});
