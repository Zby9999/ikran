import { describe, expect, test } from "vitest";
import {
  buildStructuralOverlayFrames,
  fitStructuralImageBox,
  findStructuralOverlayFrameAtPoint,
  structuralHoverDisplayRect
} from "../../components/workbench/structural-overlay";

const FRAME_BOUNDS = JSON.stringify({
  x: 100,
  y: 200,
  width: 400,
  height: 800
});

describe("structural overlay", () => {
  test("fits the screenshot like object-fit scale-down", () => {
    expect(
      fitStructuralImageBox(
        { x: 10, y: 20, w: 400, h: 400 },
        { width: 400, height: 200 }
      )
    ).toEqual({ x: 10, y: 120, w: 400, h: 200 });
    expect(
      fitStructuralImageBox(
        { x: 0, y: 0, w: 400, h: 400 },
        { width: 100, height: 50 }
      )
    ).toEqual({ x: 150, y: 175, w: 100, h: 50 });
  });

  test("hover display rect uses the same media-space margin as the annotation", () => {
    const rect = structuralHoverDisplayRect({
      rect: { x: 0.2, y: 0.25, w: 0.4, h: 0.1 },
      imageBox: { x: 100, y: 50, w: 400, h: 200 },
      mediaSize: { w: 600, h: 400 }
    });
    expect(rect.x).toBeCloseTo(0.191, 6);
    expect(rect.y).toBeCloseTo(0.232, 6);
    expect(rect.w).toBeCloseTo(0.418, 6);
    expect(rect.h).toBeCloseTo(0.136, 6);
  });

  test("projects default-selectable captured nodes and excludes root, vectors, and hidden nodes", () => {
    const frames = buildStructuralOverlayFrames({
      frameBoundsJson: FRAME_BOUNDS,
      positionalNodesJson: JSON.stringify([
        {
          id: "root",
          parentId: null,
          name: "Page",
          type: "FRAME",
          depth: 0,
          visible: true,
          bounds: { x: 100, y: 200, width: 400, height: 800 }
        },
        {
          id: "frame",
          parentId: "root",
          name: "Hero",
          type: "FRAME",
          depth: 1,
          visible: true,
          bounds: { x: 140, y: 280, width: 320, height: 240 }
        },
        {
          id: "text",
          parentId: "frame",
          name: "Headline",
          type: "TEXT",
          depth: 2,
          visible: true,
          bounds: { x: 180, y: 320, width: 120, height: 40 }
        },
        {
          id: "vector",
          parentId: "frame",
          name: "Path",
          type: "VECTOR",
          depth: 2,
          visible: true,
          bounds: { x: 200, y: 400, width: 20, height: 20 }
        },
        {
          id: "hidden",
          parentId: "root",
          name: "Hidden",
          type: "FRAME",
          depth: 1,
          visible: false,
          bounds: { x: 100, y: 200, width: 50, height: 50 }
        }
      ])
    });

    expect(frames.map((frame) => frame.nodeId)).toEqual(["frame", "text"]);
    expect(frames[0].rect).toEqual({ x: 0.1, y: 0.1, w: 0.8, h: 0.3 });
    expect(frames[1].rect).toEqual({ x: 0.2, y: 0.15, w: 0.3, h: 0.05 });
  });

  test("nested hit-test selects the deepest, smallest selectable node", () => {
    const frames = buildStructuralOverlayFrames({
      frameBoundsJson: FRAME_BOUNDS,
      positionalNodesJson: JSON.stringify([
        {
          id: "root",
          parentId: null,
          name: "Page",
          type: "FRAME",
          depth: 0,
          visible: true,
          bounds: { x: 100, y: 200, width: 400, height: 800 }
        },
        {
          id: "parent",
          parentId: "root",
          name: "Card",
          type: "FRAME",
          depth: 1,
          visible: true,
          bounds: { x: 140, y: 280, width: 320, height: 240 }
        },
        {
          id: "child",
          parentId: "parent",
          name: "Title",
          type: "TEXT",
          depth: 2,
          visible: true,
          bounds: { x: 180, y: 320, width: 120, height: 40 }
        }
      ])
    });

    expect(findStructuralOverlayFrameAtPoint(frames, { x: 0.25, y: 0.17 })?.nodeId).toBe(
      "child"
    );
    expect(findStructuralOverlayFrameAtPoint(frames, { x: 0.8, y: 0.35 })?.nodeId).toBe(
      "parent"
    );
    expect(findStructuralOverlayFrameAtPoint(frames, { x: 0.02, y: 0.02 })).toBeNull();
  });

  test("malformed positional evidence fails closed", () => {
    expect(
      buildStructuralOverlayFrames({
        frameBoundsJson: "not-json",
        positionalNodesJson: "[]"
      })
    ).toEqual([]);
    expect(
      buildStructuralOverlayFrames({
        frameBoundsJson: FRAME_BOUNDS,
        positionalNodesJson: JSON.stringify([
          {
            id: "broken",
            depth: 1,
            visible: true,
            bounds: { x: 100, y: 200, width: 10, height: 10 }
          }
        ])
      })
    ).toEqual([]);
  });
});
