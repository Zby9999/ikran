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
function aliasTargetOf(value: unknown): string | null {
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
   * Null when the style declares no usable family — the specimen then
   * renders in the inherited face and the annotation stays honest. */
  specimenFamily: string | null;
  meaning: string;
  row: DsRow;
}

function toStyleField(value: unknown): TypographyStyleField | null {
  if (value === undefined) return null;
  return { text: formatValueField(value), aliasTarget: aliasTargetOf(value) };
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

  const resolveFamilyStack = (target: string): string[] | null => {
    const entry = byId.get(target);
    if (!entry) return null;
    const value = entry.value;
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

      const isComposite = isPlainObject(value) && entry.alias === null;
      const hasStyleKeys =
        isComposite &&
        (Object.keys(STYLE_FIELD_KEYS) as StyleFieldName[]).some(
          (field) => field !== "fontFamily" && readStyleField(value, field) !== undefined
        );
      const familyField = isComposite
        ? readStyleField(value, "fontFamily")
        : undefined;

      if (isComposite && hasStyleKeys) {
        const fontFamily = toStyleField(familyField);
        const fontSize = toStyleField(readStyleField(value, "fontSize"));
        const fontSizePx =
          fontSize && fontSize.aliasTarget === null
            ? pxOf(readStyleField(value, "fontSize"))
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
        if (specimenFamily === null && families.length > 0) {
          // A style with no family link still renders in the system's
          // declared family when exactly one is known — the annotation keeps
          // showing what the source actually says.
          if (families.length === 1) {
            specimenFamily = cssFontStack(families[0]!.stack);
          }
        }
        const projected: TypographyStyleProjection = {
          key: row.key,
          role: name,
          fontFamily,
          fontSize,
          fontSizePx,
          fontWeight: toStyleField(readStyleField(value, "fontWeight")),
          lineHeight: toStyleField(readStyleField(value, "lineHeight")),
          letterSpacing: toStyleField(readStyleField(value, "letterSpacing")),
          textTransform: toStyleField(readStyleField(value, "textTransform")),
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
        classifyToken(entryDisplayName(entry), entry.domain ?? null) ===
        "typography"
    )
  }));
}

/** Base type scale for the right-pane strip: px-valued style sizes plus
 * px-valued metric tokens, deduplicated and ascending. */
export function typeScaleSteps(
  projection: TypographyProjection
): { px: number; sourceKeys: string[] }[] {
  const byPx = new Map<number, string[]>();
  const add = (px: number, key: string) => {
    const list = byPx.get(px) ?? [];
    list.push(key);
    byPx.set(px, list);
  };
  for (const style of projection.styles) {
    if (style.fontSizePx !== null) add(style.fontSizePx, style.key);
  }
  for (const group of projection.metricGroups) {
    for (const row of group.rows) {
      // Only tokens named as sizes belong on the type scale — a bare "700"
      // weight parses as a number but is not a font size.
      if (!/size/i.test(row.name)) continue;
      const px = pxOf(row.value);
      if (px !== null && px > 0) add(px, row.key);
    }
  }
  return [...byPx.entries()]
    .map(([px, sourceKeys]) => ({ px, sourceKeys }))
    .sort((a, b) => a.px - b.px);
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
