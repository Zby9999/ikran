// Fixed-ratio locator crop for Design System Source Capture (09C-D02 v2).
//
// Layout / Component placards need a 3:2 or 2:3 window that contains the
// source node so a sticky bar is not a 46px sliver and a tall frame is not
// a full-page dump. Runtime already has the seed screenshot and positional
// bounds; this module is the deterministic geometry those captures use.
// Coordinates: crop is 0–1 of the frame/screenshot; nodeRect is 0–1 of the
// crop (width/height may exceed 1 when the crop truncates the node).

import {
  asEvidenceBounds,
  type EvidenceBounds
} from "./figma-positional-evidence";

export type LocatorRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const LANDSCAPE_ASPECT = 3 / 2;
const PORTRAIT_ASPECT = 2 / 3;

export type LocatorOrientation = "landscape" | "portrait";

export type LocatorCrop = {
  orientation: LocatorOrientation;
  /** Window inside the frame/screenshot, fractions of the frame. */
  crop: LocatorRect;
  /** Node inside that window, fractions of the crop. */
  nodeRect: LocatorRect;
};

/** 2:3 only when the node is taller than 2:3; near-square and wide take 3:2. */
export function pickLocatorOrientation(
  nodeWidth: number,
  nodeHeight: number
): LocatorOrientation {
  if (!(nodeWidth > 0) || !(nodeHeight > 0)) return "landscape";
  return nodeWidth / nodeHeight < PORTRAIT_ASPECT ? "portrait" : "landscape";
}

export function computeLocatorCrop(
  frame: EvidenceBounds,
  node: EvidenceBounds
): LocatorCrop | null {
  if (frame.width <= 0 || frame.height <= 0) return null;
  if (node.width <= 0 || node.height <= 0) return null;

  const orientation = pickLocatorOrientation(node.width, node.height);
  const targetAspect =
    orientation === "portrait" ? PORTRAIT_ASPECT : LANDSCAPE_ASPECT;

  const nx = node.x - frame.x;
  const ny = node.y - frame.y;

  let cropW: number;
  let cropH: number;
  if (node.width / node.height >= targetAspect) {
    cropW = node.width;
    cropH = cropW / targetAspect;
  } else {
    cropH = node.height;
    cropW = cropH * targetAspect;
  }

  if (cropH > frame.height) {
    cropH = frame.height;
    cropW = Math.min(frame.width, cropH * targetAspect);
  }
  if (cropW > frame.width) {
    cropW = frame.width;
    cropH = Math.min(frame.height, cropW / targetAspect);
  }
  if (cropW <= 0 || cropH <= 0) return null;

  let cropX =
    node.width <= cropW ? nx + node.width / 2 - cropW / 2 : nx;
  let cropY =
    node.height <= cropH ? ny + node.height / 2 - cropH / 2 : ny;
  cropX = clamp(cropX, 0, frame.width - cropW);
  cropY = clamp(cropY, 0, frame.height - cropH);

  const nodeRect: LocatorRect = {
    x: clamp((nx - cropX) / cropW, 0, 1),
    y: clamp((ny - cropY) / cropH, 0, 1),
    width: node.width / cropW,
    height: node.height / cropH
  };

  return {
    orientation,
    crop: {
      x: cropX / frame.width,
      y: cropY / frame.height,
      width: cropW / frame.width,
      height: cropH / frame.height
    },
    nodeRect
  };
}

export function sourceBoundsForNode(node: {
  bounds: EvidenceBounds | null;
  clipRenderBounds?: EvidenceBounds | null;
}): EvidenceBounds | null {
  return asEvidenceBounds(node.clipRenderBounds ?? node.bounds);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
