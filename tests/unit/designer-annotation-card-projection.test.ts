// Issue 08A — Designer Annotation side-card projection plan tests.
// Pure geometry: designer-only filter, left/right wing docking, collision
// stacking, connector geometry, height estimate, missing-surface skip.

import { describe, expect, test, vi } from "vitest";
import {
  buildDesignerAnnotationCardPlan,
  designerAnnotationCardHeight,
  DESIGNER_ANNOTATION_CARD_GAP,
  DESIGNER_ANNOTATION_CARD_STACK_GAP,
  DESIGNER_ANNOTATION_CARD_W,
  type DesignerAnnotationCardPlan,
  type DesignerAnnotationConnectorPlan,
  type DesignerAnnotationSurfaceContext
} from "../../components/workbench/projection/designer-annotation-card-projection";
import { createDeferredAlignmentLaneSync } from "../../components/workbench/projection/designer-annotation-card-sync";
import { computeAnnotationPagePlacement, isAnnotationVisibleInStage } from "../../components/workbench/projection/annotation-projection";
import type { RegionAnnotationRecord } from "../../lib/runtime/region-annotation";

function annotation(
  partial: Partial<RegionAnnotationRecord> & Pick<RegionAnnotationRecord, "id">
): RegionAnnotationRecord {
  return {
    surface_id: "surf-1",
    surface_artifact_id: "surf-1",
    surface_node_id: null,
    target_kind: "figma-region",
    target_evidence_version_id: "surf-1",
    target_node_id: null,
    current_evidence_version_id: "surf-1",
    current_node_id: null,
    current_rect_x: null,
    current_rect_y: null,
    current_rect_w: null,
    current_rect_h: null,
    correspondence_status: "not_applicable",
    stale: false,
    author: "designer",
    type: "designer_annotation",
    body: "note",
    section: "layout",
    rect_x: 0.1,
    rect_y: 0.2,
    rect_w: 0.3,
    rect_h: 0.4,
    primary_node_id: null,
    candidates_json: null,
    from_point: false,
    geometry_version: "v2_raw",
    created_at: "2026-01-01T00:00:00.000Z",
    ...partial
  };
}

const FRAME = { x: 80, y: 60, w: 440, h: 380 };
const MEDIA_BOX = { x: 100, y: 100, w: 400, h: 300 };

function surface(
  overrides: Partial<DesignerAnnotationSurfaceContext> = {}
): DesignerAnnotationSurfaceContext {
  return {
    surfaceShapeId: "shape:surface-1",
    frame: FRAME,
    mediaBox: MEDIA_BOX,
    imageBox: MEDIA_BOX,
    ...overrides
  };
}

function planFor(annotations: RegionAnnotationRecord[]) {
  return buildDesignerAnnotationCardPlan({
    annotations,
    resolveSurface: () => surface()
  });
}

function cardOf(
  plan: ReturnType<typeof planFor>,
  recordId: string
): DesignerAnnotationCardPlan {
  const card = plan.find(
    (p): p is DesignerAnnotationCardPlan =>
      p.kind === "card" && p.recordId === recordId
  );
  if (!card) throw new Error(`card for ${recordId} missing`);
  return card;
}

function connectorOf(
  plan: ReturnType<typeof planFor>,
  recordId: string
): DesignerAnnotationConnectorPlan {
  const connector = plan.find(
    (p): p is DesignerAnnotationConnectorPlan =>
      p.kind === "connector" && p.recordId === recordId
  );
  if (!connector) throw new Error(`connector for ${recordId} missing`);
  return connector;
}

function markerCenter(record: RegionAnnotationRecord) {
  const { pageRect } = computeAnnotationPagePlacement(
    record,
    MEDIA_BOX,
    MEDIA_BOX
  );
  return {
    x: pageRect.x + pageRect.w / 2,
    y: pageRect.y + pageRect.h / 2,
    rect: pageRect
  };
}

describe("deferred Alignment lane sync", () => {
  test("coalesces height and position events into one settled annotation reflow", () => {
    let flush: (() => void) | undefined;
    const schedule = vi.fn((callback: () => void) => {
      flush = callback;
    });
    const reflow = vi.fn();
    const deferred = createDeferredAlignmentLaneSync(reflow, schedule);

    deferred.request();
    deferred.request();

    expect(schedule).toHaveBeenCalledOnce();
    expect(reflow).not.toHaveBeenCalled();

    flush?.();

    expect(reflow).toHaveBeenCalledOnce();
  });
});

