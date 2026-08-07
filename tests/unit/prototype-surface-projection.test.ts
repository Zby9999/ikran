// Issue 30 — Prototype Evidence Surface projection: Runtime records in, canvas
// shape ops out. Geometry is local-only, so a readiness or stale update must
// never move a frame the designer already positioned.

import { describe, expect, test } from "vitest";

import {
  buildPrototypeSurfaceProjectionTargets,
  planPrototypeSurfaceProjectionOps
} from "../../components/workbench/projection/prototype-surface-projection";
import { planPrototypeSurfaceLiveShapeId } from "../../components/workbench/projection/prototype-surface-live-policy";
import {
  PROTOTYPE_SURFACE_LIVE_VIEWPORT_W,
  PROTOTYPE_SURFACE_PROJECTION_DEFAULT_H,
  PROTOTYPE_SURFACE_PROJECTION_DEFAULT_W,
  prototypeSurfaceLiveViewport,
  prototypeSurfaceStatusText
} from "../../components/workbench/prototype-surface-shape";
import { buildFolderPageItems } from "../../components/workbench/folder-page-list";
import type { PrototypeSurfaceRecord } from "../../lib/runtime/prototype-surface";
import type { SeedReferenceRecord } from "../../lib/runtime/seed-reference";
import type { FigmaEvidenceSurfaceRecord } from "../../lib/runtime/evidence-package";

function surfaceRecord(
  overrides: Partial<PrototypeSurfaceRecord> = {}
): PrototypeSurfaceRecord {
  return {
    id: "proto-1",
    prototype_run_id: "run-row-1",
    run_id: "run-1",
    surface_key: "landing",
    name: "Landing",
    preview_url: "http://127.0.0.1:4300",
    preview_port: 4300,
    readiness: "ready",
    readiness_reason: null,
    stale: false,
    stale_reason: null,
    screenshot_artifact_path: null,
    screenshot_captured_at: null,
    created_at: "2026-08-06T00:00:00.000Z",
    updated_at: "2026-08-06T00:00:00.000Z",
    ...overrides
  };
}

const shapeIdForKey = (key: string) => `shape:${key}`;

