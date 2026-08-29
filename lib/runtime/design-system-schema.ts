// Design-system source JSON schemas (Issue 09 / 09A, Task B).
//
// Locked 09A decisions encoded here (2026-07-29, do not reopen):
//   - All-JSON source layer, no markdown islands: every design-system source
//     artifact is JSON; long prose (e.g. the visual language description)
//     lives in JSON string fields.
//   - File layout under `design-system/`: design-system.json, token.json,
//     component-list.json, components/<name>.json, layout-rules.json,
//     interaction-rules.json.
//   - Every rule / token / component entry carries `value` (prose for rules,
//     structured payload for tokens/components), `status` ("formalized" |
//     "candidate" | "gap") and `links` (answered question card ids / Agent
//     annotation ids). Rules and component inventory entries also carry
//     `meaning`; tokens use per-domain usage fields inside `value`, while
//     component specs use `value.description` instead.
//     Non-gap entries must link at least one record. Unresolved decisions are
//     represented only as rule entries with status `gap` and no links; token
//     entries always carry determined values and therefore cannot be gaps.
//     Gaps are explicit only, never inferred from unconsumed primitives or a
//     prescribed palette size.
//   - Token entries never carry envelope `meaning`: primitive tokens have no
//     usage prose, typography roles may carry `value.usedFor`, and other
//     semantic/component tokens may carry `value.usage`. Rules (including
//     domain rules stored in token.json) keep required `meaning` titles.
//
// These validators are pure structural checks: they never touch the DB and
// never judge prose content. Status cross-validation against alignment
// records lives in ./design-system-status. The schemas below are the single
// source of truth that Task C (ingest) and Task D (write-back) import.

