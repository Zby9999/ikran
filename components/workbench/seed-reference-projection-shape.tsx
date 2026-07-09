"use client";

// tldraw custom shape: a single seed-reference / Evidence Surface PROJECTION as
// a Figma Frame surface (Figma 230:297). Visual only — never a source of truth.
//
// Issue 02/04 + 05 boundary: a tldraw shape is ONLY a projection of Runtime
// records (`seed_references` and/or `figma_evidence_surfaces`). It carries
// Runtime ids in `meta` (and as data-* attributes) so tests / UI can tie the
// canvas shape back to the semantic record, but geometry (x/y/w/h) is local-only
// and never written back. On refresh the shape is rebuilt from records at a
// default position.
//
// Meta id convention (Issue 05):
//   - Seed-only: kind = "seed_reference_projection", runtimeRecordId = seed.id
//   - With Evidence Surface: kind = "figma_evidence_surface",
//     runtimeRecordId = surface.id (stable for surface-linked tests),
//     seedRecordId = seed.id when linked, surfaceRecordId = surface.id
//
// Visual (230:297): purple-bordered frame with header title + info tip
// (227:130 Description). Media shows a screenshot when the surface supplies
// `screenshotDataUrl` (inline data URL or authenticated /api/artifacts URL).
// Until then, seed-only projections show awaiting UX in the media area:
// Agent-registered seeds keep a loading spinner; UI-registered seeds show
// guidance to ask Agents for a Figma screenshot (no spinner).
// URL is stored in props but NOT shown on the card.
//
// Default size: 380×520 — readable tall placeholder on the workbench canvas
// (not the full Figma page aspect 695:1851, which would be ~380×1013).
// Resize is aspect-ratio locked. With a screenshot, corner resize cannot grow
// past natural pixels + frame chrome (object-fit: scale-down); shrink is free.
// Without a screenshot, resize is unconstrained. Blue selection bounds stay
// hidden; corner resize hit targets stay active (visual corner squares
// suppressed via SeedSelectionForegroundOverlayUtil — do NOT use
// hideResizeHandles, which also removes hit geometry). Unselected strokes are
// #B980B9; selected deepens both to #731b73 (`.seed-ref-frame--selected`).

import "tldraw/tldraw.css";
import { useState, type SyntheticEvent } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  TLShape,
  TLCreateShapePartial,
  TLResizeInfo,
  resizeBox,
  useEditor,
  useValue
} from "tldraw";
import { SeedReferenceDescriptionTip } from "./seed-reference-description-tip";
import {
  SEED_REF_FRAME_CHROME_H,
  SEED_REF_FRAME_CHROME_W,
  clampSeedReferenceResizeToNaturalSize,
  sizeFromNaturalPixels
} from "./seed-reference-resize-clamp";

export { SEED_REF_FRAME_CHROME_H, SEED_REF_FRAME_CHROME_W, sizeFromNaturalPixels };

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    "seed-reference-projection": {
      w: number;
      h: number;
      figmaSeedReference: string;
      originalDesignIntent: string;
      /** Source frame / node name when known; empty → title falls back to "Figma seed". */
      frameName: string;
      /** Screenshot <img src>: data URL or /api/artifacts?... URL. */
      screenshotDataUrl: string;
      /**
       * True when src is served from screenshot_artifact_path via /api/artifacts
       * (vs an inline data URL). Used for diagnostics; media still renders <img>.
       */
      hasScreenshotArtifact: boolean;
      /**
       * True when a seed/surface is projected but there is not yet a screenshot
       * src — media shows awaiting UX until Evidence Surface arrives.
       */
      awaitingEvidence: boolean;
      /**
       * Awaiting presentation: `spinner` (Agent path) or `guide` (UI path).
       */
      awaitingUx: "spinner" | "guide";
      /**
       * Screenshot intrinsic pixel size (0 when unknown / no screenshot).
       * Used to clamp corner resize so the frame cannot grow past natural
       * media size + chrome while object-fit: scale-down is in effect.
       */
      naturalMediaW: number;
      naturalMediaH: number;
    };
  }
}

export type SeedReferenceProjectionMeta = {
  canvasRecordId: string;
  /**
   * Primary Runtime id for this projection.
   * Seed-only → seed id; with Evidence Surface → surface id.
   */
  runtimeRecordId: string;
  /** Discriminator: seed-only vs upgraded / surface-only Evidence Surface. */
  kind: "seed_reference_projection" | "figma_evidence_surface";
  /** Seed id when linked (kept when runtimeRecordId is the surface id). */
  seedRecordId?: string;
  /** Surface id when an Evidence Surface is projected. */
  surfaceRecordId?: string;
};

export interface SeedReferenceProjectionShape extends TLShape<"seed-reference-projection"> {
  meta: SeedReferenceProjectionMeta;
}

export const SEED_REFERENCE_PROJECTION_TYPE = "seed-reference-projection" as const;