describe("prototype surface projection", () => {
  test("creates one shape per Runtime record with default page proportions", () => {
    const ops = planPrototypeSurfaceProjectionOps(
      buildPrototypeSurfaceProjectionTargets([surfaceRecord()]),
      [],
      shapeIdForKey
    );

    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      type: "create",
      id: "shape:proto-1",
      props: {
        w: PROTOTYPE_SURFACE_PROJECTION_DEFAULT_W,
        h: PROTOTYPE_SURFACE_PROJECTION_DEFAULT_H,
        previewUrl: "http://127.0.0.1:4300",
        readiness: "ready",
        stale: false,
        surfaceName: "Landing",
        screenshotSrc: ""
      },
      meta: {
        canvasRecordId: "prototype-surface:proto-1",
        runtimeRecordId: "proto-1",
        kind: "prototype_surface",
        runId: "run-1",
        surfaceKey: "landing"
      }
    });
  });

  test("a captured bitmap becomes an authenticated /api/artifacts URL", () => {
    const ops = planPrototypeSurfaceProjectionOps(
      buildPrototypeSurfaceProjectionTargets(
        [
          surfaceRecord({
            screenshot_artifact_path:
              ".ikran/artifacts/prototype-media/proto-1-1754430000000.png",
            screenshot_captured_at: "2026-08-06T00:05:00.000Z"
          })
        ],
        "session-token"
      ),
      [],
      shapeIdForKey
    );

    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      type: "create",
      props: {
        screenshotSrc:
          "/api/artifacts/.ikran/artifacts/prototype-media/" +
          "proto-1-1754430000000.png?session=session-token"
      }
    });

    // No session token → no URL (the artifact endpoint would 401 anyway).
    expect(
      buildPrototypeSurfaceProjectionTargets([
        surfaceRecord({
          screenshot_artifact_path:
            ".ikran/artifacts/prototype-media/proto-1-1754430000000.png"
        })
      ])[0].props.screenshotSrc
    ).toBe("");
  });

  test("a new frame is packed clear of the seed frames already on the page", () => {
    const ops = planPrototypeSurfaceProjectionOps(
      buildPrototypeSurfaceProjectionTargets([surfaceRecord()]),
      [],
      shapeIdForKey,
      [{ x: 120, y: 140, w: 720, h: 960 }]
    );

    expect(ops[0].type).toBe("create");
    if (ops[0].type !== "create") return;
    expect(ops[0].x).toBeGreaterThanOrEqual(120 + 720);
  });

  test("a readiness change updates props without moving the shape", () => {
    const existing = [
      {
        id: "shape:proto-1",
        x: 900,
        y: 400,
        props: {
          w: PROTOTYPE_SURFACE_PROJECTION_DEFAULT_W,
          h: PROTOTYPE_SURFACE_PROJECTION_DEFAULT_H,
          previewUrl: "http://127.0.0.1:4300",
          readiness: "starting" as const,
          readinessReason: "",
          stale: false,
          staleReason: "",
          surfaceName: "Landing",
          screenshotSrc: ""
        },
        meta: {
          canvasRecordId: "prototype-surface:proto-1",
          runtimeRecordId: "proto-1",
          kind: "prototype_surface" as const,
          runId: "run-1",
          surfaceKey: "landing"
        }
      }
    ];

    const ops = planPrototypeSurfaceProjectionOps(
      buildPrototypeSurfaceProjectionTargets([
        surfaceRecord({ stale: true, stale_reason: "code_changed" })
      ]),
      existing,
      shapeIdForKey
    );

    expect(ops).toEqual([
      {
        type: "update",
        id: "shape:proto-1",
        props: {
          previewUrl: "http://127.0.0.1:4300",
          readiness: "ready",
          readinessReason: "",
          stale: true,
          staleReason: "code_changed",
          surfaceName: "Landing",
          screenshotSrc: ""
        }
      }
    ]);

    // Unchanged records produce no ops at all.
    expect(
      planPrototypeSurfaceProjectionOps(
        buildPrototypeSurfaceProjectionTargets([
          surfaceRecord({ readiness: "starting" })
        ]),
        existing,
        shapeIdForKey
      )
    ).toEqual([]);
  });

  test("a record that disappears deletes its shape", () => {
    const ops = planPrototypeSurfaceProjectionOps(
      [],
      [
        {
          id: "shape:proto-1",
          x: 0,
          y: 0,
          props: {
            w: 720,
            h: 848,
            previewUrl: "",
            readiness: "ready" as const,
            readinessReason: "",
            stale: false,
            staleReason: "",
            surfaceName: "",
            screenshotSrc: ""
          },
          meta: {
            canvasRecordId: "prototype-surface:proto-1",
            runtimeRecordId: "proto-1",
            kind: "prototype_surface" as const,
            runId: "run-1",
            surfaceKey: "landing"
          }
        }
      ],
      shapeIdForKey
    );
    expect(ops).toEqual([{ type: "delete", id: "shape:proto-1" }]);
  });
});

describe("prototypeSurfaceLiveViewport", () => {
  test("lays out at the virtual viewport width and scales down to the body", () => {
    const viewport = prototypeSurfaceLiveViewport(700, 800);

    expect(viewport.width).toBe(PROTOTYPE_SURFACE_LIVE_VIEWPORT_W);
    expect(viewport.scale).toBeCloseTo(700 / PROTOTYPE_SURFACE_LIVE_VIEWPORT_W);
    // Height grows by the inverse scale so the scaled iframe fills the body.
    expect(Math.round(viewport.height * viewport.scale)).toBe(800);
  });

  test("a body wider than the virtual viewport gets a real 1:1 viewport", () => {
    const viewport = prototypeSurfaceLiveViewport(2000, 900);

    expect(viewport).toEqual({ scale: 1, width: 2000, height: 900 });
  });

  test("an unmeasured body yields zero sizes (iframe stays hidden)", () => {
    expect(prototypeSurfaceLiveViewport(0, 0)).toEqual({
      scale: 1,
      width: 0,
      height: 0
    });
  });
});

