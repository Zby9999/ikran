"use client";

// tldraw custom shape: a single seed-reference PROJECTION.
//
// Issue 02/04 boundary rule: a tldraw shape is ONLY a projection of a Runtime
// `seed_references` record. It is never a source of truth. The shape carries
// the Runtime record id in its `meta` (and as data-* attributes) so tests and
// the UI can tie the canvas shape back to the semantic record, but geometry
// (x/y/w/h) is local-only and never written back to the Runtime. On a page
// refresh the shape is rebuilt from the record at a default position.
//
// Custom-shape typing follows tldraw's documented pattern: augment
// `TLGlobalShapePropsMap` so the shape type is part of the `TLShape` union, then
// `BaseBoxShapeUtil` can take the concrete shape type. See the doc comment on
// `TLBaseShape` in @tldraw/tlschema ("Custom shapes should be defined by
// augmenting the TLGlobalShapePropsMap type").

import "tldraw/tldraw.css";
import { BaseBoxShapeUtil, HTMLContainer, T, TLShape, TLCreateShapePartial } from "tldraw";

// Register the custom shape's props in tldraw's global shape map. After this,
// `TLShape<'seed-reference-projection'>` is the concrete shape type and is part
// of the `TLShape` union (so `editor.getCurrentPageShapes()` items can be
// compared to this type, and `createShape` can target it).
declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    "seed-reference-projection": {
      w: number;
      h: number;
      figmaSeedReference: string;
      originalDesignIntent: string;
    };
  }
}

// The projection's meta ties the tldraw shape to the Runtime record id. `meta`
// is `JsonObject` on TLBaseShape; we narrow it by redeclaring it on the shape
// interface so reads are typed. `canvasRecordId` is the canvas-side handle
// (`seed-reference:<record.id>`); `runtimeRecordId` is the Runtime record id.
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

export class SeedReferenceProjectionShapeUtil extends BaseBoxShapeUtil<SeedReferenceProjectionShape> {
  static override type = SEED_REFERENCE_PROJECTION_TYPE;

  // Bare validators (no parens): T.string / T.number are T.Validatable values.
  static override props = {
    w: T.number,
    h: T.number,
    figmaSeedReference: T.string,
    originalDesignIntent: T.string
  };

  getDefaultProps(): SeedReferenceProjectionShape["props"] {
    return {
      w: 360,
      h: 168,
      figmaSeedReference: "",
      originalDesignIntent: ""
    };
  }

  // v5: `component(shape)` receives the shape directly (NOT `{ shape }`).
  override component(shape: SeedReferenceProjectionShape) {
    const { w, h, figmaSeedReference, originalDesignIntent } = shape.props;
    const { canvasRecordId, runtimeRecordId, kind } = shape.meta;

    return (
      <HTMLContainer
        data-testid="seed-reference-projection"
        data-canvas-record-id={canvasRecordId}
        data-runtime-record-id={runtimeRecordId}
        data-kind={kind}
        style={{
          width: w,
          height: h,
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: 16,
          borderRadius: 16,
          border: "1px solid #c7c7c7",
          background: "#f5f5f5",
          boxShadow: "0 12px 32px rgba(0, 0, 0, 0.12)",
          color: "#3d3d3d",
          overflow: "hidden",
          pointerEvents: "all",
          fontFamily:
            "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 10,
            letterSpacing: "-0.3px",
            textTransform: "uppercase",
            color: "#9d9d9d"
          }}
        >
          Seed reference
        </p>
        <p
          data-testid="seed-reference-projection-url"
          style={{
            margin: 0,
            fontSize: 12,
            lineHeight: 1.4,
            letterSpacing: "-0.36px",
            wordBreak: "break-word"
          }}
        >
          {figmaSeedReference}
        </p>
        <p
          style={{
            margin: 0,
            fontSize: 10,
            letterSpacing: "-0.3px",
            textTransform: "uppercase",
            color: "#9d9d9d"
          }}
        >
          Original intent
        </p>
        <p
          data-testid="seed-reference-projection-intent"
          style={{
            margin: 0,
            fontSize: 12,
            lineHeight: 1.4,
            letterSpacing: "-0.36px",
            wordBreak: "break-word"
          }}
        >
          {originalDesignIntent}
        </p>
      </HTMLContainer>
    );
  }

  // v5: override `getIndicatorPath` (NOT the deprecated `indicator()`).
  override getIndicatorPath(shape: SeedReferenceProjectionShape) {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }
}

// Re-exported so the canvas can build a typed create-partial.
export type { TLCreateShapePartial };