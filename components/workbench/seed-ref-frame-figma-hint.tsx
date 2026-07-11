"use client";

import type { CSSProperties } from "react";
import { useEditor, useValue } from "tldraw";

type HintStyle = CSSProperties & {
  "--seed-ref-figma-hint-scale": string;
};

/** Small “Figma Address” label (Figma 284:415) — inverse-scaled like description tip. */
export function SeedRefFrameFigmaHint() {
  const editor = useEditor();
  const zoom = useValue(
    "seed-ref-figma-hint-zoom",
    () => {
      const z = editor.getZoomLevel();
      return z > 0 ? z : 1;
    },
    [editor]
  );
  const style: HintStyle = {
    "--seed-ref-figma-hint-scale": String(1 / zoom),
    transform: "scale(var(--seed-ref-figma-hint-scale))",
    transformOrigin: "center bottom"
  };

  return (
    <span
      className="seed-ref-frame__figma-hint"
      data-testid="seed-reference-projection-figma-hint"
      role="tooltip"
      style={style}
    >
      Figma Address
    </span>
  );
}
