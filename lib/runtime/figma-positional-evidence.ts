// Deterministic spatial queries over Runtime-captured Figma positional evidence.
// This module deliberately contains no implementation context (styles,
// variables, component properties, or full file trees).

export type EvidenceBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PositionalEvidenceNode = {
  id: string;
  parentId: string | null;
  name: string;
  type: string;
  depth: number;
  visible: boolean;
  selectable?: boolean;
  bounds: EvidenceBounds | null;
  clipRenderBounds?: EvidenceBounds | null;
};

export type SemanticRect = { x: number; y: number; w: number; h: number };

export type AnnotationNodeCandidate = {
  nodeId: string;
  parentNodeId: string | null;
  name: string;
  type: string;
  depth: number;
  bounds: EvidenceBounds;
  normalizedBounds: SemanticRect;
  overlap: {
    intersects: true;
    intersectionArea: number;
    rectCoverage: number;
    nodeCoverage: number;
    nodeContainedByRect: boolean;
    rectContainedByNode: boolean;
  };
};

export function asEvidenceBounds(value: unknown): EvidenceBounds | null {
  if (!value || typeof value !== "object") return null;
  const bounds = value as Partial<EvidenceBounds>;
  if (
    typeof bounds.x !== "number" ||
    typeof bounds.y !== "number" ||
    typeof bounds.width !== "number" ||
    typeof bounds.height !== "number" ||
    ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    return null;
  }
  return bounds as EvidenceBounds;
}

const DEFAULT_SELECTABLE_TYPES = new Set([
  "FRAME",
  "SECTION",
  "COMPONENT",
  "INSTANCE",
  "TEXT",
  "IMAGE"
]);

function isMeaningfulGroupName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && !/^group(?:\s+\d+)?$/i.test(trimmed);
}

export function isDefaultSelectableFigmaNode(
  node: PositionalEvidenceNode
): boolean {
  if (!node.visible) return false;
  if (typeof node.selectable === "boolean") return node.selectable;
  const type = node.type.toUpperCase();
  if (DEFAULT_SELECTABLE_TYPES.has(type)) return true;
  return type === "GROUP" && isMeaningfulGroupName(node.name);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampNormalizedRect(rect: SemanticRect): SemanticRect | null {
  if (![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)) return null;
  const x1 = clamp(rect.x, 0, 1);
  const y1 = clamp(rect.y, 0, 1);
  const x2 = clamp(rect.x + Math.max(0, rect.w), 0, 1);
  const y2 = clamp(rect.y + Math.max(0, rect.h), 0, 1);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function intersectEvidenceBounds(
  a: EvidenceBounds,
  b: EvidenceBounds
): EvidenceBounds | null {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function contains(outer: EvidenceBounds, inner: EvidenceBounds): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

export function getAnnotationNodeCandidates(input: {
  nodes: PositionalEvidenceNode[];
  frameBounds: EvidenceBounds;
  rect: SemanticRect;
  includeNonDefaultSelectable?: boolean;
}): AnnotationNodeCandidate[] {
  const rect = clampNormalizedRect(input.rect);
  if (!rect || input.frameBounds.width <= 0 || input.frameBounds.height <= 0) {
    return [];
  }

  // The semantic rect is normalized to the screenshot. Figma node bounds are
  // absolute source coordinates, so the root frame is the conversion origin.
  const query: EvidenceBounds = {
    x: input.frameBounds.x + rect.x * input.frameBounds.width,
    y: input.frameBounds.y + rect.y * input.frameBounds.height,
    width: rect.w * input.frameBounds.width,
    height: rect.h * input.frameBounds.height
  };
  const queryArea = query.width * query.height;

  const candidates: AnnotationNodeCandidate[] = [];
  for (const node of input.nodes) {
    if (!node.visible || !node.bounds) continue;
    if (
      !input.includeNonDefaultSelectable &&
      !isDefaultSelectableFigmaNode(node)
    ) {
      continue;
    }
    const hitBounds = node.clipRenderBounds ?? node.bounds;
    if (!hitBounds) continue;
    const hit = intersectEvidenceBounds(query, hitBounds);
    if (!hit) continue;
    const hitArea = hit.width * hit.height;
    const nodeArea = hitBounds.width * hitBounds.height;
    candidates.push({
      nodeId: node.id,
      parentNodeId: node.parentId,
      name: node.name,
      type: node.type,
      depth: node.depth,
      bounds: node.bounds,
      normalizedBounds: {
        x: (node.bounds.x - input.frameBounds.x) / input.frameBounds.width,
        y: (node.bounds.y - input.frameBounds.y) / input.frameBounds.height,
        w: node.bounds.width / input.frameBounds.width,
        h: node.bounds.height / input.frameBounds.height
      },
      overlap: {
        intersects: true,
        intersectionArea: hitArea,
        rectCoverage: hitArea / queryArea,
        nodeCoverage: hitArea / nodeArea,
        nodeContainedByRect: contains(query, hitBounds),
        rectContainedByNode: contains(hitBounds, query)
      }
    });
  }

  return candidates.sort((a, b) => {
    if (a.overlap.nodeContainedByRect !== b.overlap.nodeContainedByRect) {
      return a.overlap.nodeContainedByRect ? -1 : 1;
    }
    if (a.overlap.rectCoverage !== b.overlap.rectCoverage) {
      return b.overlap.rectCoverage - a.overlap.rectCoverage;
    }
    const aArea = a.bounds.width * a.bounds.height;
    const bArea = b.bounds.width * b.bounds.height;
    if (aArea !== bArea) return aArea - bArea;
    if (a.depth !== b.depth) return b.depth - a.depth;
    return a.nodeId.localeCompare(b.nodeId);
  });
}

export function findNodeCorrespondence(
  currentNodes: PositionalEvidenceNode[],
  capturedNodeId: string
):
  | { status: "corresponding"; capturedNodeId: string; node: PositionalEvidenceNode }
  | { status: "missing"; capturedNodeId: string } {
  const node = currentNodes.find((candidate) => candidate.id === capturedNodeId);
  return node
    ? { status: "corresponding", capturedNodeId, node }
    : { status: "missing", capturedNodeId };
}

export function parsePositionalNodes(
  value: string | null | undefined
): PositionalEvidenceNode[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as PositionalEvidenceNode[]) : [];
  } catch {
    return [];
  }
}
