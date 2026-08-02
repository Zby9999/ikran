// Design System Reader Projection (Issue 09C-A).
//
// A deterministic, derived presentation model on top of the DB-backed
// DesignSystemView. It reorganizes internal entry ids, aliases and structured
// values into designer-readable field groups — WITHOUT becoming a second
// source of truth, without rewriting copy, and without calling any model.
// Every projected item keeps its source `entry` reference so status,
// candidate approval, the ⓘ evidence popover and Technical details stay
// wired to the canonical entry.
//
// Losslessness contract: every typography entry handed in appears in exactly
// one reading group (families / styles / metric groups) AND in
// technicalDetails. Unit tests pin both directions.

import {
  TOKEN_LAYER_LABELS,
  classifyToken,
  entryDisplayName,
  statusChips,
  toRow,
  type DsRow,
  type DsStatus,
  type TokenLayerKey
} from "./design-system-view-model";
import type {
  DesignSystemEntryView,
  DesignSystemView
} from "@/lib/runtime/design-system-view";

export { TOKEN_LAYER_LABELS };
export type { TokenLayerKey };

/* ------------------------------- primitives ------------------------------- */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** `{ alias: "layer.name" }` is how source JSON expresses a token reference
 * inside composite values; whole-value aliases already arrive as entry.alias. */
export function aliasTargetOf(value: unknown): string | null {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value);
  if (keys.length === 1 && typeof value.alias === "string") {
    return value.alias;
  }
  return typeof value.$ref === "string" && keys.length === 1
    ? value.$ref
    : null;
}

/** Pixel number for values spelled "16px", 16, or "16". Null otherwise. */
export function pxOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const match = /^(-?\d+(?:\.\d+)?)(px)?$/.exec(value.trim());
    if (match) return Number.parseFloat(match[1]!);
  }
  return null;
}

/** Scalar/alias display for one field of a composite value. */
export function formatValueField(value: unknown): string {
  const alias = aliasTargetOf(value);
  if (alias !== null) return `→ ${alias}`;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) {
    return value.every(
      (item) =>
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean"
    )
      ? value.map(String).join(", ")
      : `${value.length} entries`;
  }
  return "…";
}

/**
 * Generic object fallback (acceptance: no raw JSON in the main reading
 * layer). Top-level keys become labeled field lines, in insertion order;
 * nested structures degrade to bounded summaries and stay fully visible in
 * Technical details.
 */
export function projectObjectFields(
  value: unknown
): { label: string; text: string }[] | null {
  if (!isPlainObject(value)) return null;
  return Object.entries(value).map(([key, fieldValue]) => ({
    label: key,
    text: formatValueField(fieldValue)
  }));
}

/* ---------------------------- interaction rules --------------------------- */

/** D01 keeps cross-component interaction strategies in this collection.
 * Component-bound states and motion are extracted into component specs, so
 * this projection deliberately has no control or visual-adapter vocabulary. */
export interface InteractionRuleProjection {
  key: string;
  anchor: number;
  statement: string;
  meaning: string;
  description: string | null;
  behavior: string[];
  accessibility: string[];
  isRich: boolean;
  status: DsStatus;
  row: DsRow;
}

export function projectInteractionLeaf(
  rows: readonly DsRow[]
): InteractionRuleProjection[] {
  return rows.map((row, index) => {
    const value = row.entry.value;
    const rich = isPlainObject(value) && row.entry.alias === null;
    return {
      key: row.key,
      anchor: index + 1,
      statement:
        rich && typeof value.statement === "string"
          ? value.statement
          : entryDisplayName(row.entry),
      meaning: row.meaning,
      description:
        rich && typeof value.description === "string"
          ? value.description
          : null,
      behavior: rich ? stringArrayOf(value.behavior) : [],
      accessibility: rich ? stringArrayOf(value.accessibility) : [],
      isRich: rich,
      status: row.status,
      row
    };
  });
}

/* ------------------------------ domain rules ----------------------------- */

export interface DomainRuleProjection {
  key: string;
  anchor: number;
  statement: string;
  meaning: string;
  /** Non-empty value fields other than the statement headline. */
  fields: { label: string; text: string }[];
  status: DsStatus;
  row: DsRow;
}

function hasDisplayContent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  return true;
}

