import { expect, test } from "vitest";
import {
  findNodeCorrespondence,
  getAnnotationNodeCandidates,
  isDefaultSelectableFigmaNode,
  type PositionalEvidenceNode
} from "../../lib/runtime/figma-positional-evidence";

const nodes: PositionalEvidenceNode[] = [
  {
    id: "1:1",
    parentId: null,
    name: "Checkout",
    type: "FRAME",
    depth: 0,
    visible: true,
    selectable: true,
    bounds: { x: 100, y: 200, width: 400, height: 300 },
    clipRenderBounds: { x: 100, y: 200, width: 400, height: 300 }
  },
  {
    id: "1:2",
    parentId: "1:1",
    name: "Hero",
    type: "FRAME",
    depth: 1,
    visible: true,
    selectable: true,
    bounds: { x: 140, y: 230, width: 200, height: 120 },
    clipRenderBounds: { x: 140, y: 230, width: 200, height: 120 }
  },
  {
    id: "1:3",
    parentId: "1:2",
    name: "Buy now",
    type: "TEXT",
    depth: 2,
    visible: true,
    selectable: true,
    bounds: { x: 160, y: 250, width: 80, height: 24 },
    clipRenderBounds: { x: 160, y: 250, width: 80, height: 24 }
  },
  {
    id: "1:4",
    parentId: "1:2",
    name: "Vector 12",
    type: "VECTOR",
    depth: 2,
    visible: true,
    selectable: false,
    bounds: { x: 160, y: 250, width: 80, height: 24 },
    clipRenderBounds: { x: 160, y: 250, width: 80, height: 24 }
  }
];

test("default structural selection excludes low-level vectors and unnamed groups", () => {
  expect(isDefaultSelectableFigmaNode(nodes[1])).toBe(true);
  expect(isDefaultSelectableFigmaNode(nodes[3])).toBe(false);
  expect(
    isDefaultSelectableFigmaNode({
      ...nodes[1],
      id: "g",
      name: "Group 12",
      type: "GROUP",
      selectable: undefined
    })
  ).toBe(false);
  expect(
    isDefaultSelectableFigmaNode({
      ...nodes[1],
      id: "g2",
      name: "Pricing cards",
      type: "GROUP",
      selectable: undefined
    })
  ).toBe(true);
  expect(
    isDefaultSelectableFigmaNode({
      ...nodes[1],
      id: "image",
      name: "Hero photo",
      type: "RECTANGLE",
      selectable: true
    })
  ).toBe(true);
});

test("candidate ranking converts normalized screenshot rect and is stable for nested overlaps", () => {
  const input = {
    nodes,
    frameBounds: { x: 100, y: 200, width: 400, height: 300 },
    rect: { x: 0.1, y: 0.1, w: 0.25, h: 0.2 }
  };
  const first = getAnnotationNodeCandidates(input);
  const second = getAnnotationNodeCandidates(input);

  expect(second).toEqual(first);
  expect(first.map((candidate) => candidate.nodeId)).toEqual([
    "1:3",
    "1:2",
    "1:1"
  ]);
  expect(first[0]).toMatchObject({
    nodeId: "1:3",
    bounds: { x: 160, y: 250, width: 80, height: 24 },
    overlap: { intersects: true, nodeContainedByRect: true }
  });
  expect(first.some((candidate) => candidate.nodeId === "1:4")).toBe(false);
});

test("candidate query clamps boundary rects and returns empty rather than inventing a primary", () => {
  expect(
    getAnnotationNodeCandidates({
      nodes: nodes.slice(1),
      frameBounds: { x: 100, y: 200, width: 400, height: 300 },
      rect: { x: 0.95, y: 0.95, w: 0.5, h: 0.5 }
    })
  ).toEqual([]);
});

test("correspondence is exact by captured node id or explicitly missing", () => {
  expect(findNodeCorrespondence(nodes, "1:3")).toMatchObject({
    status: "corresponding",
    node: { id: "1:3", name: "Buy now" }
  });
  expect(findNodeCorrespondence(nodes, "removed:9")).toEqual({
    status: "missing",
    capturedNodeId: "removed:9"
  });
});
