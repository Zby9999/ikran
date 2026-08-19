"use client";

import { BaseBoxShapeUtil, HTMLContainer, T, type TLShape } from "tldraw";

import type { AlignmentStageId } from "./alignment-stage-panel";
import {
  stageColor,
  type AlignmentProjectionMeta
} from "./projection/alignment-projection";

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    "alignment-connector": {
      w: number;
      h: number;
      startX: number;
      startY: number;
      endX: number;
      endY: number;
      stage: AlignmentStageId;
    };
  }
}

export const ALIGNMENT_CONNECTOR_TYPE = "alignment-connector" as const;

export interface AlignmentConnectorShape
  extends TLShape<"alignment-connector"> {
  meta: AlignmentProjectionMeta;
}

export function AlignmentConnectorShapeView({
  shape
}: {
  shape: AlignmentConnectorShape;
}) {
  const color = stageColor(shape.props.stage);
  return (
    <HTMLContainer
      data-testid="alignment-connector-shape"
      data-canvas-record-id={shape.meta.canvasRecordId}
      data-runtime-record-id={shape.meta.runtimeRecordId}
      data-seed-reference-id={shape.meta.seedReferenceId}
      data-surface-record-id={shape.meta.surfaceRecordId}
      data-evidence-version-id={shape.meta.evidenceVersionId}
      data-node-id={shape.meta.nodeId}
      style={{
        width: shape.props.w,
        height: shape.props.h,
        overflow: "visible",
        pointerEvents: "none"
      }}
    >
      <svg
        aria-hidden="true"
        width={shape.props.w}
        height={shape.props.h}
        overflow="visible"
      >
        <line
          x1={shape.props.startX}
          y1={shape.props.startY}
          x2={shape.props.endX}
          y2={shape.props.endY}
          fill="none"
          stroke={color}
          strokeWidth="1"
          strokeDasharray="6 5"
        />
      </svg>
    </HTMLContainer>
  );
}

export class AlignmentConnectorShapeUtil extends BaseBoxShapeUtil<AlignmentConnectorShape> {
  static override type = ALIGNMENT_CONNECTOR_TYPE;

  static override props = {
    w: T.number,
    h: T.number,
    startX: T.number,
    startY: T.number,
    endX: T.number,
    endY: T.number,
    stage: T.literalEnum(
      "design-concept",
      "visual-language",
      "token",
      "layout",
      "component",
      "interaction"
    )
  };

  getDefaultProps(): AlignmentConnectorShape["props"] {
    return {
      w: 1,
      h: 1,
      startX: 0,
      startY: 0,
      endX: 1,
      endY: 1,
      stage: "design-concept"
    };
  }

  override canEdit() {
    return false;
  }

  override canResize(_shape: AlignmentConnectorShape) {
    return false;
  }

  override hideResizeHandles() {
    return true;
  }

  override hideRotateHandle() {
    return true;
  }

  override hideSelectionBoundsBg() {
    return true;
  }

  override hideSelectionBoundsFg() {
    return true;
  }

  override component(shape: AlignmentConnectorShape) {
    return <AlignmentConnectorShapeView shape={shape} />;
  }

  override getIndicatorPath() {
    return undefined;
  }
}