/** Data-driven rule-card projection for Color / Typography / Materials.
 * The source statement owns the headline; every other non-empty value field
 * remains visible without inventing a domain-specific presentation schema. */
export function projectDomainRuleLeaf(
  rows: readonly DsRow[]
): DomainRuleProjection[] {
  return rows.map((row, index) => {
    const value = row.entry.value;
    const objectValue =
      isPlainObject(value) && row.entry.alias === null ? value : null;
    return {
      key: row.key,
      anchor: index + 1,
      statement:
        objectValue &&
        typeof objectValue.statement === "string" &&
        objectValue.statement.trim().length > 0
          ? objectValue.statement
          : entryDisplayName(row.entry),
      meaning: row.meaning,
      fields: objectValue
        ? Object.entries(objectValue)
            .filter(
              ([key, fieldValue]) =>
                key !== "statement" && hasDisplayContent(fieldValue)
            )
            .map(([label, fieldValue]) => ({
              label,
              text: formatValueField(fieldValue)
            }))
        : [],
      status: row.status,
      row
    };
  });
}

/* ------------------------------ technical rows ---------------------------- */

export interface TechnicalDetail {
  key: string;
  entryId: string;
  sourcePath: string;
  name: string;
  status: DsStatus;
  /** Pretty-printed envelope shown only inside the Technical details layer. */
  rawJson: string;
}

export function toTechnicalDetail(entry: DesignSystemEntryView): TechnicalDetail {
  return {
    key: `${entry.source_artifact_path}::${entry.entry_id}`,
    entryId: entry.entry_id,
    sourcePath: entry.source_artifact_path,
    name: entryDisplayName(entry),
    status: entry.status,
    rawJson: JSON.stringify(
      {
        value: entry.value,
        ...(entry.alias !== null ? { alias: entry.alias } : {}),
        meaning: entry.meaning,
        status: entry.status,
        links: entry.links
      },
      null,
      2
    )
  };
}

/* ------------------------------ font families ----------------------------- */

const GENERIC_FONT_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "emoji",
  "math",
  "fangsong"
]);

