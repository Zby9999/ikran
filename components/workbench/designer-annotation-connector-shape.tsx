"use client";

// Issue 08A — dashed connector from a Designer Annotation card back to its
// on-surface marker. User-Annotation green; straight horizontal when the card
// sits on the marker's row, one rounded elbow (8px, Figma 674-906) when
// stacking pushed the card off it. Polyline geometry is precomputed by the
// card projection plan.

import {
  BaseBoxShapeUtil,
  HTMLContainer,
  Rectangle2d,
  T,
  type TLShape
} from "tldraw";

export const DESIGNER_ANNOTATION_CONNECTOR_TYPE =
  "designer-annotation-connector" as const;

/** Rounded-elbow corner radius (Figma 674-906). */
export const CONNECTOR_CORNER_RADIUS = 8;

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    "designer-annotation-connector": {
      w: number;
      h: number;
      /** Polyline in shape-local coords: card end first, marker end last. */
      points: Array<{ x: number; y: number }>;
      /** Precomputed accent ("" → neutral fallback at render). */
      color: string;
    };
  }
}

export type DesignerAnnotationConnectorMeta = {
  canvasRecordId: string;
  /** Runtime `region_annotations.id` of the owning card. */
  runtimeRecordId: string;
  surfaceRecordId: string;
};

export interface DesignerAnnotationConnectorShape
  extends TLShape<"designer-annotation-connector"> {
  meta: DesignerAnnotationConnectorMeta;
}

/**
 * SVG path for the connector polyline with rounded corners. Each interior
 * point becomes a quadratic arc of `radius`, clamped to half the shorter
 * adjacent segment so short segments never overshoot.
 */
export function buildConnectorPath(
  points: ReadonlyArray<{ x: number; y: number }>,
  radius: number = CONNECTOR_CORNER_RADIUS
): string {
  const pts: Array<{ x: number; y: number }> = [];
  for (const p of points) {
    const last = pts[pts.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) pts.push(p);
  }
  if (pts.length < 2) return "";

  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const next = pts[i + 1];
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    if (r <= 0 || inLen === 0 || outLen === 0) {
      d += ` L ${cur.x} ${cur.y}`;
      continue;
    }
    const inX = cur.x - ((cur.x - prev.x) / inLen) * r;
    const inY = cur.y - ((cur.y - prev.y) / inLen) * r;
    const outX = cur.x + ((next.x - cur.x) / outLen) * r;
    const outY = cur.y + ((next.y - cur.y) / outLen) * r;
    d += ` L ${inX} ${inY} Q ${cur.x} ${cur.y} ${outX} ${outY}`;
  }
  const end = pts[pts.length - 1];
  d += ` L ${end.x} ${end.y}`;
  return d;
}

export function DesignerAnnotationConnectorShapeView({
  shape
}: {
  shape: DesignerAnnotationConnectorShape;
}) {
  const { w, h, points, color } = shape.props;
  return (
    <HTMLContainer
      data-testid="designer-annotation-connector"
      data-runtime-record-id={shape.meta.runtimeRecordId}
      style={{ width: w, height: h, overflow: "visible", pointerEvents: "none" }}
    >
      <svg aria-hidden="true" width={w} height={Math.max(h, 2)} overflow="visible">
        <path
          d={buildConnectorPath(points)}
          fill="none"
          stroke={color || "#a5a5a5"}
          strokeWidth="1"
          strokeDasharray="6 5"
        />
      </svg>
    </HTMLContainer>
  );
}

export class DesignerAnnotationConnectorShapeUtil extends BaseBoxShapeUtil<DesignerAnnotationConnectorShape> {
  static override type = DESIGNER_ANNOTATION_CONNECTOR_TYPE;

  static override props = {
    w: T.number,
    h: T.number,
    points: T.arrayOf(T.object({ x: T.number, y: T.number })),
    color: T.string
  };

  getDefaultProps(): DesignerAnnotationConnectorShape["props"] {
    return {
      w: 1,
      h: 1,
      points: [
        { x: 0, y: 0.5 },
        { x: 1, y: 0.5 }
      ],
      color: ""
    };
  }

  override canEdit() {
    return false;
  }

  // Pure decoration: collapse the hit geometry to a zero-area point at the
  // CARD end of the line. The connector's real box spans card → marker; with
  // tldraw's hit margin (8px, growing as you zoom out) a margin hit on this
  // higher-z shape would beat an inside hit on the annotation marker and
  // steal its clicks. The card end sits inside the owning card, where a hit
  // is harmless.
  override getGeometry(shape: DesignerAnnotationConnectorShape) {
    const p0 = shape.props.points[0] ?? { x: 0, y: 0 };
    return new Rectangle2d({
      x: p0.x,
      y: p0.y,
      width: 0,
      height: 0,
      isFilled: false
    });
  }

  override canResize() {
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

  override component(shape: DesignerAnnotationConnectorShape) {
    return <DesignerAnnotationConnectorShapeView shape={shape} />;
  }

  override getIndicatorPath() {
    return undefined;
  }
}