import { existsSync, readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Shared entry contract
// ---------------------------------------------------------------------------

export const DESIGN_SYSTEM_STATUSES = ["formalized", "candidate", "gap"] as const;

export type DesignSystemStatus = (typeof DESIGN_SYSTEM_STATUSES)[number];

export const DESIGN_SYSTEM_ENTRY_KINDS = [
  "token",
  "domain-rule",
  "global-rule"
] as const;

export type DesignSystemEntryKind =
  (typeof DESIGN_SYSTEM_ENTRY_KINDS)[number];

export type DesignSystemFileKind =
  | "design-system.json"
  | "token.json"
  | "component-list.json"
  | "component-spec"
  | "layout-rules.json"
  | "interaction-rules.json";

export const DESIGN_SYSTEM_ENTRY_KIND_FILE_OWNERSHIP = {
  token: ["token.json"],
  "domain-rule": [
    "token.json",
    "layout-rules.json",
    "interaction-rules.json"
  ],
  "global-rule": ["design-system.json"]
} as const satisfies Record<
  DesignSystemEntryKind,
  readonly DesignSystemFileKind[]
>;

function entryKindsAllowedIn(
  fileKind: DesignSystemFileKind
): DesignSystemEntryKind[] {
  return DESIGN_SYSTEM_ENTRY_KINDS.filter((kind) =>
    (DESIGN_SYSTEM_ENTRY_KIND_FILE_OWNERSHIP[kind] as readonly DesignSystemFileKind[])
      .includes(fileKind)
  );
}

export type DesignSystemSchemaReason =
  | "invalid_design_system_json"
  | "missing_required_field"
  | "invalid_field_type"
  | "duplicate_entry_id"
  | "invalid_status"
  | "entry_links_required"
  | "gap_must_not_link"
  | "invalid_entry_kind"
  | "entry_kind_file_mismatch"
  | "unknown_field"
  | "legacy_rule_body_requires_prose"
  | "domain_rule_domain_required"
  | "invalid_token_domain"
  | "token_gap_forbidden"
  | "token_meaning_forbidden"
  | "token_usage_field_forbidden"
  | "token_primitive_alias"
  | "token_alias_unresolvable"
  | "token_alias_invalid_layer"
  | "token_alias_reserved_key"
  | "token_alias_cycle";

export type DesignSystemSchemaOk = { ok: true };

export type DesignSystemSchemaError = {
  ok: false;
  reason: DesignSystemSchemaReason | string;
  details?: unknown;
};

export type DesignSystemSchemaResult =
  | DesignSystemSchemaOk
  | DesignSystemSchemaError;

function fail(
  reason: DesignSystemSchemaReason | string,
  details?: unknown
): DesignSystemSchemaError {
  return details === undefined
    ? { ok: false, reason }
    : { ok: false, reason, details };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowedFields: readonly string[],
  ctx: Record<string, unknown> = {}
): DesignSystemSchemaError | null {
  const allowed = new Set(allowedFields);
  const field = Object.keys(value).find((candidate) => !allowed.has(candidate));
  return field === undefined ? null : fail("unknown_field", { ...ctx, field });
}

function validateRuleBody(
  value: unknown,
  ctx: Record<string, unknown>
): DesignSystemSchemaError | null {
  if (isNonEmptyString(value)) return null;
  if (isPlainObject(value)) {
    return fail("legacy_rule_body_requires_prose", {
      ...ctx,
      field: "value",
      expected: "non-empty prose string",
      migration:
        "Merge the legacy rule fields into value as prose. Keep layout sourceCaptures on the rule entry itself."
    });
  }
  return fail("invalid_field_type", {
    ...ctx,
    field: "value",
    expected: "non-empty prose string"
  });
}

/** Required non-empty string field on `entry`. */
function requireString(
  entry: Record<string, unknown>,
  field: string,
  ctx: Record<string, unknown>
): DesignSystemSchemaError | null {
  const value = entry[field];
  if (value === undefined || (typeof value === "string" && value.trim().length === 0)) {
    return fail("missing_required_field", { ...ctx, field });
  }
  if (typeof value !== "string") {
    return fail("invalid_field_type", { ...ctx, field, expected: "string" });
  }
  return null;
}

/** Required array field on `entry` (item-level checks stay with the caller). */
function requireArray(
  entry: Record<string, unknown>,
  field: string,
  ctx: Record<string, unknown>
): DesignSystemSchemaError | null {
  const value = entry[field];
  if (value === undefined) {
    return fail("missing_required_field", { ...ctx, field });
  }
  if (!Array.isArray(value)) {
    return fail("invalid_field_type", { ...ctx, field, expected: "array" });
  }
  return null;
}

/**
 * Shared entry check: id (only when `withId`), meaning, status, links and a
 * per-kind value check. `ctx` identifies the entry in failure details.
 * `meaningPolicy` names the envelope contract: non-empty by default, exactly
 * optional for tokens/component specs whose prose lives inside `value`.
 */
function checkEntry(
  raw: unknown,
  ctx: Record<string, unknown>,
  options: {
    withId: boolean;
    checkValue: (value: unknown, ctx: Record<string, unknown>) => DesignSystemSchemaError | null;
    allowedKinds?: readonly DesignSystemEntryKind[];
    domainRuleRequiresDomain?: boolean;
    meaningPolicy?: "required" | "optional";
    extraEnvelopeFields?: readonly string[];
  }
): DesignSystemSchemaError | null {
  if (!isPlainObject(raw)) {
    return fail("invalid_field_type", { ...ctx, expected: "object" });
  }
  const unknownField = rejectUnknownFields(
    raw,
    [
      ...(options.withId ? ["id"] : []),
      "kind",
      "domain",
      "value",
      "sourceCaptures",
      "meaning",
      "status",
      "links",
      ...(options.extraEnvelopeFields ?? [])
    ],
    ctx
  );
  if (unknownField) return unknownField;
  if (options.withId) {
    const idFailure = requireString(raw, "id", ctx);
    if (idFailure) return idFailure;
  }
  if (raw.kind !== undefined) {
    if (
      typeof raw.kind !== "string" ||
      !(DESIGN_SYSTEM_ENTRY_KINDS as readonly string[]).includes(raw.kind)
    ) {
      return fail("invalid_entry_kind", {
        ...ctx,
        kind: raw.kind,
        allowed: DESIGN_SYSTEM_ENTRY_KINDS
      });
    }
    if (
      options.allowedKinds &&
      !options.allowedKinds.includes(raw.kind as DesignSystemEntryKind)
    ) {
      return fail("entry_kind_file_mismatch", {
        ...ctx,
        kind: raw.kind,
        allowed: options.allowedKinds
      });
    }
    if (
      raw.kind === "domain-rule" &&
      options.domainRuleRequiresDomain &&
      !isNonEmptyString(raw.domain)
    ) {
      return fail("domain_rule_domain_required", ctx);
    }
  }
  if (options.meaningPolicy !== "optional" || raw.meaning !== undefined) {
    const meaningFailure = requireString(raw, "meaning", ctx);
    if (meaningFailure) return meaningFailure;
  }

  if (raw.status === undefined) {
    return fail("missing_required_field", { ...ctx, field: "status" });
  }
  if (
    typeof raw.status !== "string" ||
    !(DESIGN_SYSTEM_STATUSES as readonly string[]).includes(raw.status)
  ) {
    return fail("invalid_status", { ...ctx, status: raw.status });
  }

  if (raw.links === undefined) {
    return fail("missing_required_field", { ...ctx, field: "links" });
  }
  if (
    !Array.isArray(raw.links) ||
    raw.links.some((link) => !isNonEmptyString(link))
  ) {
    return fail("invalid_field_type", {
      ...ctx,
      field: "links",
      expected: "array of non-empty strings"
    });
  }
  if (raw.status === "gap" && raw.links.length > 0) {
    return fail("gap_must_not_link", ctx);
  }
  if (raw.status !== "gap" && raw.links.length === 0) {
    return fail("entry_links_required", ctx);
  }

  if (raw.value === undefined) {
    return fail("missing_required_field", { ...ctx, field: "value" });
  }
  return options.checkValue(raw.value, ctx);
}

/** Array-of-entries collection with unique ids. */
function checkEntryArray(
  raw: unknown,
  field: string,
  checkValue: (value: unknown, ctx: Record<string, unknown>) => DesignSystemSchemaError | null,
  allowedKinds?: readonly DesignSystemEntryKind[]
): DesignSystemSchemaError | null {
  if (raw === undefined) {
    return fail("missing_required_field", { field });
  }
  if (!Array.isArray(raw)) {
    return fail("invalid_field_type", { field, expected: "array" });
  }
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const ctx = { collection: field, index: i };
    const failure = checkEntry(raw[i], ctx, {
      withId: true,
      checkValue,
      allowedKinds
    });
    if (failure) return failure;
    const id = (raw[i] as Record<string, unknown>).id as string;
    if (seen.has(id)) {
      return fail("duplicate_entry_id", { collection: field, id });
    }
    seen.add(id);
  }
  return null;
}

