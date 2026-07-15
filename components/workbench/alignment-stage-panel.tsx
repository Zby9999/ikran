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
export type AlignmentCoverage = Record<AlignmentStageId, boolean>;
export type AlignmentQuestionCoverage = Partial<
  Record<AlignmentStageId, readonly boolean[]>
>;

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
  className?: string;
};

export function AlignmentStagePanel({
  currentStage,
  coverage,
  onStageChange,
  onComplete,
  completed = false,
  className
}: AlignmentStagePanelProps) {
  const canComplete =
    !completed && ALIGNMENT_STAGES.every(({ id }) => coverage[id]);

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
