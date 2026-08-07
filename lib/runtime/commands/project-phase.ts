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
  projectPath: string
): PhaseCommandResult {
  return confirmDraftDesignSystem(projectPath);
}

export function confirmPrototypeCommand(
  projectPath: string
): PhaseCommandResult {
  return confirmPrototype(projectPath);
}

export function formalizeDesignSystemCommand(
  projectPath: string,
  promoteEntryIds: readonly string[] = []
): FormalizeSuccess | FormalizeFailure {
  return formalizeDesignSystem(projectPath, promoteEntryIds);
}

export function abandonProjectPhaseCommand(
  projectPath: string
): PhaseCommandResult {
  return abandonProjectPhase(projectPath);
}
