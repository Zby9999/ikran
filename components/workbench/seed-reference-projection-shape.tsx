"use client";

// tldraw custom shape: a single seed-reference PROJECTION as a Figma Frame surface
// (Figma 230:297). Visual only — never a source of truth.
//
// Issue 02/04 boundary rule: a tldraw shape is ONLY a projection of a Runtime
// `seed_references` record. It carries the Runtime record id in `meta` (and as
// data-* attributes) so tests / UI can tie the canvas shape back to the semantic
// record, but geometry (x/y/w/h) is local-only and never written back. On refresh
// the shape is rebuilt from the record at a default position.
//
// Visual (230:297): purple-bordered frame with header title + info tip
// (227:130 Description). Media is a white placeholder until Issue 05 screenshots.
// URL is stored in props but NOT shown on the card.
//
// Default size: 380×520 — readable tall placeholder on the workbench canvas
// (not the full Figma page aspect 695:1851, which would be ~380×1013).
// Resize is aspect-ratio locked. Blue selection bounds stay hidden; corner
// resize hit targets stay active (visual corner squares suppressed via
// SeedSelectionForegroundOverlayUtil — do NOT use hideResizeHandles, which
// also removes hit geometry). Unselected strokes are #B980B9; selected
// deepens both to #731b73 (`.seed-ref-frame--selected`).

import "tldraw/tldraw.css";
import { useState, type SyntheticEvent } from "react";
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
    "seed-reference-projection": {
      w: number;
      h: number;
      figmaSeedReference: string;
      originalDesignIntent: string;
      /** Source frame / node name when known; empty → title falls back to "Figma seed". */
      frameName: string;
    };
  }
}

export type SeedReferenceProjectionMeta = {
  canvasRecordId: string;
  runtimeRecordId: string;
  /** Discriminator so a future reader can tell a projection from other shapes. */
  kind: "seed_reference_projection";
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
  const { w, h, originalDesignIntent, frameName } = shape.props;
  const { canvasRecordId, runtimeRecordId, kind } = shape.meta;
  const [tipOpen, setTipOpen] = useState(false);
  const editor = useEditor();
  const isSelected = useValue(
    "seed-ref-selected",
    () => editor.getSelectedShapeIds().includes(shape.id),
    [editor, shape.id]
  );

  const title = frameName.trim() || FALLBACK_TITLE;
  const description = originalDesignIntent.trim() || FALLBACK_DESCRIPTION;

  const stopShapePointer = (event: SyntheticEvent) => {
    event.stopPropagation();
  };

  return (
    <HTMLContainer
      data-testid="seed-reference-projection"
      data-canvas-record-id={canvasRecordId}
      data-runtime-record-id={runtimeRecordId}
      data-kind={kind}
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
          {tipOpen ? (
            <div
              className="seed-ref-frame__tip"
              data-testid="seed-reference-projection-tip"
              role="tooltip"
            >
              {description}
            </div>
          ) : null}
        </div>
      </div>
      <div
        className="seed-ref-frame__media"
        data-testid="seed-reference-projection-media"
        aria-hidden="true"
      />
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
    frameName: T.string
  };

  getDefaultProps(): SeedReferenceProjectionShape["props"] {
    return {
      w: SEED_REFERENCE_PROJECTION_DEFAULT_W,
      h: SEED_REFERENCE_PROJECTION_DEFAULT_H,
      figmaSeedReference: "",
      originalDesignIntent: "",
      frameName: ""
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

  override component(shape: SeedReferenceProjectionShape) {
    return <SeedReferenceProjectionFrame shape={shape} />;
  }

  // No selection indicator path — hides the blue selection stroke.
  override getIndicatorPath(_shape: SeedReferenceProjectionShape) {
    return undefined;
  }
}

export type { TLCreateShapePartial };
