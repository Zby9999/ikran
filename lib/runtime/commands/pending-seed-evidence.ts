// Shared pending-seed-evidence commands — single source for HTTP + MCP.

import {
  listPendingSeedEvidence,
  type PendingSeedEvidenceRecord
} from "../pending-seed-evidence";

export type ListPendingSeedEvidenceCommandResult = {
  ok: true;
  records: PendingSeedEvidenceRecord[];
};

export function listPendingSeedEvidenceCommand(
  projectPath: string
): ListPendingSeedEvidenceCommandResult {
  return { ok: true, records: listPendingSeedEvidence(projectPath) };
}
