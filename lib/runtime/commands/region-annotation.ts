// Shared region-annotation commands — single source for HTTP + MCP.

import {
  createRegionAnnotation,
  deleteRegionAnnotation,
  listRegionAnnotations,
  type RegionAnnotationResponse,
  type RegionAnnotationRecord
} from "../region-annotation";

export function createRegionAnnotationCommand(
  projectPath: string,
  input: unknown
): RegionAnnotationResponse {
  // MCP historically defaulted empty body to a placeholder; keep that here so
  // HTTP and MCP share one path (HTTP clients that omit body still get domain
  // missing_body unless they pass the placeholder explicitly — MCP tool layer
  // injects the default before calling this command).
  return createRegionAnnotation(projectPath, input);
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
