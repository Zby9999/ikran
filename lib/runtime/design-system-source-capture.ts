// Derive Design System locator captures from Alignment node anchors plus
// Runtime-owned positional evidence. Agents no longer have to screenshot and
// crop via Figma MCP during Initial extraction: if a layout rule or component
// spec links a node-anchored record, the seed screenshot already has the
// pixels and the positional index already has the box.

import { existsSync } from "node:fs";

import { targetsFromAnchor } from "./design-intent-alignment";
import type { DesignSystemLayoutCapture } from "./design-system-view";
import { asEvidenceBounds, parsePositionalNodes } from "./figma-positional-evidence";
import { resolveProjectArtifactPath } from "./evidence-package";
import {
  computeLocatorCrop,
  sourceBoundsForNode
} from "./locator-crop";

export type DerivedCaptureSurface = {
  id: string;
  screenshot_artifact_path: string | null;
  frame_bounds_json: string | null;
  positional_nodes_json: string | null;
  created_at: string;
};

export type AnchorNodeTarget = {
  evidenceVersionId: string;
  nodeId: string;
};

export function nodeTargetsFromAnchorJson(anchorJson: unknown): AnchorNodeTarget[] {
  if (typeof anchorJson !== "string") return [];
  let anchor: unknown;
  try {
    anchor = JSON.parse(anchorJson);
  } catch {
    return [];
  }
  const parsed = targetsFromAnchor(anchor);
  if (!parsed.ok) return [];
  const targets: AnchorNodeTarget[] = [];
  for (const target of parsed.targets) {
    if (target.kind !== "node") continue;
    const evidenceVersionId =
      typeof target.evidenceVersionId === "string"
        ? target.evidenceVersionId.trim()
        : "";
    const nodeId =
      typeof target.nodeId === "string" ? target.nodeId.trim() : "";
    if (!evidenceVersionId || !nodeId) continue;
    targets.push({ evidenceVersionId, nodeId });
  }
  return targets;
}

export function deriveSourceCaptures(input: {
  projectPath: string;
  anchorJsons: string[];
  loadSurface: (id: string) => DerivedCaptureSurface | undefined;
  staleOf: (surfaceId: string) => boolean;
}): DesignSystemLayoutCapture[] | undefined {
  const seen = new Set<string>();
  const captures: DesignSystemLayoutCapture[] = [];

  for (const anchorJson of input.anchorJsons) {
    for (const target of nodeTargetsFromAnchorJson(anchorJson)) {
      const key = `${target.evidenceVersionId}:${target.nodeId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const capture = deriveOne(input, target);
      if (capture) captures.push(capture);
    }
  }

  return captures.length > 0 ? captures : undefined;
}

function deriveOne(
  input: {
    projectPath: string;
    loadSurface: (id: string) => DerivedCaptureSurface | undefined;
    staleOf: (surfaceId: string) => boolean;
  },
  target: AnchorNodeTarget
): DesignSystemLayoutCapture | null {
  const surface = input.loadSurface(target.evidenceVersionId);
  if (!surface) return null;
  const artifactPath = surface.screenshot_artifact_path?.trim() ?? "";
  if (!artifactPath) return null;
  const absolute = resolveProjectArtifactPath(input.projectPath, artifactPath);
  if (absolute === null || !existsSync(absolute)) return null;

  let frameRaw: unknown = null;
  if (surface.frame_bounds_json) {
    try {
      frameRaw = JSON.parse(surface.frame_bounds_json);
    } catch {
      return null;
    }
  }
  const frame = asEvidenceBounds(frameRaw);
  if (!frame) return null;
  const node = parsePositionalNodes(surface.positional_nodes_json).find(
    (candidate) => candidate.id === target.nodeId
  );
  const nodeBounds = node ? sourceBoundsForNode(node) : null;
  if (!node || !nodeBounds) return null;
  const locator = computeLocatorCrop(frame, nodeBounds);
  if (!locator) return null;

  return {
    nodeId: target.nodeId,
    nodeName: node.name.trim() || target.nodeId,
    artifactPath,
    capturedAt: surface.created_at,
    surfaceId: surface.id,
    stale: input.staleOf(surface.id),
    nodeRect: locator.nodeRect,
    locatorCrop: locator.crop,
    origin: "source",
    codeLinks: null,
    codeDigest: null,
    harnessPath: null,
    previewUrl: null,
    surfaceReadiness: null,
    surfaceStale: false
  };
}
