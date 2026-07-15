import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import {
  AlignmentTargetShapeUtil,
  AlignmentTargetShapeView,
  type AlignmentTargetShape
} from "../../components/workbench/alignment-target-shape";
import {
  AlignmentConnectorShapeUtil,
  AlignmentConnectorShapeView,
  type AlignmentConnectorShape
} from "../../components/workbench/alignment-connector-shape";

const meta = {
  canvasRecordId: "alignment-target:question-1",
  runtimeRecordId: "question-1",
  surface: "design-intent-alignment" as const,
  seedReferenceId: "seed-1",
  surfaceRecordId: "surface-1",
  evidenceVersionId: "version-1",
  nodeId: "44:120"
};

function targetShape(): AlignmentTargetShape {
  return {
    id: "shape:alignment-target:question-1" as AlignmentTargetShape["id"],
    typeName: "shape",
    type: "alignment-target",
    x: 138,
    y: 154,
    rotation: 0,
    index: "a1" as AlignmentTargetShape["index"],
    parentId: "page:page" as AlignmentTargetShape["parentId"],
    isLocked: true,
    opacity: 1,
    props: { w: 114, h: 52, stage: "layout" },
    meta
  };
}

function connectorShape(): AlignmentConnectorShape {
  return {
    id: "shape:alignment-connector:question-1" as AlignmentConnectorShape["id"],
    typeName: "shape",
    type: "alignment-connector",
    x: 252,
    y: 90,
    rotation: 0,
    index: "a1" as AlignmentConnectorShape["index"],
    parentId: "page:page" as AlignmentConnectorShape["parentId"],
    isLocked: true,
    opacity: 1,
    props: {
      w: 248,
      h: 90,
      startX: 0,
      startY: 90,
      endX: 248,
      endY: 0,
      stage: "layout"
    },
    meta: { ...meta, canvasRecordId: "alignment-connector:question-1" }
  };
}

describe("Alignment target projection shapes", () => {
  test("renders a locked stage-colored translucent target box", () => {
    const html = renderToStaticMarkup(
      createElement(AlignmentTargetShapeView, { shape: targetShape() })
    );
    const util = Object.create(
      AlignmentTargetShapeUtil.prototype
    ) as AlignmentTargetShapeUtil;

    expect(html).toContain('data-testid="alignment-target-shape"');
    expect(html).toContain('data-runtime-record-id="question-1"');
    expect(html).toContain("border:1px solid #dc3a91");
    expect(html).toContain("background:rgba(220,58,145,0.1)");
    expect(util.canResize(targetShape())).toBe(false);
  });

  test("renders the connector as a stage-colored dashed line", () => {
    const html = renderToStaticMarkup(
      createElement(AlignmentConnectorShapeView, { shape: connectorShape() })
    );
    const util = Object.create(
      AlignmentConnectorShapeUtil.prototype
    ) as AlignmentConnectorShapeUtil;

    expect(html).toContain('data-testid="alignment-connector-shape"');
    expect(html).toContain('stroke="#dc3a91"');
    expect(html).toContain('stroke-dasharray="6 5"');
    expect(util.canResize(connectorShape())).toBe(false);
  });
});
