// Issue 08A — Designer Annotation side-card projection plan (pure).
//
// Filled designer annotations (author=designer) are docked as cards beside
// their parent Evidence Surface frame: body text in the designer-annotation
// green (Figma 670:895 — green is the User Annotation color, never
// section-tinted), with a dashed green connector back to the on-surface
// marker. Cards flank the frame on the side of the marker (marker center vs
// media center), stacked per side with collision resolution. Agent
// annotations keep the grey-marker-only treatment — no cards.
//
// Pure plan builder: geometry in, plan out. The sync controller applies it.

import type { RegionAnnotationRecord } from "@/lib/runtime/region-annotation";
import { computeAnnotationPagePlacement } from "./annotation-projection";
import type { PageRect } from "../region-annotation-geometry";

export const DESIGNER_ANNOTATION_CARD_W = 319;
export const DESIGNER_ANNOTATION_CARD_GAP = 20;
export const DESIGNER_ANNOTATION_CARD_STACK_GAP = 12;
const CARD_MIN_H = 50;
const CARD_MAX_H = 240;
const CARD_PADDING_Y = 32;
const CARD_LINE_H = 18;
const CARD_CHARS_PER_LINE = 44;

export type DesignerAnnotationAnchorKind = RegionAnnotationRecord["target_kind"];

export type DesignerAnnotationCardPlan = {
  kind: "card";
  /** `designer-annotation-card:${recordId}` */
  id: string;
  recordId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  placement: "left" | "right";
  body: string;
  /** Six-part section id, or null for legacy records without one. */
  section: string | null;
  anchorKind: DesignerAnnotationAnchorKind;
  /** Parent surface frame id (seed projection shape id) for diffing. */
  surfaceShapeId: string;
};

export type DesignerAnnotationConnectorPlan = {
  kind: "connector";
  /** `designer-annotation-connector:${recordId}` */
  id: string;
  recordId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Polyline in connector-local coords, card end first, marker end last.
   * 2 points when the card center sits on the marker row (straight
   * horizontal); 4 points when the card center is still inside the marker's
   * vertical span (two folds into the nearest vertical edge midpoint);
   * 3 points when stacked fully off the span — horizontal at the card's
   * center to the marker's center X, then vertical into the marker's
   * nearest horizontal edge (Figma 674-906).
   */
  points: Array<{ x: number; y: number }>;
};

export type DesignerAnnotationProjectionPlan =
  | DesignerAnnotationCardPlan
  | DesignerAnnotationConnectorPlan;

export type DesignerAnnotationSurfaceContext = {
  /** Seed projection shape id (for lane grouping). */
  surfaceShapeId: string;
  /** Full seed frame bounds in page space (card docks against this). */
  frame: PageRect;
  /** Screenshot media box in page space (marker geometry space). */
  mediaBox: PageRect;
  /** Fitted screenshot content box (node geometry is normalized to this). */
  imageBox: PageRect;
};

/** Estimate card height from body length (padding + wrapped lines). */
export function designerAnnotationCardHeight(body: string): number {
  const lines = body
    .split("\n")
    .reduce(
      (count, line) =>
        count + Math.max(1, Math.ceil(line.length / CARD_CHARS_PER_LINE)),
      0
    );
  const h = CARD_PADDING_Y + lines * CARD_LINE_H;
  return Math.min(CARD_MAX_H, Math.max(CARD_MIN_H, h));
}

export type OccupiedBox = { y: number; h: number };

function resolveCardCollisionY(
  desiredY: number,
  h: number,
  occupied: readonly OccupiedBox[]
): number {
  let y = desiredY;
  for (const box of [...occupied].sort((a, b) => a.y - b.y)) {
    const overlaps =
      y < box.y + box.h + DESIGNER_ANNOTATION_CARD_STACK_GAP &&
      y + h + DESIGNER_ANNOTATION_CARD_STACK_GAP > box.y;
    if (overlaps) y = box.y + box.h + DESIGNER_ANNOTATION_CARD_STACK_GAP;
  }
  return y;
}

/**
 * Build the card + connector plan for all designer-authored annotations.
 * `resolveSurface` returns null when the parent surface projection is not on
 * the current page yet (card skipped until it exists).
 * `occupiedByLane` seeds each `${surfaceShapeId}:${side}` lane with boxes
 * already taken by other docked card families (07 alignment question cards),
 * so annotation cards stack below/around them instead of overlapping.
 */
