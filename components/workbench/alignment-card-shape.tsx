"use client";

import { createContext, useContext, type PropsWithChildren } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  createShapeId,
  type TLShape,
  useEditor
} from "tldraw";

import {
  AgentAnnotationCard,
  AlignmentQuestionCard
} from "./alignment-cards";
import type { AlignmentStageId } from "./alignment-stage-panel";
import type { FocusCardSelection } from "./focus-mode";
import type { AlignmentProjectionMeta } from "./projection/alignment-projection";

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    "alignment-card": {
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
      focusSelectionJson: string;
    };
  }
}

export const ALIGNMENT_CARD_TYPE = "alignment-card" as const;
export const ALIGNMENT_CARD_COLLAPSED_WIDTH = 320;
export const ALIGNMENT_CARD_EXPANDED_WIDTH = 360;

export interface AlignmentCardShape extends TLShape<"alignment-card"> {
  meta: AlignmentProjectionMeta;
}

export type AlignmentCardProjectionActions = {
  onSubmitAnswer: (runtimeRecordId: string, answer: string) => void;
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
}) {
  return {
    w: input.expanded
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

type AlignmentCardShapeViewProps = {
  shape: AlignmentCardShape;
  onExpandedChange: (expanded: boolean) => void;
  onEditingChange: (editing: boolean) => void;
  onSingleAnchorSelected?: () => void;
};

/** Pure render seam used by the ShapeUtil and unit tests. */
export function AlignmentCardShapeView({
  shape,
  onExpandedChange,
  onEditingChange,
  onSingleAnchorSelected
}: AlignmentCardShapeViewProps) {
  const actions = useAlignmentCardProjectionActions();
  const props = shape.props;
  const meta = shape.meta;
  const focusSelection = parseFocusSelection(props.focusSelectionJson);
  const dimensions = normalizeAlignmentCardDimensions(props);

  const selectFocusCard = () => {
    if (focusSelection) actions?.onFocusCardSelection(focusSelection);
    else if (props.cardKind === "question") onSingleAnchorSelected?.();
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
      onClick={selectFocusCard}
      style={{
        width: dimensions.w,
        height: dimensions.h,
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
          onExpandedChange={onExpandedChange}
          onSubmitAnswer={(answer) =>
            actions?.onSubmitAnswer(meta.runtimeRecordId, answer)
          }
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
  const updateProps = (partial: Partial<AlignmentCardShape["props"]>) => {
    editor.run(
      () => {
        editor.updateShape<AlignmentCardShape>({
          id: shape.id,
          type: ALIGNMENT_CARD_TYPE,
          props: partial
        });
      },
      { ignoreShapeLock: true }
    );
  };
  return (
    <AlignmentCardShapeView
      shape={shape}
      onExpandedChange={(expanded) =>
        updateProps({
          expanded,
          w: expanded
            ? ALIGNMENT_CARD_EXPANDED_WIDTH
            : ALIGNMENT_CARD_COLLAPSED_WIDTH
        })
      }
      onEditingChange={(editing) => updateProps({ editing })}
      onSingleAnchorSelected={() => {
        const target = editor.getShape(
          createShapeId(`alignment-target:${shape.meta.runtimeRecordId}`)
        );
        if (!target) return;
        editor.setSelectedShapes([target.id]);
        const bounds = editor.getShapePageBounds(target);
        if (bounds) editor.zoomToBounds(bounds, { inset: 96 });
      }}
    />
  );
}

export class AlignmentCardShapeUtil extends BaseBoxShapeUtil<AlignmentCardShape> {
  static override type = ALIGNMENT_CARD_TYPE;

  static override props = {
    w: T.number,
    h: T.number,
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
    focusSelectionJson: T.string
  };

  getDefaultProps(): AlignmentCardShape["props"] {
    return {
      w: ALIGNMENT_CARD_COLLAPSED_WIDTH,
      h: 236,
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
      focusSelectionJson: ""
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