/** Quote family names that need it for CSS `font-family` lists. */
export function cssFontStack(stack: readonly string[]): string {
  return stack
    .map((family) => {
      const trimmed = family.trim();
      if (trimmed.length === 0) return trimmed;
      if (GENERIC_FONT_FAMILIES.has(trimmed.toLowerCase())) return trimmed;
      if (/^["'].*["']$/.test(trimmed)) return trimmed;
      return /\s/.test(trimmed) ? `"${trimmed}"` : trimmed;
    })
    .filter((family) => family.length > 0)
    .join(", ");
}

export interface TypographyFamilyProjection {
  key: string;
  name: string;
  /** Ordered stack as declared, e.g. ["Instrument Sans", "system-ui", "sans-serif"]. */
  stack: string[];
  /** First stack entry — the family the specimens try first. */
  primary: string;
  row: DsRow;
}

function stackFromString(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim().replace(/^["']|["']$/g, ""))
    .filter((part) => part.length > 0);
}

/* ------------------------------- text styles ------------------------------ */

const STYLE_FIELD_KEYS = {
  fontFamily: ["fontFamily", "family"],
  fontSize: ["fontSize", "size"],
  fontWeight: ["fontWeight", "weight"],
  lineHeight: ["lineHeight", "leading"],
  letterSpacing: ["letterSpacing", "tracking"],
  textTransform: ["textTransform", "transform"]
} as const;

type StyleFieldName = keyof typeof STYLE_FIELD_KEYS;

function readStyleField(
  value: Record<string, unknown>,
  field: StyleFieldName
): unknown {
  for (const key of STYLE_FIELD_KEYS[field]) {
    if (key in value) return value[key];
  }
  return undefined;
}

export interface TypographyStyleField {
  /** Display text: literal value or "→ alias.target". */
  text: string;
  aliasTarget: string | null;
  /** Terminal scalar reached through the alias chain, when resolvable. */
  resolvedText?: string | null;
  /** Direct target through terminal entry ids, in traversal order. */
  sourceEntryIds?: string[];
}

export interface TypographyStyleProjection {
  key: string;
  role: string;
  fontFamily: TypographyStyleField | null;
  fontSize: TypographyStyleField | null;
  fontSizePx: number | null;
  fontWeight: TypographyStyleField | null;
  lineHeight: TypographyStyleField | null;
  letterSpacing: TypographyStyleField | null;
  textTransform: TypographyStyleField | null;
  /** "64 / 1.05 · 700" — the compact value summary for the roles table. */
  summary: string;
  /** CSS font-family for the specimen, resolved through the alias graph
   * (full declared stack, e.g. `"Instrument Sans", system-ui, sans-serif`).
   * Null when the style declares no usable family — the Atlas renders an
   * explicit unresolved state instead of inheriting the Browser face. */
  specimenFamily: string | null;
  meaning: string;
  row: DsRow;
}

type AliasResolution = {
  value: unknown;
  sourceEntryIds: string[];
};

function toStyleField(
  value: unknown,
  resolveAlias?: (target: string) => AliasResolution
): TypographyStyleField | null {
  if (value === undefined) return null;
  const aliasTarget = aliasTargetOf(value);
  const resolved =
    aliasTarget !== null && resolveAlias ? resolveAlias(aliasTarget) : null;
  return {
    text: formatValueField(value),
    aliasTarget,
    resolvedText:
      resolved && resolved.value !== undefined
        ? formatValueField(resolved.value)
        : null,
    sourceEntryIds: resolved?.sourceEntryIds ?? []
  };
}

/** Compact summary: size / line-height · weight · tracking · transform.
 * Missing parts drop out. Letter spacing and transform stay in the left
 * reading column (acceptance criterion), labeled like the specimen
 * annotation. */
export function formatTextStyleSummary(style: {
  fontSize: TypographyStyleField | null;
  fontSizePx: number | null;
  lineHeight: TypographyStyleField | null;
  fontWeight: TypographyStyleField | null;
  letterSpacing: TypographyStyleField | null;
  textTransform: TypographyStyleField | null;
}): string {
  const parts: string[] = [];
  if (style.fontSize) {
    parts.push(
      style.fontSizePx !== null
        ? String(style.fontSizePx)
        : style.fontSize.text
    );
  }
  if (style.lineHeight) {
    const px = style.lineHeight.aliasTarget === null
      ? pxOf(style.lineHeight.text)
      : null;
    const sizePart = parts.length > 0 ? ` / ${px !== null ? String(px) : style.lineHeight.text}` : style.lineHeight.text;
    parts.push(sizePart);
  }
  if (style.fontWeight) {
    const weightPart = parts.length > 0 ? ` · ${style.fontWeight.text}` : style.fontWeight.text;
    parts.push(weightPart);
  }
  if (style.letterSpacing) {
    const tracking = `tracking ${style.letterSpacing.text}`;
    parts.push(parts.length > 0 ? ` · ${tracking}` : tracking);
  }
  if (style.textTransform) {
    parts.push(
      parts.length > 0
        ? ` · ${style.textTransform.text}`
        : style.textTransform.text
    );
  }
  return parts.join("");
}

/* ------------------------------ the projection ---------------------------- */

export interface TypographyMetricGroup {
  layer: TokenLayerKey;
  rows: DsRow[];
}

export interface TypographyProjection {
  families: TypographyFamilyProjection[];
  styles: TypographyStyleProjection[];
  /** Atomic typography tokens (sizes, weights, spacings…) by token layer. */
  metricGroups: TypographyMetricGroup[];
  technicalDetails: TechnicalDetail[];
  chips: string[];
}

export interface TypographyAtlasItem {
  key: string;
  kind: "style";
  group: "type" | "component";
  canonicalIdentity: string;
  label: string;
  usage: string;
  fontFamily: string | null;
  specimenFamily: string | null;
  fontSize: string | null;
  fontSizePx: number | null;
  fontWeight: string | null;
  lineHeight: string | null;
  letterSpacing: string | null;
  textTransform: string | null;
  /** Terminal scalar values used to render aliased style fields. */
  specimenFontWeight: string | null;
  specimenLineHeight: string | null;
  specimenLetterSpacing: string | null;
  specimenTextTransform: string | null;
  status: DsStatus;
  /** Every DB-backed row consumed by this visual form. */
  sourceRows: DsRow[];
}

function readableTypographyRole(role: string): string {
  const withoutDomain = role.replace(/^typography[._-]/i, "");
  return withoutDomain
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[._\s-]+/)
    .filter(Boolean)
    .map(
      (word) =>
        `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`
    )
    .join(" ");
}

const FAMILY_NAME_PATTERN = /font[-.]?family|typeface/i;

/**
 * Deterministic classification of typography entries:
 *   - object with any composite style key → text style (semantic role);
 *   - object with only a family key, or a string whose name says family → font family;
 *   - everything else → atomic metric rows (grouped by token layer below).
 */
export function projectTypographyLeaf(
  layers: readonly { layer: TokenLayerKey; entries: DesignSystemEntryView[] }[]
): TypographyProjection {
  const families: TypographyFamilyProjection[] = [];
  const styles: TypographyStyleProjection[] = [];
  const metricGroups: TypographyMetricGroup[] = [];
  const technicalDetails: TechnicalDetail[] = [];
  const byId = new Map<string, DesignSystemEntryView>();

  for (const { entries } of layers) {
    for (const entry of entries) byId.set(entry.entry_id, entry);
  }

  const resolveAlias = (target: string): AliasResolution => {
    const sourceEntryIds: string[] = [];
    const seen = new Set<string>();
    let current = target;
    while (!seen.has(current)) {
      seen.add(current);
      const entry = byId.get(current);
      if (!entry) return { value: undefined, sourceEntryIds };
      sourceEntryIds.push(entry.entry_id);
      const next = entry.alias ?? aliasTargetOf(entry.value);
      if (next === null) return { value: entry.value, sourceEntryIds };
      current = next;
    }
    return { value: undefined, sourceEntryIds };
  };

  const resolveFamilyStack = (target: string): string[] | null => {
    const value = resolveAlias(target).value;
    if (typeof value === "string") {
      const stack = stackFromString(value);
      return stack.length > 0 ? stack : null;
    }
    if (isPlainObject(value)) {
      const family = readStyleField(value, "fontFamily");
      if (typeof family === "string") {
        const stack = stackFromString(family);
        return stack.length > 0 ? stack : null;
      }
    }
    return null;
  };

  for (const { layer, entries } of layers) {
    const metrics: DsRow[] = [];
    for (const entry of entries) {
      const row = toRow(entry);
      const name = entryDisplayName(entry);
      const value = entry.value;
      technicalDetails.push(toTechnicalDetail(entry));

      const isRoleLayer =
        entry.section === "token.semantic" || entry.section === "token.component";
      const isComposite =
        isRoleLayer && isPlainObject(value) && entry.alias === null;
      const hasStyleKeys =
        isComposite &&
        (Object.keys(STYLE_FIELD_KEYS) as StyleFieldName[]).some(
          (field) => field !== "fontFamily" && readStyleField(value, field) !== undefined
        );
      const familyField = isComposite
        ? readStyleField(value, "fontFamily")
        : undefined;

      if (isComposite && hasStyleKeys) {
        const fontFamily = toStyleField(familyField, resolveAlias);
        const fontSize = toStyleField(
          readStyleField(value, "fontSize"),
          resolveAlias
        );
        const fontSizePx =
          fontSize
            ? pxOf(
                fontSize.aliasTarget === null
                  ? readStyleField(value, "fontSize")
                  : fontSize.resolvedText
              )
            : null;
        // Specimen family: literal stack on the style itself, else resolve
        // the family alias through the token graph, else inherit honestly.
        let specimenFamily: string | null = null;
        if (typeof familyField === "string") {
          const stack = stackFromString(familyField);
          specimenFamily = stack.length > 0 ? cssFontStack(stack) : null;
        } else if (fontFamily?.aliasTarget) {
          const stack = resolveFamilyStack(fontFamily.aliasTarget);
          specimenFamily = stack ? cssFontStack(stack) : null;
        }
        const projected: TypographyStyleProjection = {
          key: row.key,
          role: name,
          fontFamily,
          fontSize,
          fontSizePx,
          fontWeight: toStyleField(
            readStyleField(value, "fontWeight"),
            resolveAlias
          ),
          lineHeight: toStyleField(
            readStyleField(value, "lineHeight"),
            resolveAlias
          ),
          letterSpacing: toStyleField(
            readStyleField(value, "letterSpacing"),
            resolveAlias
          ),
          textTransform: toStyleField(
            readStyleField(value, "textTransform"),
            resolveAlias
          ),
          summary: "",
          specimenFamily,
          meaning: entry.meaning,
          row
        };
        projected.summary = formatTextStyleSummary(projected);
        styles.push(projected);
        continue;
      }

      const familyStack =
        isComposite && !hasStyleKeys && typeof familyField === "string"
          ? stackFromString(familyField)
          : typeof value === "string" &&
              entry.alias === null &&
              FAMILY_NAME_PATTERN.test(name)
            ? stackFromString(value)
            : null;

      if (familyStack !== null && familyStack.length > 0) {
        families.push({
          key: row.key,
          name,
          stack: familyStack,
          primary: familyStack[0]!,
          row
        });
        continue;
      }

      metrics.push(row);
    }
    if (metrics.length > 0) metricGroups.push({ layer, rows: metrics });
  }

  // Roles read from largest to smallest; unknown sizes last, alphabetical.
  styles.sort((a, b) => {
    if (a.fontSizePx !== null && b.fontSizePx !== null) {
      return b.fontSizePx - a.fontSizePx;
    }
    if (a.fontSizePx !== null) return -1;
    if (b.fontSizePx !== null) return 1;
    return a.role.localeCompare(b.role);
  });

  const allRows = [
    ...families.map((family) => family.row),
    ...styles.map((style) => style.row),
    ...metricGroups.flatMap((group) => group.rows)
  ];

  return {
    families,
    styles,
    metricGroups,
    technicalDetails,
    chips: statusChips(allRows)
  };
}

/** Typography-classified token entries from the DB-backed view, in canonical
 * layer order — the input for projectTypographyLeaf. Uses the same
 * classifier as the legacy token leaves, so both presentations agree on
 * which entries belong to Typography. */
export function typographyLayersFromView(
  view: DesignSystemView
): { layer: TokenLayerKey; entries: DesignSystemEntryView[] }[] {
  const order: TokenLayerKey[] = ["primitive", "semantic", "component"];
  return order.map((layer) => ({
    layer,
    entries: view.tokens[layer].filter(
      (entry) =>
        (entry.kind === undefined ||
          entry.kind === null ||
          entry.kind === "token") &&
        classifyToken(entryDisplayName(entry), entry.domain ?? null) ===
        "typography"
    )
  }));
}

function combinedStatus(rows: readonly DsRow[]): DsStatus {
  if (rows.some((row) => row.status === "gap")) return "gap";
  if (rows.some((row) => row.status === "candidate")) return "candidate";
  return "formalized";
}

function uniqueRowsByKey(rows: readonly DsRow[]): DsRow[] {
  return rows.filter(
    (row, index) =>
      rows.findIndex((candidate) => candidate.key === row.key) === index
  );
}

function specimenFieldValue(
  field: TypographyStyleField | null
): string | null {
  if (!field) return null;
  return field.aliasTarget === null ? field.text : field.resolvedText ?? null;
}

function atlasFieldDisplay(
  field: TypographyStyleField | null
): string | null {
  if (!field) return null;
  return field.aliasTarget !== null && field.resolvedText
    ? `${field.text} · ${field.resolvedText}`
    : field.text;
}

/**
 * Visual-first Typography atlas.
 *
 * Composite style entries become complete source-backed forms. Atomic
 * typography facts remain canonical projection data but do not become Type
 * styles. Every consumed role row is retained for status/evidence audit.
 */
export function typographyAtlasItems(
  projection: TypographyProjection
): TypographyAtlasItem[] {
  const rowsByEntryId = new Map<string, DsRow>();
  for (const family of projection.families) {
    rowsByEntryId.set(family.row.entryId, family.row);
  }
  for (const style of projection.styles) {
    rowsByEntryId.set(style.row.entryId, style.row);
  }
  for (const group of projection.metricGroups) {
    for (const row of group.rows) {
      rowsByEntryId.set(row.entryId, row);
    }
  }
  return projection.styles.map((style): TypographyAtlasItem => {
    const sourceEntryIds = [
      style.fontFamily,
      style.fontSize,
      style.fontWeight,
      style.lineHeight,
      style.letterSpacing,
      style.textTransform
    ].flatMap((field) => field?.sourceEntryIds ?? []);
    const sourceRows = uniqueRowsByKey([
      style.row,
      ...sourceEntryIds.flatMap((entryId) => {
        const row = rowsByEntryId.get(entryId);
        return row ? [row] : [];
      })
    ]);
    return {
      key: style.key,
      kind: "style",
      group:
        style.row.entry.section === "token.component" ? "component" : "type",
      canonicalIdentity: style.row.entryId,
      label: readableTypographyRole(style.role),
      usage: style.meaning,
      fontFamily: atlasFieldDisplay(style.fontFamily),
      specimenFamily: style.specimenFamily,
      fontSize: atlasFieldDisplay(style.fontSize),
      fontSizePx: style.fontSizePx,
      fontWeight: atlasFieldDisplay(style.fontWeight),
      lineHeight: atlasFieldDisplay(style.lineHeight),
      letterSpacing: atlasFieldDisplay(style.letterSpacing),
      textTransform: atlasFieldDisplay(style.textTransform),
      specimenFontWeight: specimenFieldValue(style.fontWeight),
      specimenLineHeight: specimenFieldValue(style.lineHeight),
      specimenLetterSpacing: specimenFieldValue(style.letterSpacing),
      specimenTextTransform: specimenFieldValue(style.textTransform),
      status: combinedStatus(sourceRows),
      sourceRows
    };
  });
}

/* ------------------------------ rich principle ---------------------------- */

export interface PrincipleProjection {
  /** The card title — statement for rich values, legacy display otherwise. */
  statement: string;
  rationale: string | null;
  scope: string | null;
  use: string[];
  avoid: string[];
  exceptions: string[];
  /** Everything extracted beyond the six known fields — responsive
   * relationships, checks, and every field of object values with no
   * recognized key at all — as labeled lines, never raw JSON. Null when
   * there is nothing extra. */
  extraFields: { label: string; text: string }[] | null;
  /** False for legacy string/single-key values (caller keeps current card). */
  isRich: boolean;
}

function stringArrayOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

const PRINCIPLE_KNOWN_KEYS = new Set([
  "statement",
  "rationale",
  "scope",
  "use",
  "avoid",
  "exceptions"
]);

export function projectPrinciple(entry: DesignSystemEntryView): PrincipleProjection {
  const value = entry.value;
  if (isPlainObject(value) && entry.alias === null) {
    // Single-key string values stay legacy: formatEntryValue already flattens
    // them to plain text, so the current card shows them well. Anything the
    // flat display would JSON-serialize projects to rich fields instead.
    const keys = Object.keys(value);
    const isLegacySingleString =
      keys.length === 1 && typeof value[keys[0]!] === "string";
    if (!isLegacySingleString) {
      const hasRichShape =
        typeof value.statement === "string" ||
        typeof value.rationale === "string" ||
        typeof value.scope === "string" ||
        Array.isArray(value.use) ||
        Array.isArray(value.avoid) ||
        Array.isArray(value.exceptions);
      if (hasRichShape) {
        const extras = keys
          .filter((key) => !PRINCIPLE_KNOWN_KEYS.has(key))
          .map((key) => ({ label: key, text: formatValueField(value[key]) }));
        return {
          statement:
            typeof value.statement === "string" ? value.statement : entry.meaning,
          rationale: typeof value.rationale === "string" ? value.rationale : null,
          scope: typeof value.scope === "string" ? value.scope : null,
          use: stringArrayOf(value.use),
          avoid: stringArrayOf(value.avoid),
          exceptions: stringArrayOf(value.exceptions),
          extraFields: extras.length > 0 ? extras : null,
          isRich: true
        };
      }
      // Object with no recognized key: the legacy flat display would
      // JSON-serialize it into the main reading layer (forbidden) — project
      // labeled field lines instead; the full envelope stays in Technical
      // details.
      return {
        statement: entryDisplayName(entry),
        rationale: null,
        scope: null,
        use: [],
        avoid: [],
        exceptions: [],
        extraFields: projectObjectFields(value),
        isRich: true
      };
    }
  }
  // Legacy shapes: plain string, or single-key { statement: "…" } — the view
  // model's formatEntryValue already flattens those to display text.
  const row = toRow(entry);
  return {
    statement: row.value,
    rationale: null,
    scope: null,
    use: [],
    avoid: [],
    exceptions: [],
    extraFields: null,
    isRich: false
  };
}