export function buildDesignerAnnotationCardPlan(input: {
  annotations: RegionAnnotationRecord[];
  resolveSurface: (
    record: RegionAnnotationRecord
  ) => DesignerAnnotationSurfaceContext | null;
  occupiedByLane?: ReadonlyMap<string, readonly OccupiedBox[]>;
}): DesignerAnnotationProjectionPlan[] {
  const plan: DesignerAnnotationProjectionPlan[] = [];
  const occupiedByLane = new Map<string, OccupiedBox[]>();

  for (const record of input.annotations) {
    if (record.author !== "designer") continue;
    const surface = input.resolveSurface(record);
    if (!surface) continue;

    const placement = computeAnnotationPagePlacement(
      record,
      surface.mediaBox,
      surface.imageBox
    );
    const marker = placement.pageRect;
    const markerCenterX = marker.x + marker.w / 2;
    const markerCenterY = marker.y + marker.h / 2;
    const side: "left" | "right" =
      markerCenterX >= surface.mediaBox.x + surface.mediaBox.w / 2
        ? "right"
        : "left";

    const h = designerAnnotationCardHeight(record.body);
    const w = DESIGNER_ANNOTATION_CARD_W;
    const x =
      side === "left"
        ? surface.frame.x - DESIGNER_ANNOTATION_CARD_GAP - w
        : surface.frame.x + surface.frame.w + DESIGNER_ANNOTATION_CARD_GAP;

    const laneKey = `${surface.surfaceShapeId}:${side}`;
    let occupied = occupiedByLane.get(laneKey);
    if (!occupied) {
      occupied = [...(input.occupiedByLane?.get(laneKey) ?? [])];
      occupiedByLane.set(laneKey, occupied);
    }
    const y = resolveCardCollisionY(markerCenterY - h / 2, h, occupied);
    occupied.push({ y, h });

    plan.push({
      kind: "card",
      id: `designer-annotation-card:${record.id}`,
      recordId: record.id,
      x,
      y,
      w,
      h,
      placement: side,
      body: record.body,
      section: record.section ?? null,
      anchorKind: record.target_kind,
      surfaceShapeId: surface.surfaceShapeId
    });

    // Dashed connector (Figma 674-906 + designer refinement): leaves the
    // card's inner edge at the card's VERTICAL CENTER, then three cases —
    //  1. card center on the marker's row: straight horizontal into the
    //     marker's nearest vertical edge midpoint;
    //  2. card center still inside the marker's vertical span: a stub into
    //     the top/bottom edge would read as a kink, so fold TWICE — out at
    //     the card's center height, across the gap midpoint, then into the
    //     marker's nearest vertical edge midpoint;
    //  3. card fully off the marker's span: single elbow — horizontal to the
    //     marker's center X, then vertical into the nearest horizontal edge.
    // The path never enters the marker box: the connector shape's real box
    // plus tldraw's hit margin would otherwise steal clicks meant for the
    // marker (the shape additionally reports a zero-area hit geometry at the
    // card end).
    const cardCenterY = y + h / 2;
    const cardEdgeX = side === "left" ? x + w : x;
    const markerEdgeX = side === "left" ? marker.x : marker.x + marker.w;
    const markerTop = marker.y;
    const markerBottom = marker.y + marker.h;
    const pagePoints =
      Math.abs(cardCenterY - markerCenterY) < 1
        ? [
            { x: cardEdgeX, y: markerCenterY },
            { x: markerEdgeX, y: markerCenterY }
          ]
        : cardCenterY > markerTop && cardCenterY < markerBottom
          ? (() => {
              const midX = cardEdgeX + (markerEdgeX - cardEdgeX) / 2;
              return [
                { x: cardEdgeX, y: cardCenterY },
                { x: midX, y: cardCenterY },
                { x: midX, y: markerCenterY },
                { x: markerEdgeX, y: markerCenterY }
              ];
            })()
          : [
              { x: cardEdgeX, y: cardCenterY },
              { x: markerCenterX, y: cardCenterY },
              {
                x: markerCenterX,
                y: cardCenterY < markerCenterY ? markerTop : markerBottom
              }
            ];
    const connX = Math.min(...pagePoints.map((p) => p.x));
    const connY = Math.min(...pagePoints.map((p) => p.y));
    const connMaxX = Math.max(...pagePoints.map((p) => p.x));
    const connMaxY = Math.max(...pagePoints.map((p) => p.y));
    plan.push({
      kind: "connector",
      id: `designer-annotation-connector:${record.id}`,
      recordId: record.id,
      x: connX,
      y: connY,
      w: Math.max(1, connMaxX - connX),
      h: Math.max(1, connMaxY - connY),
      points: pagePoints.map((p) => ({ x: p.x - connX, y: p.y - connY }))
    });
  }

  return plan;
}
