// Pure Runtime-record -> tldraw projection planning for Design Intent Alignment.
// Runtime types are intentionally adapted here: the canvas domain does not
// depend on the still-evolving Runtime module exports.

import type { AlignmentStageId } from "../alignment-stage-panel";
import type { FocusCardSelection } from "../focus-mode";
import type { AnswerOption } from "@/components/runtime/alignment-answer-contract";
import {
  expandAgentRegionRect,
  expandFocusHoleRect
} from "@/lib/runtime/region-annotation-display";

export type AlignmentTargetRect = {
  x: number;
  y: number;
  w?: number;
  h?: number;
  width?: number;
  height?: number;
};

export type AlignmentEvidenceTarget = {
  kind?: "surface" | "node" | "region";
  seedReferenceId: string;
  evidenceSurfaceId: string;
  evidenceVersionId: string;
  nodeId?: string;
  rect?: AlignmentTargetRect;
  resolvedRect?: AlignmentTargetRect;
};

export type AlignmentAnchor =
  | { kind: "single"; target: AlignmentEvidenceTarget }
  | { kind: "focus-target-set"; targets: AlignmentEvidenceTarget[] };

export type AlignmentQuestionCardRecord = {
  id: string;
  section: AlignmentStageId;
  observation: string;
  question: string;
  answer_options?: readonly AnswerOption[] | null;
  proposed_answer: string | null;
  final_answer: string | null;
  selected_option_id?: string | null;
  answer_source:
    | "designer-edited"
    | "agent-proposed-designer-accepted"
    | null;
  anchor: AlignmentAnchor;
};

export type AlignmentAgentAnnotationRecord = {
  id: string;
  section: AlignmentStageId | null;
  title: string;
  body: string;
  additional_information: string[];
  anchor: AlignmentAnchor;
};

export type AlignmentSeedFrame = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Fitted Evidence Surface media box; defaults to the frame bounds in tests/adapters. */
  mediaX?: number;
  mediaY?: number;
  mediaW?: number;
  mediaH?: number;
  meta: {
    runtimeRecordId: string;
    seedRecordId?: string;
    surfaceRecordId?: string;
  };
};

export type AlignmentProjectionInput = {
  currentStage: AlignmentStageId;
  readOnly: boolean;
  questions: AlignmentQuestionCardRecord[];
  annotations: AlignmentAgentAnnotationRecord[];
  seedFrames: AlignmentSeedFrame[];
  /** DOM-measured heights keyed by Runtime Question Card id. */
  measuredQuestionHeights?: ReadonlyMap<string, number>;
  /** Existing canvas tops used only while reflowing an interactive height change. */
  currentQuestionTopPositions?: ReadonlyMap<string, number>;
};

export type AlignmentProjectionMeta = {
  canvasRecordId: string;
  runtimeRecordId: string;
  surface: "design-intent-alignment";
  seedReferenceId: string;
  surfaceRecordId: string;
  evidenceVersionId: string;
  nodeId?: string;
};

export type AlignmentCardProjection = {
  type: "alignment-card";
  id: string;
  x: number;
  y: number;
  isLocked: true;
  meta: AlignmentProjectionMeta;
  props: {
    w: number;
    h: number;
    placement: "left" | "right";
    cardKind: "question" | "agent-annotation";
    stage: AlignmentStageId;
    number: number;
    observation: string;
    question: string;
    answerOptions: readonly AnswerOption[];
    proposedAnswer: string;
    finalAnswer: string;
    selectedOptionId: string;
    answerSource: string;
    title: string;
    body: string;
    additionalInformationJson: string;
    evidenceAnchor: string;
    expanded: boolean;
    editing: boolean;
    readOnly: boolean;
    focusSelection: FocusCardSelection | null;
  };
};

export type AlignmentTargetProjection = {
  type: "alignment-target";
  id: string;
  x: number;
  y: number;
  isLocked: true;
  meta: AlignmentProjectionMeta;
  props: {
    w: number;
    h: number;
    stage: AlignmentStageId;
  };
};

export type AlignmentConnectorProjection = {
  type: "alignment-connector";
  id: string;
  x: number;
  y: number;
  isLocked: true;
  meta: AlignmentProjectionMeta;
  props: {
    w: number;
    h: number;
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    stage: AlignmentStageId;
  };
};

