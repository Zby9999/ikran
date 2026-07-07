"use client";

// Enter Panel — the single control surface shown while the canvas is locked
// (before the first Figma seed import completes). Figma reference:
// node 133:362 (component states) within the recursive-design-agent file.
//
// States (Figma-owned):
//   default     -> "+" button only
//   address     -> editable Figma URL input
//   validating  -> URL confirmed, green check becomes a spinner (Figma note)
//   description -> static green check + Description block + Enter Canvas
//   loading     -> static description copy + "Preparing Candidates" progress
//
// State transition fix: the address→description step is triggered by Enter /
// blur (a deliberate confirm), NOT by every keystroke — so typing a URL
// char-by-char no longer locks the field read-only after one character.
//
// Smart Animation (Figma note on node 133:382): the Description block fades in
// from the top and pushes the panel open via a grid-template-rows 0fr→1fr
// transition when first revealed. The textarea itself hugs its content and
// animates its height as text wraps, letting the panel grow naturally.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent
} from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, CheckIcon, Delete02Icon } from "@hugeicons/core-free-icons";
import { WorkbenchButton } from "./button";
import { SmallIconButton } from "./small-icon-button";
import { SquircleChrome } from "./squircle-chrome";

export type EnterPanelState =
  | "default"
  | "address"
  | "validating"
  | "description"
  | "loading";

