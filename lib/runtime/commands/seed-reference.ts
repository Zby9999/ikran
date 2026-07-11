// Shared seed-reference commands — single source for HTTP + MCP.

import {
  listSeedReferences,
  registerSeedReference,
  resolveHttpRegisteredVia,
  type SeedReferenceErrorReason,
  type SeedReferenceRecord,
  type SeedReferenceResponse
} from "../seed-reference";

export type RegisterSeedCommandResult =
  | SeedReferenceResponse
  | { ok: false; reason: SeedReferenceErrorReason | "ui_registration_disabled" };

/**
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
