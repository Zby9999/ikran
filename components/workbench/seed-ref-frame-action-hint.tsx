"use client";

import type { CSSProperties } from "react";
import { useEditor, useValue } from "tldraw";

type HintStyle = CSSProperties & {
  "--seed-ref-action-hint-scale": string;
};

/**
 * Small hover/focus label above a header action (Figma Address pattern, 284:415).
 * Inverse-scaled so canvas zoom does not shrink the tip.
 */
export function SeedRefFrameActionHint({
  label,
  testId
}: {
  label: string;
  testId: string;
}) {
  const editor = useEditor();
  const zoom = useValue(
    "seed-ref-action-hint-zoom",
    () => {
      const z = editor.getZoomLevel();
      return z > 0 ? z : 1;
    },
    [editor]
  );
  const style: HintStyle = {
    "--seed-ref-action-hint-scale": String(1 / zoom),
    transform: "scale(var(--seed-ref-action-hint-scale))",
    transformOrigin: "center bottom"
  };

  return (
    <span
      className="seed-ref-frame__action-hint"
      data-testid={testId}
      role="tooltip"
      style={style}
    >
      {label}
    </span>
  );
}