export function EnterPanel({
  state,
  figmaSeedReference,
  originalDesignIntent,
  progress = 0,
  onStart,
  onFigmaSeedReferenceChange,
  onFigmaSeedReferenceConfirm,
  onFigmaSeedReferenceClear,
  onOriginalDesignIntentChange,
  onSubmit
}: {
  state: EnterPanelState;
  figmaSeedReference: string;
  originalDesignIntent: string;
  progress?: number;
  onStart: () => void;
  onFigmaSeedReferenceChange: (value: string) => void;
  onFigmaSeedReferenceConfirm: () => void;
  onFigmaSeedReferenceClear: () => void;
  onOriginalDesignIntentChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const showConfirmedRow =
    state === "validating" || state === "description" || state === "loading";
  const showDescriptionBlock = state === "description" || state === "loading";
  const canSubmit =
    figmaSeedReference.trim().length > 0 &&
    originalDesignIntent.trim().length > 0;
  const boundedProgress = Number.isFinite(progress)
    ? Math.min(100, Math.max(0, Math.round(progress)))
    : 0;

  // Reveal animation: collapse→expand once when the Description block first
  // appears (validating→description). Stays open across description↔loading so
  // the loading swap does not re-trigger the push-open. prevRevealActiveRef
  // tracks whether the reveal block is already mounted.
  const [revealed, setRevealed] = useState(false);
  const prevRevealActiveRef = useRef(false);
  const clearCollapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const REVEAL_MS = 300;

  useEffect(() => {
    return () => {
      if (clearCollapseTimerRef.current) {
        clearTimeout(clearCollapseTimerRef.current);
      }
    };
  }, []);
  useEffect(() => {
    const revealActive = state === "description" || state === "loading";
    if (!revealActive) {
      prevRevealActiveRef.current = false;
      return;
    }
    if (prevRevealActiveRef.current) {
      return; // already revealed — keep it open (no re-animate)
    }
    prevRevealActiveRef.current = true;
    setRevealed(false);
    const raf = requestAnimationFrame(() => setRevealed(true));
    return () => cancelAnimationFrame(raf);
  }, [state]);

  // Auto-resize the description textarea: hugs content from a single line up
  // to a 100px max, animating height changes for the Smart Animation feel.
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const currentHeight = el.offsetHeight;
    el.style.height = "auto";
    const targetHeight = Math.min(el.scrollHeight, 100);
    el.style.height = `${currentHeight}px`;
    requestAnimationFrame(() => {
      el.style.height = `${targetHeight}px`;
      el.scrollTop = 0;
    });
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [originalDesignIntent, resizeTextarea]);

  // Re-measure once the reveal animation finishes so the textarea is sized
  // correctly after the panel has grown open.
  useEffect(() => {
    if (!revealed) return;
    const timer = setTimeout(resizeTextarea, 320);
    return () => clearTimeout(timer);
  }, [revealed, resizeTextarea]);

  const handleClearFigmaSeed = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (state === "loading") return;

      if (state === "description") {
        setRevealed(false);
        if (clearCollapseTimerRef.current) {
          clearTimeout(clearCollapseTimerRef.current);
        }
        clearCollapseTimerRef.current = setTimeout(() => {
          clearCollapseTimerRef.current = null;
          onFigmaSeedReferenceClear();
        }, REVEAL_MS);
        return;
      }

      onFigmaSeedReferenceClear();
    },
    [state, onFigmaSeedReferenceClear]
  );

  return (
    <SquircleChrome
      className="enter-panel-chrome"
      surfaceTag="section"
      surfaceClassName="enter-panel"
      surfaceProps={{
        "data-testid": "enter-panel",
        "data-state": state,
        "aria-label": "Add a Figma seed page",
        onClick: (event: MouseEvent) => event.stopPropagation()
      }}
    >
      <div className="enter-panel__title-row">
        <div className="enter-panel__title">Add a Figma seed page</div>
      </div>
      <div className="enter-panel__divider" />

      {state === "default" ? (
        <div className="enter-panel__action-slot">
          <SmallIconButton
            icon={Add01Icon}
            label="Add Figma seed page"
            data-testid="seed-add-button"
            onClick={onStart}
          />
        </div>
      ) : null}

      {state === "address" ? (
        <div className="enter-panel__action-slot">
          <input
            className="enter-panel__input enter-panel__input--inline"
            data-testid="figma-seed-reference-input"
            value={figmaSeedReference}
            onChange={(event) => onFigmaSeedReferenceChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onFigmaSeedReferenceConfirm();
            }}
            onBlur={() => {
              if (figmaSeedReference.trim()) onFigmaSeedReferenceConfirm();
            }}
            placeholder="Paste your Figma design address here."
            aria-label="Figma seed reference"
            autoFocus
          />
        </div>
      ) : null}

      {showConfirmedRow ? (
        <div className="enter-panel__field-row enter-panel__field-row--confirmed">
          <span
            className={
              state === "validating"
                ? "enter-panel__check enter-panel__check--validating"
                : "enter-panel__check"
            }
            aria-hidden="true"
          >
            {state !== "validating" ? (
              <HugeiconsIcon icon={CheckIcon} size={8.167} color="currentColor" strokeWidth={2} />
            ) : null}
          </span>
          <div className="enter-panel__field-value">
            <input
              className="enter-panel__input enter-panel__input--confirmed"
              data-testid="figma-seed-reference-input"
              value={figmaSeedReference}
              readOnly
              disabled={state === "loading"}
              aria-label="Figma seed reference"
            />
            {state === "description" ? (
              <button
                type="button"
                className="enter-panel__clear"
                data-testid="figma-seed-reference-clear"
                aria-label="Clear Figma seed reference"
                onClick={handleClearFigmaSeed}
              >
                <HugeiconsIcon
                  icon={Delete02Icon}
                  size={14}
                  color="currentColor"
                  strokeWidth={1.5}
                />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {showDescriptionBlock ? (
        <div className={`enter-panel__reveal${revealed ? " enter-panel__reveal--open" : ""}`}>
          <div className="enter-panel__reveal-inner">
            <div className="enter-panel__title-row">
              <div className="enter-panel__subtitle">Description</div>
            </div>
            <div className="enter-panel__divider" />
            <div className="enter-panel__description-row">
              {state === "loading" ? (
                <p className="enter-panel__description-copy">{originalDesignIntent}</p>
              ) : (
                <textarea
                  ref={textareaRef}
                  className="enter-panel__textarea"
                  data-testid="original-design-intent-input"
                  value={originalDesignIntent}
                  onChange={(event) => onOriginalDesignIntentChange(event.currentTarget.value)}
                  placeholder="Describe your design shortly"
                  aria-label="Original design intent"
                  rows={1}
                />
              )}
            </div>

            {state === "description" ? (
              <WorkbenchButton
                variant="enterPanelSubmit"
                disabled={!canSubmit}
                onClick={onSubmit}
              >
                Enter Canvas
              </WorkbenchButton>
            ) : null}

            {state === "loading" ? (
              <div
                className="enter-panel__loading"
                aria-live="polite"
                data-progress-complete={boundedProgress === 100 ? "true" : "false"}
                style={{ "--enter-panel-progress": `${boundedProgress}%` } as CSSProperties}
              >
                <div className="enter-panel__progress" aria-hidden="true">
                  <span />
                </div>
                <p className="enter-panel__loading-label">
                  Preparing Candidates - {boundedProgress}%
                </p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </SquircleChrome>
  );
}
