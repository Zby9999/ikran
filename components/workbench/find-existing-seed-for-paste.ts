// Resolve an already-projected Seed Reference for a pasted Figma URL
// (fileKey + nodeId), so duplicate paste can focus without an in-flight frame.

import {
  figmaSeedIdentitiesEqual,
  parseFigmaSeedIdentity
} from "@/lib/runtime/figma-identity";
import type { SeedReferenceRecord } from "@/lib/runtime/seed-reference";

/**
 * Returns the existing seed id when the paste URL matches a known Seed
 * Reference identity; otherwise null (caller should run a fresh capture).
 */
export function findExistingSeedIdForPasteUrl(
  seeds: readonly SeedReferenceRecord[],
  pastedUrl: string
): string | null {
  const pasted = parseFigmaSeedIdentity(pastedUrl);
  if (!pasted) return null;

  for (const seed of seeds) {
    if (
      typeof seed.file_key === "string" &&
      seed.file_key.length > 0 &&
      typeof seed.node_id === "string"
    ) {
      if (
        figmaSeedIdentitiesEqual(
          { fileKey: seed.file_key, nodeId: seed.node_id },
          pasted
        )
      ) {
        return seed.id;
      }
    }

    const fromStored = parseFigmaSeedIdentity(seed.figma_seed_reference);
    if (fromStored && figmaSeedIdentitiesEqual(fromStored, pasted)) {
      return seed.id;
    }
  }

  return null;
}

export function hasInFlightSeedForPasteUrl(
  captures: readonly { figmaSeedReference: string }[],
  pastedUrl: string
): boolean {
  const pasted = parseFigmaSeedIdentity(pastedUrl);
  if (!pasted) return false;
  return captures.some((capture) => {
    const identity = parseFigmaSeedIdentity(capture.figmaSeedReference);
    return identity ? figmaSeedIdentitiesEqual(identity, pasted) : false;
  });
}