describe("designerAnnotationCardHeight", () => {
  test("clamps short bodies to the minimum", () => {
    expect(designerAnnotationCardHeight("")).toBe(50);
    expect(designerAnnotationCardHeight("hi")).toBe(50);
  });

  test("grows with wrapped lines", () => {
    const oneLine = designerAnnotationCardHeight("x".repeat(44));
    const threeLines = designerAnnotationCardHeight("x".repeat(44 * 3));
    expect(threeLines).toBeGreaterThan(oneLine);
  });

  test("counts explicit newlines", () => {
    const multi = designerAnnotationCardHeight("a\nb\nc");
    expect(multi).toBe(designerAnnotationCardHeight("x".repeat(44 * 3)));
  });

  test("clamps very long bodies to the maximum", () => {
    expect(designerAnnotationCardHeight("x".repeat(5000))).toBe(240);
  });

  test("CJK glyphs count double — 44 CJK chars estimate two lines, not one", () => {
    const cjk = designerAnnotationCardHeight("字".repeat(44));
    const latinOneLine = designerAnnotationCardHeight("x".repeat(44));
    expect(cjk).toBeGreaterThan(latinOneLine);
    expect(cjk).toBe(designerAnnotationCardHeight("x".repeat(88)));
  });
});

describe("isAnnotationVisibleInStage", () => {
  test("designer annotation only appears in its own section", () => {
    const record = annotation({ id: "a1", section: "layout" });
    expect(isAnnotationVisibleInStage(record, "layout")).toBe(true);
    expect(isAnnotationVisibleInStage(record, "design-concept")).toBe(false);
  });

  test("agent annotations are always visible (no section scoping)", () => {
    const record = annotation({ id: "a2", author: "agent", section: null });
    expect(isAnnotationVisibleInStage(record, "layout")).toBe(true);
    expect(isAnnotationVisibleInStage(record, "design-concept")).toBe(true);
  });

  test("legacy designer records without a section stay visible everywhere", () => {
    const record = annotation({ id: "a3", section: null });
    expect(isAnnotationVisibleInStage(record, "layout")).toBe(true);
    expect(isAnnotationVisibleInStage(record, "token")).toBe(true);
  });
});

