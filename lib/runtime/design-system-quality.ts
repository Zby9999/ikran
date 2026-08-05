import type { DesignSystemEntryRowInput } from "./design-system-ingest";

export type DesignSystemQualityDiagnostic = {
  severity: "warning";
  code:
    | "typography_used_for_restates_role"
    | "typography_composite_roles_missing";
  source_artifact_path: string;
  entry_id?: string;
  related_entry_ids?: string[];
  message: string;
};

const TYPOGRAPHY_STYLE_FIELDS = new Set([
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "textTransform"
]);

const ROLE_NAME_NOISE = new Set([
  "component",
  "font",
  "letter",
  "line",
  "primitive",
  "role",
  "semantic",
  "size",
  "spacing",
  "text",
  "token",
  "transform",
  "typography",
  "weight"
]);

const LOW_INFORMATION_USAGE_WORDS = new Set([
  "a",
  "an",
  "action",
  "call",
  "primary",
  "the",
  "this",
  "to"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCompositeTypographyRole(entry: DesignSystemEntryRowInput): boolean {
  if (
    entry.domain !== "typography" ||
    !["token.semantic", "token.component"].includes(entry.section) ||
    !isRecord(entry.value)
  ) {
    return false;
  }
  const fields = Object.keys(entry.value).filter((key) =>
    TYPOGRAPHY_STYLE_FIELDS.has(key)
  );
  return fields.some((field) => field !== "fontFamily");
}

function semanticWords(value: string): string[] {
  return (
    value
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.filter((word) => !ROLE_NAME_NOISE.has(word)) ?? []
  );
}

function usedForRestatesRole(entry: DesignSystemEntryRowInput): boolean {
  if (
    entry.domain !== "typography" ||
    entry.section === "token.primitive" ||
    !entry.name
  ) {
    return false;
  }
  const role = semanticWords(entry.name);
  const usedFor = isRecord(entry.value) ? entry.value.usedFor : undefined;
  if (typeof usedFor !== "string") return false;
  const usage = semanticWords(usedFor);
  if (role.length === 0 || usage.length === 0) return false;
  if (role.join(" ") === usage.join(" ")) return true;
  if (!role.every((word) => usage.includes(word))) return false;
  const expansion = usage.filter((word) => !role.includes(word));
  return (
    expansion.length > 0 &&
    expansion.every((word) => LOW_INFORMATION_USAGE_WORDS.has(word))
  );
}

function atomicFactKind(name: string | null): string | null {
  const normalized = name?.replace(/[^a-z]/gi, "").toLowerCase() ?? "";
  if (/fontfamily|typeface/.test(normalized)) return "fontFamily";
  if (/fontsize/.test(normalized)) return "fontSize";
  if (/fontweight/.test(normalized)) return "fontWeight";
  if (/lineheight/.test(normalized)) return "lineHeight";
  return null;
}

export function designSystemQualityDiagnostics(
  sourceArtifactPath: string,
  entries: readonly DesignSystemEntryRowInput[]
): DesignSystemQualityDiagnostic[] {
  const typography = entries.filter((entry) => entry.domain === "typography");
  const diagnostics = typography
    .filter(usedForRestatesRole)
    .map(
      (entry): DesignSystemQualityDiagnostic => ({
        severity: "warning",
        code: "typography_used_for_restates_role",
        source_artifact_path: sourceArtifactPath,
        entry_id: entry.entry_id,
        message:
          "Typography usedFor repeats the role identity. Describe its usage context, function, or design intent instead."
      })
    );

  const compositeRoles = typography.filter(isCompositeTypographyRole);
  const atomicFacts = new Set(
    typography.flatMap((entry) => {
      if (entry.status === "gap") return [];
      const kind = atomicFactKind(entry.name);
      return kind ? [kind] : [];
    })
  );
  const hasSufficientConstructionFacts = [
    "fontFamily",
    "fontSize",
    "fontWeight",
    "lineHeight"
  ].every((field) => atomicFacts.has(field));

  if (hasSufficientConstructionFacts && compositeRoles.length === 0) {
    diagnostics.push({
      severity: "warning",
      code: "typography_composite_roles_missing",
      source_artifact_path: sourceArtifactPath,
      related_entry_ids: typography.map((entry) => entry.entry_id),
      message:
        "Typography construction facts are present but no composite role is declared. Map supported facts into evidence-backed composite roles or record explicit gaps."
    });
  }

  return diagnostics;
}
