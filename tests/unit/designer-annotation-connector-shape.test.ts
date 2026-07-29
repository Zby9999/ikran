// Issue 08A — Designer Annotation connector shape tests.
// buildConnectorPath: rounded-elbow SVG path (8px, Figma 674-906) with
// per-corner radius clamping. getGeometry: zero-area hit geometry at the
// card end so the connector can never steal clicks from the marker.

import { describe, expect, test } from "vitest";

import {
  buildConnectorPath,
  CONNECTOR_CORNER_RADIUS,
  DesignerAnnotationConnectorShapeUtil,
  type DesignerAnnotationConnectorShape
} from "../../components/workbench/designer-annotation-connector-shape";

describe("buildConnectorPath", () => {
  test("straight two-point line has no arcs", () => {
    expect(
      buildConnectorPath([
        { x: 0, y: 0.5 },
        { x: 120, y: 0.5 }
      ])
    ).toBe("M 0 0.5 L 120 0.5");
  });

  test("elbow gets a quadratic corner trimmed by the corner radius", () => {
    const d = buildConnectorPath([
      { x: 100, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 100 }
    ]);
    expect(d).toBe(
      `M 100 0 L ${CONNECTOR_CORNER_RADIUS} 0 Q 0 0 0 ${CONNECTOR_CORNER_RADIUS} L 0 100`
    );
  });

  test("radius clamps to half the shorter adjacent segment", () => {
    const d = buildConnectorPath([
      { x: 10, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 10 }
    ]);
    // r = min(8, 10/2, 10/2) = 5
    expect(d).toBe("M 10 0 L 5 0 Q 0 0 0 5 L 0 10");
  });

  test("consecutive duplicate points are dropped", () => {
    expect(
      buildConnectorPath([
        { x: 50, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 80 }
      ])
    ).toBe("M 50 0 L 50 80");
  });

  test("fewer than two distinct points yields an empty path", () => {
    expect(buildConnectorPath([{ x: 1, y: 1 }])).toBe("");
    expect(buildConnectorPath([])).toBe("");
  });
});

describe("connector hit geometry", () => {
  function connectorShape(): DesignerAnnotationConnectorShape {
    return {
      id: "shape:designer-annotation-connector:ann-1" as DesignerAnnotationConnectorShape["id"],
      typeName: "shape",
      type: "designer-annotation-connector",
      x: 200,
      y: 100,
      rotation: 0,
      index: "a1" as DesignerAnnotationConnectorShape["index"],
      parentId: "page:page" as DesignerAnnotationConnectorShape["parentId"],
      isLocked: true,
      opacity: 1,
      props: {
        w: 120,
        h: 60,
        points: [
          { x: 120, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 60 }
        ],
        color: "#19d122"
      },
      meta: {
        canvasRecordId: "designer-annotation-connector:ann-1",
        runtimeRecordId: "ann-1",
        surfaceRecordId: "surf-1"
      }
    };
  }

  test("zero-area geometry sits at the card end (first point), never near the marker", () => {
    const util = Object.create(DesignerAnnotationConnectorShapeUtil.prototype);
    const geometry = util.getGeometry(connectorShape());
    expect(geometry.bounds.x).toBe(120);
    expect(geometry.bounds.y).toBe(0);
    expect(geometry.bounds.w).toBe(0);
    expect(geometry.bounds.h).toBe(0);
    // …while the real polyline box would have reached the marker at (10, 60).
  });
});
