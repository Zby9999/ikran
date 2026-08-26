import {
  registerComponentPreview,
  type RegisterComponentPreviewInput,
  type RegisterComponentPreviewResult
} from "../component-preview-registration";
import {
  runComponentFormalizationStage,
  runComponentFormalizationStageAsync
} from "../component-formalization-timing";
import {
  startComponentPreviewVerification,
  type StartComponentPreviewVerificationInput,
  type StartComponentPreviewVerificationResult
} from "../component-preview-verification";
import {
  resolveComponentPreviewException,
  type ResolveComponentPreviewExceptionInput,
  type ResolveComponentPreviewExceptionResult
} from "../component-preview-exception";

export function registerComponentPreviewCommand(
  projectPath: string,
  input: RegisterComponentPreviewInput
): RegisterComponentPreviewResult {
  return runComponentFormalizationStage(
    projectPath,
    "live_hero_declaration",
    { componentCount: 1 },
    () => registerComponentPreview(projectPath, input),
    { runId: input.runId }
  );
}

export function startComponentPreviewVerificationCommand(
  projectPath: string,
  input: StartComponentPreviewVerificationInput
): Promise<StartComponentPreviewVerificationResult> {
  return runComponentFormalizationStageAsync(
    projectPath,
    "verification",
    { componentCount: input.entryIds?.length },
    () => startComponentPreviewVerification(projectPath, input)
  );
}

export function resolveComponentPreviewExceptionCommand(
  projectPath: string,
  input: ResolveComponentPreviewExceptionInput
): ResolveComponentPreviewExceptionResult {
  return resolveComponentPreviewException(projectPath, input);
}
