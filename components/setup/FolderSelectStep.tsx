"use client";

import { WorkbenchButton } from "@/components/workbench";
import { FolderSimpleIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { activeIconGradients } from "./IconGradients";
import { CompleteCheckIcon, IconBox } from "./IconBox";
import { useSquircle } from "./useSquircle";

export type FolderSelectVariant = "inactive" | "default" | "inside-folder" | "complete";

type HelperTone = "default" | "success" | "error";

export function FolderSelectStep({
  variant,
  helper,
  helperTone = "default",
  helperTestId = "folder-helper",
  rowTestId = "select-folder-button",
  onSelectFolder,
  onUseFolderDirectly,
  folderActionDisabled = false,
  useFolderDirectlyDisabled = false
}: {
  variant: FolderSelectVariant;
  helper: ReactNode;
  helperTone?: HelperTone;
  helperTestId?: string;
  rowTestId?: string;
  onSelectFolder?: () => void;
  onUseFolderDirectly?: () => void;
  folderActionDisabled?: boolean;
  useFolderDirectlyDisabled?: boolean;
}) {
  const rowRef = useSquircle<HTMLButtonElement>(12);
  const rowStaticRef = useSquircle<HTMLDivElement>(12);
  const active = variant === "default" || variant === "inside-folder";
  const complete = variant === "complete";
  const mutedLabel = complete && !onSelectFolder;

  const icon = complete ? (
    <CompleteCheckIcon />
  ) : (
    <IconBox tone={active ? "blue" : "gray"}>
      <FolderSimpleIcon
        color={active ? activeIconGradients.folder : "white"}
        size={14}
        weight="fill"
      />
    </IconBox>
  );

  const rowContent = (
    <>
      {icon}
      <div className="step-fill">
        <p className={`step-label ${mutedLabel ? "complete" : ""}`}>Select a Folder</p>
        {!complete ? (
          <span className={`number ${active ? "number--blue" : ""}`}>2</span>
        ) : null}
      </div>
    </>
  );

  return (
    <div className="step" aria-disabled={folderActionDisabled || undefined}>
      {onSelectFolder ? (
        <WorkbenchButton
          variant="setupRow"
          data-testid={rowTestId}
          disabled={folderActionDisabled}
          onClick={onSelectFolder}
          ref={rowRef}
        >
          {rowContent}
        </WorkbenchButton>
      ) : (
        <div className="step-row" ref={rowStaticRef}>
          {rowContent}
        </div>
      )}

      {variant === "inside-folder" ? (
        <div
          className={`folder-step-footer ${helperTone === "error" ? "is-expanded" : ""}`}
        >
          <p
            className={`helper ${helperTone === "default" ? "" : helperTone}`}
            data-testid={helperTestId}
          >
            {helper}
          </p>
          <WorkbenchButton
            variant="subtlePill"
            data-testid="use-folder-directly-button"
            disabled={useFolderDirectlyDisabled}
            onClick={onUseFolderDirectly}
          >
            Use this folder directly
          </WorkbenchButton>
        </div>
      ) : (
        <p
          className={`helper ${helperTone === "default" ? "" : helperTone}`}
          data-testid={helperTestId}
        >
          {helper}
        </p>
      )}
    </div>
  );
}
