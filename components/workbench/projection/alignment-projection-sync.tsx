"use client";

import { useEffect, useRef } from "react";
import { createShapeId, useEditor, type Editor, type TLShapeId } from "tldraw";

import {
  ALIGNMENT_CARD_TYPE,
  alignmentCardWidth,
  alignmentCardXForWidth,
  type AlignmentCardShape
} from "../alignment-card-shape";
import {
  ALIGNMENT_CONNECTOR_TYPE,
  type AlignmentConnectorShape
} from "../alignment-connector-shape";
import { SEED_REFERENCE_PROJECTION_TYPE } from "../seed-reference-projection-shape";
import type { AlignmentStageId } from "../alignment-stage-panel";
import { mediaBoxInPage } from "../region-annotation-geometry";
import {
  ALIGNMENT_TARGET_TYPE,
  type AlignmentTargetShape
} from "../alignment-target-shape";
import {
  buildAlignmentProjectionPlan,
  type AlignmentAgentAnnotationRecord,
  type AlignmentCardProjection,
  type AlignmentProjectionInput,
  type AlignmentProjectionShape,
  type AlignmentQuestionCardRecord,
  type AlignmentSeedFrame
} from "./alignment-projection";

const ALIGNMENT_TYPES = new Set<string>([
  ALIGNMENT_CARD_TYPE,
  ALIGNMENT_TARGET_TYPE,
  ALIGNMENT_CONNECTOR_TYPE
]);

type AlignmentStoreRecordsDiff = {
  added: Record<string, unknown>;
  removed: Record<string, unknown>;
  updated: Record<string, readonly [unknown, unknown]>;
};

type AlignmentCardLikeRecord = {
  type?: unknown;
  y?: unknown;
  props?: { cardKind?: unknown; h?: unknown };
  meta?: { runtimeRecordId?: unknown };
};

function asAlignmentCardLike(record: unknown): AlignmentCardLikeRecord | null {
  return record && typeof record === "object"
    ? (record as AlignmentCardLikeRecord)
    : null;
}

function isQuestionCardRecord(record: unknown): boolean {
  const candidate = asAlignmentCardLike(record);
  return (
    candidate?.type === ALIGNMENT_CARD_TYPE &&
    candidate.props?.cardKind === "question"
  );
}

/** Pure seam: DOM-measured Question Card heights carried by tldraw shapes. */
export function collectMeasuredQuestionHeights(
  shapes: readonly unknown[]
): ReadonlyMap<string, number> {
  const heights = new Map<string, number>();
  for (const shape of shapes) {
    const candidate = asAlignmentCardLike(shape);
    const runtimeRecordId = candidate?.meta?.runtimeRecordId;
    const h = candidate?.props?.h;
    if (
      !isQuestionCardRecord(shape) ||
      typeof runtimeRecordId !== "string" ||
      typeof h !== "number" ||
      !Number.isFinite(h) ||
      h <= 0
    ) {
      continue;
    }
    heights.set(runtimeRecordId, h);
  }
  return heights;
}

/** Preserve the visible top edge while an open/collapse measurement reflows its lane. */
export function collectQuestionCardTopPositions(
  shapes: readonly unknown[],
  runtimeRecordIds?: ReadonlySet<string>
): ReadonlyMap<string, number> {
  const positions = new Map<string, number>();
  for (const shape of shapes) {
    const candidate = asAlignmentCardLike(shape);
    const runtimeRecordId = candidate?.meta?.runtimeRecordId;
    const y = candidate?.y;
    if (
      !isQuestionCardRecord(shape) ||
      typeof runtimeRecordId !== "string" ||
      (runtimeRecordIds !== undefined && !runtimeRecordIds.has(runtimeRecordId)) ||
      typeof y !== "number" ||
      !Number.isFinite(y)
    ) {
      continue;
    }
    positions.set(runtimeRecordId, y);
  }
  return positions;
}

