"use client";

// Issue 08A — Designer Annotation side-card projection sync.
// Runtime records → card + connector shapes docked beside the parent Evidence
// Surface frame. Re-projects on the same triggers as the marker sync (seed
// surface create / move / resize / delete) plus annotations prop changes
// (body / section edits). Cards are projection-owned geometry (isLocked);
// `editing` is local UI state preserved across sync updates. Sync writes go
// through mergeRemoteChanges + ignoreShapeLock so the user-scoped store
// listener does not re-enter on its own corrections.

import { useEffect, useRef } from "react";
import { createShapeId, useEditor, type TLShapeId } from "tldraw";
import {
  SEED_REFERENCE_PROJECTION_TYPE,
  type SeedReferenceProjectionShape
} from "../seed-reference-projection-shape";
import { fitStructuralImageBox } from "../structural-overlay";
import {
  findSurfaceShapeForAnnotation,
  isAnnotationVisibleInStage,
  mediaBoxInPage,
  shouldResyncAnnotationsForStoreChanges
} from "./annotation-projection";
import {
  buildDesignerAnnotationCardPlan,
  type DesignerAnnotationCardPlan,
  type DesignerAnnotationConnectorPlan,
  type DesignerAnnotationProjectionPlan,
  type DesignerAnnotationSurfaceContext,
  type OccupiedBox
} from "./designer-annotation-card-projection";
import { measureDesignerAnnotationCardHeight } from "./designer-annotation-card-measure";
import {
  DESIGNER_ANNOTATION_CARD_TYPE,
  type DesignerAnnotationCardMeta,
  type DesignerAnnotationCardShape
} from "../designer-annotation-card-shape";
import {
  ALIGNMENT_CARD_TYPE,
  type AlignmentCardShape
} from "../alignment-card-shape";
import {
  isSeedReferenceProjectionShape,
  seedReferenceMetaMatchesSurfaceId
} from "../seed-reference-surface-match";
import type { AnnotationSurfaceShapeLike } from "./annotation-projection";
import {
  DESIGNER_ANNOTATION_CONNECTOR_TYPE,
  type DesignerAnnotationConnectorShape
} from "../designer-annotation-connector-shape";
import type { RegionAnnotationRecord } from "@/lib/runtime/region-annotation";

/** User Annotation green (Figma 670:891) — card border + dashed connector. */
const DESIGNER_ANNOTATION_GREEN = "#19d122";

/**
 * 07 alignment question cards dock in the same side lanes as designer
 * annotation cards (frame edge + gap). Seed each lane with their current
 * boxes so annotation cards stack around them instead of overlapping.
 */
function collectAlignmentLaneOccupied(
  editor: ReturnType<typeof useEditor>,
  seedShapes: AnnotationSurfaceShapeLike[]
): Map<string, OccupiedBox[]> {
  const occupied = new Map<string, OccupiedBox[]>();
  for (const shape of editor.getCurrentPageShapes()) {
    if (shape.type !== ALIGNMENT_CARD_TYPE) continue;
    const card = shape as AlignmentCardShape;
    const surfaceRecordId = card.meta?.surfaceRecordId;
    if (!surfaceRecordId) continue;
    const parent = seedShapes.find(
      (seed) =>
        isSeedReferenceProjectionShape(seed) &&
        seedReferenceMetaMatchesSurfaceId(seed.meta, surfaceRecordId)
    );
    if (!parent) continue;
    const laneKey = `${String(parent.id)}:${card.props.placement}`;
    const list = occupied.get(laneKey) ?? [];
    list.push({ y: card.y, h: card.props.h });
    occupied.set(laneKey, list);
  }
  return occupied;
}

function projectionMeta(
  plan: DesignerAnnotationProjectionPlan,
  record: RegionAnnotationRecord
): DesignerAnnotationCardMeta {
  return {
    canvasRecordId: plan.id,
    runtimeRecordId: plan.recordId,
    surfaceRecordId: record.surface_id ?? record.surface_artifact_id ?? ""
  };
}

function cardPropsEqual(
  shape: DesignerAnnotationCardShape,
  plan: DesignerAnnotationCardPlan
): boolean {
  const p = shape.props;
  return (
    shape.x === plan.x &&
    shape.y === plan.y &&
    p.w === plan.w &&
    p.h === plan.h &&
    p.body === plan.body &&
    p.section === (plan.section ?? "") &&
    p.anchorKind === plan.anchorKind &&
    p.placement === plan.placement
  );
}

function connectorPointsEqual(
  a: ReadonlyArray<{ x: number; y: number }>,
  b: ReadonlyArray<{ x: number; y: number }>
): boolean {
  return (
    a.length === b.length &&
    a.every((p, i) => p.x === b[i].x && p.y === b[i].y)
  );
}

