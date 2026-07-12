// Shared project readiness + Design Language Description commands (Issue 05B).

import {
  getDesignLanguageDescription,
  getProjectReadiness,
  setDesignLanguageDescription,
  type ProjectReadiness,
  type SetDesignLanguageDescriptionResult
} from "../project-readiness";

export function getProjectReadinessCommand(
  projectPath: string
): { ok: true } & ProjectReadiness {
  const readiness = getProjectReadiness(projectPath);
  return { ok: true, ...readiness };
}

export function getDesignLanguageDescriptionCommand(
  projectPath: string
): { ok: true; designLanguageDescription: string } {
  return {
    ok: true,
    designLanguageDescription: getDesignLanguageDescription(projectPath)
  };
}

export function setDesignLanguageDescriptionCommand(
  projectPath: string,
  description: unknown
): SetDesignLanguageDescriptionResult {
  return setDesignLanguageDescription(projectPath, description);
}
