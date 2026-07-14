// Shared seed-capture commands — Workbench paste + Agent add_seed_reference.

import {
  addSeedReference,
  refreshSeedReference,
  type SeedCaptureInitiator,
  type SeedCaptureResult,
  type SeedRefreshResult
} from "../seed-capture";

export async function addSeedReferenceCommand(
  projectPath: string,
  input: {
    figmaSeedReference?: unknown;
    referenceNote?: unknown;
    initiator?: unknown;
  }
): Promise<SeedCaptureResult> {
  const initiator: SeedCaptureInitiator =
    input.initiator === "ui" ? "ui" : "agent";
  return addSeedReference(projectPath, {
    figmaSeedReference:
      typeof input.figmaSeedReference === "string"
        ? input.figmaSeedReference
        : "",
    referenceNote:
      typeof input.referenceNote === "string" ? input.referenceNote : "",
    initiator
  });
}

export async function refreshSeedReferenceCommand(
  projectPath: string,
  input: { seedReferenceId?: unknown; initiator?: unknown }
): Promise<SeedRefreshResult> {
  if (
    typeof input.seedReferenceId !== "string" ||
    input.seedReferenceId.trim().length === 0
  ) {
    return { ok: false, reason: "seed_reference_not_found" };
  }
  return refreshSeedReference(projectPath, {
    seedReferenceId: input.seedReferenceId,
    initiator: input.initiator === "ui" ? "ui" : "agent"
  });
}
