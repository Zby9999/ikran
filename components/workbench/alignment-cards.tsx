"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type SyntheticEvent
} from "react";
import { ArrowUpIcon } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import type {
  AnswerOption,
  AnswerSubmission
} from "@/components/runtime/alignment-answer-contract";

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

/** Grow an alignment card editor field to its content instead of scrolling at two lines. */
export function hugAlignmentAnswerTextarea(
  textarea: Pick<HTMLTextAreaElement, "style" | "scrollHeight">
) {
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

export function restoreAlignmentQuestionHeaderFocus(
  header: Pick<HTMLButtonElement, "focus"> | null
) {
  header?.focus({ preventScroll: true });
}

export function endAlignmentCardFocusPreview(
  persistent: boolean,
  onFocusPreviewEnd?: () => void
) {
  if (!persistent) onFocusPreviewEnd?.();
}

export type AlignmentAnswerSource =
  | "designer-edited"
  | "agent-proposed-designer-accepted";

export type AlignmentAnswerMutationResult =
  | { ok: true }
  | { ok: false; error?: string };

export async function submitAlignmentQuestionAnswer(
  submission: AnswerSubmission,
  onSubmitAnswer: (
    submission: AnswerSubmission
  ) => Promise<AlignmentAnswerMutationResult>,
  onSubmitted: (submission: AnswerSubmission) => void
): Promise<boolean> {
  const result = await onSubmitAnswer(submission);
  if (!result.ok) return false;
  onSubmitted(submission);
  return true;
}

export async function submitAlignmentQuestionOption(
  option: AnswerOption,
  onSubmitAnswer: (
    submission: AnswerSubmission
  ) => Promise<AlignmentAnswerMutationResult>,
  onSubmitted: (option: AnswerOption) => void
): Promise<boolean> {
  return submitAlignmentQuestionAnswer(
    { kind: "option", optionId: option.id },
    onSubmitAnswer,
    () => onSubmitted(option)
  );
}

export function shouldSubmitAlignmentCustomAnswer(event: {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
}) {
  return event.key === "Enter" && !event.shiftKey && !event.isComposing;
}

export function alignmentSubmissionForCustomText(
  answerOptions: readonly AnswerOption[],
  text: string
): AnswerSubmission {
  return answerOptions.length > 0
    ? { kind: "custom", text }
    : { kind: "legacy", text };
}

export function customAnswerDraftOnActivation(
  selectedOptionId: string | undefined,
  currentDraft: string
) {
  return selectedOptionId ? "" : currentDraft;
}

export function resolveAlignmentAnswerDisplay(input: {
  savedAnswer: string;
  selectedOptionId: string | undefined;
  submittedAnswer: string;
  submittedOptionId: string;
}) {
  return input.submittedAnswer
    ? {
        answer: input.submittedAnswer,
        selectedOptionId: input.submittedOptionId
      }
    : {
        answer: input.savedAnswer,
        selectedOptionId: input.selectedOptionId ?? ""
      };
}

export type AlignmentQuestionCardProps = {
  number: number;
  stage: AlignmentStageId;
  observation: string;
  question: string;
  evidenceAnchor: string;
  answerOptions?: readonly AnswerOption[];
  selectedOptionId?: string;
  proposedAnswer?: string;
  finalAnswer?: string;
  /** Retained for the projection contract; deliberately never rendered. */
  answerSource?: AlignmentAnswerSource;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onActivate?: () => void;
  onFocusPreview?: () => void;
  onFocusPreviewEnd?: () => void;
  onHeightChange?: (height: number) => void;
  onPointerInteraction?: (event: SyntheticEvent) => void;
  onSubmitAnswer: (
    submission: AnswerSubmission
  ) => Promise<AlignmentAnswerMutationResult>;
  readOnly?: boolean;
  className?: string;
};

const STAGE_TINTS: Record<AlignmentStageId, string> = {
  "design-concept": "#fff0ea",
  "visual-language": "#e6f1ff",
  token: "#fbeeff",
  layout: "#f8eff3",
  component: "#e8fffe",
  interaction: "#fcffdc"
};

const STAGE_SUBMIT_COLORS: Record<AlignmentStageId, string> = {
  "design-concept": "#a88a7e",
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
  answerOptions = [],
  selectedOptionId,
  proposedAnswer,
  finalAnswer,
  answerSource: _answerSource,
  expanded,
  onExpandedChange,
  onActivate,
  onFocusPreview,
  onFocusPreviewEnd,
  onHeightChange,
  onPointerInteraction,
  onSubmitAnswer,
  readOnly = false,
  className
}: AlignmentQuestionCardProps) {
  const editorId = useId();
  const observationId = `${editorId}-observation`;
  const questionId = `${editorId}-question`;
  const finalAnswerId = `${editorId}-final-answer`;
  const articleRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const restoreFocusAfterCollapseRef = useRef(false);
  const savedAnswer = finalAnswer?.trim() ?? "";
  const initialDraft = savedAnswer || proposedAnswer || "";
  const [draft, setDraft] = useState(initialDraft);
  const [submittedAnswer, setSubmittedAnswer] = useState("");
  const [submittedOptionId, setSubmittedOptionId] = useState("");
  const [customActive, setCustomActive] = useState(
    Boolean(savedAnswer && !selectedOptionId && answerOptions.length > 0)
  );
  const [submitting, setSubmitting] = useState(false);
  const {
    answer: displayAnswer,
    selectedOptionId: displaySelectedOptionId
  } = resolveAlignmentAnswerDisplay({
    savedAnswer,
    selectedOptionId,
    submittedAnswer,
    submittedOptionId
  });
  const stageDefinition = ALIGNMENT_STAGES.find(({ id }) => id === stage)!;
  const style = {
    "--alignment-accent": stageDefinition.color,
    "--alignment-tint": STAGE_TINTS[stage],
    "--alignment-submit": STAGE_SUBMIT_COLORS[stage]
  } as CSSProperties;

  useEffect(() => {
    setDraft(savedAnswer || proposedAnswer || "");
    if (savedAnswer) {
      setSubmittedAnswer("");
      setSubmittedOptionId("");
    }
    if (savedAnswer && answerOptions.length > 0) {
      setCustomActive(!selectedOptionId);
    }
  }, [answerOptions.length, proposedAnswer, savedAnswer, selectedOptionId]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    hugAlignmentAnswerTextarea(textarea);
    if (customActive && expanded && !readOnly) textarea.focus();
  }, [customActive, draft, expanded, readOnly]);

  useLayoutEffect(() => {
    const article = articleRef.current;
    if (!article || !onHeightChange) return;
    const notify = () => onHeightChange(article.offsetHeight);
    notify();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(notify);
    observer.observe(article);
    return () => observer.disconnect();
  }, [onHeightChange]);

  useLayoutEffect(() => {
    if (expanded || !restoreFocusAfterCollapseRef.current) return;
    restoreFocusAfterCollapseRef.current = false;
    restoreAlignmentQuestionHeaderFocus(headerRef.current);
  }, [expanded]);

  async function submitAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const answer = draft.trim();
    if (readOnly || !answer || submitting) return;
    setSubmitting(true);
    try {
      await submitAlignmentQuestionAnswer(
        alignmentSubmissionForCustomText(answerOptions, answer),
        onSubmitAnswer,
        (submitted) => {
          if (submitted.kind !== "option") {
            setSubmittedAnswer(submitted.text);
            setSubmittedOptionId("");
          }
          restoreFocusAfterCollapseRef.current = true;
          onExpandedChange(false);
        }
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function submitOption(option: AnswerOption) {
    if (readOnly || submitting) return;
    setSubmitting(true);
    try {
      await submitAlignmentQuestionOption(
        option,
        onSubmitAnswer,
        (submitted) => {
          setSubmittedAnswer(submitted.text);
          setSubmittedOptionId(submitted.id);
          setCustomActive(false);
          restoreFocusAfterCollapseRef.current = true;
          onExpandedChange(false);
        }
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <article
      ref={articleRef}
      className={[styles.questionCard, className].filter(Boolean).join(" ")}
      data-expanded={expanded}
      data-stage={stage}
      data-status={displayAnswer ? "answered" : "unanswered"}
      data-read-only={readOnly}
      onMouseDown={(event) =>
        stopAlignmentCardPointer(event, onPointerInteraction)
      }
      onMouseEnter={() => previewAlignmentQuestionFocus(onFocusPreview)}
      onMouseLeave={() =>
        endAlignmentCardFocusPreview(expanded, onFocusPreviewEnd)
      }
      onPointerDown={(event) =>
        stopAlignmentCardPointer(event, onPointerInteraction)
      }
      style={style}
    >
      <button
        aria-describedby={[
          observationId,
          questionId,
          !expanded && displayAnswer ? finalAnswerId : null
        ].filter(Boolean).join(" ")}
        aria-expanded={expanded}
        aria-label={`Open question ${number} editor`}
        className={styles.questionContent}
        disabled={readOnly}
        onClick={() =>
          activateAlignmentQuestionCard(onExpandedChange, onActivate)
        }
        ref={headerRef}
        type="button"
      >
        <span className={styles.questionHeader}>
          <span className={styles.questionNumber}>{number}</span>
          <span className={styles.questionCopy} data-slot="question-copy">
            <span className={styles.questionObservation} id={observationId}>
              {observation}
            </span>
          </span>
        </span>
        <span className={styles.questionText} id={questionId}>{question}</span>
        {!expanded && displayAnswer ? (
          <span
            className={styles.finalAnswer}
            data-slot="complete-answer"
            id={finalAnswerId}
          >
            {displayAnswer}
          </span>
        ) : null}
      </button>

      {expanded && answerOptions.length > 0 ? (
        <div
          className={styles.answerChoices}
          data-custom-active={customActive}
          data-submitting={submitting}
        >
          {answerOptions.map((option) => (
            <button
              aria-label={`Choose ${option.text}`}
              aria-pressed={displaySelectedOptionId === option.id}
              className={styles.answerChoice}
              data-selected={displaySelectedOptionId === option.id}
              disabled={readOnly || submitting}
              key={option.id}
              onClick={() => void submitOption(option)}
              type="button"
            >
              {option.text}
            </button>
          ))}
          {customActive ? (
            <form className={styles.customAnswerEditor} onSubmit={submitAnswer}>
              <label className={styles.srOnly} htmlFor={editorId}>
                Answer question {number}
              </label>
              <textarea
                aria-label={`Answer question ${number}`}
                disabled={readOnly || submitting}
                id={editorId}
                onChange={(event) => setDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (!shouldSubmitAlignmentCustomAnswer({
                    key: event.key,
                    shiftKey: event.shiftKey,
                    isComposing: event.nativeEvent.isComposing
                  })) {
                    return;
                  }
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }}
                ref={textareaRef}
                rows={1}
                value={draft}
              />
            </form>
          ) : (
            <button
              aria-label="Add your answer"
              className={styles.customAnswerTrigger}
              disabled={readOnly || submitting}
              onClick={() => {
                setDraft(
                  customAnswerDraftOnActivation(
                    displaySelectedOptionId,
                    draft
                  )
                );
                setCustomActive(true);
              }}
              type="button"
            >
              Add your answer...
            </button>
          )}
        </div>
      ) : expanded ? (
        <form
          className={styles.customAnswerEditor}
          data-legacy="true"
          data-submitting={submitting}
          onSubmit={submitAnswer}
        >
          <label className={styles.srOnly} htmlFor={editorId}>
            Answer question {number}
          </label>
          <textarea
            aria-label={`Answer question ${number}`}
            disabled={readOnly || submitting}
            id={editorId}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (!shouldSubmitAlignmentCustomAnswer({
                key: event.key,
                shiftKey: event.shiftKey,
                isComposing: event.nativeEvent.isComposing
              })) {
                return;
              }
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }}
            placeholder={draft ? undefined : "Add your answer..."}
            ref={textareaRef}
            rows={1}
            value={draft}
          />
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
  onActivate?: () => void;
  onFocusPreview?: () => void;
  onFocusPreviewEnd?: () => void;
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
  onActivate,
  onFocusPreview,
  onFocusPreviewEnd,
  onPointerInteraction,
  evidenceAnchor: _evidenceAnchor,
  className
}: AgentAnnotationCardProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState("");

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    hugAlignmentAnswerTextarea(textarea);
  }, [draft, editing]);

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
      onMouseEnter={() => previewAlignmentQuestionFocus(onFocusPreview)}
      onMouseLeave={() =>
        endAlignmentCardFocusPreview(editing, onFocusPreviewEnd)
      }
      onPointerDown={(event) =>
        stopAlignmentCardPointer(event, onPointerInteraction)
      }
    >
      <button
        aria-label="Add information to agent annotation"
        className={styles.annotationBrowse}
        onClick={() => {
          onEditingChange(true);
          onActivate?.();
        }}
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
            ref={textareaRef}
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