// ---------------------------------------------------------------------------
// token.json — 3 layers (primitive → semantic → component) + alias graph
//
// Shape: { primitive: {name: TokenEntry}, semantic: {...}, component: {...} }.
// The map key is the token identity (no `id` field). A TokenEntry value is
// either a concrete payload (any non-null JSON value) or a PURE alias object
// `{ alias: "<layer>.<tokenName>" }` — the `alias` key is RESERVED for alias
// references: a concrete value object MUST NOT contain an `alias` key, and a
// mixed object combining `alias` with content keys is rejected with
// `token_alias_reserved_key`. Task C (ingest) / Task D (write-back) respect
// that encoding. Alias targets are layer-qualified so references are
// unambiguous inside the single file (09A: the cross-domain alias web stays
// in one file).
//
// Layer rules: primitive entries must be concrete (no alias). semantic may
// alias primitive or semantic; component may alias component, semantic or
// primitive — sideways chains and layer-skipping back-references are
// allowed, forward references are not. Cycles (incl. self-cycles) are
// rejected with the offending path in details.
//
// Usage contract: token entries never carry envelope `meaning`. Primitive
// entries carry no usage prose. Semantic/component typography roles may use
// `value.usedFor`; other domains may use `value.usage`. Domain rules remain
// rules and keep required envelope `meaning`.
// ---------------------------------------------------------------------------

// Single owner of the token layer vocabulary: ./design-system-ingest
// (flatten) and ./design-system-approval (write-back location) import these
// instead of re-declaring them.
export const TOKEN_LAYERS = ["primitive", "semantic", "component"] as const;

export type TokenLayer = (typeof TOKEN_LAYERS)[number];

/**
 * Semantic token domain is explicit source data. The Browser may retain its
 * legacy name-based fallback for old rows, but newly extracted tokens should
 * declare one of these values so typography, color, spacing, and other
 * established decisions are never lost to naming heuristics.
 */
export const TOKEN_DOMAINS = [
  "color",
  "typography",
  "spacing",
  "size",
  "ratio",
  "radius",
  "border",
  "shadow",
  "opacity",
  "motion",
  "breakpoint",
  "other"
] as const;

export type TokenDomain = (typeof TOKEN_DOMAINS)[number];

/** Designer-facing component collections required by the extraction flow. */
export const RICH_COMPONENT_SPEC_FIELDS = [
  "variants",
  "guidelines",
  "tokenLinks",
  "codeLinks"
] as const;

export const COMPONENT_SPEC_VALUE_FIELDS = [
  "description",
  "props",
  "stateMatrix",
  ...RICH_COMPONENT_SPEC_FIELDS,
  "group",
  "liveHero",
  "sourceCaptures"
] as const;

const ALLOWED_ALIAS_TARGET_LAYERS: Record<TokenLayer, readonly TokenLayer[]> =
  {
    primitive: [],
    semantic: ["primitive", "semantic"],
    component: ["primitive", "semantic", "component"]
  };

/**
 * Parse a layer-qualified token reference ("<layer>.<name>"; the name may
 * itself contain dots). Used for alias targets here, and by Task D's
 * write-back to split a token entry id into its nested file location.
 * Null when the shape or layer is invalid.
 */
export function parseTokenEntryRef(
  ref: string
): { layer: TokenLayer; name: string } | null {
  const dot = ref.indexOf(".");
  if (dot <= 0 || dot === ref.length - 1) return null;
  const layer = ref.slice(0, dot);
  const name = ref.slice(dot + 1);
  if (!(TOKEN_LAYERS as readonly string[]).includes(layer)) return null;
  return { layer: layer as TokenLayer, name };
}

/**
 * Extract an alias reference from a token value, using the module's uniform
 * result idiom: ok with `alias: null` for a concrete payload, ok with the
 * target string for an alias object, or a failure when the reserved `alias`
 * key is misused — a non-string target, or a MIXED object that combines
 * `alias` with content keys (the reserved key belongs to pure alias objects
 * only; concrete values must not carry it).
 */
function aliasTargetOf(
  value: unknown
): { ok: true; alias: string | null } | DesignSystemSchemaError {
  if (!isPlainObject(value) || !("alias" in value)) {
    return { ok: true, alias: null };
  }
  const keys = Object.keys(value);
  if (keys.some((key) => !["alias", "usage", "usedFor"].includes(key))) {
    return fail("token_alias_reserved_key", {
      field: "value",
      keys: keys.sort()
    });
  }
  if (!isNonEmptyString(value.alias)) {
    return fail("invalid_field_type", {
      field: "value.alias",
      expected: "non-empty string"
    });
  }
  return { ok: true, alias: value.alias };
}

function braceColorReferenceOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^\{color\.([^{}]+)\}$/.exec(value.trim());
  return match?.[1]?.trim() || null;
}

export function validateTokenUsageField(
  value: unknown,
  layer: TokenLayer,
  domain: unknown,
  ctx: Record<string, unknown> = {}
): DesignSystemSchemaError | null {
  if (!isPlainObject(value)) return null;
  const usageField = domain === "typography" ? "usedFor" : "usage";
  const wrongField = usageField === "usedFor" ? "usage" : "usedFor";
  if (value[wrongField] !== undefined) {
    return fail("token_usage_field_forbidden", {
      ...ctx,
      field: `value.${wrongField}`,
      expected:
        layer === "primitive" ? "no token usage field" : `value.${usageField}`
    });
  }
  if (value[usageField] !== undefined) {
    if (layer === "primitive") {
      return fail("token_usage_field_forbidden", {
        ...ctx,
        field: `value.${usageField}`,
        expected: "no token usage field"
      });
    }
    if (!isNonEmptyString(value[usageField])) {
      return fail("invalid_field_type", {
        ...ctx,
        field: `value.${usageField}`,
        expected: "non-empty string"
      });
    }
  }
  return null;
}

