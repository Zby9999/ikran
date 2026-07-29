"use client";

// tldraw custom shape: Region Annotation marker on an Evidence Surface
// (Issue 06). Visual projection only — Runtime `region_annotations` row is
// the source of truth. Geometry (w/h) is local page-space size of the marker
// box; normalized rect lives on the Runtime record and is mapped via
// `region-annotation-geometry.ts` by the wiring agent.
//
// Persisted markers are projected with `isLocked: true` so select-tool drag
// is a no-op (Workbench enables `selectLockedShapes` so Delete still works).
//
// Visual: on-surface colored box only (no side cards, connectors, or pink).
// Stroke + radius are **page-space** and scale with the parent Seed Reference
// **media box width**, calibrated to Figma annotations on the Design System
// Abstract seed-ref (media ~695px → 1px stroke / 4px radius). Camera zoom
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
import { DesignerAnnotationEntryForm } from "./designer-annotation-entry-form";
import { useDesignerAnnotationEntry } from "./designer-annotation-entry-context";
import {
  annotationChromeForMediaWidth,
  REGION_ANNOTATION_REF_MEDIA_W
} from "./annotation-chrome";
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
 * Stroke stays at the Figma reference weight; radius is intentionally reduced
 * to 4px so tiny point annotations remain visually precise and readable.
 */
export {
  REGION_ANNOTATION_STROKE_AT_REF,
  REGION_ANNOTATION_RADIUS_AT_REF,
  REGION_ANNOTATION_REF_MEDIA_W,
  annotationChromeForMediaWidth
} from "./annotation-chrome";

function RegionAnnotationMarker({ shape }: { shape: RegionAnnotationShape }) {
  const { w, h, author, surfaceMediaW } = shape.props;
  const { canvasRecordId, runtimeRecordId, surfaceRecordId } = shape.meta;
  const editor = useEditor();
  const entry = useDesignerAnnotationEntry();
  const isSelected = useValue(
    "region-annotation-selected",
    () => editor.getSelectedShapeIds().includes(shape.id),
    [editor, shape.id]
  );
  // Issue 08A: a freshly placed marker (draft:committing) renders the text
  // entry form while it is the pending entry. Submit creates the Runtime
  // record; Esc/cancel deletes this draft without persisting anything.
  const isPendingDraft =
    runtimeRecordId === "draft:committing" &&
    entry?.pending?.payload.draftShapeId === String(shape.id);
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
  // Issue 08A: the entry form docks OUTSIDE the parent frame, on the side
  // nearer to the marker, vertically centered on the marker (Figma 670:891 —
  // entry box sits beside the frame edge, level with the annotation).
  const entryPlacement = useValue(
    "region-annotation-entry-placement",
    () => {
      if (!surfaceRecordId) return null;
      for (const parent of editor.getCurrentPageShapes()) {
        if (!isSeedReferenceProjectionShape(parent)) continue;
        const meta = parent.meta;
        if (!seedReferenceMetaMatchesSurfaceId(meta, surfaceRecordId)) continue;
        const bounds = editor.getShapePageBounds(parent);
        if (!bounds) return null;
        const FORM_W = 360;
        const FORM_H = 56;
        const GAP = 20;
        const right = shape.x + w / 2 >= bounds.x + bounds.w / 2;
        const anchorX = right
          ? bounds.x + bounds.w + GAP
          : bounds.x - GAP - FORM_W;
        return { left: anchorX - shape.x, top: h / 2 - FORM_H / 2 };
      }
      return null;
    },
    [editor, surfaceRecordId, shape.x, w, h]
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
      {isPendingDraft && entry ? (
        <div
          className="designer-annotation-entry-anchor"
          data-testid="designer-annotation-entry-anchor"
          style={
            entryPlacement
              ? { left: entryPlacement.left, top: entryPlacement.top }
              : undefined
          }
        >
          <DesignerAnnotationEntryForm
            submitting={entry.submitting}
            onSubmit={async (body) => {
              const result = await entry.submit(body);
              // Failure keeps the form open with the typed body intact — the
              // designer retries or explicitly cancels (Esc). Only cancel
              // destroys a draft (PRD 50); a transient create error must not.
              if (!result.ok) {
                console.error(
                  "[designer-annotation] create failed:",
                  result.error
                );
              }
            }}
            onCancel={() => {
              entry.cancel();
              editor.deleteShape(shape.id);
            }}
          />
        </div>
      ) : null}
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

  override canResize(_shape: RegionAnnotationShape) {
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