/** Question records whose own height changed in this transaction. */
export function questionCardRuntimeIdsWithHeightChanges(
  changes: AlignmentStoreRecordsDiff
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const [from, to] of Object.values(changes.updated)) {
    if (!isQuestionCardRecord(from) && !isQuestionCardRecord(to)) continue;
    const changed =
      asAlignmentCardLike(from)?.props?.h !==
      asAlignmentCardLike(to)?.props?.h;
    if (!changed) continue;
    const runtimeRecordId =
      asAlignmentCardLike(to)?.meta?.runtimeRecordId ??
      asAlignmentCardLike(from)?.meta?.runtimeRecordId;
    if (typeof runtimeRecordId === "string") ids.add(runtimeRecordId);
  }
  return ids;
}

/** Reflow only for a true Question Card height delta, avoiding sync loops. */
export function shouldResyncAlignmentForQuestionHeightChanges(
  changes: AlignmentStoreRecordsDiff
): boolean {
  return questionCardRuntimeIdsWithHeightChanges(changes).size > 0;
}

function seedFramesFromEditor(editor: Editor): AlignmentSeedFrame[] {
  return editor
    .getCurrentPageShapes()
    .filter((shape) => shape.type === SEED_REFERENCE_PROJECTION_TYPE)
    .flatMap((shape) => {
      const bounds = editor.getShapePageBounds(shape);
      const meta = shape.meta as Record<string, unknown>;
      if (!bounds || typeof meta.runtimeRecordId !== "string") return [];
      const media = mediaBoxInPage(bounds.x, bounds.y, bounds.w, bounds.h);
      return [
        {
          id: String(shape.id),
          x: bounds.x,
          y: bounds.y,
          w: bounds.w,
          h: bounds.h,
          mediaX: media.x,
          mediaY: media.y,
          mediaW: media.w,
          mediaH: media.h,
          meta: {
            runtimeRecordId: meta.runtimeRecordId,
            ...(typeof meta.seedRecordId === "string"
              ? { seedRecordId: meta.seedRecordId }
              : {}),
            ...(typeof meta.surfaceRecordId === "string"
              ? { surfaceRecordId: meta.surfaceRecordId }
              : {})
          }
        }
      ];
    });
}

function tldrawId(shape: AlignmentProjectionShape): TLShapeId {
  return createShapeId(shape.id);
}

export function alignmentCardShapeProps(
  props: AlignmentCardProjection["props"]
): AlignmentCardShape["props"] {
  const { answerOptions, focusSelection, ...shapeProps } = props;
  return {
    ...shapeProps,
    answerOptionsJson: JSON.stringify(answerOptions),
    focusSelectionJson: focusSelection ? JSON.stringify(focusSelection) : ""
  };
}

function createProjectedShape(editor: Editor, shape: AlignmentProjectionShape) {
  const id = tldrawId(shape);
  if (shape.type === ALIGNMENT_CARD_TYPE) {
    editor.createShape<AlignmentCardShape>({
      id,
      type: ALIGNMENT_CARD_TYPE,
      x: shape.x,
      y: shape.y,
      isLocked: true,
      meta: shape.meta,
      props: alignmentCardShapeProps(shape.props)
    });
  } else if (shape.type === ALIGNMENT_TARGET_TYPE) {
    editor.createShape<AlignmentTargetShape>({
      id,
      type: ALIGNMENT_TARGET_TYPE,
      x: shape.x,
      y: shape.y,
      isLocked: true,
      meta: shape.meta,
      props: shape.props
    });
  } else {
    editor.createShape<AlignmentConnectorShape>({
      id,
      type: ALIGNMENT_CONNECTOR_TYPE,
      x: shape.x,
      y: shape.y,
      isLocked: true,
      meta: shape.meta,
      props: shape.props
    });
  }
}

