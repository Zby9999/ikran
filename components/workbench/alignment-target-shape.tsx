"use client";

import { BaseBoxShapeUtil, HTMLContainer, T, type TLShape } from "tldraw";

import type { AlignmentStageId } from "./alignment-stage-panel";
import {
  stageColor,
  type AlignmentProjectionMeta
} from "./projection/alignment-projection";

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    "alignment-target": {
      w: number;
      h: number;
      stage: AlignmentStageId;
    };
  }
}

export const ALIGNMENT_TARGET_TYPE = "alignment-target" as const;

export interface AlignmentTargetShape extends TLShape<"alignment-target"> {
  meta: AlignmentProjectionMeta;
}

function translucent(color: string): string {
  const value = color.startsWith("#") ? color.slice(1) : color;
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r},${g},${b},0.1)`;
}

export function AlignmentTargetShapeView({
  shape
}: {
  shape: AlignmentTargetShape;
}) {
  const color = stageColor(shape.props.stage);
  return (
    <HTMLContainer
      data-testid="alignment-target-shape"
      data-canvas-record-id={shape.meta.canvasRecordId}
      data-runtime-record-id={shape.meta.runtimeRecordId}
      data-seed-reference-id={shape.meta.seedReferenceId}
      data-surface-record-id={shape.meta.surfaceRecordId}
      data-evidence-version-id={shape.meta.evidenceVersionId}
      data-node-id={shape.meta.nodeId}
      data-stage={shape.props.stage}
      style={{
        width: shape.props.w,
        height: shape.props.h,
        border: `1px solid ${color}`,
        background: translucent(color),
        borderRadius: 4,
        pointerEvents: "none"
      }}
    />
  );
}

export class AlignmentTargetShapeUtil extends BaseBoxShapeUtil<AlignmentTargetShape> {
  static override type = ALIGNMENT_TARGET_TYPE;

  static override props = {
    w: T.number,
    h: T.number,
    stage: T.literalEnum(
      "design-principle",
      "visual-language",
      "token",
      "layout",
      "component",
      "interaction"
    )
  };

  getDefaultProps(): AlignmentTargetShape["props"] {
    return { w: 40, h: 40, stage: "design-principle" };
  }

  override canEdit() {
    return false;
  }

  override canResize(_shape: AlignmentTargetShape) {
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

  override component(shape: AlignmentTargetShape) {
    return <AlignmentTargetShapeView shape={shape} />;
  }

  override getIndicatorPath() {
    return undefined;
  }
}