function parseAliasRef(
  ref: string
): { layer: TokenLayer; name: string } | null {
  return parseTokenEntryRef(ref);
}

function validateTokenJson(json: Record<string, unknown>): DesignSystemSchemaResult {
  const unknownRootField = Object.keys(json).find(
    (field) => !(TOKEN_LAYERS as readonly string[]).includes(field)
  );
  if (unknownRootField) {
    return fail("unknown_field", { field: unknownRootField });
  }
  const layers = new Map<TokenLayer, Record<string, unknown>>();
  for (const layer of TOKEN_LAYERS) {
    const raw = json[layer];
    if (raw === undefined) {
      return fail("missing_required_field", { field: layer });
    }
    if (!isPlainObject(raw)) {
      return fail("invalid_field_type", { field: layer, expected: "object" });
    }
    layers.set(layer, raw);
  }

  // alias target → qualified name, plus entry checks.
  const aliasEdges = new Map<string, string>();
  for (const layer of TOKEN_LAYERS) {
    const entries = layers.get(layer)!;
    for (const [name, raw] of Object.entries(entries)) {
      const qualified = `${layer}.${name}`;
      const ctx = { token: qualified };
      if (!isPlainObject(raw)) {
        return fail("invalid_field_type", { ...ctx, expected: "object" });
      }
      if (
        raw.domain !== undefined &&
        (typeof raw.domain !== "string" ||
          !(TOKEN_DOMAINS as readonly string[]).includes(raw.domain))
      ) {
        return fail("invalid_token_domain", {
          ...ctx,
          domain: raw.domain,
          allowed: TOKEN_DOMAINS
        });
      }
      const alias = aliasTargetOf(raw.value);
      if (!alias.ok) return alias;
      const aliasRef = alias.alias;
      const braceColorReference =
        layer === "primitive" || raw.kind === "domain-rule" || raw.domain !== "color"
          ? null
          : braceColorReferenceOf(raw.value);
      if (braceColorReference !== null) {
        const primitive = layers.get("primitive")!;
        const primitiveName = Object.prototype.hasOwnProperty.call(
          primitive,
          braceColorReference
        )
          ? braceColorReference
          : Object.prototype.hasOwnProperty.call(
                primitive,
                `color.${braceColorReference}`
              )
            ? `color.${braceColorReference}`
            : "<token-name>";
        return fail("token_alias_unresolvable", {
          ...ctx,
          field: "value",
          expected: `{ alias: \"primitive.${primitiveName}\", usage: \"...\" }`
        });
      }
      if (raw.kind !== "domain-rule" && raw.meaning !== undefined) {
        return fail("token_meaning_forbidden", {
          ...ctx,
          field: "meaning"
        });
      }
      if (raw.kind !== "domain-rule" && raw.status === "gap") {
        return fail("token_gap_forbidden", {
          ...ctx,
          migration:
            "Represent the unresolved decision as a domain-rule with status gap; token entries must carry determined values."
        });
      }
      if (raw.kind !== "domain-rule") {
        const usageFailure = validateTokenUsageField(
          raw.value,
          layer,
          raw.domain,
          ctx
        );
        if (usageFailure) return usageFailure;
      }
      const entryFailure = checkEntry(raw, ctx, {
        withId: false,
        allowedKinds: ["token", "domain-rule"],
        domainRuleRequiresDomain: true,
        meaningPolicy: raw.kind === "domain-rule" ? "required" : "optional",
        checkValue: (value) => {
          if (raw.kind === "domain-rule") {
            return validateRuleBody(value, ctx);
          }
          if (value === null) {
            return fail("invalid_field_type", { ...ctx, field: "value", expected: "non-null" });
          }
          if (layer === "primitive" && aliasRef !== null) {
            return fail("token_primitive_alias", ctx);
          }
          return null;
        }
      });
      if (entryFailure) return entryFailure;

      if (aliasRef !== null) {
        const target = parseAliasRef(aliasRef);
        if (!target) {
          return fail("token_alias_unresolvable", { ...ctx, alias: aliasRef });
        }
        if (!ALLOWED_ALIAS_TARGET_LAYERS[layer].includes(target.layer)) {
          return fail("token_alias_invalid_layer", {
            ...ctx,
            alias: aliasRef,
            targetLayer: target.layer
          });
        }
        const targetQualified = `${target.layer}.${target.name}`;
        if (
          !Object.prototype.hasOwnProperty.call(
            layers.get(target.layer)!,
            target.name
          )
        ) {
          return fail("token_alias_unresolvable", { ...ctx, alias: aliasRef });
        }
        aliasEdges.set(qualified, targetQualified);
      }
    }
  }

  // Topological check: every alias chain must terminate. Three-color DFS;
  // the cycle path (first repeated node … repeat) goes into details.
  const color = new Map<string, 1 | 2>();
  const visit = (node: string, stack: string[]): string[] | null => {
    color.set(node, 1);
    stack.push(node);
    const next = aliasEdges.get(node);
    if (next !== undefined) {
      if (color.get(next) === 1) {
        return stack.slice(stack.indexOf(next)).concat(next);
      }
      if (color.get(next) !== 2) {
        const cycle = visit(next, stack);
        if (cycle) return cycle;
      }
    }
    stack.pop();
    color.set(node, 2);
    return null;
  };
  for (const node of aliasEdges.keys()) {
    if (color.has(node)) continue;
    const cycle = visit(node, []);
    if (cycle) {
      return fail("token_alias_cycle", { path: cycle });
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Per-file-kind validators
// ---------------------------------------------------------------------------

function validateDesignSystemMeta(
  json: Record<string, unknown>
): DesignSystemSchemaResult {
  const unknownField = rejectUnknownFields(json, [
    "name",
    "visualLanguage",
    "concepts"
  ]);
  if (unknownField) return unknownField;
  const nameFailure = requireString(json, "name", {});
  if (nameFailure) return nameFailure;

  if (json.visualLanguage === undefined) {
    return fail("missing_required_field", { field: "visualLanguage" });
  }
  const visualFailure = checkEntry(json.visualLanguage, { entry: "visualLanguage" }, {
    withId: true,
    allowedKinds: entryKindsAllowedIn("design-system.json"),
    checkValue: (value, ctx) => {
      if (!isPlainObject(value)) {
        return fail("invalid_field_type", { ...ctx, field: "value", expected: "object" });
      }
      return requireString(value, "description", { ...ctx, field: "value" });
    }
  });
  if (visualFailure) return visualFailure;

  return (
    checkEntryArray(json.concepts, "concepts", (value, ctx) => {
      return validateRuleBody(value, ctx);
    }, ["global-rule"]) ?? { ok: true }
  );
}

function validateComponentList(
  json: Record<string, unknown>
): DesignSystemSchemaResult {
  const unknownField = rejectUnknownFields(json, ["components"]);
  if (unknownField) return unknownField;
  return (
    checkEntryArray(json.components, "components", (value, ctx) => {
      if (!isPlainObject(value)) {
        return fail("invalid_field_type", { ...ctx, field: "value", expected: "object" });
      }
      return (
        requireString(value, "name", { ...ctx, field: "value" }) ??
        requireString(value, "specPath", { ...ctx, field: "value" })
      );
    }, entryKindsAllowedIn("component-list.json")) ?? { ok: true }
  );
}

// components/<name>.json — one file per component. Every designer-facing
// collection is required so Runtime and Workbench cannot silently diverge.
// Size and viewport choices live in variants, motion lives on state rows, and
// prescriptive rules live in polarity-explicit guidelines.
function validateComponentSpec(
  json: Record<string, unknown>
): DesignSystemSchemaResult {
  const nameFailure = requireString(json, "name", {});
  if (nameFailure) return nameFailure;
  return checkEntry(json, {}, {
    withId: true,
    allowedKinds: entryKindsAllowedIn("component-spec"),
    meaningPolicy: "optional",
    extraEnvelopeFields: ["name"],
    checkValue: (value, ctx) => {
      if (!isPlainObject(value)) {
        return fail("invalid_field_type", { ...ctx, field: "value", expected: "object" });
      }
      const unknownField = Object.keys(value).find(
        (field) =>
          !(COMPONENT_SPEC_VALUE_FIELDS as readonly string[]).includes(field)
      );
      if (unknownField) {
        return fail("unknown_field", {
          ...ctx,
          field: `value.${unknownField}`
        });
      }
      const descriptionFailure = requireString(value, "description", { ...ctx, field: "value" });
      if (descriptionFailure) return descriptionFailure;

      const propsFailure = requireArray(value, "props", { ...ctx, field: "value" });
      if (propsFailure) return propsFailure;
      const props = value.props as unknown[];
      for (let i = 0; i < props.length; i++) {
        const prop = props[i];
        if (!isPlainObject(prop)) {
          return fail("invalid_field_type", { ...ctx, field: `value.props[${i}]`, expected: "object" });
        }
        const propFailure =
          requireString(prop, "name", { ...ctx, field: `value.props[${i}]` }) ??
          requireString(prop, "type", { ...ctx, field: `value.props[${i}]` });
        if (propFailure) return propFailure;
      }

      const variantsFailure = requireArray(value, "variants", { ...ctx, field: "value" });
      if (variantsFailure) return variantsFailure;
      const variants = value.variants as unknown[];
      for (let i = 0; i < variants.length; i++) {
        const variant = variants[i];
        if (
          !isPlainObject(variant) ||
          !isNonEmptyString(variant.name) ||
          (variant.axis !== "style" &&
            variant.axis !== "size" &&
            variant.axis !== "viewport")
        ) {
          return fail("invalid_field_type", {
            ...ctx,
            field: `value.variants[${i}]`,
            expected: '{ axis: "style" | "size" | "viewport", name: non-empty string }'
          });
        }
      }

      const stateMatrixFailure = requireArray(value, "stateMatrix", { ...ctx, field: "value" });
      if (stateMatrixFailure) return stateMatrixFailure;
      const stateMatrix = value.stateMatrix as unknown[];
      for (let i = 0; i < stateMatrix.length; i++) {
        const state = stateMatrix[i];
        if (!isPlainObject(state)) {
          return fail("invalid_field_type", { ...ctx, field: `value.stateMatrix[${i}]`, expected: "object" });
        }
        const stateFailure = requireString(state, "state", { ...ctx, field: `value.stateMatrix[${i}]` });
        if (stateFailure) return stateFailure;
      }

      const guidelinesFailure = requireArray(value, "guidelines", { ...ctx, field: "value" });
      if (guidelinesFailure) return guidelinesFailure;
      const guidelines = value.guidelines as unknown[];
      for (let i = 0; i < guidelines.length; i++) {
        const guideline = guidelines[i];
        if (
          !isPlainObject(guideline) ||
          (guideline.kind !== "do" && guideline.kind !== "dont") ||
          !isNonEmptyString(guideline.text)
        ) {
          return fail("invalid_field_type", {
            ...ctx,
            field: `value.guidelines[${i}]`,
            expected: '{ kind: "do" | "dont", text: non-empty string }'
          });
        }
      }

      for (const field of ["tokenLinks", "codeLinks"] as const) {
        const collectionFailure = requireArray(value, field, { ...ctx, field: "value" });
        if (collectionFailure) return collectionFailure;
        const invalidIndex = (value[field] as unknown[]).findIndex(
          (item) => !(isNonEmptyString(item) || isPlainObject(item))
        );
        if (invalidIndex >= 0) {
          return fail("invalid_field_type", {
            ...ctx,
            field: `value.${field}[${invalidIndex}]`,
            expected: "non-empty string or object"
          });
        }
      }
      // 09C-D03: optional sidebar grouping. Absent stays valid (09A/09B
      // legacy specs); when present it is a closed enum.
      if (
        value.group !== undefined &&
        value.group !== "component" &&
        value.group !== "block"
      ) {
        return fail("invalid_field_type", {
          ...ctx,
          field: "value.group",
          expected: '"component" | "block"'
        });
      }
      if (value.sourceCaptures !== undefined) {
        const captures = validateSourceCaptures(
          value.sourceCaptures,
          "value.sourceCaptures",
          ctx
        );
        if (!captures.ok) return captures;
      }
      if (value.liveHero !== undefined) {
        if (!isPlainObject(value.liveHero)) {
          return fail("invalid_field_type", {
            ...ctx,
            field: "value.liveHero",
            expected: "object"
          });
        }
        const liveHero = value.liveHero;
        const unknownLiveField = Object.keys(liveHero).find(
          (field) =>
            !["surfaceId", "harnessPath", "harnessArtifactPath"].includes(
              field
            )
        );
        if (unknownLiveField) {
          return fail("unknown_field", {
            ...ctx,
            field: `value.liveHero.${unknownLiveField}`
          });
        }
        for (const field of ["surfaceId", "harnessPath", "harnessArtifactPath"] as const) {
          const failure = requireString(liveHero, field, {
            ...ctx,
            field: "value.liveHero"
          });
          if (failure) return failure;
        }
        if (!isCaptureHarnessPath(String(liveHero.harnessPath))) {
          return fail("invalid_field_type", {
            ...ctx,
            field: "value.liveHero.harnessPath",
            expected:
              'same-origin relative path ("/" prefix; no "..", scheme/authority, query or fragment)'
          });
        }
      }
      return null;
    }
  }) ?? { ok: true };
}

function validateRulesFile(
  json: Record<string, unknown>,
  fileKind: "layout-rules.json" | "interaction-rules.json"
): DesignSystemSchemaResult {
  const unknownField = rejectUnknownFields(json, ["rules"]);
  if (unknownField) return unknownField;
  return (
    checkEntryArray(json.rules, "rules", (value, ctx) => {
      return validateRuleBody(value, ctx);
    }, entryKindsAllowedIn(fileKind)) ?? { ok: true }
  );
}

// ---------------------------------------------------------------------------
// Layout rule source captures (09C-D02)
// ---------------------------------------------------------------------------

/** Rule → Figma node screenshot provenance. Captures are structured records
 * outside the prose body and get their own item shape check below. */
export const LAYOUT_RULE_CAPTURE_FIELD = "sourceCaptures";
export const LAYOUT_RULE_CAPTURE_REQUIRED_FIELDS = [
  "nodeName",
  "artifactPath",
  "capturedAt"
] as const;
export const LAYOUT_RULE_CAPTURE_OPTIONAL_FIELDS = [
  "nodeId",
  "surfaceId"
] as const;

/** Node position inside the capture image (fractions of the PNG, v2
 * annotation). Optional: captures without it simply render no position
 * mark. x/y locate the node's top-left inside the image and stay in
 * [0, 1]; width/height may exceed 1 when the fixed-ratio crop truncates
 * an oversized node (the browser skips the mark for near-fill rects and
 * uses the fraction aspect to pick the figure orientation). */
export const LAYOUT_RULE_CAPTURE_NODE_RECT_FIELD = "nodeRect";
export const LAYOUT_RULE_CAPTURE_NODE_RECT_KEYS = [
  "x",
  "y",
  "width",
  "height"
] as const;
/** Generous ceiling for width/height — a node more than 4× the crop is a
 * data error, not a truncation. */
export const LAYOUT_RULE_CAPTURE_NODE_RECT_MAX_EXTENT = 4;

/** Path convention for artifacts whose entries declare sourceCaptures:
 * layout rules and component specs. Single source for the rule-update
 * guidance trigger (which only has paths, not artifact types). */
export function isCaptureBearingArtifactPath(artifactPath: string): boolean {
  return (
    /(^|\/)layout-rules\.json$/.test(artifactPath) ||
    /(^|\/)design-system\/components\/[^/]+\.json$/.test(artifactPath)
  );
}

/** Harness path contract (Issue 33): a same-origin relative route inside the
 * prototype app — leading slash, no scheme/authority ("//host"), no parent
 * traversal, no fragment or backslashes. Runtime-owned shared adapters may
 * carry exactly one `registrationId` query parameter; the hero preserves it
 * while adding `state`. Shared by the live-hero declaration gate, legacy
 * capture compatibility, and the view's defensive parse. */
export function isCaptureHarnessPath(value: string): boolean {
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  if (value.includes("..")) return false;
  if (/[#\\]/.test(value)) return false;
  const question = value.indexOf("?");
  if (question >= 0) {
    if (value.indexOf("?", question + 1) >= 0) return false;
    const params = new URLSearchParams(value.slice(question + 1));
    if (
      [...params.keys()].length !== 1 ||
      !params.has("registrationId") ||
      (params.get("registrationId") ?? "").trim().length === 0
    ) return false;
  }
  return true;
}

/** Bounds check shared by the declaration gate and the view's defensive
 * parse: x/y in [0, 1]; width/height in (0, MAX_EXTENT] — above 1 means the
 * fixed-ratio crop truncates the node, which is expected. */
export function isCaptureNodeRectBounds(
  x: number,
  y: number,
  width: number,
  height: number
): boolean {
  return (
    x >= 0 &&
    y >= 0 &&
    x <= 1 &&
    y <= 1 &&
    width > 0 &&
    height > 0 &&
    width <= LAYOUT_RULE_CAPTURE_NODE_RECT_MAX_EXTENT &&
    height <= LAYOUT_RULE_CAPTURE_NODE_RECT_MAX_EXTENT
  );
}

function validateCaptureNodeRect(
  item: Record<string, unknown>,
  itemField: string
): DesignSystemSchemaResult {
  const rect = item[LAYOUT_RULE_CAPTURE_NODE_RECT_FIELD];
  if (rect === undefined) return { ok: true };
  const rectField = `${itemField}.${LAYOUT_RULE_CAPTURE_NODE_RECT_FIELD}`;
  if (!isPlainObject(rect)) {
    return fail("invalid_field_type", { field: rectField, expected: "object" });
  }
  for (const key of LAYOUT_RULE_CAPTURE_NODE_RECT_KEYS) {
    const value = rect[key];
    if (typeof value !== "number" || Number.isNaN(value)) {
      return fail("invalid_field_type", {
        field: `${rectField}.${key}`,
        expected: "number"
      });
    }
  }
  const { x, y, width, height } = rect as {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  if (!isCaptureNodeRectBounds(x, y, width, height)) {
    return fail("invalid_field_type", {
      field: rectField,
      expected: `x/y in [0, 1]; width/height in (0, ${LAYOUT_RULE_CAPTURE_NODE_RECT_MAX_EXTENT}] (may exceed 1 when the crop truncates the node)`
    });
  }
  return { ok: true };
}

function validateSourceCaptures(
  captures: unknown,
  field: string,
  context: Record<string, unknown> = {}
): DesignSystemSchemaResult {
  if (!Array.isArray(captures)) {
    return fail("invalid_field_type", {
      ...context,
      field,
      expected: "array"
    });
  }
  for (let i = 0; i < captures.length; i++) {
    const item = captures[i];
    const itemField = `${field}[${i}]`;
    if (!isPlainObject(item)) {
      return fail("invalid_field_type", {
        ...context,
        field: itemField,
        expected: "object"
      });
    }
    for (const requiredField of LAYOUT_RULE_CAPTURE_REQUIRED_FIELDS) {
      if (!isNonEmptyString(item[requiredField])) {
        return fail("invalid_field_type", {
          ...context,
          field: `${itemField}.${requiredField}`,
          expected: "non-empty string"
        });
      }
    }
    for (const optionalField of LAYOUT_RULE_CAPTURE_OPTIONAL_FIELDS) {
      if (
        item[optionalField] !== undefined &&
        !isNonEmptyString(item[optionalField])
      ) {
        return fail("invalid_field_type", {
          ...context,
          field: `${itemField}.${optionalField}`,
          expected: "non-empty string"
        });
      }
    }
    const rect = validateCaptureNodeRect(item, itemField);
    if (!rect.ok) return rect;
    const origin = validateCaptureOrigin(item, itemField, context);
    if (!origin.ok) return origin;
  }
  return { ok: true };
}

/** Capture provenance (Issue 32): "source" is a Figma node screenshot (the
 * legacy default when `origin` is absent), "code" is a code rendering
 * screenshot, which must carry the code files it froze and their content
 * digest so the view can verdict freshness. */
export const CAPTURE_ORIGINS = ["source", "code"] as const;

function validateCaptureOrigin(
  item: Record<string, unknown>,
  itemField: string,
  context: Record<string, unknown>
): DesignSystemSchemaResult {
  if (
    item.origin !== undefined &&
    item.origin !== "source" &&
    item.origin !== "code"
  ) {
    return fail("invalid_field_type", {
      ...context,
      field: `${itemField}.origin`,
      expected: '"source" | "code"'
    });
  }
  const origin = item.origin === undefined ? "source" : item.origin;
  // Live-render harness declaration (Issue 33): only a code capture can name
  // the prototype-app route that mounts its component — a source capture's
  // surface is Figma evidence, never a renderable preview.
  if (item.harnessPath !== undefined) {
    if (
      !isNonEmptyString(item.harnessPath) ||
      !isCaptureHarnessPath(item.harnessPath)
    ) {
      return fail("invalid_field_type", {
        ...context,
        field: `${itemField}.harnessPath`,
        expected:
          'same-origin relative path ("/" prefix; no "..", scheme/authority, query or fragment)'
      });
    }
    if (origin !== "code") {
      return fail("invalid_field_type", {
        ...context,
        field: `${itemField}.harnessPath`,
        expected: 'only allowed when origin is "code"'
      });
    }
  }
  if (origin !== "code") return { ok: true };
  if (!isNonEmptyString(item.codeDigest)) {
    return fail("invalid_field_type", {
      ...context,
      field: `${itemField}.codeDigest`,
      expected: 'non-empty string (required when origin is "code")'
    });
  }
  if (
    !Array.isArray(item.codeLinks) ||
    item.codeLinks.length === 0 ||
    item.codeLinks.some((link) => !isNonEmptyString(link))
  ) {
    return fail("invalid_field_type", {
      ...context,
      field: `${itemField}.codeLinks`,
      expected: 'non-empty string array (required when origin is "code")'
    });
  }
  return { ok: true };
}

function validateLayoutRulesFile(
  json: Record<string, unknown>
): DesignSystemSchemaResult {
  const base = validateRulesFile(json, "layout-rules.json");
  if (!base.ok) return base;
  // Captures stay structured outside the prose body.
  const rules = json.rules as Record<string, unknown>[];
  for (const rule of rules) {
    const captures = rule[LAYOUT_RULE_CAPTURE_FIELD];
    if (captures === undefined) continue;
    const result = validateSourceCaptures(
      captures,
      LAYOUT_RULE_CAPTURE_FIELD
    );
    if (!result.ok) return result;
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const FILE_KIND_VALIDATORS: Record<
  DesignSystemFileKind,
  (json: Record<string, unknown>) => DesignSystemSchemaResult
> = {
  "design-system.json": validateDesignSystemMeta,
  "token.json": validateTokenJson,
  "component-list.json": validateComponentList,
  "component-spec": validateComponentSpec,
  "layout-rules.json": validateLayoutRulesFile,
  "interaction-rules.json": (json) =>
    validateRulesFile(json, "interaction-rules.json")
};

export function validateDesignSystemJson(
  fileKind: DesignSystemFileKind,
  json: unknown
): DesignSystemSchemaResult {
  if (!isPlainObject(json)) {
    return fail("invalid_design_system_json");
  }
  return FILE_KIND_VALIDATORS[fileKind](json);
}

/**
 * Single owner of the exists → read → JSON.parse → top-level-object shell
 * used by declaration-time file checks — both the per-kind checks below and
 * the class fallback in ./source-artifact build on this.
 */
export function readJsonFileObject(
  absolutePath: string
):
  | { ok: true; json: Record<string, unknown> }
  | { ok: false; reason: "artifact_file_missing" | "invalid_design_system_json" } {
  if (!existsSync(absolutePath)) {
    return { ok: false, reason: "artifact_file_missing" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(absolutePath, "utf-8"));
  } catch {
    return { ok: false, reason: "invalid_design_system_json" };
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, reason: "invalid_design_system_json" };
  }
  return { ok: true, json: parsed };
}

/**
 * Task A `checkFile` seam adapter: file shell → deep per-kind schema.
 * Returns the failure reason or null when the file passes. Failure details
 * are available via validateDesignSystemJson for callers (Task C ingest)
 * that need them.
 */
export function designSystemFileCheck(
  fileKind: DesignSystemFileKind
): (
  absolutePath: string
) => DesignSystemSchemaReason | "artifact_file_missing" | string | null {
  return (absolutePath) => {
    const file = readJsonFileObject(absolutePath);
    if (!file.ok) return file.reason;
    const result = validateDesignSystemJson(fileKind, file.json);
    return result.ok ? null : result.reason;
  };
}

/**
 * Flatten a validated file into the status-bearing entries Task C's ingest
 * feeds to ./design-system-status. Token entries are layer-qualified
 * (`semantic.color.primary`); everything else uses its `id`.
 *
 * Assumes `json` already passed validateDesignSystemJson for `fileKind`.
 */
export function collectStatusEntries(
  fileKind: DesignSystemFileKind,
  json: unknown
): Array<{ id: string; status: DesignSystemStatus; links: string[] }> {
  const root = json as Record<string, unknown>;
  const fromEntry = (raw: unknown, idOverride?: string) => {
    const entry = raw as { id?: string; status: DesignSystemStatus; links: string[] };
    return {
      id: idOverride ?? entry.id!,
      status: entry.status,
      links: entry.links
    };
  };

  switch (fileKind) {
    case "design-system.json": {
      const concepts = root.concepts as unknown[];
      return [
        fromEntry(root.visualLanguage),
        ...concepts.map((p) => fromEntry(p))
      ];
    }
    case "token.json": {
      const out: Array<{ id: string; status: DesignSystemStatus; links: string[] }> = [];
      for (const layer of TOKEN_LAYERS) {
        for (const [name, raw] of Object.entries(
          root[layer] as Record<string, unknown>
        )) {
          out.push(fromEntry(raw, `${layer}.${name}`));
        }
      }
      return out;
    }
    case "component-list.json":
      return (root.components as unknown[]).map((c) => fromEntry(c));
    case "component-spec":
      return [fromEntry(root)];
    case "layout-rules.json":
    case "interaction-rules.json":
      return (root.rules as unknown[]).map((r) => fromEntry(r));
  }
}
