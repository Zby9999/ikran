// Pure seed / evidence projection targets + reconcile planning (Task 12).

import { test, expect } from "vitest";
import {
  artifactScreenshotUrl,
  buildSeedProjectionTargets,
  defaultSeedProjectionLayout,
  findNonOverlappingSeedProjectionLayout,
  planSeedProjectionOps,
  planSeedProjectionReflowMoves,
  seedProjectionBoundsOverlap,
  seedProjectionLayoutFootprint,
  seedProjectionMetaEqual,
  seedProjectionOccupiedBounds,
  seedProjectionPropsEqual,
  SEED_PROJECTION_LAYOUT_GAP,
  SEED_PROJECTION_LAYOUT_ORIGIN_X,
  SEED_PROJECTION_LAYOUT_ORIGIN_Y,
  SEED_PROJECTION_LAYOUT_RESERVE_H,
  SEED_PROJECTION_LAYOUT_RESERVE_W,
  type SeedProjectionExisting,
  type SeedProjectionReflowShape,
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
  test("historical seed without surface → unavailable guide + seed meta", () => {
    const targets = buildSeedProjectionTargets([SEED], [], "sess");
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      shapeKey: "seed-1",
      canvasRecordId: "seed-reference:seed-1",
      awaitingEvidence: true,
      awaitingUx: "guide",
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

  test("historical initiator does not change unavailable UX", () => {
    const [t] = buildSeedProjectionTargets([UI_SEED], [], "sess");
    expect(t.awaitingUx).toBe("guide");
  });

  test("seed + surface with data URL upgrades meta and clears awaiting", () => {
    const surf = surface({
      id: "surf-1",
      screenshot_data_url: "data:image/png;base64,aa",
      frame_bounds_json: '{"x":0,"y":0,"width":320,"height":240}',
      positional_nodes_json: '[{"id":"1:2","type":"FRAME"}]'
    });
    const [t] = buildSeedProjectionTargets([SEED], [surf], "sess");
    expect(t.shapeKey).toBe("seed-1");
    expect(t.awaitingEvidence).toBe(false);
    expect(t.screenshotDataUrl).toBe("data:image/png;base64,aa");
    expect(t.hasScreenshotArtifact).toBe(false);
    expect(t.frameName).toBe("Frame A");
    expect(t.frameBoundsJson).toContain('"width":320');
    expect(t.positionalNodesJson).toContain('"type":"FRAME"');
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
    expect(targets[0].awaitingUx).toBe("guide");
  });
});

test.describe("seed projection equality + layout", () => {
  test("default layout is 4-column grid", () => {
    expect(defaultSeedProjectionLayout(0)).toEqual({
      x: SEED_PROJECTION_LAYOUT_ORIGIN_X,
      y: SEED_PROJECTION_LAYOUT_ORIGIN_Y
    });
    expect(defaultSeedProjectionLayout(1)).toEqual({ x: 540, y: 140 });
    expect(defaultSeedProjectionLayout(4)).toEqual({ x: 120, y: 700 });
  });

  test("layout footprint reserves space until natural size is known", () => {
    expect(seedProjectionLayoutFootprint(380, 520)).toEqual({
      w: SEED_PROJECTION_LAYOUT_RESERVE_W,
      h: SEED_PROJECTION_LAYOUT_RESERVE_H
    });
    expect(
      seedProjectionLayoutFootprint(900, 1400, { hasNaturalSize: true })
    ).toEqual({ w: 900, h: 1400 });
  });

  test("bounds overlap respects gap", () => {
    const a = { x: 0, y: 0, w: 100, h: 100 };
    const b = {
      x: 100 + SEED_PROJECTION_LAYOUT_GAP,
      y: 0,
      w: 100,
      h: 100
    };
    expect(seedProjectionBoundsOverlap(a, b, SEED_PROJECTION_LAYOUT_GAP)).toBe(
      false
    );
    expect(
      seedProjectionBoundsOverlap(
        a,
        { ...b, x: 100 + SEED_PROJECTION_LAYOUT_GAP - 1 },
        SEED_PROJECTION_LAYOUT_GAP
      )
    ).toBe(true);
  });

  test("findNonOverlapping places at origin when empty", () => {
    expect(findNonOverlappingSeedProjectionLayout([], 720, 960)).toEqual({
      x: SEED_PROJECTION_LAYOUT_ORIGIN_X,
      y: SEED_PROJECTION_LAYOUT_ORIGIN_Y
    });
  });

  test("findNonOverlapping clears existing bounds by gap", () => {
    const occupied = [
      {
        x: SEED_PROJECTION_LAYOUT_ORIGIN_X,
        y: SEED_PROJECTION_LAYOUT_ORIGIN_Y,
        w: 800,
        h: 1200
      }
    ];
    const next = findNonOverlappingSeedProjectionLayout(occupied, 720, 960);
    expect(next.x).toBe(
      SEED_PROJECTION_LAYOUT_ORIGIN_X + 800 + SEED_PROJECTION_LAYOUT_GAP
    );
    expect(next.y).toBe(SEED_PROJECTION_LAYOUT_ORIGIN_Y);
    expect(
      seedProjectionBoundsOverlap(
        { ...occupied[0] },
        { x: next.x, y: next.y, w: 720, h: 960 },
        SEED_PROJECTION_LAYOUT_GAP
      )
    ).toBe(false);
  });

  test("occupied bounds use reserve when natural size unknown", () => {
    expect(
      seedProjectionOccupiedBounds({
        x: 10,
        y: 20,
        props: {
          w: 380,
          h: 520,
          naturalMediaW: 0,
          naturalMediaH: 0
        }
      })
    ).toEqual({
      x: 10,
      y: 20,
      w: SEED_PROJECTION_LAYOUT_RESERVE_W,
      h: SEED_PROJECTION_LAYOUT_RESERVE_H
    });
  });

  test("propsEqual ignores geometry; metaEqual compares ids", () => {
    const target: SeedProjectionTarget = {
      shapeKey: "seed-1",
      canvasRecordId: "seed-reference:seed-1",
      figmaSeedReference: "u",
      originalDesignIntent: "i",
      designLanguageDescription: "",
      frameName: "F",
      frameBoundsJson: "",
      positionalNodesJson: "",
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
          designLanguageDescription: "",
          frameName: "F",
          frameBoundsJson: "",
          positionalNodesJson: "",
          screenshotDataUrl: "data:x",
          hasScreenshotArtifact: false,
          awaitingEvidence: false,
          awaitingUx: "spinner",
          naturalMediaW: 10,
          naturalMediaH: 10,
          layoutLocked: false
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
        x: 200,
        y: 300,
        props: {
          w: 380,
          h: 520,
          figmaSeedReference: SEED.figma_seed_reference,
          originalDesignIntent: SEED.original_design_intent,
          designLanguageDescription: "",
          frameName: "",
          frameBoundsJson: "",
          positionalNodesJson: "",
          screenshotDataUrl: "",
          hasScreenshotArtifact: false,
          awaitingEvidence: true,
          awaitingUx: "spinner",
          naturalMediaW: 0,
          naturalMediaH: 0,
          layoutLocked: false
        },
        meta: {
          canvasRecordId: "seed-reference:seed-1",
          runtimeRecordId: "seed-1",
          kind: "seed_reference_projection"
        }
      },
      {
        id: "shape:stale",
        x: 900,
        y: 140,
        props: {
          w: 380,
          h: 520,
          figmaSeedReference: "x",
          originalDesignIntent: "",
          designLanguageDescription: "",
          frameName: "",
          frameBoundsJson: "",
          positionalNodesJson: "",
          screenshotDataUrl: "",
          hasScreenshotArtifact: false,
          awaitingEvidence: true,
          awaitingUx: "spinner",
          naturalMediaW: 0,
          naturalMediaH: 0,
          layoutLocked: false
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

  test("create uses non-overlapping layout and clears natural media", () => {
    const targets = buildSeedProjectionTargets([SEED], [], "sess");
    const ops = planSeedProjectionOps(targets, [], (key) => `shape:${key}`);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      type: "create",
      id: "shape:seed-1",
      x: SEED_PROJECTION_LAYOUT_ORIGIN_X,
      y: SEED_PROJECTION_LAYOUT_ORIGIN_Y,
      props: {
        naturalMediaW: 0,
        naturalMediaH: 0,
        awaitingEvidence: true
      }
    });
  });

  test("batch creates leave gap using reserved footprint", () => {
    const seed2: SeedReferenceRecord = {
      ...SEED,
      id: "seed-2",
      current_surface_id: ""
    };
    const seed3: SeedReferenceRecord = {
      ...SEED,
      id: "seed-3",
      current_surface_id: ""
    };
    const targets = buildSeedProjectionTargets([SEED, seed2, seed3], [], "sess");
    const ops = planSeedProjectionOps(targets, [], (key) => `shape:${key}`);
    const creates = ops.filter((o) => o.type === "create");
    expect(creates).toHaveLength(3);
    const xs = creates.map((o) => (o.type === "create" ? o.x : -1));
    const ys = creates.map((o) => (o.type === "create" ? o.y : -1));
    expect(xs[0]).toBe(SEED_PROJECTION_LAYOUT_ORIGIN_X);
    expect(xs[1]).toBe(
      SEED_PROJECTION_LAYOUT_ORIGIN_X +
        SEED_PROJECTION_LAYOUT_RESERVE_W +
        SEED_PROJECTION_LAYOUT_GAP
    );
    expect(xs[2]).toBe(
      xs[1] + SEED_PROJECTION_LAYOUT_RESERVE_W + SEED_PROJECTION_LAYOUT_GAP
    );
    expect(ys.every((y) => y === SEED_PROJECTION_LAYOUT_ORIGIN_Y)).toBe(true);
  });

  test("new create clears actual existing bounds without moving them", () => {
    const seed2: SeedReferenceRecord = {
      ...SEED,
      id: "seed-2",
      current_surface_id: ""
    };
    const targets = buildSeedProjectionTargets([SEED, seed2], [], "sess");
    const existing: SeedProjectionExisting[] = [
      {
        id: "shape:seed-1",
        x: 500,
        y: 200,
        props: {
          w: 640,
          h: 1100,
          figmaSeedReference: SEED.figma_seed_reference,
          originalDesignIntent: SEED.original_design_intent,
          designLanguageDescription: "",
          frameName: "",
          frameBoundsJson: "",
          positionalNodesJson: "",
          screenshotDataUrl: "",
          hasScreenshotArtifact: false,
          awaitingEvidence: true,
          awaitingUx: "spinner",
          naturalMediaW: 630,
          naturalMediaH: 1066,
          layoutLocked: false
        },
        meta: {
          canvasRecordId: "seed-reference:seed-1",
          runtimeRecordId: "seed-1",
          kind: "seed_reference_projection"
        }
      }
    ];
    const ops = planSeedProjectionOps(targets, existing, (key) => `shape:${key}`);
    expect(ops.some((o) => o.type === "update" && "x" in o)).toBe(false);
    const create = ops.find((o) => o.type === "create");
    expect(create?.type).toBe("create");
    if (create?.type === "create") {
      expect(create.id).toBe("shape:seed-2");
      // Existing already has natural size → pack against actual 640×1100.
      expect(
        seedProjectionBoundsOverlap(
          { x: 500, y: 200, w: 640, h: 1100 },
          {
            x: create.x,
            y: create.y,
            w: SEED_PROJECTION_LAYOUT_RESERVE_W,
            h: SEED_PROJECTION_LAYOUT_RESERVE_H
          },
          SEED_PROJECTION_LAYOUT_GAP
        )
      ).toBe(false);
    }
  });

  test("create prefers savedFrames geometry over packing", () => {
    const targets = buildSeedProjectionTargets([SEED], [], "sess");
    const ops = planSeedProjectionOps(
      targets,
      [],
      (key) => `shape:${key}`,
      {
        savedFrames: {
          "seed-1": {
            x: 777,
            y: 888,
            w: 320,
            h: 480,
            layoutLocked: true
          }
        }
      }
    );
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      type: "create",
      id: "shape:seed-1",
      x: 777,
      y: 888,
      props: {
        w: 320,
        h: 480,
        layoutLocked: true
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
        x: 120,
        y: 140,
        props: {
          w: 380,
          h: 520,
          figmaSeedReference: SEED.figma_seed_reference,
          originalDesignIntent: SEED.original_design_intent,
          designLanguageDescription: "",
          frameName: "Frame A",
          frameBoundsJson: "",
          positionalNodesJson: "",
          screenshotDataUrl: "data:image/png;base64,OLD",
          hasScreenshotArtifact: false,
          awaitingEvidence: false,
          awaitingUx: "spinner",
          naturalMediaW: 100,
          naturalMediaH: 200,
          layoutLocked: false
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

test.describe("planSeedProjectionReflowMoves", () => {
  function frame(partial: {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    naturalW: number;
    naturalH: number;
    layoutLocked?: boolean;
  }): SeedProjectionReflowShape {
    return {
      id: partial.id,
      x: partial.x,
      y: partial.y,
      layoutLocked: partial.layoutLocked ?? false,
      props: {
        w: partial.w,
        h: partial.h,
        naturalMediaW: partial.naturalW,
        naturalMediaH: partial.naturalH
      }
    };
  }

  test("refresh-style stack: large natural sizes at reserved spacing get unpacked", () => {
    // Mimic batch create (720-stride) then screenshot onLoad to ~2000×2800.
    const gap = SEED_PROJECTION_LAYOUT_GAP;
    const reservedStride = SEED_PROJECTION_LAYOUT_RESERVE_W + gap;
    const shapes = [
      frame({
        id: "shape:a",
        x: SEED_PROJECTION_LAYOUT_ORIGIN_X,
        y: SEED_PROJECTION_LAYOUT_ORIGIN_Y,
        w: 2010,
        h: 2834,
        naturalW: 2000,
        naturalH: 2800
      }),
      frame({
        id: "shape:b",
        x: SEED_PROJECTION_LAYOUT_ORIGIN_X + reservedStride,
        y: SEED_PROJECTION_LAYOUT_ORIGIN_Y,
        w: 2010,
        h: 2834,
        naturalW: 2000,
        naturalH: 2800
      }),
      frame({
        id: "shape:c",
        x: SEED_PROJECTION_LAYOUT_ORIGIN_X + reservedStride * 2,
        y: SEED_PROJECTION_LAYOUT_ORIGIN_Y,
        w: 2010,
        h: 2834,
        naturalW: 2000,
        naturalH: 2800
      })
    ];
    expect(
      seedProjectionBoundsOverlap(
        { x: shapes[0].x, y: shapes[0].y, w: shapes[0].props.w, h: shapes[0].props.h },
        { x: shapes[1].x, y: shapes[1].y, w: shapes[1].props.w, h: shapes[1].props.h },
        gap
      )
    ).toBe(true);

    const moves = planSeedProjectionReflowMoves(shapes);
    expect(moves.length).toBeGreaterThan(0);

    const byId = new Map(shapes.map((s) => [s.id, { ...s }]));
    for (const m of moves) {
      const s = byId.get(m.id);
      expect(s).toBeTruthy();
      if (s) {
        s.x = m.x;
        s.y = m.y;
      }
    }
    const placed = [...byId.values()];
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        expect(
          seedProjectionBoundsOverlap(
            {
              x: placed[i].x,
              y: placed[i].y,
              w: placed[i].props.w,
              h: placed[i].props.h
            },
            {
              x: placed[j].x,
              y: placed[j].y,
              w: placed[j].props.w,
              h: placed[j].props.h
            },
            gap
          )
        ).toBe(false);
      }
    }
  });

  test("no moves when frames already clear each other", () => {
    const shapes = [
      frame({
        id: "shape:a",
        x: 120,
        y: 140,
        w: 640,
        h: 1100,
        naturalW: 630,
        naturalH: 1066
      }),
      frame({
        id: "shape:b",
        x: 120 + 640 + SEED_PROJECTION_LAYOUT_GAP,
        y: 140,
        w: 640,
        h: 1100,
        naturalW: 630,
        naturalH: 1066
      })
    ];
    expect(planSeedProjectionReflowMoves(shapes)).toEqual([]);
  });

  test("layoutLocked frames stay put; unlocked pack around them", () => {
    const shapes = [
      frame({
        id: "shape:locked",
        x: 500,
        y: 200,
        w: 800,
        h: 1200,
        naturalW: 790,
        naturalH: 1166,
        layoutLocked: true
      }),
      frame({
        id: "shape:free",
        x: 520,
        y: 220,
        w: 800,
        h: 1200,
        naturalW: 790,
        naturalH: 1166,
        layoutLocked: false
      })
    ];
    const moves = planSeedProjectionReflowMoves(shapes);
    expect(moves.every((m) => m.id !== "shape:locked")).toBe(true);
    const free = moves.find((m) => m.id === "shape:free");
    expect(free).toBeTruthy();
    if (free) {
      expect(
        seedProjectionBoundsOverlap(
          { x: 500, y: 200, w: 800, h: 1200 },
          { x: free.x, y: free.y, w: 800, h: 1200 },
          SEED_PROJECTION_LAYOUT_GAP
        )
      ).toBe(false);
    }
  });
});
