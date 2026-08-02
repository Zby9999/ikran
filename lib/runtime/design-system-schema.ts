// Design-system source JSON schemas (Issue 09 / 09A, Task B).
//
// Locked 09A decisions encoded here (2026-07-29, do not reopen):
//   - All-JSON source layer, no markdown islands: every design-system source
//     artifact is JSON; long prose (e.g. the visual language description)
//     lives in JSON string fields.
//   - File layout under `design-system/`: design-system.json, token.json,
//     component-list.json, components/<name>.json, layout-rules.json,
//     interaction-rules.json.
//   - Every rule / token / component entry carries `value` (structured
//     payload, shape per file kind), `meaning` (one-line semantics), `status`
//     ("formalized" | "candidate" | "gap") and `links` (answered question
//     card ids / Agent annotation ids). Non-gap entries must link at least
//     one record; gap entries carry none — the gap declaration itself is the
//     semantics (09A decision 4: gaps are explicit only, never derived).
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

export type DesignSystemFileKind =
  | "design-system.json"
  | "token.json"
  | "component-list.json"
  | "component-spec"
  | "layout-rules.json"
  | "interaction-rules.json";

export type DesignSystemSchemaReason =
  | "invalid_design_system_json"
  | "missing_required_field"
  | "invalid_field_type"
  | "duplicate_entry_id"
  | "invalid_status"
  | "entry_links_required"
  | "gap_must_not_link"
  | "invalid_token_domain"
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
 */
