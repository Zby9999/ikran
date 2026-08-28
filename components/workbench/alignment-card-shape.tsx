"use client";

import {
  createContext,
  useCallback,
  useEffect,
  useContext,
  type PropsWithChildren,
  type SyntheticEvent
} from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type Editor,
  type TLShape,
  type TLShapeId,
  useEditor
} from "tldraw";

import {
  AgentAnnotationCard,
  AlignmentQuestionCard,
  type AlignmentAnswerMutationResult
} from "./alignment-cards";
import type { AlignmentStageId } from "./alignment-stage-panel";
import type {
  AnswerOption,
  AnswerSubmission
} from "@/components/runtime/alignment-answer-contract";
import { useExclusiveDialog } from "./exclusive-dialog-context";
import type { FocusCardSelection } from "./focus-mode";
import type { AlignmentProjectionMeta } from "./projection/alignment-projection";

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    "alignment-card": {
      w: number;
      h: number;
      placement: "left" | "right";
      cardKind: "question" | "agent-annotation";
      stage: AlignmentStageId;
      number: number;
      observation: string;
      question: string;
      answerOptionsJson: string;
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
      focusSelectionJson: string;
      readOnly: boolean;
    };
  }
}

export const ALIGNMENT_CARD_TYPE = "alignment-card" as const;
export const ALIGNMENT_CARD_COLLAPSED_WIDTH = 320;
export const ALIGNMENT_CARD_EXPANDED_WIDTH = 360;
export const ALIGNMENT_QUESTION_CARD_WIDTH = 360;

export function alignmentCardWidth(
  cardKind: "question" | "agent-annotation",
  active: boolean
) {
  return cardKind === "question"
    ? ALIGNMENT_QUESTION_CARD_WIDTH
    : active
      ? ALIGNMENT_CARD_EXPANDED_WIDTH
      : ALIGNMENT_CARD_COLLAPSED_WIDTH;
}

export function alignmentCardXForWidth(
  x: number,
  currentWidth: number,
  nextWidth: number,
  placement: "left" | "right"
) {
  return placement === "left"
    ? x + currentWidth - nextWidth
    : x;
}

type AlignmentEditorCard = {
  id: string;
  x: number;
  w: number;
  placement: "left" | "right";
  cardKind: "question" | "agent-annotation";
  expanded: boolean;
  editing: boolean;
};

export function alignmentCardEditorUpdates(
  cards: readonly AlignmentEditorCard[],
  activeId: string | null
) {
  return cards.flatMap((card) => {
    const active = card.id === activeId;
    const expanded = card.cardKind === "question" && active;
    const editing = card.cardKind === "agent-annotation" && active;
    if (card.expanded === expanded && card.editing === editing) return [];
    const w = alignmentCardWidth(card.cardKind, expanded || editing);
    return [{
      id: card.id,
      x: alignmentCardXForWidth(card.x, card.w, w, card.placement),
      expanded,
      editing,
      w
    }];
  });
}

export function setOnlyOpenAlignmentCard(
  editor: Editor,
  activeId: string | null
) {
  const shapes = editor
    .getCurrentPageShapes()
    .filter((shape): shape is AlignmentCardShape => shape.type === ALIGNMENT_CARD_TYPE);
  const updates = alignmentCardEditorUpdates(
    shapes.map((shape) => ({
      id: String(shape.id),
      x: shape.x,
      w: shape.props.w,
      placement: shape.props.placement,
      cardKind: shape.props.cardKind,
      expanded: shape.props.expanded,
      editing: shape.props.editing
    })),
    activeId
  );
  // Cards are independently placed, so a hugging editor can overlap a later
  // sibling. Opening must raise that dialog even when expand/collapse is a no-op.
  if (updates.length === 0 && !activeId) return;
  editor.run(
    () => {
      for (const update of updates) {
        editor.updateShape<AlignmentCardShape>({
          id: update.id as TLShapeId,
          type: ALIGNMENT_CARD_TYPE,
          x: update.x,
          props: {
            expanded: update.expanded,
            editing: update.editing,
            w: update.w
          }
        });
      }
      if (activeId) editor.bringToFront([activeId as TLShapeId]);
    },
    { ignoreShapeLock: true }
  );
}

