import {
  listPrototypeSurfaces,
  recordPreview,
  type PrototypeSurfaceRecord,
  type RecordPreviewInput,
  type RecordPreviewOptions,
  type RecordPreviewResult
} from "../prototype-surface";

export function recordPreviewCommand(
  projectPath: string,
  input: RecordPreviewInput,
  options?: RecordPreviewOptions
): Promise<RecordPreviewResult> {
  return recordPreview(projectPath, input, options);
}

export function listPrototypeSurfacesCommand(projectPath: string): {
  records: PrototypeSurfaceRecord[];
} {
  return { records: listPrototypeSurfaces(projectPath) };
}