function updateProjectedShape(editor: Editor, shape: AlignmentProjectionShape) {
  const id = tldrawId(shape);
  if (shape.type === ALIGNMENT_CARD_TYPE) {
    const current = editor.getShape<AlignmentCardShape>(id);
    const expanded =
      shape.props.cardKind === "question" && shape.props.readOnly
        ? false
        : current?.props.expanded ?? false;
    const editing = current?.props.editing ?? false;
    const expandedWidth = alignmentCardWidth(
      shape.props.cardKind,
      expanded || editing
    );
    editor.updateShape<AlignmentCardShape>({
      id,
      type: ALIGNMENT_CARD_TYPE,
      x: alignmentCardXForWidth(
        shape.x,
        shape.props.w,
        expandedWidth,
        shape.props.placement
      ),
      y: shape.y,
      isLocked: true,
      meta: shape.meta,
      props: {
        ...alignmentCardShapeProps(shape.props),
        w: expandedWidth,
        expanded,
        editing
      }
    });
  } else if (shape.type === ALIGNMENT_TARGET_TYPE) {
    editor.updateShape<AlignmentTargetShape>({
      id,
      type: ALIGNMENT_TARGET_TYPE,
      x: shape.x,
      y: shape.y,
      isLocked: true,
      meta: shape.meta,
      props: shape.props
    });
  } else {
    editor.updateShape<AlignmentConnectorShape>({
      id,
      type: ALIGNMENT_CONNECTOR_TYPE,
      x: shape.x,
      y: shape.y,
      isLocked: true,
      meta: shape.meta,
      props: shape.props
    });
  }
}

export function syncAlignmentProjectionShapes(
  editor: Editor,
  records: Omit<AlignmentProjectionInput, "seedFrames">,
  options: { preserveQuestionTopRuntimeIds?: ReadonlySet<string> } = {}
) {
  const currentShapes = editor.getCurrentPageShapes();
  const plan = buildAlignmentProjectionPlan({
    ...records,
    seedFrames: seedFramesFromEditor(editor),
    measuredQuestionHeights: collectMeasuredQuestionHeights(currentShapes),
    ...(options.preserveQuestionTopRuntimeIds
      ? {
          currentQuestionTopPositions:
            collectQuestionCardTopPositions(
              currentShapes,
              options.preserveQuestionTopRuntimeIds
            )
        }
      : {})
  });
  const wantedIds = new Set(plan.map((shape) => String(tldrawId(shape))));
  const existing = currentShapes.filter((shape) => ALIGNMENT_TYPES.has(shape.type));

  editor.store.mergeRemoteChanges(() => {
    editor.run(
      () => {
        for (const shape of plan) {
          if (editor.getShape(tldrawId(shape))) updateProjectedShape(editor, shape);
          else createProjectedShape(editor, shape);
        }
        for (const shape of existing) {
          if (!wantedIds.has(String(shape.id))) editor.deleteShape(shape.id);
        }
      },
      { ignoreShapeLock: true }
    );
  });
}

export function AlignmentProjectionSync({
  currentStage,
  readOnly,
  questions,
  annotations
}: {
  currentStage: AlignmentStageId;
  readOnly: boolean;
  questions: AlignmentQuestionCardRecord[];
  annotations: AlignmentAgentAnnotationRecord[];
}) {
  const editor = useEditor();
  const recordsRef = useRef({ currentStage, readOnly, questions, annotations });
  recordsRef.current = { currentStage, readOnly, questions, annotations };

  useEffect(() => {
    syncAlignmentProjectionShapes(editor, { currentStage, readOnly, questions, annotations });
  }, [editor, currentStage, readOnly, questions, annotations]);

  useEffect(() => {
    return editor.store.listen(
      () => syncAlignmentProjectionShapes(editor, recordsRef.current),
      { source: "user", scope: "document" }
    );
  }, [editor]);

  useEffect(() => {
    return editor.store.listen(
      (entry) => {
        const changedQuestionIds =
          questionCardRuntimeIdsWithHeightChanges(entry.changes);
        if (changedQuestionIds.size === 0) return;
        syncAlignmentProjectionShapes(editor, recordsRef.current, {
          preserveQuestionTopRuntimeIds: changedQuestionIds
        });
      },
      { source: "all", scope: "document" }
    );
  }, [editor]);

  return null;
}