type AlignmentCanvasEvent = {
  type: string;
  name: string;
  target?: string;
};

export function isAlignmentCanvasPointerDown(
  event: AlignmentCanvasEvent
): boolean {
  return (
    event.type === "pointer" &&
    event.name === "pointer_down" &&
    event.target === "canvas"
  );
}

export function AlignmentCardInteractionController() {
  const editor = useEditor();
  const exclusive = useExclusiveDialog();

  useEffect(() => {
    // Canvas pointer-down closes every input dialog (all card families when
    // the exclusive coordinator is mounted, alignment cards only otherwise).
    const closeAll = () =>
      exclusive
        ? exclusive.closeDialogs()
        : setOnlyOpenAlignmentCard(editor, null);
    closeAll();
    const onEditorEvent = (event: AlignmentCanvasEvent) => {
      if (isAlignmentCanvasPointerDown(event)) {
        closeAll();
      }
    };
    editor.on("event", onEditorEvent);
    return () => {
      editor.off("event", onEditorEvent);
    };
  }, [editor, exclusive]);

  return null;
}

export interface AlignmentCardShape extends TLShape<"alignment-card"> {
  meta: AlignmentProjectionMeta;
}

type AlignmentGeometryScheduler = (callback: () => void) => void;

type PendingAlignmentCardHeights = {
  heights: Map<TLShapeId, number>;
};

const pendingAlignmentCardHeights = new WeakMap<
  Editor,
  PendingAlignmentCardHeights
>();

const scheduleBeforePaint: AlignmentGeometryScheduler = (callback) =>
  queueMicrotask(callback);

/**
 * ResizeObservers for the closing and opening cards can fire together. Commit
 * their latest heights in one canvas transaction before paint so lane and
 * annotation reflow never exposes an intermediate geometry frame.
 */
export function scheduleAlignmentCardHeightUpdate(
  editor: Editor,
  shapeId: TLShapeId,
  height: number,
  scheduleGeometry: AlignmentGeometryScheduler = scheduleBeforePaint
) {
  if (!Number.isFinite(height) || height <= 0) return;
  const pending = pendingAlignmentCardHeights.get(editor);
  if (pending) {
    pending.heights.set(shapeId, height);
    return;
  }

  const batch: PendingAlignmentCardHeights = {
    heights: new Map([[shapeId, height]])
  };
  pendingAlignmentCardHeights.set(editor, batch);
  scheduleGeometry(() => {
    if (pendingAlignmentCardHeights.get(editor) !== batch) return;
    pendingAlignmentCardHeights.delete(editor);
    editor.store.mergeRemoteChanges(() => {
      editor.run(
        () => {
          for (const [id, nextHeight] of batch.heights) {
            const current = editor.getShape<AlignmentCardShape>(id);
            if (
              current?.type !== ALIGNMENT_CARD_TYPE ||
              current.props.h === nextHeight
            ) {
              continue;
            }
            editor.updateShape<AlignmentCardShape>({
              id,
              type: ALIGNMENT_CARD_TYPE,
              props: { h: nextHeight }
            });
          }
        },
        { ignoreShapeLock: true }
      );
    });
  });
}

export type AlignmentCardProjectionActions = {
  onSubmitAnswer: (
    runtimeRecordId: string,
    submission: AnswerSubmission
  ) => Promise<AlignmentAnswerMutationResult>;
  onAppendAnnotationInformation: (
    runtimeRecordId: string,
    information: string
  ) => void;
  onFocusCardSelection: (selection: FocusCardSelection) => void;
  onFocusCardPreviewEnd: () => void;
};

const AlignmentCardProjectionContext =
  createContext<AlignmentCardProjectionActions | null>(null);

export function AlignmentCardProjectionProvider({
  children,
  ...actions
}: PropsWithChildren<AlignmentCardProjectionActions>) {
  return (
    <AlignmentCardProjectionContext.Provider value={actions}>
      {children}
    </AlignmentCardProjectionContext.Provider>
  );
}

export function useAlignmentCardProjectionActions() {
  return useContext(AlignmentCardProjectionContext);
}

