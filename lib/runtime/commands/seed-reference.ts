// Shared seed-reference commands — single source for HTTP + MCP.

import {
  deleteSeedReference,
  listSeedReferences,
  registerSeedReference,
  resolveHttpRegisteredVia,
  updateSeedReferenceNote,
  type SeedReferenceDeleteResponse,
  type SeedReferenceErrorReason,
  type SeedReferenceNoteUpdateResponse,
  type SeedReferenceRecord,
  type SeedReferenceResponse
} from "../seed-reference";

export type RegisterSeedCommandResult =
  | SeedReferenceResponse
  | { ok: false; reason: SeedReferenceErrorReason | "ui_registration_disabled" };

/**
 * Historical / fixture-only seed writer (no Figma capture).
 *
 * Active product path is `addSeedReferenceCommand` (Workbench paste +
 * MCP `add_seed_reference`). This command remains for unit fixtures and
 * migration-era compatibility tests — it is not registered on Active MCP
 * and Active HTTP POST routes no longer call it.
 *
 * Register a seed. `registeredVia` policy:
 * - HTTP callers should pass `enforceHttpVia: true` (rejects ui).
 * - MCP always registers as agent (default).
 */
export function registerSeedReferenceCommand(
  projectPath: string,
  input: unknown,
  options?: { enforceHttpVia?: boolean }
): RegisterSeedCommandResult {
  const raw =
    input !== null && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};

  let registeredVia: "ui" | "agent" = "agent";
  if (options?.enforceHttpVia) {
    const via = resolveHttpRegisteredVia(raw.registeredVia);
    if (!via.ok) {
      return { ok: false, reason: via.reason };
    }
    registeredVia = via.registeredVia;
  } else if (raw.registeredVia === "ui") {
    registeredVia = "ui";
  }

  return registerSeedReference(projectPath, {
    figmaSeedReference:
      typeof raw.figmaSeedReference === "string" ? raw.figmaSeedReference : "",
    originalDesignIntent:
      typeof raw.originalDesignIntent === "string"
        ? raw.originalDesignIntent
        : "",
    registeredVia
  });
}

export type ListSeedReferencesCommandResult = {
  ok: true;
  records: SeedReferenceRecord[];
};

export function listSeedReferencesCommand(
  projectPath: string
): ListSeedReferencesCommandResult {
  return { ok: true, records: listSeedReferences(projectPath) };
}

export function deleteSeedReferenceCommand(
  projectPath: string,
  id: string
): SeedReferenceDeleteResponse {
  return deleteSeedReference(projectPath, id);
}

export function updateSeedReferenceNoteCommand(
  projectPath: string,
  input: { id: unknown; referenceNote?: unknown }
): SeedReferenceNoteUpdateResponse {
  return updateSeedReferenceNote(projectPath, {
    id: typeof input.id === "string" ? input.id : "",
    referenceNote:
      typeof input.referenceNote === "string" ? input.referenceNote : ""
  });
}
