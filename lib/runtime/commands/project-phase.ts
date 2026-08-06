import {
  abandonProjectPhase,
  confirmDraftDesignSystem,
  confirmPrototype,
  formalizeDesignSystem,
  getProjectPhase,
  requireProjectPhase,
  type FormalizeFailure,
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
  projectPath: string
): PhaseCommandResult | FormalizeFailure {
  return formalizeDesignSystem(projectPath);
}

export function abandonProjectPhaseCommand(
  projectPath: string
): PhaseCommandResult {
  return abandonProjectPhase(projectPath);
}