function checkEntry(
  raw: unknown,
  ctx: Record<string, unknown>,
  options: {
    withId: boolean;
    checkValue: (value: unknown, ctx: Record<string, unknown>) => DesignSystemSchemaError | null;
  }
): DesignSystemSchemaError | null {
  if (!isPlainObject(raw)) {
    return fail("invalid_field_type", { ...ctx, expected: "object" });
  }
  if (options.withId) {
    const idFailure = requireString(raw, "id", ctx);
    if (idFailure) return idFailure;
  }
  const meaningFailure = requireString(raw, "meaning", ctx);
  if (meaningFailure) return meaningFailure;

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
  checkValue: (value: unknown, ctx: Record<string, unknown>) => DesignSystemSchemaError | null
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
    const failure = checkEntry(raw[i], ctx, { withId: true, checkValue });
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

/** Additional component-detail groups produced by the 09B extraction flow. */
export const RICH_COMPONENT_SPEC_FIELDS = [
  "anatomy",
  "variants",
  "sizes",
  "states",
  "motion",
  "tokenLinks",
  "usageRules",
  "contentRules",
  "responsiveBehavior",
  "codeLinks",
  "verificationTargets",
  "openGaps"
] as const;

export const RICH_PRINCIPLE_STRING_FIELDS = [
  "rationale",
  "scope"
] as const;
export const RICH_PRINCIPLE_COLLECTION_FIELDS = [
  "use",
  "avoid",
  "exceptions"
] as const;
export const RICH_LAYOUT_RULE_FIELDS = [
  "relationship",
  "responsiveBehavior",
  "tokenLinks",
  "acceptanceChecks"
] as const;
export const RICH_INTERACTION_RULE_STRING_FIELDS = [
  "statement",
  "description"
] as const;
export const RICH_INTERACTION_RULE_COLLECTION_FIELDS = [
  "behavior",
  "accessibility"
] as const;
export const RICH_INTERACTION_RULE_FIELDS = [
  ...RICH_INTERACTION_RULE_STRING_FIELDS,
  ...RICH_INTERACTION_RULE_COLLECTION_FIELDS
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
  if (Object.keys(value).length > 1) {
    return fail("token_alias_reserved_key", {
      field: "value",
      keys: Object.keys(value).sort()
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

function parseAliasRef(
  ref: string
): { layer: TokenLayer; name: string } | null {
  return parseTokenEntryRef(ref);
}

function validateTokenJson(json: Record<string, unknown>): DesignSystemSchemaResult {
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
      const entryFailure = checkEntry(raw, ctx, {
        withId: false,
        checkValue: (value) => {
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
  const nameFailure = requireString(json, "name", {});
  if (nameFailure) return nameFailure;

  if (json.visualLanguage === undefined) {
    return fail("missing_required_field", { field: "visualLanguage" });
  }
  const visualFailure = checkEntry(json.visualLanguage, { entry: "visualLanguage" }, {
    withId: true,
    checkValue: (value, ctx) => {
      if (!isPlainObject(value)) {
        return fail("invalid_field_type", { ...ctx, field: "value", expected: "object" });
      }
      return requireString(value, "description", { ...ctx, field: "value" });
    }
  });
  if (visualFailure) return visualFailure;

  return (
    checkEntryArray(json.principles, "principles", (value, ctx) => {
      if (!isPlainObject(value)) {
        return fail("invalid_field_type", { ...ctx, field: "value", expected: "object" });
      }
      const statementFailure = requireString(value, "statement", {
        ...ctx,
        field: "value"
      });
      if (statementFailure) return statementFailure;
      for (const field of RICH_PRINCIPLE_STRING_FIELDS) {
        if (value[field] !== undefined && !isNonEmptyString(value[field])) {
          return fail("invalid_field_type", {
            ...ctx,
            field: `value.${field}`,
            expected: "non-empty string"
          });
        }
      }
      for (const field of RICH_PRINCIPLE_COLLECTION_FIELDS) {
        if (value[field] !== undefined && !Array.isArray(value[field])) {
          return fail("invalid_field_type", {
            ...ctx,
            field: `value.${field}`,
            expected: "array"
          });
        }
      }
      return null;
    }) ?? { ok: true }
  );
}

function validateComponentList(
  json: Record<string, unknown>
): DesignSystemSchemaResult {
  return (
    checkEntryArray(json.components, "components", (value, ctx) => {
      if (!isPlainObject(value)) {
        return fail("invalid_field_type", { ...ctx, field: "value", expected: "object" });
      }
      return (
        requireString(value, "name", { ...ctx, field: "value" }) ??
        requireString(value, "specPath", { ...ctx, field: "value" })
      );
    }) ?? { ok: true }
  );
}

// components/<name>.json — one file per component. The spec value carries a
// description, a props table, Boundaries (constraint list) and the state
// matrix (09A: component detail includes Boundaries and the state matrix).
// Boundaries/stateMatrix may be empty arrays but must be present.
function validateComponentSpec(
  json: Record<string, unknown>
): DesignSystemSchemaResult {
  const nameFailure = requireString(json, "name", {});
  if (nameFailure) return nameFailure;
  return checkEntry(json, {}, {
    withId: true,
    checkValue: (value, ctx) => {
      if (!isPlainObject(value)) {
        return fail("invalid_field_type", { ...ctx, field: "value", expected: "object" });
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

      const boundariesFailure = requireArray(value, "boundaries", { ...ctx, field: "value" });
      if (boundariesFailure) return boundariesFailure;
      if ((value.boundaries as unknown[]).some((b) => !isNonEmptyString(b))) {
        return fail("invalid_field_type", {
          ...ctx,
          field: "value.boundaries",
          expected: "array of non-empty strings"
        });
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
      // Backward compatible at declaration time: 09A specs remain valid.
      // When a 09B field is present, however, it has a stable collection
      // shape so ingest/view/export can preserve it without interpretation.
      for (const field of RICH_COMPONENT_SPEC_FIELDS) {
        if (value[field] !== undefined && !Array.isArray(value[field])) {
          return fail("invalid_field_type", {
            ...ctx,
            field: `value.${field}`,
            expected: "array"
          });
        }
      }
      return null;
    }
  }) ?? { ok: true };
}

function validateRulesFile(
  json: Record<string, unknown>,
  collectionFields: readonly string[],
  stringFields: readonly string[] = [],
  allowedFields: readonly string[] | null = null
): DesignSystemSchemaResult {
  return (
    checkEntryArray(json.rules, "rules", (value, ctx) => {
      if (!isPlainObject(value)) {
        return fail("invalid_field_type", { ...ctx, field: "value", expected: "object" });
      }
      if (allowedFields) {
        const allowed = new Set(allowedFields);
        for (const field of Object.keys(value)) {
          if (allowed.has(field)) continue;
          return fail("invalid_field_type", {
            ...ctx,
            field: `value.${field}`,
            expected:
              "interaction rules only support cross-component strategy fields; component-bound fields belong in a component spec"
          });
        }
      }
      for (const field of stringFields) {
        if (value[field] !== undefined && !isNonEmptyString(value[field])) {
          return fail("invalid_field_type", {
            ...ctx,
            field: `value.${field}`,
            expected: "non-empty string"
          });
        }
      }
      for (const field of collectionFields) {
        if (value[field] !== undefined && !Array.isArray(value[field])) {
          return fail("invalid_field_type", {
            ...ctx,
            field: `value.${field}`,
            expected: "array"
          });
        }
      }
      return null;
    }) ?? { ok: true }
  );
}

// ---------------------------------------------------------------------------
// Layout rule source captures (09C-D02)
// ---------------------------------------------------------------------------

/** Rule → Figma node screenshot provenance. Captures are structured records,
 * not writing-style constraint sentences, so the field lives outside
 * RICH_LAYOUT_RULE_FIELDS and gets its own item shape check below. */
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

function validateLayoutRulesFile(
  json: Record<string, unknown>
): DesignSystemSchemaResult {
  const base = validateRulesFile(json, RICH_LAYOUT_RULE_FIELDS);
  if (!base.ok) return base;
  // Base validation passed: every rule is a plain object with a plain-object
  // value. Walk the capture lists for their item shape.
  const rules = json.rules as Record<string, unknown>[];
  for (const rule of rules) {
    const value = rule.value as Record<string, unknown>;
    const captures = value[LAYOUT_RULE_CAPTURE_FIELD];
    if (captures === undefined) continue;
    if (!Array.isArray(captures)) {
      return fail("invalid_field_type", {
        field: `value.${LAYOUT_RULE_CAPTURE_FIELD}`,
        expected: "array"
      });
    }
    for (let i = 0; i < captures.length; i++) {
      const item = captures[i];
      const itemField = `value.${LAYOUT_RULE_CAPTURE_FIELD}[${i}]`;
      if (!isPlainObject(item)) {
        return fail("invalid_field_type", {
          field: itemField,
          expected: "object"
        });
      }
      for (const field of LAYOUT_RULE_CAPTURE_REQUIRED_FIELDS) {
        if (!isNonEmptyString(item[field])) {
          return fail("invalid_field_type", {
            field: `${itemField}.${field}`,
            expected: "non-empty string"
          });
        }
      }
      for (const field of LAYOUT_RULE_CAPTURE_OPTIONAL_FIELDS) {
        if (item[field] !== undefined && !isNonEmptyString(item[field])) {
          return fail("invalid_field_type", {
            field: `${itemField}.${field}`,
            expected: "non-empty string"
          });
        }
      }
      const rect = validateCaptureNodeRect(item, itemField);
      if (!rect.ok) return rect;
    }
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
    validateRulesFile(
      json,
      RICH_INTERACTION_RULE_COLLECTION_FIELDS,
      RICH_INTERACTION_RULE_STRING_FIELDS,
      RICH_INTERACTION_RULE_FIELDS
    )
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
      const principles = root.principles as unknown[];
      return [
        fromEntry(root.visualLanguage),
        ...principles.map((p) => fromEntry(p))
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
