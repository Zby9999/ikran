"use client";

// Description tip for seed-reference projections (Figma 227:130).
// Lives inside the tldraw HTMLContainer, so camera zoom would otherwise scale
// typography/size. Inverse-scale keeps the tip screen-space constant while
// CSS position (right/bottom on `.seed-ref-frame__tip`) keeps it anchored to
// the info icon. transform-origin: right bottom matches the tip's bottom-right
// alignment toward the icon.

import type { CSSProperties } from "react";
import { useEditor, useValue } from "tldraw";

type TipStyle = CSSProperties & {
  "--seed-ref-tip-scale": string;
};

export function SeedReferenceDescriptionTip({
  description
}: {
  description: string;
}) {
  const editor = useEditor();
  const zoom = useValue(
    "seed-ref-description-tip-zoom",
    () => {
      const z = editor.getZoomLevel();
      return z > 0 ? z : 1;
    },
    [editor]
  );
  const style: TipStyle = {
    "--seed-ref-tip-scale": String(1 / zoom),
    transform: "scale(var(--seed-ref-tip-scale))",
    transformOrigin: "right bottom"
  };

  return (
    <div
      className="seed-ref-frame__tip"
      data-testid="seed-reference-projection-tip"
      role="tooltip"
      style={style}
    >
      {description}
    </div>
  );
}
