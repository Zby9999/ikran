"use client";

// tldraw custom shape: Region Annotation marker on an Evidence Surface
// (Issue 06). Visual projection only — Runtime `region_annotations` row is
// the source of truth. Geometry (w/h) is local page-space size of the marker
// box; normalized rect lives on the Runtime record and is mapped via
// `region-annotation-geometry.ts` by the wiring agent.
//
// Visual: on-surface colored box only (no side cards, connectors, or pink).
// Stroke + radius are **page-space** and scale with the parent Seed Reference
// **media box width**, calibrated to Figma annotations on the Design System
// Abstract seed-ref (media ~695px → 1px stroke / 8px radius). Camera zoom
// scales them once via the html-layer transform — not inverse-scaled to
// screen pixels.
//   designer → border #19d122, fill rgba(25,209,34,0.05)
//   agent    → border #a5a5a5, fill rgba(165,165,165,0.05)
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
import { mediaBoxInPage } from "./region-annotation-geometry";
import {
  isSeedReferenceProjectionShape,
  seedReferenceMetaMatchesSurfaceId
} from "./seed-reference-surface-match";

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    "region-annotation": {
      w: number;
      h: number;
      /** Who created the annotation — drives marker color. */
      author: "designer" | "agent";
      /** Reserved for future label UI; unused for now. */
      label: string;
      /**
       * Parent Evidence Surface media-box width in page px (synced). The
       * marker also re-reads the live parent bounds so chrome tracks resize.
       */
      surfaceMediaW: number;
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

/**
 * Stroke / radius at the Figma annotation reference media width.
 * Figma nodes 97:774 / 97:775 / 247:138: strokeWeight 1, cornerRadius 8.
 */
export const REGION_ANNOTATION_STROKE_AT_REF = 1;
export const REGION_ANNOTATION_RADIUS_AT_REF = 8;

/**
 * Media width where stroke/radius above apply (Figma seed-ref image 97:773
 * inside Design System Abstract). Smaller Seed References get thinner /
 * tighter chrome; larger ones scale up proportionally.
 */
export const REGION_ANNOTATION_REF_MEDIA_W = 695;

/**
 * Page-space stroke + radius scaled to the parent Seed Reference media width.
 * At Figma ref media width → 1px stroke / 8px radius. Halving the Seed
 * Reference halves stroke and radius. Camera zoom then scales these page
 * values once.
 */
export function annotationChromeForMediaWidth(mediaW: number): {
  stroke: number;
  radius: number;
} {
  const scale = mediaW > 0 ? mediaW / REGION_ANNOTATION_REF_MEDIA_W : 1;
  return {
    stroke: Math.max(0, REGION_ANNOTATION_STROKE_AT_REF * scale),
    radius: Math.max(0, REGION_ANNOTATION_RADIUS_AT_REF * scale)
  };
}

function RegionAnnotationMarker({ shape }: { shape: RegionAnnotationShape }) {
  const { w, h, author, surfaceMediaW } = shape.props;
  const { canvasRecordId, runtimeRecordId, surfaceRecordId } = shape.meta;
  const editor = useEditor();
  const isSelected = useValue(
    "region-annotation-selected",
    () => editor.getSelectedShapeIds().includes(shape.id),
    [editor, shape.id]
  );
  // Read parent Seed Reference bounds live so chrome tracks resize even before
  // projection sync rewrites `surfaceMediaW` on the marker props.
  const mediaW = useValue(
    "region-annotation-parent-media-w",
    () => {
      const fallback =
        surfaceMediaW > 0 ? surfaceMediaW : REGION_ANNOTATION_REF_MEDIA_W;
      if (!surfaceRecordId) return fallback;
      for (const parent of editor.getCurrentPageShapes()) {
        if (!isSeedReferenceProjectionShape(parent)) continue;
        const meta = parent.meta;
        if (!seedReferenceMetaMatchesSurfaceId(meta, surfaceRecordId)) continue;
        const bounds = editor.getShapePageBounds(parent);
        if (!bounds) break;
        const media = mediaBoxInPage(bounds.x, bounds.y, bounds.w, bounds.h);
        if (media.w > 0) return media.w;
        break;
      }
      return fallback;
    },
    [editor, surfaceRecordId, surfaceMediaW]
  );
  const authorClass =
    author === "agent"
      ? "region-annotation-marker--agent"
      : "region-annotation-marker--designer";

  const { stroke, radius } = annotationChromeForMediaWidth(mediaW);

  return (
    <HTMLContainer
      data-testid="region-annotation"
      data-canvas-record-id={canvasRecordId}
      data-runtime-record-id={runtimeRecordId}
      data-surface-record-id={surfaceRecordId}
      data-author={author}
      data-surface-media-w={String(mediaW)}
      data-selected={isSelected ? "true" : "false"}
      className={
        isSelected
          ? `region-annotation-marker ${authorClass} region-annotation-marker--selected`
          : `region-annotation-marker ${authorClass}`
      }
      style={{ width: w, height: h, pointerEvents: "all" }}
    >
      <div
        className="region-annotation-marker__chrome"
        style={{
          width: "100%",
          height: "100%",
          borderWidth: stroke,
          borderRadius: radius
        }}
      />
    </HTMLContainer>
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
    label: T.string,
    surfaceMediaW: T.number
  };

  getDefaultProps(): RegionAnnotationShape["props"] {
    return {
      w: REGION_ANNOTATION_DEFAULT_W,
      h: REGION_ANNOTATION_DEFAULT_H,
      author: "designer",
      label: "",
      surfaceMediaW: REGION_ANNOTATION_REF_MEDIA_W
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
