"use client";

import type { CSSProperties } from "react";
import { CheckIcon } from "@phosphor-icons/react";

import styles from "./alignment-ui.module.css";

export const ALIGNMENT_STAGES = [
  { id: "design-principle", label: "Design principle", color: "#c97759" },
  { id: "visual-language", label: "Visual language", color: "#4178ba" },
  { id: "token", label: "Token", color: "#be5fde" },
  { id: "layout", label: "Layout", color: "#dc3a91" },
  { id: "component", label: "Component", color: "#3db0ac" },
  { id: "interaction", label: "Interaction", color: "#b8c807" }
] as const;

export type AlignmentStageId = (typeof ALIGNMENT_STAGES)[number]["id"];
export const DEFAULT_ALIGNMENT_STAGE: AlignmentStageId = ALIGNMENT_STAGES[0].id;
export type AlignmentCoverage = Record<AlignmentStageId, boolean>;
export type AlignmentQuestionCoverage = Partial<
  Record<AlignmentStageId, readonly boolean[]>
>;

export type AlignmentQuestionProgress = {
  stageCompleted: number;
  stageTotal: number;
  overallCompleted: number;
  overallTotal: number;
};

/** One Extraction progress bar — ordered by section, then card order. */
export type AlignmentQuestionSegment = {
  id: string;
  stageId: AlignmentStageId;
  color: string;
  answered: boolean;
};

/** Paper 42S-0 — Extraction panel progress colors only (not card/stage accents). */
export const EXTRACTION_PROGRESS_STAGE_COLORS: Record<AlignmentStageId, string> =
  {
    "design-principle": "#e78460",
    "visual-language": "#5192e1",
    token: "#c774e4",
    layout: "#e863a4",
    component: "#5cc7c3",
    interaction: "#c1d03c"
  };

export function getAlignmentQuestionProgress(
  coverage: {
    sections: readonly {
      section: AlignmentStageId;
      question_count: number;
      covered_count: number;
      complete: boolean;
    }[];
    total_questions: number;
    can_complete: boolean;
  },
  currentStage: AlignmentStageId
): AlignmentQuestionProgress {
  const stage = coverage.sections.find(
    (section) => section.section === currentStage
  );
  return {
    stageCompleted: stage?.covered_count ?? 0,
    stageTotal: stage?.question_count ?? 0,
    overallCompleted: coverage.sections.reduce(
      (total, section) => total + section.covered_count,
      0
    ),
    overallTotal: coverage.total_questions
  };
}

/**
 * Paper 42S-0 / Figma 678:1335 — one bar per question card, section order first,
 * then relative card order within each section. Answered = non-empty final_answer.
 * Colors are Extraction-panel-only (EXTRACTION_PROGRESS_STAGE_COLORS).
 */
export function getAlignmentQuestionSegments(
  cards: readonly {
    id: string;
    section: AlignmentStageId;
    final_answer: string | null;
  }[]
): AlignmentQuestionSegment[] {
  return ALIGNMENT_STAGES.flatMap(({ id: stageId }) =>
    cards
      .filter((card) => card.section === stageId)
      .map((card) => ({
        id: card.id,
        stageId,
        color: EXTRACTION_PROGRESS_STAGE_COLORS[stageId],
        answered: (card.final_answer?.trim() ?? "").length > 0
      }))
  );
}

export function getAlignmentCoverage(
  questions: AlignmentQuestionCoverage
): AlignmentCoverage {
  return Object.fromEntries(
    ALIGNMENT_STAGES.map(({ id }) => {
      const stageQuestions = questions[id] ?? [];
      return [id, stageQuestions.length > 0 && stageQuestions.every(Boolean)];
    })
  ) as unknown as AlignmentCoverage;
}

export type AlignmentStagePanelProps = {
  currentStage: AlignmentStageId;
  coverage: AlignmentCoverage;
  onStageChange: (stage: AlignmentStageId) => void;
  onComplete: () => void;
  completed?: boolean;
  completionEnabled?: boolean;
  className?: string;
};

export function AlignmentStagePanel({
  currentStage,
  coverage,
  onStageChange,
  onComplete,
  completed = false,
  completionEnabled = true,
  className
}: AlignmentStagePanelProps) {
  const canComplete =
    completionEnabled &&
    !completed &&
    ALIGNMENT_STAGES.every(({ id }) => coverage[id]);

  return (
    <nav
      aria-label="Design intent alignment stages"
      className={[styles.stagePanel, className].filter(Boolean).join(" ")}
      data-stage-count={ALIGNMENT_STAGES.length}
      data-current-stage={currentStage}
      data-default-view="current"
    >
      <div className={styles.stageList}>
        {ALIGNMENT_STAGES.map((stage) => {
          const current = stage.id === currentStage;
          const complete = coverage[stage.id];
          const style = { "--alignment-accent": stage.color } as CSSProperties;

          return (
            <button
              aria-current={current ? "step" : undefined}
              className={styles.stageButton}
              data-complete={complete}
              data-current={current}
              data-stage={stage.id}
              key={stage.id}
              onClick={() => onStageChange(stage.id)}
              style={style}
              type="button"
            >
              {complete ? (
                <span aria-hidden="true" className={styles.stageCheck}>
                  <CheckIcon size={11.2} weight="bold" />
                </span>
              ) : null}
              <span>{stage.label}</span>
            </button>
          );
        })}
      </div>

      <div className={styles.completeTray}>
        <button
          aria-label="Complete alignment"
          className={styles.completeButton}
          disabled={!canComplete}
          onClick={onComplete}
          type="button"
        >
          {completed ? "Completed" : "Complete"}
        </button>
      </div>
    </nav>
  );
}