export function normalizeAlignmentCardDimensions(input: {
  w: number;
  h: number;
  cardKind: "question" | "agent-annotation";
  expanded: boolean;
  editing: boolean;
}) {
  return {
    w: alignmentCardWidth(input.cardKind, input.expanded || input.editing),
    h: input.h
  };
}

function parseStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function parseAnswerOptions(value: string): AnswerOption[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is AnswerOption =>
            !!item &&
            typeof item === "object" &&
            typeof (item as AnswerOption).id === "string" &&
            typeof (item as AnswerOption).text === "string"
        )
      : [];
  } catch {
    return [];
  }
}

function parseFocusSelection(value: string): FocusCardSelection | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as FocusCardSelection;
    return parsed && typeof parsed.cardId === "string" && Array.isArray(parsed.targets)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function activateAlignmentCardFocus(
  selection: FocusCardSelection | null,
  onFocusCardSelection?: (selection: FocusCardSelection) => void,
  onFocusCardExit?: () => void
) {
  if (selection) {
    onFocusCardSelection?.(selection);
  } else {
    onFocusCardExit?.();
  }
}

type AlignmentCardShapeViewProps = {
  shape: AlignmentCardShape;
  onExpandedChange: (expanded: boolean) => void;
  onEditingChange: (editing: boolean) => void;
  onQuestionHeightChange?: (height: number) => void;
  onPointerInteraction?: (event: SyntheticEvent) => void;
};

/** Pure render seam used by the ShapeUtil and unit tests. */
export function AlignmentCardShapeView({
  shape,
  onExpandedChange,
  onEditingChange,
  onQuestionHeightChange,
  onPointerInteraction
}: AlignmentCardShapeViewProps) {
  const actions = useAlignmentCardProjectionActions();
  const props = shape.props;
  const meta = shape.meta;
  const focusSelection = parseFocusSelection(props.focusSelectionJson);
  const dimensions = normalizeAlignmentCardDimensions(props);

  const selectFocusCard = () => {
    activateAlignmentCardFocus(
      focusSelection,
      actions?.onFocusCardSelection,
      actions?.onFocusCardPreviewEnd
    );
  };

  return (
    <HTMLContainer
      data-testid="alignment-card-shape"
      data-canvas-record-id={meta.canvasRecordId}
      data-runtime-record-id={meta.runtimeRecordId}
      data-seed-reference-id={meta.seedReferenceId}
      data-surface-record-id={meta.surfaceRecordId}
      data-evidence-version-id={meta.evidenceVersionId}
      data-node-id={meta.nodeId}
      data-stage={props.stage}
      data-card-kind={props.cardKind}
      style={{
        width: dimensions.w,
        height: "fit-content",
        bottom: "auto",
        pointerEvents: "all"
      }}
    >
      {props.cardKind === "question" ? (
        <AlignmentQuestionCard
          number={props.number}
          stage={props.stage}
          observation={props.observation}
          question={props.question}
          evidenceAnchor={props.evidenceAnchor}
          answerOptions={parseAnswerOptions(props.answerOptionsJson)}
          selectedOptionId={props.selectedOptionId || undefined}
          proposedAnswer={props.proposedAnswer || undefined}
          finalAnswer={props.finalAnswer || undefined}
          answerSource={
            props.answerSource === "designer-edited" ||
            props.answerSource === "agent-proposed-designer-accepted"
              ? props.answerSource
              : undefined
          }
          expanded={props.expanded}
          onActivate={selectFocusCard}
          onFocusPreview={focusSelection ? selectFocusCard : undefined}
          onFocusPreviewEnd={
            focusSelection ? actions?.onFocusCardPreviewEnd : undefined
          }
          onExpandedChange={onExpandedChange}
          onHeightChange={onQuestionHeightChange}
          onPointerInteraction={onPointerInteraction}
          onSubmitAnswer={(submission) =>
            actions?.onSubmitAnswer(meta.runtimeRecordId, submission) ??
            Promise.resolve({
              ok: false,
              error: "record_designer_answer_unavailable"
            })
          }
          readOnly={props.readOnly}
        />
      ) : (
        <AgentAnnotationCard
          number={props.number}
          title={props.title}
          body={props.body}
          additionalInformation={parseStringArray(props.additionalInformationJson)}
          evidenceAnchor={props.evidenceAnchor}
          editing={props.editing}
          onEditingChange={onEditingChange}
          onActivate={selectFocusCard}
          onFocusPreview={focusSelection ? selectFocusCard : undefined}
          onFocusPreviewEnd={
            focusSelection ? actions?.onFocusCardPreviewEnd : undefined
          }
          onPointerInteraction={onPointerInteraction}
          onAppendInformation={(information) =>
            actions?.onAppendAnnotationInformation(meta.runtimeRecordId, information)
          }
        />
      )}
    </HTMLContainer>
  );
}

