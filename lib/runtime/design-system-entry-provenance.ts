import { createHash } from "node:crypto";
import type { DesignSystemFileKind } from "./design-system-schema";

export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = sortKeysDeep(source[key]);
    }
    return sorted;
  }
  return value;
}

/** Stable fingerprint of the exact status-bearing entry the designer approved. */
export function designSystemEntryContentDigest(entry: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(sortKeysDeep(entry)))
    .digest("hex");
}

/**
 * Build entry-id → content-digest without changing collectStatusEntries' public
 * shape. Callers invoke this only after the source passed schema validation.
 */
export function collectDesignSystemEntryContentDigests(
  fileKind: DesignSystemFileKind,
  json: Record<string, unknown>
): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  const addList = (list: unknown) => {
    for (const raw of list as Array<Record<string, unknown>>) {
      result.set(raw.id as string, designSystemEntryContentDigest(raw));
    }
  };

  switch (fileKind) {
    case "design-system.json":
      result.set(
        (json.visualLanguage as Record<string, unknown>).id as string,
        designSystemEntryContentDigest(json.visualLanguage)
      );
      addList(json.concepts);
      break;
    case "token.json":
      for (const layer of ["primitive", "semantic", "component"] as const) {
        for (const [name, raw] of Object.entries(
          json[layer] as Record<string, unknown>
        )) {
          result.set(`${layer}.${name}`, designSystemEntryContentDigest(raw));
        }
      }
      break;
    case "component-list.json":
      addList(json.components);
      break;
    case "component-spec":
      result.set(json.id as string, designSystemEntryContentDigest(json));
      break;
    case "layout-rules.json":
    case "interaction-rules.json":
      addList(json.rules);
      break;
  }
  return result;
}
