"use client";

import { WorkbenchButton } from "@/components/workbench";
import { FolderSimpleIcon } from "@phosphor-icons/react";
import { activeIconGradients } from "./IconGradients";
import { IconBox, SettledCheckIcon, StepLoadingIcon } from "./IconBox";
import { stepLabelClassName } from "./step-label";
import { useSquircle } from "./useSquircle";

export type FolderSelectVariant =
  | "inactive"
  | "default"
  | "loading"
  | "complete"
  | "error";

const FOLDER_LABELS: Record<Exclude<FolderSelectVariant, "complete">, string> =
  {
    inactive: "Project Folder",
    default: "Project Folder",
    loading: "Loading...",
    error: "Folder bind failed"
  };

export function FolderSelectStep({
  variant,
  folderName,
  label,
  rowTestId = "select-folder-button",
  labelTestId = "folder-label",
  onSelectFolder,
  folderActionDisabled = false
}: {
  variant: FolderSelectVariant;
  folderName?: string;
  label?: string;
  rowTestId?: string;
  labelTestId?: string;
  onSelectFolder?: () => void;
  folderActionDisabled?: boolean;
}) {
  const rowRef = useSquircle<HTMLButtonElement>(12);
  const rowStaticRef = useSquircle<HTMLDivElement>(12);
  const complete = variant === "complete";
  const accented =
    variant === "default" ||
    variant === "loading" ||
    variant === "error" ||
    complete;
  // Initialize / retry: default (needs confirm) and error (bind failed).
  const canSelectFolder =
    (variant === "default" || variant === "error") &&
    Boolean(onSelectFolder) &&
    !folderActionDisabled;
  const resolvedLabel =
    label ??
    (variant === "complete" && folderName
      ? `/${folderName} connected`
      : FOLDER_LABELS[variant === "complete" ? "default" : variant]);

  const icon =
    variant === "loading" ? (
      <StepLoadingIcon tone="blue" />
    ) : (
      <IconBox tone={accented ? "blue" : "gray"}>
        <FolderSimpleIcon
          color={accented ? activeIconGradients.folder : "white"}
          size={14}
          weight="fill"
        />
      </IconBox>
    );

  const rowContent = (
    <>
      {icon}
      <div className="step-fill">
        <p
          className={stepLabelClassName(variant === "error")}
          data-testid={labelTestId}
        >
          {resolvedLabel}
        </p>
        {complete ? (
          <SettledCheckIcon />
        ) : (
          <span className={`number ${accented ? "number--blue" : ""}`}>2</span>
        )}
      </div>
    </>
  );

  return (
    <div className="step" aria-disabled={folderActionDisabled || undefined}>
      {canSelectFolder ? (
        <WorkbenchButton
          variant="setupRow"
          data-testid={rowTestId}
          onClick={onSelectFolder}
          ref={rowRef}
        >
          {rowContent}
        </WorkbenchButton>
      ) : (
        <div
          className={`step-row${complete ? " step-row--settled" : ""}`}
          data-testid={rowTestId}
          ref={rowStaticRef}
        >
          {rowContent}
        </div>
      )}
    </div>
  );
}
