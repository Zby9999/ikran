// Shared region-annotation commands — single source for HTTP + MCP.

import {
  createRegionAnnotation,
  confirmAnnotationPrimaryNode,
  deleteRegionAnnotation,
  listRegionAnnotations,
  restoreRegionAnnotation,
  updateRegionAnnotationBody,
  type RegionAnnotationResponse,
  type RegionAnnotationRecord
} from "../region-annotation";

export function createRegionAnnotationCommand(
  projectPath: string,
  input: unknown
): RegionAnnotationResponse {
  let normalized = input;
  if (input && typeof input === "object") {
    const raw = input as Record<string, unknown>;
    normalized = {
      ...raw,
      ...(typeof raw.body !== "string" || raw.body.trim().length === 0
        ? { body: "Placeholder annotation" }
        : {})
    };
  }
  return createRegionAnnotation(projectPath, normalized);
}

export function confirmAnnotationPrimaryNodeCommand(
  projectPath: string,
  input: unknown
) {
  return confirmAnnotationPrimaryNode(projectPath, input);
}

export type ListRegionAnnotationsCommandResult = {
  ok: true;
  records: RegionAnnotationRecord[];
};

export function listRegionAnnotationsCommand(
  projectPath: string
): ListRegionAnnotationsCommandResult {
  return { ok: true, records: listRegionAnnotations(projectPath) };
}

export function deleteRegionAnnotationCommand(
  projectPath: string,
  id: string
) {
  return deleteRegionAnnotation(projectPath, id);
}

export function restoreRegionAnnotationCommand(
  projectPath: string,
  id: string
) {
  return restoreRegionAnnotation(projectPath, id);
}

export function updateRegionAnnotationBodyCommand(
  projectPath: string,
  input: unknown
) {
  return updateRegionAnnotationBody(projectPath, input);
}
