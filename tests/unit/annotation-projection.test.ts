// Pure annotation surface lookup / placement / store-change filter (Task 12).

import { test, expect } from "vitest";
import {
  annotationMetaEqual,
  computeAnnotationPagePlacement,
  findSurfaceShapeForAnnotation,
  planAnnotationProjectionOps,
  shouldResyncAnnotationsForStoreChanges,
  type AnnotationProjectionExisting
} from "../../components/workbench/projection/annotation-projection";
import { SEED_REFERENCE_PROJECTION_TYPE } from "../../components/workbench/seed-reference-projection-shape";
import { REGION_ANNOTATION_TYPE } from "../../components/workbench/region-annotation-shape";
import type { RegionAnnotationRecord } from "../../lib/runtime/region-annotation";
import { AGENT_REGION_MARGIN } from "../../lib/runtime/region-annotation-display";

function annotation(
  partial: Partial<RegionAnnotationRecord> & Pick<RegionAnnotationRecord, "id">
): RegionAnnotationRecord {
  return {
    surface_id: "surf-1",
    surface_artifact_id: "surf-1",
    surface_node_id: null,
    author: "designer",
    type: "explanatory",
    body: "note",
    rect_x: 0.1,
    rect_y: 0.2,
    rect_w: 0.3,
    rect_h: 0.4,
    primary_node_id: null,
    candidates_json: null,
    from_point: false,
    geometry_version: "v2_raw",
    created_at: "2026-01-01T00:00:00.000Z",
    ...partial
  };
}

test.describe("findSurfaceShapeForAnnotation", () => {
  test("matches figma_evidence_surface by surfaceRecordId or runtimeRecordId", () => {
    const shapes = [
      {
        id: "shape:a",
        type: SEED_REFERENCE_PROJECTION_TYPE,
        meta: {
          kind: "seed_reference_projection",
          runtimeRecordId: "seed-1",
          canvasRecordId: "seed-reference:seed-1"
        }
      },
      {
        id: "shape:b",
        type: SEED_REFERENCE_PROJECTION_TYPE,
        meta: {
          kind: "figma_evidence_surface",
          runtimeRecordId: "surf-1",
          surfaceRecordId: "surf-1",
          canvasRecordId: "seed-reference:seed-1",
          seedRecordId: "seed-1"
        }
      }
    ];
    expect(findSurfaceShapeForAnnotation(shapes, annotation({ id: "a" }))?.id).toBe(
      "shape:b"
    );
    expect(
      findSurfaceShapeForAnnotation(shapes, annotation({ id: "a", surface_id: "nope" }))
    ).toBeUndefined();
  });
});

test.describe("computeAnnotationPagePlacement", () => {
  test("maps designer rect through media box without agent padding", () => {
    const mediaBox = { x: 10, y: 20, w: 100, h: 200 };
    const placement = computeAnnotationPagePlacement(
      annotation({ id: "ann-1", rect_x: 0.1, rect_y: 0.2, rect_w: 0.3, rect_h: 0.4 }),
      mediaBox
    );
    expect(placement.author).toBe("designer");
    expect(placement.pageRect).toEqual({
      x: 10 + 0.1 * 100,
      y: 20 + 0.2 * 200,
      w: 0.3 * 100,
      h: 0.4 * 200
    });
    expect(placement.meta).toEqual({
      canvasRecordId: "region-annotation:ann-1",
      runtimeRecordId: "ann-1",
      surfaceRecordId: "surf-1"
    });
  });

  test("agent v2_raw explicit applies display padding before page map", () => {
    const mediaBox = { x: 0, y: 0, w: 100, h: 200 };
    const placement = computeAnnotationPagePlacement(
      annotation({
        id: "ann-agent",
        author: "agent",
        rect_x: 0.2,
        rect_y: 0.25,
        rect_w: 0.6,
        rect_h: 0.08
      }),
      mediaBox
    );
    const my = (AGENT_REGION_MARGIN * mediaBox.w) / mediaBox.h;
    expect(placement.pageRect.x).toBeCloseTo((0.2 - AGENT_REGION_MARGIN) * 100, 6);
    expect(placement.pageRect.y).toBeCloseTo((0.25 - my) * 200, 6);
  });
});

