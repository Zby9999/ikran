import {
  getDesignSystemRevisionHistory,
  getEffectiveDesignSystem,
  reviseDraftDesignSystem,
  type ReviseDraftDesignSystemInput
} from "../design-system-revision";

export function getEffectiveDesignSystemCommand(projectPath: string) {
  return getEffectiveDesignSystem(projectPath);
}

export function getDesignSystemRevisionHistoryCommand(projectPath: string) {
  return getDesignSystemRevisionHistory(projectPath);
}

export function reviseDraftDesignSystemCommand(
  projectPath: string,
  input: ReviseDraftDesignSystemInput
) {
  return reviseDraftDesignSystem(projectPath, input);
}
