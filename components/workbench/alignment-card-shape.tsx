"use client";

import {
  createContext,
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
      proposedAnswer: string;
      finalAnswer: string;
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
    const w = expanded || editing
      ? ALIGNMENT_CARD_EXPANDED_WIDTH
      : ALIGNMENT_CARD_COLLAPSED_WIDTH;
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
  if (updates.length === 0) return;
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

  useEffect(() => {
    setOnlyOpenAlignmentCard(editor, null);
    const onEditorEvent = (event: AlignmentCanvasEvent) => {
      if (isAlignmentCanvasPointerDown(event)) {
        setOnlyOpenAlignmentCard(editor, null);
      }
    };
    editor.on("event", onEditorEvent);
    return () => {
      editor.off("event", onEditorEvent);
    };
  }, [editor]);

  return null;
}

export interface AlignmentCardShape extends TLShape<"alignment-card"> {
  meta: AlignmentProjectionMeta;
}

export type AlignmentCardProjectionActions = {
  onSubmitAnswer: (
    runtimeRecordId: string,
    answer: string
  ) => Promise<AlignmentAnswerMutationResult>;
  onAppendAnnotationInformation: (
    runtimeRecordId: string,
    information: string
  ) => void;
  onFocusCardSelection: (selection: FocusCardSelection) => void;
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
  expanded: boolean;
  editing: boolean;
}) {
  return {
    w: input.expanded || input.editing
      ? ALIGNMENT_CARD_EXPANDED_WIDTH
      : ALIGNMENT_CARD_COLLAPSED_WIDTH,
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
  onFocusCardSelection?: (selection: FocusCardSelection) => void
) {
  if (selection) onFocusCardSelection?.(selection);
}

type AlignmentCardShapeViewProps = {
  shape: AlignmentCardShape;
  onExpandedChange: (expanded: boolean) => void;
  onEditingChange: (editing: boolean) => void;
  onPointerInteraction?: (event: SyntheticEvent) => void;
};

/** Pure render seam used by the ShapeUtil and unit tests. */
export function AlignmentCardShapeView({
  shape,
  onExpandedChange,
  onEditingChange,
  onPointerInteraction
}: AlignmentCardShapeViewProps) {
  const actions = useAlignmentCardProjectionActions();
  const props = shape.props;
  const meta = shape.meta;
  const focusSelection = parseFocusSelection(props.focusSelectionJson);
  const dimensions = normalizeAlignmentCardDimensions(props);

  const selectFocusCard = () => {
    activateAlignmentCardFocus(focusSelection, actions?.onFocusCardSelection);
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
        top: "50%",
        bottom: "auto",
        transform: "translateY(-50%)",
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
          onExpandedChange={onExpandedChange}
          onPointerInteraction={onPointerInteraction}
          onSubmitAnswer={(answer) =>
            actions?.onSubmitAnswer(meta.runtimeRecordId, answer) ??
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
  return (
    <AlignmentCardShapeView
      shape={shape}
      onExpandedChange={(expanded) =>
        setOnlyOpenAlignmentCard(
          editor,
          expanded ? String(shape.id) : null
        )
      }
      onEditingChange={(editing) =>
        setOnlyOpenAlignmentCard(
          editor,
          editing ? String(shape.id) : null
        )
      }
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
      "design-principle",
      "visual-language",
      "token",
      "layout",
      "component",
      "interaction"
    ),
    number: T.number,
    observation: T.string,
    question: T.string,
    proposedAnswer: T.string,
    finalAnswer: T.string,
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
      w: ALIGNMENT_CARD_COLLAPSED_WIDTH,
      h: 236,
      placement: "right",
      cardKind: "question",
      stage: "design-principle",
      number: 1,
      observation: "",
      question: "",
      proposedAnswer: "",
      finalAnswer: "",
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