/** Readable default for a tall frame placeholder on the workbench canvas. */
export const SEED_REFERENCE_PROJECTION_DEFAULT_W = 380;
export const SEED_REFERENCE_PROJECTION_DEFAULT_H = 520;

const FALLBACK_TITLE = "Figma seed";
const FALLBACK_DESCRIPTION = "Description Place Holder";

function SeedReferenceProjectionFrame({
  shape
}: {
  shape: SeedReferenceProjectionShape;
}) {
  const {
    w,
    h,
    originalDesignIntent,
    frameName,
    screenshotDataUrl,
    hasScreenshotArtifact,
    awaitingEvidence,
    awaitingUx
  } = shape.props;
  const { canvasRecordId, runtimeRecordId, kind, seedRecordId, surfaceRecordId } =
    shape.meta;
  const [tipOpen, setTipOpen] = useState(false);
  const editor = useEditor();
  const isSelected = useValue(
    "seed-ref-selected",
    () => editor.getSelectedShapeIds().includes(shape.id),
    [editor, shape.id]
  );

  const title = frameName.trim() || FALLBACK_TITLE;
  const description = originalDesignIntent.trim() || FALLBACK_DESCRIPTION;
  const screenshotSrc = screenshotDataUrl.trim();
  const hasScreenshot = screenshotSrc.length > 0;
  const showAwaiting = awaitingEvidence && !hasScreenshot;
  const showGuide = showAwaiting && awaitingUx === "guide";
  const showSpinner = showAwaiting && awaitingUx !== "guide";

  const stopShapePointer = (event: SyntheticEvent) => {
    event.stopPropagation();
  };

  const handleScreenshotLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    // Ignore tiny fixtures / broken loads — keep the default placeholder size.
    if (!nw || !nh || Math.max(nw, nh) < 32) return;
    const next = sizeFromNaturalPixels(nw, nh);
    const sizeUnchanged =
      Math.abs(shape.props.w - next.w) < 1 &&
      Math.abs(shape.props.h - next.h) < 1;
    const naturalUnchanged =
      shape.props.naturalMediaW === nw && shape.props.naturalMediaH === nh;
    if (sizeUnchanged && naturalUnchanged) return;
    // Local geometry + natural size for resize clamp — never written back to Runtime.
    editor.updateShape<SeedReferenceProjectionShape>({
      id: shape.id,
      type: SEED_REFERENCE_PROJECTION_TYPE,
      props: {
        w: next.w,
        h: next.h,
        naturalMediaW: nw,
        naturalMediaH: nh
      }
    });
  };

  return (
    <HTMLContainer
      data-testid="seed-reference-projection"
      data-canvas-record-id={canvasRecordId}
      data-runtime-record-id={runtimeRecordId}
      data-kind={kind}
      data-seed-record-id={seedRecordId ?? undefined}
      data-surface-record-id={surfaceRecordId ?? undefined}
      data-selected={isSelected ? "true" : "false"}
      className={
        isSelected ? "seed-ref-frame seed-ref-frame--selected" : "seed-ref-frame"
      }
      style={{ width: w, height: h, pointerEvents: "all" }}
    >
      <div className="seed-ref-frame__header">
        <p
          className="seed-ref-frame__title"
          data-testid="seed-reference-projection-title"
        >
          {title}
        </p>
        <div className="seed-ref-frame__info-wrap">
          <button
            type="button"
            className="seed-ref-frame__info"
            data-testid="seed-reference-projection-info"
            aria-label="Description"
            aria-expanded={tipOpen}
            onPointerDown={stopShapePointer}
            onMouseDown={stopShapePointer}
            onClick={stopShapePointer}
            onMouseEnter={() => setTipOpen(true)}
            onMouseLeave={() => setTipOpen(false)}
            onFocus={() => setTipOpen(true)}
            onBlur={() => setTipOpen(false)}
          >
            <svg
              className="seed-ref-frame__info-icon"
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              aria-hidden="true"
            >
              <circle
                cx="7"
                cy="7"
                r="5.5625"
                stroke="#731b73"
                strokeWidth="0.875"
              />
              <path
                d="M7 6.25V9.5"
                stroke="#731b73"
                strokeWidth="0.875"
                strokeLinecap="round"
              />
              <circle cx="7" cy="4.5" r="0.7" fill="#731b73" />
            </svg>
          </button>
          {tipOpen ? <SeedReferenceDescriptionTip description={description} /> : null}
        </div>
      </div>
      <div
        className="seed-ref-frame__media"
        data-testid="seed-reference-projection-media"
        data-has-screenshot={hasScreenshot ? "true" : "false"}
        data-screenshot-from-artifact={
          hasScreenshot && hasScreenshotArtifact ? "true" : "false"
        }
        data-awaiting-evidence={showAwaiting ? "true" : "false"}
        data-awaiting-ux={showAwaiting ? awaitingUx : undefined}
        aria-hidden={hasScreenshot || showAwaiting ? undefined : "true"}
      >
        {hasScreenshot ? (
          // eslint-disable-next-line @next/next/no-img-element -- Runtime data URL or same-origin /api/artifacts
          <img
            className="seed-ref-frame__media-img"
            data-testid="seed-reference-projection-screenshot"
            src={screenshotSrc}
            alt=""
            draggable={false}
            onLoad={handleScreenshotLoad}
          />
        ) : showGuide ? (
          <div
            className="seed-ref-frame__awaiting seed-ref-frame__awaiting--guide"
            data-testid="seed-reference-projection-awaiting"
            data-awaiting-evidence="true"
            data-awaiting-ux="guide"
            role="status"
            aria-label="Ask Agents to fetch a Figma screenshot"
          >
            <p
              className="seed-ref-frame__awaiting-hint"
              data-testid="seed-reference-projection-awaiting-hint"
            >
              Ask Agents to fetch a Figma screenshot for this seed
            </p>
          </div>
        ) : showSpinner ? (
          <div
            className="seed-ref-frame__awaiting seed-ref-frame__awaiting--spinner"
            data-testid="seed-reference-projection-awaiting"
            data-awaiting-evidence="true"
            data-awaiting-ux="spinner"
            role="status"
            aria-label="Waiting for Agent to fulfill pending evidence"
          >
            <span className="seed-ref-frame__awaiting-spinner" aria-hidden="true" />
            <p
              className="seed-ref-frame__awaiting-hint"
              data-testid="seed-reference-projection-awaiting-hint"
            >
              Waiting for Agent — capturing Figma screenshot
            </p>
          </div>
        ) : null}
      </div>
    </HTMLContainer>
  );
}