describe("prototypeSurfaceStatusText", () => {
  test("names the lifecycle state and the reason behind it", () => {
    expect(
      prototypeSurfaceStatusText({
        readiness: "installing",
        readinessReason: "",
        stale: false,
        staleReason: ""
      })
    ).toBe("Installing prototype dependencies");

    expect(
      prototypeSurfaceStatusText({
        readiness: "failed",
        readinessReason: "port_conflict",
        stale: false,
        staleReason: ""
      })
    ).toBe("Prototype dev server failed (port_conflict)");
  });

  test("a stale surface warns instead of reporting readiness", () => {
    expect(
      prototypeSurfaceStatusText({
        readiness: "ready",
        readinessReason: "",
        stale: true,
        staleReason: "code_changed"
      })
    ).toBe("Prototype code changed — this preview is out of date");

    expect(
      prototypeSurfaceStatusText({
        readiness: "ready",
        readinessReason: "",
        stale: true,
        staleReason: "dev_server_exited"
      })
    ).toBe("The prototype dev server stopped — this preview is out of date");
  });
});

describe("buildFolderPageItems", () => {
  const seed = {
    id: "seed-1",
    current_surface_id: "surface-1"
  } as SeedReferenceRecord;
  const surface = {
    id: "surface-1",
    seed_reference_id: "seed-1",
    frame_name: "Checkout"
  } as FigmaEvidenceSurfaceRecord;

  test("seed pages carry the Figma frame name, prototype pages their own", () => {
    expect(
      buildFolderPageItems({
        seeds: [seed],
        surfaces: [surface],
        prototypeSurfaces: [surfaceRecord()]
      })
    ).toEqual([
      { id: "seed-1", label: "Checkout", kind: "figma" },
      { id: "proto-1", label: "Landing", kind: "website" }
    ]);
  });

  test("an evidence surface with no seed on record still gets a page", () => {
    expect(
      buildFolderPageItems({
        seeds: [],
        surfaces: [{ ...surface, frame_name: "" }],
        prototypeSurfaces: []
      })
    ).toEqual([{ id: "surface-1", label: "Seed Page", kind: "figma" }]);
  });
});

describe("single-live policy", () => {
  const ready = (shapeId: string) => ({
    shapeId,
    readiness: "ready",
    stale: false,
    previewUrl: "http://127.0.0.1:4300"
  });

  test("a selected ready surface is live", () => {
    expect(
      planPrototypeSurfaceLiveShapeId({
        surfaces: [ready("a"), ready("b")],
        selectedShapeIds: ["b"],
        autoLiveExitedShapeIds: new Set()
      })
    ).toBe("b");
  });

  test("the sole ready surface defaults to live when nothing is selected", () => {
    expect(
      planPrototypeSurfaceLiveShapeId({
        surfaces: [ready("a")],
        selectedShapeIds: [],
        autoLiveExitedShapeIds: new Set()
      })
    ).toBe("a");
  });

  test("an explicitly exited sole surface stays a placeholder until re-selected", () => {
    expect(
      planPrototypeSurfaceLiveShapeId({
        surfaces: [ready("a")],
        selectedShapeIds: [],
        autoLiveExitedShapeIds: new Set(["a"])
      })
    ).toBeNull();
    expect(
      planPrototypeSurfaceLiveShapeId({
        surfaces: [ready("a")],
        selectedShapeIds: ["a"],
        autoLiveExitedShapeIds: new Set(["a"])
      })
    ).toBe("a");
  });

  test("two ready surfaces with no selection: none is live", () => {
    expect(
      planPrototypeSurfaceLiveShapeId({
        surfaces: [ready("a"), ready("b")],
        selectedShapeIds: [],
        autoLiveExitedShapeIds: new Set()
      })
    ).toBeNull();
  });

  test("stale, non-ready, or URL-less surfaces are never live", () => {
    expect(
      planPrototypeSurfaceLiveShapeId({
        surfaces: [
          { ...ready("a"), stale: true },
          { ...ready("b"), readiness: "starting" },
          { ...ready("c"), previewUrl: " " }
        ],
        selectedShapeIds: [],
        autoLiveExitedShapeIds: new Set()
      })
    ).toBeNull();
  });
});