export type AlignmentProjectionShape =
  | AlignmentCardProjection
  | AlignmentTargetProjection
  | AlignmentConnectorProjection;

export const ALIGNMENT_CARD_COLLAPSED_W = 320;
export const ALIGNMENT_CARD_EXPANDED_W = 360;
export const ALIGNMENT_QUESTION_CARD_W = 360;
export const ALIGNMENT_CARD_SEED_GAP = 20;
export const ALIGNMENT_CARD_STACK_GAP = 12;
export const ALIGNMENT_QUESTION_CARD_H = 236;
export const ALIGNMENT_ANNOTATION_CARD_H = 180;

/**
 * Keep the established canvas rhythm after a Question Card collapses. The DOM
 * height still drives its rendered box and connector center, while the shared
 * Question/Annotation lane never reserves less than the original card height.
 */
export function alignmentCardLaneFootprintHeight(
  cardKind: "question" | "agent-annotation",
  renderedHeight: number
): number {
  return cardKind === "question"
    ? Math.max(ALIGNMENT_QUESTION_CARD_H, renderedHeight)
    : renderedHeight;
}

type CardCollisionBox = { y: number; h: number };

function resolveCardCollisionY(
  desiredY: number,
  h: number,
  occupied: readonly CardCollisionBox[]
): number {
  let y = desiredY;
  for (const box of [...occupied].sort((a, b) => a.y - b.y)) {
    const overlaps =
      y < box.y + box.h + ALIGNMENT_CARD_STACK_GAP &&
      y + h + ALIGNMENT_CARD_STACK_GAP > box.y;
    if (overlaps) y = box.y + box.h + ALIGNMENT_CARD_STACK_GAP;
  }
  return y;
}

const STAGE_COLORS: Record<AlignmentStageId, string> = {
  "design-concept": "#c97759",
  "visual-language": "#4178ba",
  token: "#be5fde",
  layout: "#dc3a91",
  component: "#3db0ac",
  interaction: "#b8c807"
};

function firstTarget(anchor: AlignmentAnchor): AlignmentEvidenceTarget | undefined {
  return anchor.kind === "single" ? anchor.target : anchor.targets[0];
}

function frameForTarget(
  frames: AlignmentSeedFrame[],
  target: AlignmentEvidenceTarget
): AlignmentSeedFrame | undefined {
  return frames.find(
    (frame) =>
      frame.meta.seedRecordId === target.seedReferenceId ||
      frame.meta.runtimeRecordId === target.seedReferenceId
  );
}

function rectForTarget(target: AlignmentEvidenceTarget) {
  const rect = target.resolvedRect ?? target.rect;
  if (!rect) return null;
  const w = rect.w ?? rect.width;
  const h = rect.h ?? rect.height;
  if (w == null || h == null || w <= 0 || h <= 0) return null;
  return { x: rect.x, y: rect.y, w, h };
}

function metaFor(
  recordId: string,
  canvasRecordId: string,
  target: AlignmentEvidenceTarget
): AlignmentProjectionMeta {
  return {
    canvasRecordId,
    runtimeRecordId: recordId,
    surface: "design-intent-alignment",
    seedReferenceId: target.seedReferenceId,
    surfaceRecordId: target.evidenceSurfaceId,
    evidenceVersionId: target.evidenceVersionId,
    ...(target.nodeId ? { nodeId: target.nodeId } : {})
  };
}

function focusSelectionFor(
  cardId: string,
  anchor: AlignmentAnchor,
  frames: AlignmentSeedFrame[]
): FocusCardSelection | null {
  if (anchor.kind !== "focus-target-set") return null;
  return {
    cardId,
    targets: anchor.targets.flatMap((target, index) => {
      const rect = rectForTarget(target);
      if (!rect) return [];
      const frame = frameForTarget(frames, target);
      const mediaW = frame?.mediaW ?? frame?.w;
      const mediaH = frame?.mediaH ?? frame?.h;
      const displayRect =
        mediaW && mediaH && mediaW > 0 && mediaH > 0
          ? expandFocusHoleRect(rect, { w: mediaW, h: mediaH })
          : rect;
      return [
        {
          targetId: `${cardId}:${index}`,
          surfaceArtifactId: target.evidenceSurfaceId,
          evidenceVersionId: target.evidenceVersionId,
          rect: {
            x: displayRect.x,
            y: displayRect.y,
            width: displayRect.w,
            height: displayRect.h
          }
        }
      ];
    })
  };
}

