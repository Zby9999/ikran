"use client";

import {
  useEffect,
  useId,
  useState,
  type CSSProperties,
  type FormEvent,
  type SyntheticEvent
} from "react";
import { ArrowUpIcon } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";

import {
  ALIGNMENT_STAGES,
  type AlignmentStageId
} from "./alignment-stage-panel";
import styles from "./alignment-ui.module.css";

export const ALIGNMENT_CARD_SEED_GAP_PX = 20;

export function stopAlignmentCardPointer(
  event: Pick<SyntheticEvent, "stopPropagation">,
  markHandled?: (event: SyntheticEvent) => void
) {
  markHandled?.(event as SyntheticEvent);
  event.stopPropagation();
}

export function activateAlignmentQuestionCard(
  onExpandedChange: (expanded: boolean) => void,
  onActivate?: () => void
) {
  onExpandedChange(true);
  onActivate?.();
}

export function previewAlignmentQuestionFocus(onFocusPreview?: () => void) {
  onFocusPreview?.();
}

export type AlignmentAnswerSource =
  | "designer-edited"
  | "agent-proposed-designer-accepted";

export type AlignmentQuestionCardProps = {
  number: number;
  stage: AlignmentStageId;
  observation: string;
  question: string;
  evidenceAnchor: string;
  proposedAnswer?: string;
  finalAnswer?: string;
  /** Retained for the projection contract; deliberately never rendered. */
  answerSource?: AlignmentAnswerSource;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onActivate?: () => void;
  onFocusPreview?: () => void;
  onPointerInteraction?: (event: SyntheticEvent) => void;
  onSubmitAnswer: (answer: string) => void;
  className?: string;
};

const STAGE_TINTS: Record<AlignmentStageId, string> = {
  "design-principle": "#fff0ea",
  "visual-language": "#e6f1ff",
  token: "#fbeeff",
  layout: "#f8eff3",
  component: "#e8fffe",
  interaction: "#fcffdc"
};

const STAGE_SUBMIT_COLORS: Record<AlignmentStageId, string> = {
  "design-principle": "#a88a7e",
  "visual-language": "#698db9",
  token: "#ae6fc3",
  layout: "#b2688f",
  component: "#5ba3a1",
  interaction: "#949b44"
};

export function AlignmentQuestionCard({
  number,
  stage,
  observation,
  question,
  evidenceAnchor: _evidenceAnchor,
  proposedAnswer,
  finalAnswer,
  answerSource: _answerSource,
  expanded,
  onExpandedChange,
  onActivate,
  onFocusPreview,
  onPointerInteraction,
  onSubmitAnswer,
  className
}: AlignmentQuestionCardProps) {
  const editorId = useId();
  const savedAnswer = finalAnswer?.trim() ?? "";
  const initialDraft = savedAnswer || proposedAnswer || "";
  const [draft, setDraft] = useState(initialDraft);
  const stageDefinition = ALIGNMENT_STAGES.find(({ id }) => id === stage)!;
  const style = {
    "--alignment-accent": stageDefinition.color,
    "--alignment-tint": STAGE_TINTS[stage],
    "--alignment-submit": STAGE_SUBMIT_COLORS[stage]
  } as CSSProperties;

  useEffect(() => {
    setDraft(savedAnswer || proposedAnswer || "");
  }, [proposedAnswer, savedAnswer]);

  function submitAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const answer = draft.trim();
    if (answer) onSubmitAnswer(answer);
  }

  return (
    <article
      className={[styles.questionCard, className].filter(Boolean).join(" ")}
      data-expanded={expanded}
      data-stage={stage}
      data-status={savedAnswer ? "answered" : "unanswered"}
      onMouseDown={(event) =>
        stopAlignmentCardPointer(event, onPointerInteraction)
      }
      onMouseEnter={() => previewAlignmentQuestionFocus(onFocusPreview)}
      onPointerDown={(event) =>
        stopAlignmentCardPointer(event, onPointerInteraction)
      }
      style={style}
    >
      <button
        aria-expanded={expanded}
        aria-label={`Open question ${number} editor`}
        className={styles.questionContent}
        onClick={() =>
          activateAlignmentQuestionCard(onExpandedChange, onActivate)
        }
        type="button"
      >
        <span className={styles.questionHeading}>
          <span className={styles.questionNumber}>{number}.</span>
          <span className={styles.questionCopy} data-slot="question-copy">
            <span className={styles.questionObservation}>{observation}</span>
            <span className={styles.questionText}>{question}</span>
            {!expanded && savedAnswer ? (
              <span className={styles.finalAnswer}>{savedAnswer}</span>
            ) : null}
          </span>
        </span>
      </button>

      {expanded ? (
        <form className={styles.answerEditor} onSubmit={submitAnswer}>
          <label className={styles.srOnly} htmlFor={editorId}>
            Answer question {number}
          </label>
          <textarea
            aria-label={`Answer question ${number}`}
            id={editorId}
            onChange={(event) => setDraft(event.currentTarget.value)}
            placeholder="Add your design intent..."
            rows={2}
            value={draft}
          />
          <Button
            aria-label={`Submit answer ${number}`}
            className={styles.answerSubmit}
            disabled={!draft.trim()}
            size="icon"
            type="submit"
          >
            <ArrowUpIcon aria-hidden="true" size={14} weight="regular" />
          </Button>
        </form>
      ) : null}
    </article>
  );
}

export type AgentAnnotationCardProps = {
  number: number;
  title: string;
  body: string;
  additionalInformation: readonly string[];
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onAppendInformation: (information: string) => void;
  onPointerInteraction?: (event: SyntheticEvent) => void;
  evidenceAnchor?: string;
  className?: string;
};

export function AgentAnnotationCard({
  number,
  title,
  body,
  additionalInformation,
  editing,
  onEditingChange,
  onAppendInformation,
  onPointerInteraction,
  evidenceAnchor: _evidenceAnchor,
  className
}: AgentAnnotationCardProps) {
  const [draft, setDraft] = useState("");

  function submitAnnotation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const information = draft.trim();
    if (!information) return;
    onAppendInformation(information);
    setDraft("");
    onEditingChange(false);
  }

  return (
    <aside
      className={[styles.annotationCard, className].filter(Boolean).join(" ")}
      data-editing={editing}
      data-kind="agent-annotation"
      onMouseDown={(event) =>
        stopAlignmentCardPointer(event, onPointerInteraction)
      }
      onPointerDown={(event) =>
        stopAlignmentCardPointer(event, onPointerInteraction)
      }
    >
      <button
        aria-label="Add information to agent annotation"
        className={styles.annotationBrowse}
        onClick={() => onEditingChange(true)}
        type="button"
      >
        <span className={styles.annotationHeading}>
          <span>{number}. {title}</span>
        </span>
        <span>{body}</span>
        {additionalInformation.map((information, index) => (
          <span className={styles.additionalInformation} key={`${index}-${information}`}>
            {information}
          </span>
        ))}
      </button>

      {editing ? (
        <form className={styles.annotationEditor} onSubmit={submitAnnotation}>
          <textarea
            aria-label="Add information to agent annotation"
            onChange={(event) => setDraft(event.currentTarget.value)}
            placeholder="Add your design intent..."
            rows={2}
            value={draft}
          />
          <Button
            aria-label="Submit agent annotation information"
            className={styles.annotationSubmit}
            disabled={!draft.trim()}
            size="icon"
            type="submit"
          >
            <ArrowUpIcon aria-hidden="true" size={14} weight="regular" />
          </Button>
        </form>
      ) : null}
    </aside>
  );
}
