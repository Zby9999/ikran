// Pure Runtime-record -> tldraw projection planning for Design Intent Alignment.
// Runtime types are intentionally adapted here: the canvas domain does not
// depend on the still-evolving Runtime module exports.

import type { AlignmentStageId } from "../alignment-stage-panel";
import type { FocusCardSelection } from "../focus-mode";

export type AlignmentTargetRect = {
  x: number;
  y: number;
  w?: number;
  h?: number;
  width?: number;
  height?: number;
};

export type AlignmentEvidenceTarget = {
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
  proposed_answer: string | null;
  final_answer: string | null;
  answer_source:
    | "designer-edited"
    | "agent-proposed-designer-accepted"
    | null;
  anchor: AlignmentAnchor;
};

export type AlignmentAgentAnnotationRecord = {
  id: string;
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
  questions: AlignmentQuestionCardRecord[];
  annotations: AlignmentAgentAnnotationRecord[];
  seedFrames: AlignmentSeedFrame[];
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
    cardKind: "question" | "agent-annotation";
    stage: AlignmentStageId;
    number: number;
    observation: string;
    question: string;
    proposedAnswer: string;
    finalAnswer: string;
    answerSource: string;
    title: string;
    body: string;
    additionalInformationJson: string;
    evidenceAnchor: string;
    expanded: boolean;
    editing: boolean;
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
export const ALIGNMENT_CARD_SEED_GAP = 20;
export const ALIGNMENT_CARD_STACK_GAP = 12;
export const ALIGNMENT_QUESTION_CARD_H = 236;
export const ALIGNMENT_ANNOTATION_CARD_H = 180;

const STAGE_COLORS: Record<AlignmentStageId, string> = {
  "design-principle": "#c97759",
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
  anchor: AlignmentAnchor
): FocusCardSelection | null {
  if (anchor.kind !== "focus-target-set") return null;
  return {
    cardId,
    targets: anchor.targets.flatMap((target, index) => {
      const rect = rectForTarget(target);
      return rect
        ? [
            {
              targetId: `${cardId}:${index}`,
              surfaceArtifactId: target.evidenceSurfaceId,
              evidenceVersionId: target.evidenceVersionId,
              rect: {
                x: rect.x,
                y: rect.y,
                width: rect.w,
                height: rect.h
              }
            }
          ]
        : [];
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
  const nextYByFrame = new Map<string, number>();
  const visibleCards: Array<
    | { kind: "question"; record: AlignmentQuestionCardRecord; number: number }
    | {
        kind: "agent-annotation";
        record: AlignmentAgentAnnotationRecord;
        number: number;
      }
  > = [
    ...input.questions
      .filter((record) => record.section === input.currentStage)
      .map((record) => ({
        kind: "question" as const,
        record,
        number: 0
      })),
    ...input.annotations.map((record) => ({
      kind: "agent-annotation" as const,
      record,
      number: 0
    }))
  ].map((item, index) => ({ ...item, number: index + 1 }));

  for (const item of visibleCards) {
    const target = firstTarget(item.record.anchor);
    if (!target) continue;
    const frame = frameForTarget(input.seedFrames, target);
    if (!frame) continue;
    const y = nextYByFrame.get(frame.id) ?? frame.y;
    const h =
      item.kind === "question"
        ? ALIGNMENT_QUESTION_CARD_H
        : ALIGNMENT_ANNOTATION_CARD_H;
    const cardId = `alignment-card:${item.record.id}`;
    const stage =
      item.kind === "question" ? item.record.section : input.currentStage;
    const card: AlignmentCardProjection = {
      type: "alignment-card",
      id: cardId,
      x: frame.x + frame.w + ALIGNMENT_CARD_SEED_GAP,
      y,
      isLocked: true,
      meta: metaFor(item.record.id, cardId, target),
      props: {
        w: ALIGNMENT_CARD_COLLAPSED_W,
        h,
        cardKind: item.kind,
        stage,
        number: item.number,
        observation: item.kind === "question" ? item.record.observation : "",
        question: item.kind === "question" ? item.record.question : "",
        proposedAnswer:
          item.kind === "question" ? item.record.proposed_answer ?? "" : "",
        finalAnswer:
          item.kind === "question" ? item.record.final_answer ?? "" : "",
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
        focusSelection: focusSelectionFor(item.record.id, item.record.anchor)
      }
    };
    plan.push(card);
    nextYByFrame.set(frame.id, y + h + ALIGNMENT_CARD_STACK_GAP);

    // Multi-place focus sets are rendered by focus mode only. Neutral Agent
    // annotations also do not add stage-colored target chrome.
    if (item.kind !== "question" || item.record.anchor.kind !== "single") {
      continue;
    }
    const rect = rectForTarget(target);
    if (!rect) continue;
    const targetId = `alignment-target:${item.record.id}`;
    const mediaX = frame.mediaX ?? frame.x;
    const mediaY = frame.mediaY ?? frame.y;
    const mediaW = frame.mediaW ?? frame.w;
    const mediaH = frame.mediaH ?? frame.h;
    const targetX = mediaX + rect.x * mediaW;
    const targetY = mediaY + rect.y * mediaH;
    const targetW = rect.w * mediaW;
    const targetH = rect.h * mediaH;
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

    const start = { x: targetX + targetW, y: targetY + targetH / 2 };
    const end = { x: card.x, y: card.y + Math.min(40, card.props.h / 2) };
    const connectorId = `alignment-connector:${item.record.id}`;
    const connectorX = Math.min(start.x, end.x);
    const connectorY = Math.min(start.y, end.y);
    plan.push({
      type: "alignment-connector",
      id: connectorId,
      x: connectorX,
      y: connectorY,
      isLocked: true,
      meta: metaFor(item.record.id, connectorId, target),
      props: {
        w: Math.max(1, Math.abs(end.x - start.x)),
        h: Math.max(1, Math.abs(end.y - start.y)),
        startX: start.x - connectorX,
        startY: start.y - connectorY,
        endX: end.x - connectorX,
        endY: end.y - connectorY,
        stage
      }
    });
  }

  return plan;
}