test.describe("annotationMetaEqual + planAnnotationProjectionOps", () => {
  test("meta equality is strict on ids", () => {
    expect(
      annotationMetaEqual(
        {
          canvasRecordId: "region-annotation:a",
          runtimeRecordId: "a",
          surfaceRecordId: "s"
        },
        {
          canvasRecordId: "region-annotation:a",
          runtimeRecordId: "a",
          surfaceRecordId: "s"
        }
      )
    ).toBe(true);
    expect(
      annotationMetaEqual(
        {
          canvasRecordId: "region-annotation:a",
          runtimeRecordId: "a",
          surfaceRecordId: "s"
        },
        {
          canvasRecordId: "region-annotation:a",
          runtimeRecordId: "a",
          surfaceRecordId: "other"
        }
      )
    ).toBe(false);
  });

  test("plans create/update/delete and preserves draft markers", () => {
    const mediaBox = { x: 0, y: 0, w: 100, h: 100 };
    const record = annotation({
      id: "ann-1",
      rect_x: 0,
      rect_y: 0,
      rect_w: 0.5,
      rect_h: 0.5
    });
    const placement = computeAnnotationPagePlacement(record, mediaBox);
    const existing: AnnotationProjectionExisting[] = [
      {
        id: "shape:region-annotation:ann-1",
        x: 0,
        y: 0,
        props: { w: 10, h: 10, author: "designer", label: "" },
        meta: {
          canvasRecordId: "region-annotation:ann-1",
          runtimeRecordId: "ann-1",
          surfaceRecordId: "surf-1"
        }
      },
      {
        id: "shape:draft",
        x: 1,
        y: 1,
        props: { w: 1, h: 1, author: "designer", label: "" },
        meta: {
          canvasRecordId: "region-annotation:draft",
          runtimeRecordId: "draft",
          surfaceRecordId: "surf-1"
        }
      },
      {
        id: "shape:stale",
        x: 2,
        y: 2,
        props: { w: 5, h: 5, author: "designer", label: "" },
        meta: {
          canvasRecordId: "region-annotation:stale",
          runtimeRecordId: "stale",
          surfaceRecordId: "surf-1"
        }
      }
    ];

    const ops = planAnnotationProjectionOps(
      [{ record, placement }],
      existing,
      (id) => `shape:region-annotation:${id}`
    );

    expect(ops.some((o) => o.type === "update" && o.id.includes("ann-1"))).toBe(
      true
    );
    expect(ops.some((o) => o.type === "delete" && o.id === "shape:stale")).toBe(
      true
    );
    expect(ops.some((o) => o.id === "shape:draft")).toBe(false);
  });

  test("deletes an old-surface marker after the stable parent shape switches surfaces", () => {
    const oldSurfaceAnnotation = annotation({
      id: "ann-old",
      surface_id: "surf-old",
      surface_artifact_id: "surf-old"
    });
    const oldParent = {
      id: "shape:seed-1",
      type: SEED_REFERENCE_PROJECTION_TYPE,
      meta: {
        canvasRecordId: "seed-reference:seed-1",
        kind: "figma_evidence_surface" as const,
        runtimeRecordId: "surf-old",
        seedRecordId: "seed-1",
        surfaceRecordId: "surf-old"
      }
    };
    expect(
      findSurfaceShapeForAnnotation([oldParent], oldSurfaceAnnotation)
    ).toBe(oldParent);

    const switchedParent = {
      ...oldParent,
      meta: {
        ...oldParent.meta,
        runtimeRecordId: "surf-new",
        surfaceRecordId: "surf-new"
      }
    };
    expect(
      findSurfaceShapeForAnnotation([switchedParent], oldSurfaceAnnotation)
    ).toBeUndefined();

    const ops = planAnnotationProjectionOps(
      [],
      [
        {
          id: "shape:region-annotation:ann-old",
          x: 10,
          y: 20,
          props: { w: 30, h: 40, author: "designer", label: "" },
          meta: {
            canvasRecordId: "region-annotation:ann-old",
            runtimeRecordId: "ann-old",
            surfaceRecordId: "surf-old"
          }
        }
      ],
      (id) => `shape:region-annotation:${id}`
    );
    expect(ops).toEqual([
      { type: "delete", id: "shape:region-annotation:ann-old" }
    ]);
  });
});

