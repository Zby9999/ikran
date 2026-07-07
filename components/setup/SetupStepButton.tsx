"use client";

import type { ReactNode } from "react";
import { WorkbenchButton } from "@/components/workbench";
import { SettledCheckIcon } from "./IconBox";
import { useSquircle } from "./useSquircle";

type HelperTone = "default" | "success" | "error";
type StepNumberTone = "gray" | "pink" | "blue";

export function SetupStepButton({
  icon,
  label,
  helper,
  stepNumber,
  stepNumberActive = false,
  stepNumberTone = "gray",
  labelComplete = false,
  helperTone = "default",
  helperTestId,
  rowTestId,
  onClick,
  disabled = false
}: {
  icon: ReactNode;
  label: string;
  helper: ReactNode;
  stepNumber?: number;
  stepNumberActive?: boolean;
  stepNumberTone?: StepNumberTone;
  labelComplete?: boolean;
  helperTone?: HelperTone;
  helperTestId?: string;
  rowTestId?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const rowRef = useSquircle<HTMLDivElement>(12);
  const buttonRowRef = useSquircle<HTMLButtonElement>(12);
  const rowClassName = `step-row${labelComplete ? " step-row--settled" : ""}`;

  const rowContent = (
    <>
      {icon}
      <div className="step-fill">
        <p className={`step-label ${labelComplete ? "complete" : ""}`}>
          {label}
        </p>
        {labelComplete ? (
          <SettledCheckIcon />
        ) : stepNumber !== undefined ? (
          <span
            className={`number ${stepNumberActive ? "active" : ""} ${
              stepNumberTone === "blue" ? "number--blue" : ""
            }`}
          >
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
          variant="setupRow"
          data-testid={rowTestId}
          disabled={disabled}
          onClick={onClick}
          ref={buttonRowRef}
        >
          {rowContent}
        </WorkbenchButton>
      ) : (
        <div className={rowClassName} ref={rowRef}>
          {rowContent}
        </div>
      )}
      <p
        className={`helper ${helperTone === "default" ? "" : helperTone}`}
        data-testid={helperTestId}
      >
        {helper}
      </p>
    </div>
  );
}
