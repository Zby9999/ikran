"use client";

// React Flow node that renders a Figma Evidence Surface card.
//
// Extracted from SeedEvidenceWorkbench so the workbench owns layout + lock
// state and this component owns surface presentation. The node's data is the
// `evidenceSurface` slice of a SeedEvidencePackage produced by the Runtime /
// AgentAdapter — never a UI-hardcoded fixture.

import { type Node, type NodeProps } from "@xyflow/react";
import type { SeedEvidenceSurface } from "@/lib/runtime/seed-evidence-types";

export type FigmaEvidenceSurfaceNode = Node<
  SeedEvidenceSurface,
  "figmaEvidenceSurface"
>;

export const figmaEvidenceNodeTypes = {
  figmaEvidenceSurface: FigmaEvidenceSurfaceNode
};

export function FigmaEvidenceSurfaceNode({
  data
}: NodeProps<FigmaEvidenceSurfaceNode>) {
  return (
    <article className="figma-evidence-surface" data-testid="figma-evidence-surface">
      <div className="figma-evidence-surface__media">
        <div className="figma-evidence-surface__frame-label">
          {data.dimensions.width} x {data.dimensions.height}
        </div>
      </div>
      <div className="figma-evidence-surface__body">
        <p className="figma-evidence-surface__eyebrow">Runtime / AgentAdapter result</p>
        <h2>{data.title}</h2>
        <p>{data.summary}</p>
        <dl>
          <div>
            <dt>Seed</dt>
            <dd>{data.sourceReference}</dd>
          </div>
          <div>
            <dt>Intent</dt>
            <dd>{data.originalDesignIntent}</dd>
          </div>
        </dl>
      </div>
    </article>
  );
}