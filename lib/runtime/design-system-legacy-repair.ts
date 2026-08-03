// Legacy token.json repair for the primitive-color-meaning contract.
//
// The schema now requires `meaning: ""` on primitive tokens with
// domain "color" (usage semantics live in the semantic/component layers).
// DB rows are backfilled by migration v21, but SQLite migrations cannot
// reach the filesystem, so source files accepted under the old contract
// would fail re-declaration and designer edits with
// `primitive_color_meaning_forbidden`. This module strips those meanings
// from the on-disk token.json at the two seams that re-read the source:
//   - ./source-artifact (recordSourceArtifact) — only for previously
//     declared files, so freshly authored content still hard-fails and the
//     extraction agent learns the contract;
//   - ./design-system-edit (editDesignSystemEntry) — the ingested DB row
//     already proves the file was accepted under the old schema.
// Every repair is deterministic (same strip set for the same file) and
// audit-logged by the caller.

import { readFileSync, writeFileSync } from "node:fs";

import { stableJsonStringify } from "./design-system-view";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Strip `meaning` down to "" on every primitive token with domain "color"
 * (domain-rule entries keep their meaning). Mutates `json`; returns the
 * qualified names (`primitive.<name>`) of the entries it rewrote.
 */
export function stripLegacyPrimitiveColorMeanings(
  json: Record<string, unknown>
): string[] {
  const primitive = json.primitive;
  if (!isPlainObject(primitive)) return [];
  const stripped: string[] = [];
  for (const [name, raw] of Object.entries(primitive)) {
    if (!isPlainObject(raw)) continue;
    if (raw.domain !== "color" || raw.kind === "domain-rule") continue;
    if (typeof raw.meaning === "string" && raw.meaning !== "") {
      raw.meaning = "";
      stripped.push(`primitive.${name}`);
    }
  }
  return stripped;
}

export type LegacyPrimitiveColorRepairResult =
  | { ok: true; repaired: boolean; stripped: string[] }
  | { ok: false; reason: "read_failed" | "invalid_json" | "write_failed" };

/**
 * Read → strip → write a token.json source file. No-op (repaired: false)
 * when the file already satisfies the contract. The rewrite uses the same
 * stable serialization as the edit / approval write paths.
 */
export function repairLegacyPrimitiveColorMeaningsInFile(
  absolutePath: string
): LegacyPrimitiveColorRepairResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(absolutePath, "utf8"));
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  if (!isPlainObject(parsed)) return { ok: false, reason: "invalid_json" };
  const stripped = stripLegacyPrimitiveColorMeanings(parsed);
  if (stripped.length === 0) return { ok: true, repaired: false, stripped };
  try {
    writeFileSync(absolutePath, `${stableJsonStringify(parsed)}\n`, "utf8");
  } catch {
    return { ok: false, reason: "write_failed" };
  }
  return { ok: true, repaired: true, stripped };
}
