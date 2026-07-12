// Shared seed-capture commands — Workbench paste + Agent add_seed_reference.

import {
  addSeedReference,
  type SeedCaptureInitiator,
  type SeedCaptureResult
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