describe("buildDesignerAnnotationCardPlan", () => {
  test("skips agent-authored annotations entirely", () => {
    const plan = planFor([
      annotation({ id: "ann-agent", author: "agent" }),
      annotation({ id: "ann-designer" })
    ]);
    expect(plan.filter((p) => p.recordId === "ann-agent")).toHaveLength(0);
    expect(plan.some((p) => p.recordId === "ann-designer")).toBe(true);
  });

  test("skips records whose surface is not resolvable", () => {
    const plan = buildDesignerAnnotationCardPlan({
      annotations: [annotation({ id: "ann-1" })],
      resolveSurface: () => null
    });
    expect(plan).toHaveLength(0);
  });

  test("emits card + connector with stable ids and record fields", () => {
    const record = annotation({
      id: "ann-1",
      body: "Move this toolbar 8px up",
      section: "visual-language",
      target_kind: "figma-node"
    });
    const plan = planFor([record]);
    const card = cardOf(plan, "ann-1");
    expect(card.id).toBe("designer-annotation-card:ann-1");
    expect(card.body).toBe("Move this toolbar 8px up");
    expect(card.section).toBe("visual-language");
    expect(card.anchorKind).toBe("figma-node");
    expect(card.surfaceShapeId).toBe("shape:surface-1");
    expect(card.w).toBe(DESIGNER_ANNOTATION_CARD_W);
    expect(connectorOf(plan, "ann-1").id).toBe(
      "designer-annotation-connector:ann-1"
    );
  });

  test("docks on the right wing when the marker sits right of media center", () => {
    const record = annotation({ id: "ann-r", rect_x: 0.7, rect_w: 0.1 });
    const card = cardOf(planFor([record]), "ann-r");
    expect(card.placement).toBe("right");
    expect(card.x).toBe(FRAME.x + FRAME.w + DESIGNER_ANNOTATION_CARD_GAP);
  });

  test("docks on the left wing when the marker sits left of media center", () => {
    const record = annotation({ id: "ann-l", rect_x: 0.05, rect_w: 0.1 });
    const card = cardOf(planFor([record]), "ann-l");
    expect(card.placement).toBe("left");
    expect(card.x).toBe(
      FRAME.x - DESIGNER_ANNOTATION_CARD_GAP - DESIGNER_ANNOTATION_CARD_W
    );
  });

  test("stacks colliding cards within the same lane", () => {
    const first = annotation({ id: "ann-1", rect_x: 0.05, rect_y: 0.2 });
    const second = annotation({ id: "ann-2", rect_x: 0.06, rect_y: 0.21 });
    const plan = planFor([first, second]);
    const card1 = cardOf(plan, "ann-1");
    const card2 = cardOf(plan, "ann-2");
    expect(card1.placement).toBe("left");
    expect(card2.placement).toBe("left");
    expect(card2.y).toBeGreaterThanOrEqual(
      card1.y + card1.h + DESIGNER_ANNOTATION_CARD_STACK_GAP
    );
  });

  test("separate surfaces get independent lanes (no cross-surface stacking)", () => {
    const first = annotation({ id: "ann-1", rect_x: 0.05, rect_y: 0.2 });
    const second = annotation({
      id: "ann-2",
      surface_id: "surf-2",
      rect_x: 0.06,
      rect_y: 0.21
    });
    const plan = buildDesignerAnnotationCardPlan({
      annotations: [first, second],
      resolveSurface: (record) =>
        surface({
          surfaceShapeId:
            record.surface_id === "surf-2"
              ? "shape:surface-2"
              : "shape:surface-1"
        })
    });
    const card1 = cardOf(plan, "ann-1");
    const card2 = cardOf(plan, "ann-2");
    // No collision resolution across lanes: both keep their desired Y.
    const desired2 = markerCenter(second).y - card2.h / 2;
    expect(card2.y).toBe(desired2);
    expect(card1.surfaceShapeId).toBe("shape:surface-1");
    expect(card2.surfaceShapeId).toBe("shape:surface-2");
  });

  function pagePointsOf(connector: DesignerAnnotationConnectorPlan) {
    return connector.points.map((p) => ({
      x: p.x + connector.x,
      y: p.y + connector.y
    }));
  }

  test("straight connector: card inner edge → marker's nearest edge at marker-center Y", () => {
    const record = annotation({ id: "ann-1", rect_x: 0.05, rect_y: 0.2 });
    const plan = planFor([record]);
    const card = cardOf(plan, "ann-1");
    const connector = connectorOf(plan, "ann-1");
    const marker = markerCenter(record);

    // No stacking pressure: the card centers on the marker row, so the
    // connector is a straight 2-point horizontal at the marker-center Y.
    expect(card.y + card.h / 2).toBe(marker.y);
    expect(connector.points).toHaveLength(2);
    const [p0, p1] = pagePointsOf(connector);
    expect(p0).toEqual({ x: card.x + card.w, y: marker.y });
    expect(p1).toEqual({ x: marker.rect.x, y: marker.y });

    // The path never enters the marker box — the connector shape would
    // otherwise steal tldraw hit-tests from clicks on the marker.
    expect(connector.x + connector.w).toBeLessThanOrEqual(marker.rect.x);
  });

  test("right-wing straight connector ends at the marker's right edge", () => {
    const record = annotation({ id: "ann-r", rect_x: 0.7, rect_w: 0.1 });
    const plan = planFor([record]);
    const card = cardOf(plan, "ann-r");
    const connector = connectorOf(plan, "ann-r");
    const marker = markerCenter(record);

    expect(card.placement).toBe("right");
    const markerEdge = marker.rect.x + marker.rect.w;
    const [p0, p1] = pagePointsOf(connector);
    expect(p0).toEqual({ x: card.x, y: marker.y });
    expect(p1).toEqual({ x: markerEdge, y: marker.y });
    expect(connector.x).toBe(markerEdge);
    expect(connector.x + connector.w).toBeLessThanOrEqual(
      card.x + DESIGNER_ANNOTATION_CARD_GAP
    );
  });

  test("card center inside the marker's span folds twice into the nearest vertical edge midpoint", () => {
    const first = annotation({ id: "ann-1", rect_x: 0.05, rect_y: 0.2 });
    const second = annotation({ id: "ann-2", rect_x: 0.06, rect_y: 0.21 });
    const plan = planFor([first, second]);
    const card2 = cardOf(plan, "ann-2");
    const connector = connectorOf(plan, "ann-2");
    const marker = markerCenter(second);

    // Card 2 was pushed down, but its center still overlaps the marker's
    // vertical span — a stub into the top/bottom edge would read as a kink.
    const cardCenterY = card2.y + card2.h / 2;
    expect(cardCenterY).toBeGreaterThan(marker.rect.y);
    expect(cardCenterY).toBeLessThan(marker.rect.y + marker.rect.h);
    expect(cardCenterY).not.toBe(marker.y);

    // Two folds: out at the card's center height, across the gap midpoint,
    // then into the marker's nearest vertical edge midpoint.
    expect(connector.points).toHaveLength(4);
    const cardEdgeX = card2.x + card2.w;
    const markerEdgeX = marker.rect.x;
    const midX = cardEdgeX + (markerEdgeX - cardEdgeX) / 2;
    const [p0, p1, p2, p3] = pagePointsOf(connector);
    expect(p0).toEqual({ x: cardEdgeX, y: cardCenterY });
    expect(p1).toEqual({ x: midX, y: cardCenterY });
    expect(p2).toEqual({ x: midX, y: marker.y });
    expect(p3).toEqual({ x: markerEdgeX, y: marker.y });

    // Bounding box covers the whole polyline.
    expect(connector.x).toBe(Math.min(p0.x, p1.x, p2.x, p3.x));
    expect(connector.y).toBe(Math.min(p0.y, p1.y, p2.y, p3.y));
  });

  test("card stacked fully off the marker's span elbows into its horizontal edge (Figma 674-906)", () => {
    const record = annotation({ id: "ann-low", rect_x: 0.05, rect_h: 0.05 });
    const marker = markerCenter(record);
    const plan = buildDesignerAnnotationCardPlan({
      annotations: [record],
      resolveSurface: () => surface(),
      occupiedByLane: new Map([
        ["shape:surface-1:left", [{ y: marker.rect.y - 20, h: 100 }]]
      ])
    });
    const card = cardOf(plan, "ann-low");
    const connector = connectorOf(plan, "ann-low");

    // Card center is below the marker's whole span → single elbow down into
    // the marker's bottom edge at its center X.
    const cardCenterY = card.y + card.h / 2;
    expect(cardCenterY).toBeGreaterThan(marker.rect.y + marker.rect.h);
    expect(connector.points).toHaveLength(3);
    const [p0, p1, p2] = pagePointsOf(connector);
    expect(p0).toEqual({ x: card.x + card.w, y: cardCenterY });
    expect(p1).toEqual({ x: marker.x, y: cardCenterY });
    expect(p2).toEqual({ x: marker.x, y: marker.rect.y + marker.rect.h });
  });

  test("stacks below lane boxes occupied by other card families (07 agent question cards)", () => {
    const record = annotation({ id: "ann-1", rect_x: 0.05, rect_y: 0.2 });
    const marker = markerCenter(record);
    const occupiedY = marker.y - 25;
    const plan = buildDesignerAnnotationCardPlan({
      annotations: [record],
      resolveSurface: () => surface(),
      occupiedByLane: new Map([
        ["shape:surface-1:left", [{ y: occupiedY, h: 60 }]]
      ])
    });
    const card = cardOf(plan, "ann-1");
    // Desired Y collides with the occupied box → pushed below it + stack gap.
    expect(card.y).toBe(occupiedY + 60 + DESIGNER_ANNOTATION_CARD_STACK_GAP);
    // …and its connector elbows back up to the marker.
    expect(connectorOf(plan, "ann-1").points).toHaveLength(3);
  });

  test("other lanes' occupied boxes do not affect this lane", () => {
    const record = annotation({ id: "ann-1", rect_x: 0.05, rect_y: 0.2 });
    const marker = markerCenter(record);
    const plan = buildDesignerAnnotationCardPlan({
      annotations: [record],
      resolveSurface: () => surface(),
      occupiedByLane: new Map([
        ["shape:surface-1:right", [{ y: marker.y - 100, h: 300 }]]
      ])
    });
    const card = cardOf(plan, "ann-1");
    expect(card.y).toBe(marker.y - card.h / 2);
  });

  test("uses the injected measureCardHeight for card and stacking geometry", () => {
    const first = annotation({ id: "ann-1", rect_x: 0.05, rect_y: 0.2 });
    const second = annotation({ id: "ann-2", rect_x: 0.06, rect_y: 0.21 });
    const plan = buildDesignerAnnotationCardPlan({
      annotations: [first, second],
      resolveSurface: () => surface(),
      measureCardHeight: () => 123
    });
    const card1 = cardOf(plan, "ann-1");
    const card2 = cardOf(plan, "ann-2");
    expect(card1.h).toBe(123);
    expect(card2.h).toBe(123);
    // Stacking uses the measured height, not the unit-count estimate.
    expect(card2.y).toBeGreaterThanOrEqual(
      card1.y + 123 + DESIGNER_ANNOTATION_CARD_STACK_GAP
    );
  });

  test("legacy records without a section plan with section null", () => {
    const card = cardOf(
      planFor([annotation({ id: "ann-legacy", section: null })]),
      "ann-legacy"
    );
    expect(card.section).toBeNull();
  });
});
