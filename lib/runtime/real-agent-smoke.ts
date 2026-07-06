import { logEvent, type LoggedEvent } from "./events";

export interface RealAgentSeedEvidenceSmokeRecord {
  status: "blocked" | "passed" | "failed";
  taskId: string;
  figmaSeedReference: string;
  originalDesignIntent: string;
  packageId?: string | null;
  surfaceId?: string | null;
  agentCommand: string;
  reason?: string;
  openGaps?: string[];
  attemptLog?: string;
}

export function recordRealAgentSeedEvidenceSmoke(
  projectPath: string,
  record: RealAgentSeedEvidenceSmokeRecord
): LoggedEvent {
  return logEvent(projectPath, "real_agent_seed_evidence_smoke_recorded", {
    status: record.status,
    taskId: record.taskId,
    figmaSeedReference: record.figmaSeedReference,
    originalDesignIntent: record.originalDesignIntent,
    packageId: record.packageId ?? null,
    surfaceId: record.surfaceId ?? null,
    agentCommand: record.agentCommand,
    reason: record.reason ?? null,
    openGaps: record.openGaps ?? [],
    attemptLog: record.attemptLog ?? null
  });
}