function AlignmentCardShapeComponent({ shape }: { shape: AlignmentCardShape }) {
  const editor = useEditor();
  const exclusive = useExclusiveDialog();
  const fitQuestionHeight = useCallback(
    (height: number) => {
      const nextHeight = Math.ceil(height);
      if (
        shape.props.cardKind !== "question" ||
        !Number.isFinite(nextHeight) ||
        nextHeight <= 0 ||
        nextHeight === shape.props.h
      ) {
        return;
      }
      scheduleAlignmentCardHeightUpdate(editor, shape.id, nextHeight);
    },
    [editor, shape.id, shape.props.cardKind, shape.props.h]
  );
  // Single-active-dialog: opening this card closes every other input dialog
  // (designer-annotation cards and the pending entry draft included).
  const handleActiveChange = (active: boolean) => {
    if (exclusive) {
      if (active) {
        exclusive.openDialog({ family: "alignment", id: String(shape.id) });
      } else {
        exclusive.closeDialogs();
      }
      return;
    }
    setOnlyOpenAlignmentCard(editor, active ? String(shape.id) : null);
  };
  return (
    <AlignmentCardShapeView
      shape={shape}
      onExpandedChange={handleActiveChange}
      onEditingChange={handleActiveChange}
      onQuestionHeightChange={fitQuestionHeight}
      onPointerInteraction={editor.markEventAsHandled}
    />
  );
}

export class AlignmentCardShapeUtil extends BaseBoxShapeUtil<AlignmentCardShape> {
  static override type = ALIGNMENT_CARD_TYPE;

  static override props = {
    w: T.number,
    h: T.number,
    placement: T.literalEnum("left", "right"),
    cardKind: T.literalEnum("question", "agent-annotation"),
    stage: T.literalEnum(
      "design-concept",
      "visual-language",
      "token",
      "layout",
      "component",
      "interaction"
    ),
    number: T.number,
    observation: T.string,
    question: T.string,
    answerOptionsJson: T.string,
    proposedAnswer: T.string,
    finalAnswer: T.string,
    selectedOptionId: T.string,
    answerSource: T.string,
    title: T.string,
    body: T.string,
    additionalInformationJson: T.string,
    evidenceAnchor: T.string,
    expanded: T.boolean,
    editing: T.boolean,
    focusSelectionJson: T.string,
    readOnly: T.boolean
  };

  getDefaultProps(): AlignmentCardShape["props"] {
    return {
      w: ALIGNMENT_QUESTION_CARD_WIDTH,
      h: 236,
      placement: "right",
      cardKind: "question",
      stage: "design-concept",
      number: 1,
      observation: "",
      question: "",
      answerOptionsJson: "[]",
      proposedAnswer: "",
      finalAnswer: "",
      selectedOptionId: "",
      answerSource: "",
      title: "",
      body: "",
      additionalInformationJson: "[]",
      evidenceAnchor: "",
      expanded: false,
      editing: false,
      focusSelectionJson: "",
      readOnly: false
    };
  }

  override onBeforeUpdate(
    _previous: AlignmentCardShape,
    next: AlignmentCardShape
  ) {
    const dimensions = normalizeAlignmentCardDimensions(next.props);
    return dimensions.w === next.props.w
      ? next
      : { ...next, props: { ...next.props, ...dimensions } };
  }

  override canEdit() {
    return false;
  }

  override canResize(_shape: AlignmentCardShape) {
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

  override component(shape: AlignmentCardShape) {
    return <AlignmentCardShapeComponent shape={shape} />;
  }

  override getIndicatorPath() {
    return undefined;
  }
}
