"use client";

import {
  ArrowLeft01Icon,
  ArtboardToolIcon,
  Cursor02Icon,
  FigmaIcon,
  GridIcon
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";
import { SmallIconButton } from "./small-icon-button";
import { SquircleChrome } from "./squircle-chrome";
import { cn } from "@/lib/utils";
import type { AlignmentQuestionSegment } from "./alignment-stage-panel";
import type { FolderPageItem } from "./folder-page-list";

export type FolderChromeExtraction = {
  segments: readonly AlignmentQuestionSegment[];
};

/**
 * Post-gate folder stages.
 *   `sign-seed` / `extraction` / `prototype` — Figma 905:6680 Left Top Main Panel
 *   `build` — Variant4, Setup end state (no Set up row, no hint)
 */
export type FolderChromePhase =
  | "sign-seed"
  | "extraction"
  | "prototype"
  | "build";

export type FolderSetupSquareState = "pending" | "current" | "done";

export type FolderChromeProps = {
  folderName: string;
  onBack: () => void;
  backLabel?: string;
  /**
   * `null` — compact Default (back + name only).
   * `sign-seed` — Set up + Sign Seed Design + Complete.
   * `extraction` — Set up + Extraction + Complete.
   * `prototype` — Set up + Draft Design System + Complete.
   * `build` — Design System button + page list + Build label.
   */
  phase?: FolderChromePhase | null;
  /** Gates Sign Seed Complete (Figma unactive until at least one seed). */
  seedCount?: number;
  extraction?: FolderChromeExtraction | null;
  /** Extraction Complete: all six sections answered. */
  completeEnabled?: boolean;
  /** After Agent finalize: six-part questions are ready for the designer. */
  questionsReady?: boolean;
  /**
   * After Complete, while `prepare_initial_design_system` is still pending or
   * claimed: the hint tells the designer the Agent is writing the Draft Design
   * System.
   */
  designSystemPreparing?: boolean;
  /**
   * Prototype phase, while no preview is `ready` yet: the hint tells the
   * designer the Agent is building the prototype.
   */
  prototypePreparing?: boolean;
  /** After Complete, squares turn green and the hint switches. */
  completed?: boolean;
  /** Build panel page list — Figma seed pages and prototype pages. */
  pages?: readonly FolderPageItem[];
  selectedPageId?: string | null;
  onSelectPage?: (pageId: string) => void;
  /** Prototype "Draft Design System" / Build "Design System" — existing browser. */
  onOpenDesignSystem?: () => void;
  /** Sign Seed Complete — Runtime prepare (next phase). */
  onNextPhase?: () => void;
  /** Extraction Complete — Runtime complete alignment. */
  onComplete?: () => void;
  /** Prototype Complete — Runtime confirm prototype. */
  onConfirmPrototype?: () => void;
  onSelect?: () => void;
  /** When true, Select button shows selected/active state (Figma 329:461). */
  selectActive?: boolean;
  onAnnotate?: () => void;
  /** When true, Annotate button shows selected/active state (Figma 325:422). */
  annotateActive?: boolean;
};

const SETUP_SQUARE_COUNT = 3;

function setupSquareStates(
  phase: FolderChromePhase,
  completed: boolean
): FolderSetupSquareState[] {
  if (phase === "sign-seed") {
    return ["current", "pending", "pending"];
  }
  if (phase === "extraction") {
    return completed
      ? ["done", "done", "pending"]
      : ["done", "current", "pending"];
  }
  if (phase === "prototype") {
    return ["done", "done", "current"];
  }
  return ["pending", "pending", "pending"];
}

function folderHint(
  phase: FolderChromePhase | null,
  completed: boolean,
  seedCount = 0,
  questionsReady = false,
  designSystemPreparing = false,
  prototypePreparing = false
): string | null {
  if (phase === "sign-seed") {
    return seedCount >= 1
      ? "Add a design language description"
      : "Paste a Figma reference";
  }
  if (phase === "extraction") {
    if (completed) {
      return designSystemPreparing
        ? "Creating Draft Design System"
        : "Iterate with Agent, or go next";
    }
    return questionsReady ? "Answer the questions" : "Extracting";
  }
  if (phase === "prototype") {
    if (prototypePreparing) return "Making a prototype";
    return completed
      ? "Ask the Agent to continue"
      : "Review and iterate the prototype";
  }
  return null;
}

function stageLabel(phase: FolderChromePhase): string {
  if (phase === "sign-seed") return "Sign Seed Design";
  if (phase === "extraction") return "Extraction";
  if (phase === "prototype") return "Prototype";
  return "Build";
}

function FolderToolButton({
  label,
  testId,
  active,
  icon,
  onClick
}: {
  label: string;
  testId: string;
  active: boolean;
  icon: IconSvgElement;
  onClick?: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="seed-workbench__folder-tool"
          data-testid={testId}
          data-active={active ? "true" : undefined}
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
        >
          <HugeiconsIcon
            icon={icon}
            size={14}
            color="currentColor"
            strokeWidth={1.5}
          />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function FolderToolSwitch({
  selectActive,
  annotateActive,
  onSelect,
  onAnnotate
}: {
  selectActive: boolean;
  annotateActive: boolean;
  onSelect?: () => void;
  onAnnotate?: () => void;
}) {
  return (
    <TooltipProvider>
      <div className="seed-workbench__folder-tool-switch" role="group" aria-label="Canvas tools">
        <FolderToolButton
          label="Select (V)"
          testId="select-button"
          active={selectActive}
          icon={Cursor02Icon}
          onClick={onSelect}
        />
        <FolderToolButton
          label="Annotate on Figma (F)"
          testId="annotate-button"
          active={annotateActive}
          icon={ArtboardToolIcon}
          onClick={onAnnotate}
        />
      </div>
    </TooltipProvider>
  );
}

function FolderSetupRow({
  phase,
  completed
}: {
  phase: Exclude<FolderChromePhase, "build">;
  completed: boolean;
}) {
  const squares = setupSquareStates(phase, completed);
  return (
    <div className="seed-workbench__folder-setup" data-testid="folder-setup-row">
      <div className="seed-workbench__folder-setup-leading">
        <span className="seed-workbench__folder-setup-label">Set up</span>
        <span className="seed-workbench__folder-setup-squares" aria-hidden="true">
          {Array.from({ length: SETUP_SQUARE_COUNT }, (_, index) => (
            <span
              key={index}
              className="seed-workbench__folder-setup-square"
              data-state={squares[index]}
              data-testid="folder-setup-square"
            />
          ))}
        </span>
      </div>
      <span className="seed-workbench__folder-stage-label">{stageLabel(phase)}</span>
    </div>
  );
}

function FolderCompleteButton({
  disabled,
  testId,
  ariaLabel,
  onClick,
  label = "Complete"
}: {
  disabled: boolean;
  testId: string;
  ariaLabel?: string;
  onClick?: () => void;
  label?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      className="seed-workbench__folder-next"
      data-testid={testId}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

export function FolderChrome({
  folderName,
  onBack,
  backLabel = "Back to setup",
  phase = null,
  seedCount = 0,
  completeEnabled = false,
  questionsReady = false,
  designSystemPreparing = false,
  prototypePreparing = false,
  completed = false,
  pages = [],
  selectedPageId = null,
  onSelectPage,
  onOpenDesignSystem,
  onNextPhase,
  onComplete,
  onConfirmPrototype,
  onSelect,
  selectActive = false,
  onAnnotate,
  annotateActive = false
}: FolderChromeProps) {
  const showActions = phase !== null;
  const showSignSeed = phase === "sign-seed";
  const showExtraction = phase === "extraction";
  const showPrototype = phase === "prototype";
  const showBuild = phase === "build";
  const showSetup = showSignSeed || showExtraction || showPrototype;
  const hint = folderHint(
    phase,
    completed,
    seedCount,
    questionsReady,
    designSystemPreparing,
    prototypePreparing
  );
  const signSeedCompleteEnabled = seedCount >= 1;
  const extractionCompleteEnabled = completeEnabled && !completed;

  return (
    <div className="seed-workbench__folder-shell">
      <SquircleChrome
        className={cn(
          "seed-workbench__folder",
          showActions && "seed-workbench__folder--expanded"
        )}
        surfaceClassName={cn(
          "seed-workbench__folder-body",
          !showActions && "seed-workbench__folder-body--compact"
        )}
        cornerRadius={14}
      >
        <div className="seed-workbench__folder-row">
          <div className="seed-workbench__folder-leading">
            <SmallIconButton
              className="seed-workbench__folder-back"
              icon={ArrowLeft01Icon}
              label={backLabel}
              onClick={onBack}
            />
            <span className="seed-workbench__folder-name">{folderName || "Folder Name"}</span>
          </div>
          {showActions ? (
            <FolderToolSwitch
              selectActive={selectActive}
              annotateActive={annotateActive}
              onSelect={onSelect}
              onAnnotate={onAnnotate}
            />
          ) : null}
        </div>

        {showSetup ? (
          <>
            <div className="seed-workbench__folder-divider" role="separator" />
            {showSignSeed ? (
              <div
                className="seed-workbench__folder-stage"
                data-testid="seed-workbench-sign-seed"
              >
                <FolderSetupRow phase="sign-seed" completed={false} />
                <FolderCompleteButton
                  disabled={!signSeedCompleteEnabled}
                  testId="sign-seed-next-phase"
                  onClick={onNextPhase}
                />
              </div>
            ) : null}

            {showExtraction ? (
              <div
                className="seed-workbench__folder-stage"
                data-testid="seed-workbench-extraction"
              >
                <FolderSetupRow phase="extraction" completed={completed} />
                <FolderCompleteButton
                  disabled={!extractionCompleteEnabled}
                  testId="folder-extraction-complete"
                  ariaLabel={
                    completed ? "Waiting for Agent" : "Complete alignment"
                  }
                  label={completed ? "Waiting for Agent" : "Complete"}
                  onClick={onComplete}
                />
              </div>
            ) : null}

            {showPrototype ? (
              <div
                className="seed-workbench__folder-prototype"
                data-testid="seed-workbench-prototype"
              >
                <FolderSetupRow phase="prototype" completed={completed} />
                <Button
                  type="button"
                  variant="ghost"
                  className="seed-workbench__folder-next"
                  data-testid="folder-draft-design-system-button"
                  onClick={onOpenDesignSystem}
                >
                  Draft Design System
                </Button>
                <div className="seed-workbench__folder-divider" role="separator" />
                <FolderCompleteButton
                  disabled={completed || prototypePreparing}
                  testId="folder-prototype-complete"
                  onClick={onConfirmPrototype}
                />
              </div>
            ) : null}
          </>
        ) : null}

        {showBuild ? (
          <>
            <Button
              type="button"
              variant="ghost"
              className="seed-workbench__folder-next"
              data-testid="folder-design-system-button"
              onClick={onOpenDesignSystem}
            >
              Design System
            </Button>
            <div className="seed-workbench__folder-divider" role="separator" />
            <div
              className="seed-workbench__folder-build"
              data-testid="seed-workbench-build"
            >
              <div className="seed-workbench__folder-build-heading">
                <span className="seed-workbench__folder-build-label">Build</span>
              </div>
              {pages.length > 0 ? (
                <ul
                  className="seed-workbench__folder-pages"
                  data-testid="folder-page-list"
                >
                  {pages.map((page) => {
                    const selected = page.id === selectedPageId;
                    return (
                      <li key={page.id}>
                        <button
                          type="button"
                          className={cn(
                            "seed-workbench__folder-page",
                            selected && "seed-workbench__folder-page--selected"
                          )}
                          data-testid="folder-page-item"
                          data-page-id={page.id}
                          data-page-kind={page.kind}
                          data-selected={selected ? "true" : undefined}
                          aria-current={selected ? "true" : undefined}
                          onClick={() => onSelectPage?.(page.id)}
                        >
                          <HugeiconsIcon
                            className="seed-workbench__folder-page-icon"
                            icon={page.kind === "figma" ? FigmaIcon : GridIcon}
                            size={14}
                            color="currentColor"
                            strokeWidth={1.5}
                          />
                          <span className="seed-workbench__folder-page-label">
                            {page.label}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          </>
        ) : null}
      </SquircleChrome>

      {hint ? (
        <div className="seed-workbench__folder-hint" data-testid="folder-hint">
          <span className="seed-workbench__folder-hint-text">{hint}</span>
        </div>
      ) : null}
    </div>
  );
}
