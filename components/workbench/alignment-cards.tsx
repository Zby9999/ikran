"use client";

import {
  useEffect,
  useId,
  useState,
  type CSSProperties,
  type FormEvent
} from "react";
import { ArrowUpIcon } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";

import {
  ALIGNMENT_STAGES,
  type AlignmentStageId
} from "./alignment-stage-panel";
import styles from "./alignment-ui.module.css";

export const ALIGNMENT_CARD_SEED_GAP_PX = 20;

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
  evidenceAnchor,
  proposedAnswer,
  finalAnswer,
  answerSource: _answerSource,
  expanded,
  onExpandedChange,
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
      style={style}
    >
      <button
        aria-expanded={expanded}
        aria-label={`Open question ${number} editor`}
        className={styles.questionContent}
        onClick={() => onExpandedChange(true)}
        type="button"
      >
        <span className={styles.questionHeading}>
          <span>{number}. {observation}</span>
          <span className={styles.evidenceAnchor}>{evidenceAnchor}</span>
        </span>
        <span className={styles.questionText}>{question}</span>
        {!expanded && savedAnswer ? (
          <span className={styles.finalAnswer}>{savedAnswer}</span>
        ) : null}
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
  evidenceAnchor,
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
    >
      <button
        aria-label="Add information to agent annotation"
        className={styles.annotationBrowse}
        onClick={() => onEditingChange(true)}
        type="button"
      >
        <span className={styles.annotationHeading}>
          <span>{number}. {title}</span>
          {evidenceAnchor ? (
            <span className={styles.annotationAnchor}>{evidenceAnchor}</span>
          ) : null}
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
            placeholder="Add information..."
            rows={4}
            value={draft}
          />
          <div className={styles.annotationActions}>
            <Button
              onClick={() => onEditingChange(false)}
              size="sm"
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button disabled={!draft.trim()} size="sm" type="submit">
              Add information
            </Button>
          </div>
        </form>
      ) : null}
    </aside>
  );
}
