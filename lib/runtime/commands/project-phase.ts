import {
  abandonProjectPhase,
  confirmDraftDesignSystem,
  confirmPrototype,
  formalizeDesignSystem,
  getProjectPhase,
  requireProjectPhase,
  type FormalizeFailure,
  type FormalizeSuccess,
  type PhaseCommandResult,
  type ProjectPhase
} from "../project-phase";
import {
  completeComponentFormalizationTiming,
  getRunningComponentFormalizationTiming,
  runComponentFormalizationStage
} from "../component-formalization-timing";

export function getProjectPhaseCommand(projectPath: string): ProjectPhase {
  return getProjectPhase(projectPath);
}

export function requireProjectPhaseCommand(
  projectPath: string,
  allowed: ProjectPhase | readonly ProjectPhase[]
) {
  return requireProjectPhase(projectPath, allowed);
}

export function confirmDraftDesignSystemCommand(
  projectPath: string,
  designerConfirmation: string
): PhaseCommandResult {
  return confirmDraftDesignSystem(projectPath, designerConfirmation);
}

export function confirmPrototypeCommand(
  projectPath: string
): PhaseCommandResult {
  return confirmPrototype(projectPath);
}

export function formalizeDesignSystemCommand(
  projectPath: string,
  promoteEntryIds: readonly string[] = [],
  modificationReview: string
): FormalizeSuccess | FormalizeFailure {
  const result = runComponentFormalizationStage(
    projectPath,
    "formalization",
    { componentCount: promoteEntryIds.length },
    () => formalizeDesignSystem(projectPath, promoteEntryIds, modificationReview)
  );
  if (result.ok) {
    const session = getRunningComponentFormalizationTiming(projectPath);
    if (session) {
      try {
        completeComponentFormalizationTiming(projectPath, session.id);
      } catch {
        // Timing never changes the formalization result.
      }
    }
  }
  return result;
}

export function abandonProjectPhaseCommand(
  projectPath: string
): PhaseCommandResult {
  return abandonProjectPhase(projectPath);
}
