import {
  asEvidenceBounds,
  intersectEvidenceBounds,
  isDefaultSelectableFigmaNode,
  parsePositionalNodes,
  type EvidenceBounds
} from "@/lib/runtime/figma-positional-evidence";
import { expandStructureRegionRect } from "@/lib/runtime/region-annotation-display";

export type StructuralOverlayRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type StructuralOverlayFrame = {
  nodeId: string;
  parentNodeId: string | null;
  /** Nearest ancestor that is also projected as a selectable overlay frame. */
  selectableParentNodeId: string | null;
  name: string;
  type: string;
  depth: number;
  rect: StructuralOverlayRect;
};

export type StructuralImageBox = {
  x: number;
  y: number;
  w: number;
  h: number;
};

/**
 * Expand a screenshot-normalized structure rect in the same media coordinate
 * space used by persisted annotations, then map it back into the image overlay.
 * This keeps hover and confirmed geometry identical even with letterboxing.
 */
export function structuralHoverDisplayRect(input: {
  rect: StructuralOverlayRect;
  imageBox: StructuralImageBox;
  mediaSize: { w: number; h: number };
}): StructuralOverlayRect {
  const { rect, imageBox, mediaSize } = input;
  if (
    imageBox.w <= 0 ||
    imageBox.h <= 0 ||
    mediaSize.w <= 0 ||
    mediaSize.h <= 0
  ) {
    return rect;
  }
  const mediaRect = {
    x: (imageBox.x + rect.x * imageBox.w) / mediaSize.w,
    y: (imageBox.y + rect.y * imageBox.h) / mediaSize.h,
    w: (rect.w * imageBox.w) / mediaSize.w,
    h: (rect.h * imageBox.h) / mediaSize.h
  };
  const displayRect = expandStructureRegionRect(mediaRect, mediaSize);
  return {
    x: (displayRect.x * mediaSize.w - imageBox.x) / imageBox.w,
    y: (displayRect.y * mediaSize.h - imageBox.y) / imageBox.h,
    w: (displayRect.w * mediaSize.w) / imageBox.w,
    h: (displayRect.h * mediaSize.h) / imageBox.h
  };
}

/** Match CSS object-fit: scale-down so hover and annotation hit-testing agree. */
export function fitStructuralImageBox(
  container: StructuralImageBox,
  natural: { width: number; height: number }
): StructuralImageBox | null {
  if (
    container.w <= 0 ||
    container.h <= 0 ||
    natural.width <= 0 ||
    natural.height <= 0
  ) {
    return null;
  }
  const scale = Math.min(
    1,
    container.w / natural.width,
    container.h / natural.height
  );
  const w = natural.width * scale;
  const h = natural.height * scale;
  return {
    x: container.x + (container.w - w) / 2,
    y: container.y + (container.h - h) / 2,
    w,
    h
  };
}

function parseBounds(value: string): EvidenceBounds | null {
  try {
    return asEvidenceBounds(JSON.parse(value));
  } catch {
    return null;
  }
}

export function buildStructuralOverlayFrames(input: {
  frameBoundsJson: string;
  positionalNodesJson: string;
}): StructuralOverlayFrame[] {
  const frameBounds = parseBounds(input.frameBoundsJson);
  if (!frameBounds) return [];

  const nodes = parsePositionalNodes(input.positionalNodesJson);
  const frames: StructuralOverlayFrame[] = [];
  for (const node of nodes) {
    // The capture root is the screenshot itself, not a useful overlay target.
    if (
      typeof node.id !== "string" ||
      typeof node.name !== "string" ||
      typeof node.type !== "string" ||
      !Number.isFinite(node.depth) ||
      node.depth <= 0 ||
      !node.visible
    ) {
      continue;
    }
    if (!isDefaultSelectableFigmaNode(node)) continue;

    const nodeBounds = asEvidenceBounds(node.bounds);
    if (!nodeBounds) continue;
    const visibleBounds =
      node.clipRenderBounds === undefined
        ? nodeBounds
        : asEvidenceBounds(node.clipRenderBounds);
    if (!visibleBounds) continue;
    const clipped = intersectEvidenceBounds(frameBounds, visibleBounds);
    if (!clipped) continue;
    frames.push({
      nodeId: node.id,
      parentNodeId: node.parentId,
      selectableParentNodeId: null,
      name: node.name,
      type: node.type,
      depth: node.depth,
      rect: {
        x: (clipped.x - frameBounds.x) / frameBounds.width,
        y: (clipped.y - frameBounds.y) / frameBounds.height,
        w: clipped.width / frameBounds.width,
        h: clipped.height / frameBounds.height
      }
    });
  }

  const selectableIds = new Set(frames.map((frame) => frame.nodeId));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  for (const frame of frames) {
    let ancestorId = frame.parentNodeId;
    while (ancestorId) {
      if (selectableIds.has(ancestorId)) {
        frame.selectableParentNodeId = ancestorId;
        break;
      }
      ancestorId = nodesById.get(ancestorId)?.parentId ?? null;
    }
  }

  // Parents first for stable projection; deeper nodes remain the hit-test
  // winner, with smaller siblings preferred when bounds overlap.
  return frames.sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    const areaA = a.rect.w * a.rect.h;
    const areaB = b.rect.w * b.rect.h;
    if (areaA !== areaB) return areaB - areaA;
    return a.nodeId.localeCompare(b.nodeId);
  });
}

export function findStructuralOverlayFrameAtPoint(
  frames: StructuralOverlayFrame[],
  point: { x: number; y: number },
  preferredNodeId?: string | null
): StructuralOverlayFrame | null {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  const preferred = preferredNodeId
    ? frames.find((frame) => frame.nodeId === preferredNodeId) ?? null
    : null;
  if (preferred && pointInsideStructuralFrame(preferred, point)) {
    return preferred;
  }
  let winner: StructuralOverlayFrame | null = null;
  for (const frame of frames) {
    if (!pointInsideStructuralFrame(frame, point)) continue;
    const { rect } = frame;
    if (!winner) {
      winner = frame;
      continue;
    }
    const frameArea = rect.w * rect.h;
    const winnerArea = winner.rect.w * winner.rect.h;
    if (
      frame.depth > winner.depth ||
      (frame.depth === winner.depth && frameArea < winnerArea)
    ) {
      winner = frame;
    }
  }
  return winner;
}

function pointInsideStructuralFrame(
  frame: StructuralOverlayFrame,
  point: { x: number; y: number }
): boolean {
  const { rect } = frame;
  return (
    point.x >= rect.x &&
    point.y >= rect.y &&
    point.x <= rect.x + rect.w &&
    point.y <= rect.y + rect.h
  );
}

/** Tab drill-up: clamp at the highest selectable ancestor. */
export function parentStructuralOverlayFrame(
  frames: StructuralOverlayFrame[],
  nodeId: string
): StructuralOverlayFrame | null {
  const current = frames.find((frame) => frame.nodeId === nodeId) ?? null;
  if (!current) return null;
  if (!current.selectableParentNodeId) return current;
  return (
    frames.find(
      (frame) => frame.nodeId === current.selectableParentNodeId
    ) ?? current
  );
}
