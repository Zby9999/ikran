import {
  getComponentFormalizationTiming,
  type ComponentFormalizationTimingSummary
} from "../component-formalization-timing";

export function getComponentFormalizationTimingCommand(
  projectPath: string,
  sessionId?: string
): { timing: ComponentFormalizationTimingSummary | null } {
  return { timing: getComponentFormalizationTiming(projectPath, sessionId) };
}
