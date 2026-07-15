"use client";

import { useEffect, useRef } from "react";
import { createShapeId, useEditor, type Editor, type TLShapeId } from "tldraw";

import {
  ALIGNMENT_CARD_TYPE,
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
      props: {
        ...shape.props,
        focusSelectionJson: shape.props.focusSelection
          ? JSON.stringify(shape.props.focusSelection)
          : ""
      }
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
    const expanded = current?.props.expanded ?? false;
    const editing = current?.props.editing ?? false;
    editor.updateShape<AlignmentCardShape>({
      id,
      type: ALIGNMENT_CARD_TYPE,
      x: shape.x,
      y: shape.y,
      isLocked: true,
      meta: shape.meta,
      props: {
        ...shape.props,
        w: expanded ? 360 : 320,
        expanded,
        editing,
        focusSelectionJson: shape.props.focusSelection
          ? JSON.stringify(shape.props.focusSelection)
          : ""
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
  records: Omit<AlignmentProjectionInput, "seedFrames">
) {
  const plan = buildAlignmentProjectionPlan({
    ...records,
    seedFrames: seedFramesFromEditor(editor)
  });
  const wantedIds = new Set(plan.map((shape) => String(tldrawId(shape))));
  const existing = editor
    .getCurrentPageShapes()
    .filter((shape) => ALIGNMENT_TYPES.has(shape.type));

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
  questions,
  annotations
}: {
  currentStage: AlignmentStageId;
  questions: AlignmentQuestionCardRecord[];
  annotations: AlignmentAgentAnnotationRecord[];
}) {
  const editor = useEditor();
  const recordsRef = useRef({ currentStage, questions, annotations });
  recordsRef.current = { currentStage, questions, annotations };

  useEffect(() => {
    syncAlignmentProjectionShapes(editor, { currentStage, questions, annotations });
  }, [editor, currentStage, questions, annotations]);

  useEffect(() => {
    return editor.store.listen(
      () => syncAlignmentProjectionShapes(editor, recordsRef.current),
      { source: "user", scope: "document" }
    );
  }, [editor]);

  return null;
}
