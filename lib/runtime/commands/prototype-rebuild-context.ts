import {
  getPrototypeRebuildContext,
  type PrototypeRebuildContextResult
} from "../prototype-rebuild-context";

export function getPrototypeRebuildContextCommand(
  projectPath: string
): PrototypeRebuildContextResult {
  return getPrototypeRebuildContext(projectPath);
}
