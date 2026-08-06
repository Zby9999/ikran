import {
  exportResearchPackage,
  type ResearchExportResult
} from "../research-export";

export function exportResearchCommand(
  projectPath: string
): ResearchExportResult {
  return exportResearchPackage(projectPath);
}