function connectorPropsEqual(
  shape: DesignerAnnotationConnectorShape,
  plan: DesignerAnnotationConnectorPlan,
  color: string
): boolean {
  const p = shape.props;
  return (
    shape.x === plan.x &&
    shape.y === plan.y &&
    p.w === plan.w &&
    p.h === plan.h &&
    connectorPointsEqual(p.points, plan.points) &&
    p.color === color
  );
}

function syncDesignerAnnotationCardShapes(
  editor: ReturnType<typeof useEditor>,
  annotations: RegionAnnotationRecord[],
  currentStage: string
): void {
  const seedShapes = editor
    .getCurrentPageShapes()
    .filter((s) => s.type === SEED_REFERENCE_PROJECTION_TYPE);

  // Section scoping (08A): a designer annotation only appears in the section
  // it was written in; agent + legacy section-less records always show.
  const visible = annotations.filter((record) =>
    isAnnotationVisibleInStage(record, currentStage)
  );

  const resolveSurface = (
    record: RegionAnnotationRecord
  ): DesignerAnnotationSurfaceContext | null => {
    const parent = findSurfaceShapeForAnnotation(seedShapes, record);
    if (!parent) return null;
    const pageBounds = editor.getShapePageBounds(parent);
    if (!pageBounds) return null;
    const frame = {
      x: pageBounds.x,
      y: pageBounds.y,
      w: pageBounds.w,
      h: pageBounds.h
    };
    const mediaBox = mediaBoxInPage(frame.x, frame.y, frame.w, frame.h);
    if (mediaBox.w <= 0 || mediaBox.h <= 0) return null;
    const surfaceShape = parent as SeedReferenceProjectionShape;
    const imageBox =
      fitStructuralImageBox(mediaBox, {
        width: surfaceShape.props.naturalMediaW,
        height: surfaceShape.props.naturalMediaH
      }) ?? mediaBox;
    return {
      surfaceShapeId: String(parent.id),
      frame,
      mediaBox,
      imageBox
    };
  };

  const plan = buildDesignerAnnotationCardPlan({
    annotations: visible,
    resolveSurface,
    occupiedByLane: collectAlignmentLaneOccupied(editor, seedShapes),
    // Exact rendered heights (DOM probe inside the tldraw container), so
    // multiline / CJK bodies never clip inside the committed card.
    measureCardHeight: (body) =>
      measureDesignerAnnotationCardHeight(editor.getContainer(), body)
  });
  const recordById = new Map(visible.map((r) => [r.id, r]));

  const existingCards = editor
    .getCurrentPageShapes()
    .filter((s) => s.type === DESIGNER_ANNOTATION_CARD_TYPE)
    .map((s) => s as DesignerAnnotationCardShape);
  const existingConnectors = editor
    .getCurrentPageShapes()
    .filter((s) => s.type === DESIGNER_ANNOTATION_CONNECTOR_TYPE)
    .map((s) => s as DesignerAnnotationConnectorShape);
  const cardById = new Map(existingCards.map((s) => [String(s.id), s]));
  const connectorById = new Map(
    existingConnectors.map((s) => [String(s.id), s])
  );

  const wantCardIds = new Set<string>();
  const wantConnectorIds = new Set<string>();
  const creates: DesignerAnnotationProjectionPlan[] = [];
  const cardUpdates: Array<{
    shape: DesignerAnnotationCardShape;
    plan: DesignerAnnotationCardPlan;
  }> = [];
  const connectorUpdates: Array<{
    shape: DesignerAnnotationConnectorShape;
    plan: DesignerAnnotationConnectorPlan;
    color: string;
  }> = [];

  for (const item of plan) {
    const shapeId = String(createShapeId(item.id));
    if (item.kind === "card") {
      wantCardIds.add(shapeId);
      const current = cardById.get(shapeId);
      if (!current) {
        creates.push(item);
      } else if (!cardPropsEqual(current, item)) {
        cardUpdates.push({ shape: current, plan: item });
      }
    } else {
      wantConnectorIds.add(shapeId);
      const color = DESIGNER_ANNOTATION_GREEN;
      const current = connectorById.get(shapeId);
      if (!current) {
        creates.push(item);
      } else if (!connectorPropsEqual(current, item, color)) {
        connectorUpdates.push({ shape: current, plan: item, color });
      }
    }
  }

  const deleteIds: string[] = [];
  for (const shape of existingCards) {
    if (!wantCardIds.has(String(shape.id))) deleteIds.push(String(shape.id));
  }
  for (const shape of existingConnectors) {
    if (!wantConnectorIds.has(String(shape.id))) deleteIds.push(String(shape.id));
  }

  if (
    creates.length === 0 &&
    cardUpdates.length === 0 &&
    connectorUpdates.length === 0 &&
    deleteIds.length === 0
  ) {
    return;
  }

  editor.store.mergeRemoteChanges(() => {
    editor.run(
      () => {
        for (const item of creates) {
          const record = recordById.get(item.recordId);
          if (!record) continue;
          if (item.kind === "card") {
            editor.createShape<DesignerAnnotationCardShape>({
              id: createShapeId(item.id),
              type: DESIGNER_ANNOTATION_CARD_TYPE,
              x: item.x,
              y: item.y,
              isLocked: true,
              props: {
                w: item.w,
                h: item.h,
                body: item.body,
                section: item.section ?? "",
                anchorKind: item.anchorKind,
                placement: item.placement,
                editing: false
              },
              meta: projectionMeta(item, record)
            });
          } else {
            editor.createShape<DesignerAnnotationConnectorShape>({
              id: createShapeId(item.id),
              type: DESIGNER_ANNOTATION_CONNECTOR_TYPE,
              x: item.x,
              y: item.y,
              isLocked: true,
              props: {
                w: item.w,
                h: item.h,
                points: item.points,
                color: DESIGNER_ANNOTATION_GREEN
              },
              meta: projectionMeta(item, record)
            });
          }
        }
        for (const { shape, plan: cardPlan } of cardUpdates) {
          const record = recordById.get(cardPlan.recordId);
          if (!record) continue;
          // While the designer is editing in place, keep the live box size so
          // a projection refresh cannot shrink the form mid-keystroke and
          // reintroduce the multiline clip.
          const editing = shape.props.editing;
          editor.updateShape<DesignerAnnotationCardShape>({
            id: shape.id,
            type: DESIGNER_ANNOTATION_CARD_TYPE,
            x: editing ? shape.x : cardPlan.x,
            y: editing ? shape.y : cardPlan.y,
            isLocked: true,
            props: {
              w: cardPlan.w,
              h: editing ? Math.max(cardPlan.h, shape.props.h) : cardPlan.h,
              body: cardPlan.body,
              section: cardPlan.section ?? "",
              anchorKind: cardPlan.anchorKind,
              placement: cardPlan.placement,
              // Local UI state survives projection updates (alignment-card precedent).
              editing
            },
            meta: projectionMeta(cardPlan, record)
          });
        }
        for (const { shape, plan: connPlan, color } of connectorUpdates) {
          const record = recordById.get(connPlan.recordId);
          if (!record) continue;
          editor.updateShape<DesignerAnnotationConnectorShape>({
            id: shape.id,
            type: DESIGNER_ANNOTATION_CONNECTOR_TYPE,
            x: connPlan.x,
            y: connPlan.y,
            isLocked: true,
            props: {
              w: connPlan.w,
              h: connPlan.h,
              points: connPlan.points,
              color
            },
            meta: projectionMeta(connPlan, record)
          });
        }
        for (const id of deleteIds) {
          editor.deleteShape(id as TLShapeId);
        }
      },
      { ignoreShapeLock: true }
    );
  });
}

