"use client";

import type { ReactNode } from "react";
import { WorkbenchButton } from "@/components/workbench";
import { SettledCheckIcon, StepLoadingIcon } from "./IconBox";
import { stepLabelClassName } from "./step-label";
import { useSquircle } from "./useSquircle";

export type SetupStepVisual = "default" | "loading" | "complete" | "error";
export type StepNumberTone = "gray" | "pink" | "blue";

export function SetupStepButton({
  icon,
  label,
  visual,
  stepNumber,
  stepNumberTone = "gray",
  rowTestId,
  labelTestId,
  onClick,
  disabled = false
}: {
  icon: ReactNode;
  label: string;
  visual: SetupStepVisual;
  stepNumber?: number;
  stepNumberTone?: StepNumberTone;
  rowTestId?: string;
  labelTestId?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const rowRef = useSquircle<HTMLDivElement>(12);
  const buttonRowRef = useSquircle<HTMLButtonElement>(12);
  const isComplete = visual === "complete";
  const rowClassName = `step-row${isComplete ? " step-row--settled" : ""}`;
  const numberToneClass =
    stepNumberTone === "pink"
      ? " active"
      : stepNumberTone === "blue"
        ? " number--blue"
        : "";

  const rowContent = (
    <>
      {visual === "loading" ? <StepLoadingIcon tone="pink" /> : icon}
      <div className="step-fill">
        <p
          className={stepLabelClassName(visual === "error")}
          data-testid={labelTestId}
        >
          {label}
        </p>
        {isComplete ? (
          <SettledCheckIcon />
        ) : stepNumber !== undefined ? (
          <span className={`number${numberToneClass}`}>
            {stepNumber}
          </span>
        ) : null}
      </div>
    </>
  );

  return (
    <div className="step" aria-disabled={disabled || undefined}>
      {onClick ? (
        <WorkbenchButton
          variant={isComplete ? "setupRowSettled" : "setupRow"}
          data-testid={rowTestId}
          disabled={disabled}
          onClick={onClick}
          ref={buttonRowRef}
        >
          {rowContent}
        </WorkbenchButton>
      ) : (
        <div className={rowClassName} data-testid={rowTestId} ref={rowRef}>
          {rowContent}
        </div>
      )}
    </div>
  );
}