function evidenceLabel(target: AlignmentEvidenceTarget): string {
  return target.nodeId
    ? `Figma node ${target.nodeId}`
    : `Evidence ${target.evidenceVersionId}`;
}

export function stageColor(stage: AlignmentStageId): string {
  return STAGE_COLORS[stage];
}

/**
 * Build a deterministic projection. Cards are grouped by their first target's
 * Seed Reference and stacked vertically to its right. Missing Seed frames are
 * skipped until their Evidence Surface projection exists.
 */
export function buildAlignmentProjectionPlan(
  input: AlignmentProjectionInput
): AlignmentProjectionShape[] {
  const plan: AlignmentProjectionShape[] = [];
  const nextYByLane = new Map<string, number>();
  const occupiedCardsByLane = new Map<string, CardCollisionBox[]>();
  const visibleCards: Array<
    | { kind: "question"; record: AlignmentQuestionCardRecord; number: number }
    | {
        kind: "agent-annotation";
        record: AlignmentAgentAnnotationRecord;
        number: number;
      }
  > = [
    ...input.annotations
      .filter((record) => record.section === input.currentStage)
      .map((record) => ({
        kind: "agent-annotation" as const,
        record,
        number: 0
      })),
    ...input.questions
      .filter((record) => record.section === input.currentStage)
      .map((record) => ({
        kind: "question" as const,
        record,
        number: 0
      }))
  ].map((item, index) => ({ ...item, number: index + 1 }));

  for (const item of visibleCards) {
    const target = firstTarget(item.record.anchor);
    if (!target) continue;
    const frame = frameForTarget(input.seedFrames, target);
    if (!frame) continue;
    const measuredQuestionHeight =
      item.kind === "question"
        ? input.measuredQuestionHeights?.get(item.record.id)
        : undefined;
    const h =
      item.kind === "question"
        ? typeof measuredQuestionHeight === "number" &&
          Number.isFinite(measuredQuestionHeight) &&
          measuredQuestionHeight > 0
          ? measuredQuestionHeight
          : ALIGNMENT_QUESTION_CARD_H
        : ALIGNMENT_ANNOTATION_CARD_H;
    const w =
      item.kind === "question"
        ? ALIGNMENT_QUESTION_CARD_W
        : ALIGNMENT_CARD_COLLAPSED_W;
    const laneFootprintH = alignmentCardLaneFootprintHeight(item.kind, h);
    const cardId = `alignment-card:${item.record.id}`;
    const stage =
      item.kind === "question"
        ? item.record.section
        : item.record.section ?? input.currentStage;
    const rect =
      item.record.anchor.kind === "single" &&
      target.kind !== "surface"
        ? rectForTarget(target)
        : null;
    const mediaX = frame.mediaX ?? frame.x;
    const mediaY = frame.mediaY ?? frame.y;
    const mediaW = frame.mediaW ?? frame.w;
    const mediaH = frame.mediaH ?? frame.h;
    // Alignment targets are Agent-authored evidence callouts. Keep the
    // Runtime anchor rect raw for auditability, but add the same page-isotropic
    // comfort margin used by Agent Region Annotations at projection time.
    const displayRect = rect
      ? expandAgentRegionRect(rect, { w: mediaW, h: mediaH })
      : null;
    const targetGeometry = displayRect
      ? {
          x: mediaX + displayRect.x * mediaW,
          y: mediaY + displayRect.y * mediaH,
          w: displayRect.w * mediaW,
          h: displayRect.h * mediaH
        }
      : null;
    const placement =
      targetGeometry &&
      targetGeometry.x + targetGeometry.w / 2 <
        mediaX + mediaW / 2
        ? "left"
        : "right";
    const laneId = `${frame.id}:${placement}`;
    const fallbackY = nextYByLane.get(laneId) ?? frame.y;
    const currentQuestionTop =
      item.kind === "question"
        ? input.currentQuestionTopPositions?.get(item.record.id)
        : undefined;
    const desiredY =
      typeof currentQuestionTop === "number" &&
      Number.isFinite(currentQuestionTop)
        ? currentQuestionTop
        : targetGeometry
          ? targetGeometry.y + targetGeometry.h / 2 - h / 2
          : fallbackY;
    const occupied = occupiedCardsByLane.get(laneId) ?? [];
    const y = resolveCardCollisionY(desiredY, laneFootprintH, occupied);
    const card: AlignmentCardProjection = {
      type: "alignment-card",
      id: cardId,
      x:
        placement === "left"
          ? frame.x - ALIGNMENT_CARD_SEED_GAP - w
          : frame.x + frame.w + ALIGNMENT_CARD_SEED_GAP,
      y,
      isLocked: true,
      meta: metaFor(item.record.id, cardId, target),
      props: {
        w,
        h,
        placement,
        cardKind: item.kind,
        stage,
        number: item.number,
        observation: item.kind === "question" ? item.record.observation : "",
        question: item.kind === "question" ? item.record.question : "",
        answerOptions:
          item.kind === "question" ? item.record.answer_options ?? [] : [],
        proposedAnswer:
          item.kind === "question" ? item.record.proposed_answer ?? "" : "",
        finalAnswer:
          item.kind === "question" ? item.record.final_answer ?? "" : "",
        selectedOptionId:
          item.kind === "question" ? item.record.selected_option_id ?? "" : "",
        answerSource:
          item.kind === "question" ? item.record.answer_source ?? "" : "",
        title: item.kind === "agent-annotation" ? item.record.title : "",
        body: item.kind === "agent-annotation" ? item.record.body : "",
        additionalInformationJson:
          item.kind === "agent-annotation"
            ? JSON.stringify(item.record.additional_information)
            : "[]",
        evidenceAnchor: evidenceLabel(target),
        expanded: false,
        editing: false,
        readOnly: input.readOnly,
        focusSelection: focusSelectionFor(
          item.record.id,
          item.record.anchor,
          input.seedFrames
        )
      }
    };
    plan.push(card);
    occupied.push({ y, h: laneFootprintH });
    occupiedCardsByLane.set(laneId, occupied);
    nextYByLane.set(
      laneId,
      Math.max(
        nextYByLane.get(laneId) ?? frame.y,
        y + laneFootprintH + ALIGNMENT_CARD_STACK_GAP
      )
    );

    // Multi-place focus sets are rendered by focus mode only. Whole-surface
    // anchors are represented by the card without redundant target chrome.
    if (
      item.record.anchor.kind !== "single" ||
      target.kind === "surface" ||
      !targetGeometry
    ) {
      continue;
    }
    const targetId = `alignment-target:${item.record.id}`;
    const targetX = targetGeometry.x;
    const targetY = targetGeometry.y;
    const targetW = targetGeometry.w;
    const targetH = targetGeometry.h;
    const targetShape: AlignmentTargetProjection = {
      type: "alignment-target",
      id: targetId,
      x: targetX,
      y: targetY,
      isLocked: true,
      meta: metaFor(item.record.id, targetId, target),
      props: { w: targetW, h: targetH, stage }
    };
    plan.push(targetShape);

    const connectorY = card.y + card.props.h / 2;
    const start = {
      x: placement === "left" ? targetX : targetX + targetW,
      y: connectorY
    };
    const end = {
      x:
        placement === "left"
          ? card.x + card.props.w
          : card.x,
      y: connectorY
    };
    const connectorId = `alignment-connector:${item.record.id}`;
    const connectorX = Math.min(start.x, end.x);
    const connectorShapeY = Math.min(start.y, end.y);
    plan.push({
      type: "alignment-connector",
      id: connectorId,
      x: connectorX,
      y: connectorShapeY,
      isLocked: true,
      meta: metaFor(item.record.id, connectorId, target),
      props: {
        w: Math.max(1, Math.abs(end.x - start.x)),
        h: Math.max(1, Math.abs(end.y - start.y)),
        startX: start.x - connectorX,
        startY: start.y - connectorShapeY,
        endX: end.x - connectorX,
        endY: end.y - connectorShapeY,
        stage
      }
    });
  }

  return plan;
}