export function DesignerAnnotationCardSync({
  annotations,
  currentStage
}: {
  annotations: RegionAnnotationRecord[];
  /** Six-part stage currently in view — designer annotations are scoped to it. */
  currentStage: string;
}) {
  const editor = useEditor();
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  const stageRef = useRef(currentStage);
  stageRef.current = currentStage;

  useEffect(() => {
    if (!editor) return;
    syncDesignerAnnotationCardShapes(editor, annotations, currentStage);
  }, [editor, annotations, currentStage]);

  useEffect(() => {
    if (!editor) return;
    const unsub = editor.store.listen(
      (entry) => {
        if (!shouldResyncAnnotationsForStoreChanges(entry.changes)) return;
        syncDesignerAnnotationCardShapes(
          editor,
          annotationsRef.current,
          stageRef.current
        );
      },
      { source: "user", scope: "document" }
    );
    return () => unsub();
  }, [editor]);

  // Alignment question cards share the side lanes; when they appear / move /
  // resize (their sync writes via mergeRemoteChanges → source "all" needed),
  // re-stack annotation cards around them. Self-trigger is impossible: this
  // sync never writes alignment-card records.
  useEffect(() => {
    if (!editor) return;
    const touchesAlignmentCard = (
      changes: Parameters<typeof shouldResyncAnnotationsForStoreChanges>[0]
    ): boolean => {
      const isCard = (record: unknown): boolean =>
        !!record &&
        typeof record === "object" &&
        (record as { type?: unknown }).type === ALIGNMENT_CARD_TYPE;
      if (Object.values(changes.added).some(isCard)) return true;
      if (Object.values(changes.removed).some(isCard)) return true;
      return Object.values(changes.updated).some(
        ([from, to]) => isCard(from) || isCard(to)
      );
    };
    const unsub = editor.store.listen(
      (entry) => {
        if (!touchesAlignmentCard(entry.changes)) return;
        syncDesignerAnnotationCardShapes(
          editor,
          annotationsRef.current,
          stageRef.current
        );
      },
      { source: "all", scope: "document" }
    );
    return () => unsub();
  }, [editor]);

  return null;
}
