import {
  listPrototypeSurfaces,
  recordPreview,
  type PrototypeSurfaceRecord,
  type RecordPreviewInput,
  type RecordPreviewOptions,
  type RecordPreviewResult
} from "../prototype-surface";
import {
  getRunningComponentFormalizationTiming,
  runComponentFormalizationStageAsync
} from "../component-formalization-timing";

export function recordPreviewCommand(
  projectPath: string,
  input: RecordPreviewInput,
  options?: RecordPreviewOptions
): Promise<RecordPreviewResult> {
  let warm = false;
  try {
    warm = listPrototypeSurfaces(projectPath).some(
      (surface) => surface.run_id === input.runId && surface.readiness === "ready"
    );
  } catch {
    // Preview behavior remains authoritative when optional timing lookup fails.
  }
  return runComponentFormalizationStageAsync(
    projectPath,
    "preview_readiness",
    { previewStartup: warm ? "warm" : "cold" },
    () => recordPreview(projectPath, input, options),
    { runId: input.runId }
  );
}

export function listPrototypeSurfacesCommand(projectPath: string): {
  records: PrototypeSurfaceRecord[];
} {
  return { records: listPrototypeSurfaces(projectPath) };
}
