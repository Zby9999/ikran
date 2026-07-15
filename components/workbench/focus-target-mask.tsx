"use client";

import { useId, type CSSProperties, type TransitionEvent } from "react";
import type { FocusTarget } from "./focus-mode";
import "./focus-target-mask.css";

export type FocusTargetMaskProps = {
  phase: "active" | "exiting";
  surfaceArtifactId: string;
  evidenceVersionId: string;
  targets: readonly FocusTarget[];
  /** Complete the reducer's exiting phase after the short opacity fade. */
  onFadeOutComplete?: () => void;
  style?: CSSProperties;
};

export function focusTargetsForSurface(
  targets: readonly FocusTarget[],
  surfaceArtifactId: string,
  evidenceVersionId: string
): FocusTarget[] {
  return targets.filter(
    (target) =>
      target.surfaceArtifactId === surfaceArtifactId &&
      target.evidenceVersionId === evidenceVersionId
  );
}

/**
 * Screenshot-relative dimming projection. The SVG mask leaves every linked
 * target rect transparent, so the original screenshot pixels remain visible.
 */
export function FocusTargetMask({
  phase,
  surfaceArtifactId,
  evidenceVersionId,
  targets,
  onFadeOutComplete,
  style
}: FocusTargetMaskProps) {
  const maskId = `focus-target-mask-${useId().replaceAll(":", "")}`;
  const visibleTargets = focusTargetsForSurface(
    targets,
    surfaceArtifactId,
    evidenceVersionId
  );
  if (visibleTargets.length === 0) return null;

  const handleTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (
      phase === "exiting" &&
      event.propertyName === "opacity" &&
      event.currentTarget === event.target
    ) {
      onFadeOutComplete?.();
    }
  };

  return (
    <div
      className="focus-target-mask"
      data-testid="focus-target-mask"
      data-state={phase}
      data-surface-artifact-id={surfaceArtifactId}
      data-evidence-version-id={evidenceVersionId}
      aria-hidden="true"
      onTransitionEnd={handleTransitionEnd}
      style={style}
    >
      <svg
        className="focus-target-mask__svg"
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
      >
        <defs>
          <mask
            id={maskId}
            maskUnits="userSpaceOnUse"
            maskContentUnits="userSpaceOnUse"
            x="0"
            y="0"
            width="1"
            height="1"
          >
            <rect x="0" y="0" width="1" height="1" fill="white" />
            {visibleTargets.map((target) => (
              <rect
                key={target.targetId}
                data-focus-target-id={target.targetId}
                x={target.rect.x}
                y={target.rect.y}
                width={target.rect.width}
                height={target.rect.height}
                fill="black"
              />
            ))}
          </mask>
        </defs>
        <rect
          className="focus-target-mask__dimmer"
          x="0"
          y="0"
          width="1"
          height="1"
          mask={`url(#${maskId})`}
        />
      </svg>
    </div>
  );
}
