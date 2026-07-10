"use client";

// tldraw custom shape: Region Annotation marker on an Evidence Surface
// (Issue 06). Visual projection only — Runtime `region_annotations` row is
// the source of truth. Geometry (w/h) is local page-space size of the marker
// box; normalized rect lives on the Runtime record and is mapped via
// `region-annotation-geometry.ts` by the wiring agent.
//
// Visual: on-surface colored box only (no side cards, connectors, or pink).
//   designer → border #19d122, fill rgba(25,209,34,0.05), radius 8px
//   agent    → border #a5a5a5, fill rgba(165,165,165,0.05), radius 8px
//
// Meta: runtimeRecordId (annotation id), surfaceRecordId, canvasRecordId.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  TLShape,
  TLCreateShapePartial,
  useEditor,
  useValue
} from "tldraw";

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    "region-annotation": {
      w: number;
      h: number;
      /** Who created the annotation — drives marker color. */
      author: "designer" | "agent";
      /** Reserved for future label UI; unused for now. */
      label: string;
    };
  }
}

export type RegionAnnotationMeta = {
  canvasRecordId: string;
  /** Runtime `region_annotations.id`. */
  runtimeRecordId: string;
  /** Anchored Evidence Surface id (`figma_evidence_surfaces.id`). */
  surfaceRecordId: string;
};

export interface RegionAnnotationShape extends TLShape<"region-annotation"> {
  meta: RegionAnnotationMeta;
}

export const REGION_ANNOTATION_TYPE = "region-annotation" as const;

/** Default marker size in page pixels (overridden when syncing from normalized rect). */
export const REGION_ANNOTATION_DEFAULT_W = 40;
export const REGION_ANNOTATION_DEFAULT_H = 40;

function RegionAnnotationMarker({ shape }: { shape: RegionAnnotationShape }) {
  const { w, h, author } = shape.props;
  const { canvasRecordId, runtimeRecordId, surfaceRecordId } = shape.meta;
  const editor = useEditor();
  const isSelected = useValue(
    "region-annotation-selected",
    () => editor.getSelectedShapeIds().includes(shape.id),
    [editor, shape.id]
  );
  const authorClass =
    author === "agent"
      ? "region-annotation-marker--agent"
      : "region-annotation-marker--designer";

  return (
    <HTMLContainer
      data-testid="region-annotation"
      data-canvas-record-id={canvasRecordId}
      data-runtime-record-id={runtimeRecordId}
      data-surface-record-id={surfaceRecordId}
      data-author={author}
      data-selected={isSelected ? "true" : "false"}
      className={
        isSelected
          ? `region-annotation-marker ${authorClass} region-annotation-marker--selected`
          : `region-annotation-marker ${authorClass}`
      }
      style={{ width: w, height: h, pointerEvents: "all" }}
    />
  );
}

/**
 * tldraw shape util for Region Annotation markers.
 * Wiring agent: register as `RegionAnnotationShapeUtil` in workbench shapeUtils.
 */
export class RegionAnnotationShapeUtil extends BaseBoxShapeUtil<RegionAnnotationShape> {
  static override type = REGION_ANNOTATION_TYPE;

  static override props = {
    w: T.number,
    h: T.number,
    author: T.literalEnum("designer", "agent"),
    label: T.string
  };

  getDefaultProps(): RegionAnnotationShape["props"] {
    return {
      w: REGION_ANNOTATION_DEFAULT_W,
      h: REGION_ANNOTATION_DEFAULT_H,
      author: "designer",
      label: ""
    };
  }

  override hideResizeHandles(_shape: RegionAnnotationShape) {
    return true;
  }

  override hideRotateHandle(_shape: RegionAnnotationShape) {
    return true;
  }

  override hideSelectionBoundsBg(_shape: RegionAnnotationShape) {
    return true;
  }

  override hideSelectionBoundsFg(_shape: RegionAnnotationShape) {
    return true;
  }

  override canEdit(_shape: RegionAnnotationShape) {
    return false;
  }

  override component(shape: RegionAnnotationShape) {
    return <RegionAnnotationMarker shape={shape} />;
  }

  override getIndicatorPath(_shape: RegionAnnotationShape) {
    return undefined;
  }
}

export type { TLCreateShapePartial };
