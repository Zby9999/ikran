// Shared evidence-package commands — single source for HTTP + MCP.

import {
  listFigmaEvidenceSurfaces,
  recordEvidencePackage,
  type EvidencePackageRecordResponse,
  type FigmaEvidenceSurfaceRecord
} from "../evidence-package";

export function recordEvidencePackageCommand(
  projectPath: string,
  input: unknown
): EvidencePackageRecordResponse {
  return recordEvidencePackage(projectPath, input);
}

export type ListEvidenceSurfacesCommandResult = {
  ok: true;
  records: FigmaEvidenceSurfaceRecord[];
};

export function listEvidenceSurfacesCommand(
  projectPath: string
): ListEvidenceSurfacesCommandResult {
  return { ok: true, records: listFigmaEvidenceSurfaces(projectPath) };
}