test.describe("shouldResyncAnnotationsForStoreChanges", () => {
  const seedShape = (id: string, x = 0, y = 0, w = 380, h = 520) => ({
    id,
    typeName: "shape" as const,
    type: SEED_REFERENCE_PROJECTION_TYPE,
    x,
    y,
    rotation: 0,
    props: { w, h },
    meta: {
      canvasRecordId: "seed-reference:seed-1",
      kind: "figma_evidence_surface",
      runtimeRecordId: "surf-old",
      seedRecordId: "seed-1",
      surfaceRecordId: "surf-old"
    }
  });

  const annotationShape = (
    id: string,
    opts: {
      x?: number;
      y?: number;
      w?: number;
      h?: number;
      runtimeRecordId?: string;
    } = {}
  ) => ({
    id,
    typeName: "shape" as const,
    type: REGION_ANNOTATION_TYPE,
    x: opts.x ?? 0,
    y: opts.y ?? 0,
    rotation: 0,
    props: { w: opts.w ?? 10, h: opts.h ?? 10 },
    meta: {
      canvasRecordId: `region-annotation:${opts.runtimeRecordId ?? "ann-1"}`,
      runtimeRecordId: opts.runtimeRecordId ?? "ann-1",
      surfaceRecordId: "surf-1"
    }
  });

  test("true for seed-reference-projection create / delete", () => {
    expect(
      shouldResyncAnnotationsForStoreChanges({
        added: { "shape:a": seedShape("shape:a") },
        updated: {},
        removed: {}
      })
    ).toBe(true);
    expect(
      shouldResyncAnnotationsForStoreChanges({
        added: {},
        updated: {},
        removed: { "shape:a": seedShape("shape:a") }
      })
    ).toBe(true);
  });

  test("true for seed move / resize; false for seed prop-only update", () => {
    const from = seedShape("shape:a", 0, 0, 380, 520);
    expect(
      shouldResyncAnnotationsForStoreChanges({
        added: {},
        updated: {
          "shape:a": [from, { ...from, x: 40 }]
        },
        removed: {}
      })
    ).toBe(true);
    expect(
      shouldResyncAnnotationsForStoreChanges({
        added: {},
        updated: {
          "shape:a": [from, { ...from, props: { w: 400, h: 520 } }]
        },
        removed: {}
      })
    ).toBe(true);
    expect(
      shouldResyncAnnotationsForStoreChanges({
        added: {},
        updated: {
          "shape:a": [
            from,
            {
              ...from,
              props: { w: 380, h: 520, screenshotDataUrl: "data:new" }
            }
          ]
        },
        removed: {}
      })
    ).toBe(false);
  });

  test("true when stable seed shape switches semantic surface identity", () => {
    const from = seedShape("shape:seed-1");
    const to = {
      ...from,
      meta: {
        ...from.meta,
        runtimeRecordId: "surf-new",
        surfaceRecordId: "surf-new"
      }
    };
    expect(
      shouldResyncAnnotationsForStoreChanges({
        added: {},
        updated: { "shape:seed-1": [from, to] },
        removed: {}
      })
    ).toBe(true);
  });

  test("false when only screenshot or title props change and meta is unchanged", () => {
    const from = seedShape("shape:seed-1");
    const to = {
      ...from,
      props: {
        ...from.props,
        screenshotDataUrl: "data:image/png;base64,new",
        frameName: "New title"
      }
    };
    expect(
      shouldResyncAnnotationsForStoreChanges({
        added: {},
        updated: { "shape:seed-1": [from, to] },
        removed: {}
      })
    ).toBe(false);
  });

  test("true when persisted annotation geometry drifts (user drag snap-back)", () => {
    const from = annotationShape("shape:ann-1", { x: 10, y: 20, w: 30, h: 40 });
    // Measured bug: drag left a permanent 120×80 offset until refresh.
    const to = annotationShape("shape:ann-1", {
      x: 10 + 120,
      y: 20 + 80,
      w: 30,
      h: 40
    });
    expect(
      shouldResyncAnnotationsForStoreChanges({
        added: {},
        updated: { "shape:ann-1": [from, to] },
        removed: {}
      })
    ).toBe(true);
    expect(
      shouldResyncAnnotationsForStoreChanges({
        added: {},
        updated: {
          "shape:ann-1": [
            from,
            annotationShape("shape:ann-1", { x: 10, y: 20, w: 50, h: 60 })
          ]
        },
        removed: {}
      })
    ).toBe(true);
  });

  test("planAnnotationProjectionOps corrects drifted marker back to Runtime rect", () => {
    const mediaBox = { x: 0, y: 0, w: 100, h: 100 };
    const record = annotation({
      id: "ann-1",
      rect_x: 0.1,
      rect_y: 0.2,
      rect_w: 0.3,
      rect_h: 0.4
    });
    const placement = computeAnnotationPagePlacement(record, mediaBox);
    // Local drag left marker 120×80 off Runtime page rect.
    const drifted: AnnotationProjectionExisting[] = [
      {
        id: "shape:region-annotation:ann-1",
        x: placement.pageRect.x + 120,
        y: placement.pageRect.y + 80,
        props: {
          w: placement.nextW,
          h: placement.nextH,
          author: "designer",
          label: ""
        },
        meta: placement.meta
      }
    ];
    const ops = planAnnotationProjectionOps(
      [{ record, placement }],
      drifted,
      (id) => `shape:region-annotation:${id}`
    );
    expect(ops).toEqual([
      {
        type: "update",
        id: "shape:region-annotation:ann-1",
        x: placement.pageRect.x,
        y: placement.pageRect.y,
        props: {
          w: placement.nextW,
          h: placement.nextH,
          author: "designer",
          label: ""
        }
      }
    ]);
  });

  test("false for annotation draft / create / other shapes (avoids sync recursion)", () => {
    expect(
      shouldResyncAnnotationsForStoreChanges({
        added: {
          "shape:d": annotationShape("shape:d", { runtimeRecordId: "draft" })
        },
        updated: {},
        removed: {}
      })
    ).toBe(false);
    // Draft geometry updates during annotate-tool gesture must not resync.
    expect(
      shouldResyncAnnotationsForStoreChanges({
        added: {},
        updated: {
          "shape:d": [
            annotationShape("shape:d", { runtimeRecordId: "draft", x: 0 }),
            annotationShape("shape:d", { runtimeRecordId: "draft", x: 9 })
          ]
        },
        removed: {}
      })
    ).toBe(false);
    // Persisted annotation create/delete alone do not qualify (geometry drift does).
    expect(
      shouldResyncAnnotationsForStoreChanges({
        added: { "shape:a": annotationShape("shape:a") },
        updated: {},
        removed: {}
      })
    ).toBe(false);
    expect(
      shouldResyncAnnotationsForStoreChanges({
        added: {},
        updated: {},
        removed: { "shape:a": annotationShape("shape:a") }
      })
    ).toBe(false);
    expect(
      shouldResyncAnnotationsForStoreChanges({
        added: {
          "shape:geo": {
            id: "shape:geo",
            typeName: "shape",
            type: "geo",
            x: 0,
            y: 0,
            rotation: 0,
            props: { w: 1, h: 1 }
          }
        },
        updated: {},
        removed: {}
      })
    ).toBe(false);
  });
});
