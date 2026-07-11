"use client";

// Description tip for seed-reference projections (Figma 227:130).
// Lives inside the tldraw HTMLContainer, so camera zoom would otherwise scale
// typography/size. Inverse-scale keeps the tip screen-space constant while
// CSS position on `.seed-ref-frame__tip-anchor` keeps it anchored to the
// info icon. transform-origin: right bottom matches right-aligned tip.

import type { CSSProperties } from "react";
import { useEditor, useValue } from "tldraw";

/** Fixed page-pixel gap between tip bottom and seed-ref header top. Tune here. */
export const SEED_REF_TIP_GAP_PX = 10;

type AnchorStyle = CSSProperties & {
  "--seed-ref-tip-gap": string;
};

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
  const anchorStyle: AnchorStyle = {
    "--seed-ref-tip-gap": `${SEED_REF_TIP_GAP_PX}px`
  };
  const tipStyle: TipStyle = {
    "--seed-ref-tip-scale": String(1 / zoom),
    transform: "scale(var(--seed-ref-tip-scale))",
    transformOrigin: "right bottom"
  };

  return (
    <div className="seed-ref-frame__tip-anchor" style={anchorStyle}>
      <div
        className="seed-ref-frame__tip"
        data-testid="seed-reference-projection-tip"
        role="tooltip"
        style={tipStyle}
      >
        {description}
      </div>
    </div>
  );
}
