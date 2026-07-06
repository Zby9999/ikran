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
// transition when first revealed.

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent
} from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, CheckIcon } from "@hugeicons/core-free-icons";
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
  onOriginalDesignIntentChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const showConfirmedRow =
    state === "validating" || state === "description" || state === "loading";
  const showDescriptionBlock = state === "description" || state === "loading";
  const canSubmit =
    figmaSeedReference.trim().length > 0 &&
    originalDesignIntent.trim().length > 0;

  // Reveal animation: collapse→expand once when the Description block first
  // appears (validating→description). Stays open across description↔loading so
  // the loading swap does not re-trigger the push-open. prevRevealActiveRef
  // tracks whether the reveal block is already mounted.
  const [revealed, setRevealed] = useState(false);
  const prevRevealActiveRef = useRef(false);
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
      <div className="enter-panel__title">Add a Figma seed page</div>
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
          <input
            className="enter-panel__input enter-panel__input--confirmed"
            data-testid="figma-seed-reference-input"
            value={figmaSeedReference}
            readOnly
            disabled={state === "loading"}
            aria-label="Figma seed reference"
          />
        </div>
      ) : null}

      {showDescriptionBlock ? (
        <div className={`enter-panel__reveal${revealed ? " enter-panel__reveal--open" : ""}`}>
          <div className="enter-panel__reveal-inner">
            <div className="enter-panel__subtitle">Description</div>
            <div className="enter-panel__divider" />
            <div className="enter-panel__description-row">
              {state === "loading" ? (
                <p className="enter-panel__description-copy">{originalDesignIntent}</p>
              ) : (
                <textarea
                  className="enter-panel__textarea"
                  data-testid="original-design-intent-input"
                  value={originalDesignIntent}
                  onChange={(event) => onOriginalDesignIntentChange(event.currentTarget.value)}
                  placeholder="Describe your design shortly"
                  aria-label="Original design intent"
                />
              )}
            </div>

            {state === "description" ? (
              <button
                className="enter-panel__submit"
                type="button"
                disabled={!canSubmit}
                onClick={onSubmit}
              >
                Enter Canvas
              </button>
            ) : null}

            {state === "loading" ? (
              <div
                className="enter-panel__loading"
                aria-live="polite"
                style={{ "--enter-panel-progress": `${progress}%` } as CSSProperties}
              >
                <div className="enter-panel__progress" aria-hidden="true">
                  <span />
                </div>
                <p className="enter-panel__loading-label">
                  Preparing Candidates - {progress}%
                </p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </SquircleChrome>
  );
}