export class SeedReferenceProjectionShapeUtil extends BaseBoxShapeUtil<SeedReferenceProjectionShape> {
  static override type = SEED_REFERENCE_PROJECTION_TYPE;

  static override props = {
    w: T.number,
    h: T.number,
    figmaSeedReference: T.string,
    originalDesignIntent: T.string,
    frameName: T.string,
    screenshotDataUrl: T.string,
    hasScreenshotArtifact: T.boolean,
    awaitingEvidence: T.boolean,
    awaitingUx: T.literalEnum("spinner", "guide"),
    naturalMediaW: T.number,
    naturalMediaH: T.number
  };

  getDefaultProps(): SeedReferenceProjectionShape["props"] {
    return {
      w: SEED_REFERENCE_PROJECTION_DEFAULT_W,
      h: SEED_REFERENCE_PROJECTION_DEFAULT_H,
      figmaSeedReference: "",
      originalDesignIntent: "",
      frameName: "",
      screenshotDataUrl: "",
      hasScreenshotArtifact: false,
      awaitingEvidence: false,
      awaitingUx: "spinner",
      naturalMediaW: 0,
      naturalMediaH: 0
    };
  }

  override isAspectRatioLocked(_shape: SeedReferenceProjectionShape) {
    return true;
  }

  // Keep resize handles enabled so corner hit targets work. Visual corner
  // squares are suppressed by SeedSelectionForegroundOverlayUtil.
  override hideResizeHandles(_shape: SeedReferenceProjectionShape) {
    return false;
  }

  override hideRotateHandle(_shape: SeedReferenceProjectionShape) {
    return true;
  }

  override hideSelectionBoundsBg(_shape: SeedReferenceProjectionShape) {
    return true;
  }

  override hideSelectionBoundsFg(_shape: SeedReferenceProjectionShape) {
    return true;
  }

  /**
   * Corner resize: allow shrink below screenshot natural size; clamp grow at
   * natural pixels + frame chrome. No screenshot / unknown natural → free resize.
   */
  override onResize(
    shape: SeedReferenceProjectionShape,
    info: TLResizeInfo<SeedReferenceProjectionShape>
  ) {
    const resized = resizeBox(shape, info);
    const { naturalMediaW, naturalMediaH, screenshotDataUrl } =
      info.initialShape.props;
    const hasScreenshot = screenshotDataUrl.trim().length > 0;
    if (!hasScreenshot || naturalMediaW <= 0 || naturalMediaH <= 0) {
      return resized;
    }

    const max = sizeFromNaturalPixels(naturalMediaW, naturalMediaH);
    const clamped = clampSeedReferenceResizeToNaturalSize({
      x: resized.x,
      y: resized.y,
      rotation: resized.rotation,
      handle: info.handle,
      w: resized.props.w,
      h: resized.props.h,
      maxW: max.w,
      maxH: max.h
    });

    return {
      ...resized,
      x: clamped.x,
      y: clamped.y,
      props: {
        ...resized.props,
        w: clamped.w,
        h: clamped.h
      }
    };
  }

  override component(shape: SeedReferenceProjectionShape) {
    return <SeedReferenceProjectionFrame shape={shape} />;
  }

  // No selection indicator path — hides the blue selection stroke.
  override getIndicatorPath(_shape: SeedReferenceProjectionShape) {
    return undefined;
  }
}

export type { TLCreateShapePartial };
