"use client";

// Decorative camera-aware 100px page-space grid (Figma 133:129).
//
// Visual only — not tldraw Grid Mode. We render via `Background` so shapes can
// drag freely with no snap-to-grid. Lines are page-space 100px, converted to
// canvas pixels with the live camera (x/y/z). Stroke is 5% black.

import { useLayoutEffect, useRef } from "react";
import {
  useEditor,
  useValue,
  type TLComponents
} from "tldraw";

const GRID_STROKE = "rgba(0, 0, 0, 0.05)";
const GRID_LINE_WIDTH = 1;
/** Page-space grid size matching Figma 133:129 (100px × 100px). */
export const WORKBENCH_GRID_SIZE = 100;

function WorkbenchGridBackground() {
  const editor = useEditor();
  const camera = useValue("camera", () => editor.getCamera(), [editor]);
  const screenBounds = useValue(
    "screenBounds",
    () => editor.getViewportScreenBounds(),
    [editor]
  );
  const devicePixelRatio = useValue(
    "dpr",
    () => editor.getInstanceState().devicePixelRatio,
    [editor]
  );
  const canvas = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    if (!canvas.current) return;

    const canvasW = screenBounds.w * devicePixelRatio;
    const canvasH = screenBounds.h * devicePixelRatio;
    canvas.current.width = canvasW;
    canvas.current.height = canvasH;

    const ctx = canvas.current.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.fillStyle = "#dcdcdc";
    ctx.fillRect(0, 0, canvasW, canvasH);

    ctx.strokeStyle = GRID_STROKE;
    ctx.lineWidth = GRID_LINE_WIDTH * devicePixelRatio;

    const size = WORKBENCH_GRID_SIZE;
    const pageViewportBounds = editor.getViewportPageBounds();
    const startPageX = Math.ceil(pageViewportBounds.minX / size) * size;
    const startPageY = Math.ceil(pageViewportBounds.minY / size) * size;
    const endPageX = Math.floor(pageViewportBounds.maxX / size) * size;
    const endPageY = Math.floor(pageViewportBounds.maxY / size) * size;
    const numRows = Math.round((endPageY - startPageY) / size);
    const numCols = Math.round((endPageX - startPageX) / size);

    for (let row = 0; row <= numRows; row++) {
      const pageY = startPageY + row * size;
      const canvasY = (pageY + camera.y) * camera.z * devicePixelRatio;
      ctx.beginPath();
      ctx.moveTo(0, canvasY);
      ctx.lineTo(canvasW, canvasY);
      ctx.stroke();
    }

    for (let col = 0; col <= numCols; col++) {
      const pageX = startPageX + col * size;
      const canvasX = (pageX + camera.x) * camera.z * devicePixelRatio;
      ctx.beginPath();
      ctx.moveTo(canvasX, 0);
      ctx.lineTo(canvasX, canvasH);
      ctx.stroke();
    }
  }, [screenBounds, camera, devicePixelRatio, editor]);

  return (
    <canvas
      className="tl-background seed-workbench__grid-canvas"
      ref={canvas}
      aria-hidden="true"
    />
  );
}

export const WORKBENCH_CANVAS_COMPONENTS: TLComponents = {
  // Decorative grid lives on Background (always on). Do NOT use Grid +
  // isGridMode — that enables snap-to-grid on drag/create.
  Background: WorkbenchGridBackground
};
