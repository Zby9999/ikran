// Design System Layout Blueprint projection (Issue 09C-B).
//
// A deterministic derivation from DB-backed layout rule rows into the spatial
// facts the Blueprint visual sample draws: container width, shell regions,
// column count, gutter measure, section rhythm and breakpoints — plus the
// honest set of rules nothing can be drawn for. It never invents a design
// fact: labels are verbatim source values (alias-aware), geometry derived
// from unrecognized values stays undrawn, and undrawable rules surface as
// explicit unavailable samples instead of fabricated visuals.
//
// Every projected rule keeps its canonical `row` so status, the ⓘ evidence
// popover and candidate approval stay wired to the DB entry. Anchor numbers
// (1-based, rule order) key each rule row to its measurements in the
// drawing — the "逐项对应" reading path.

import {
  aliasTargetOf,
  formatValueField,
  pxOf
} from "./design-system-reader-projection";
import type { DsRow } from "./design-system-view-model";

/* --------------------------------- facts --------------------------------- */

export type LayoutFactKind =
  | "container"
  | "regions"
  | "columns"
  | "gutter"
  | "rhythm"
  | "breakpoints";

export interface LayoutBreakpointMark {
  /** Declared breakpoint name ("md"), when the source names one. */
  name: string | null;
  /** Pixel position when declared; null keeps the mark unpositioned. */
  px: number | null;
  /** Verbatim display: "768", or "md 768" when named. */
  label: string;
}

export interface LayoutSpatialFact {
  kind: LayoutFactKind;
  /** Verbatim source display ("1120px", "→ spacing.200", "96 → 56px"). */
  label: string;
  /** Parsed column count for grid drawing. */
  columns?: number;
  /** Parsed container px for proportional drawing; null when aliased or
   * unparseable — the drawing then normalizes and says "not to scale". */
  maxWidthPx?: number | null;
  /** Declared region names, top to bottom. */
  regions?: string[];
  breakpoints?: LayoutBreakpointMark[];
}

export interface LayoutRuleProjection {
  row: DsRow;
  /** Stable 1-based anchor keying rule row ↔ drawing. */
  anchor: number;
  concern: string;
  facts: LayoutSpatialFact[];
}

export interface LayoutBlueprintModel {
  rules: LayoutRuleProjection[];
  /** Rules with at least one drawable spatial fact. */
  drawable: LayoutRuleProjection[];
  /** Rules nothing can be drawn for — shown as unavailable samples. */
  unavailable: LayoutRuleProjection[];
}

/* ------------------------------- recognition ------------------------------ */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Rich metadata fields (schema RICH_LAYOUT_RULE_FIELDS) describe the rule's
 * lineage, not its geometry — never interpreted as spatial values. */
const RICH_METADATA_KEYS = new Set([
  "relationship",
  "responsiveBehavior",
  "tokenLinks",
  "acceptanceChecks"
]);

const CONTAINER_KEYS = [
  "maxWidth",
  "max-width",
  "container",
  "containerMaxWidth",
  "containerWidth"
];
const COLUMNS_KEYS = ["columns", "columnCount", "gridColumns"];
const GUTTER_KEYS = ["gutter", "gap", "gridGap", "columnGap", "grid-gap"];
const REGIONS_KEYS = ["regions", "stack", "shell"];
const BREAKPOINT_KEYS = ["breakpoints", "breakpoint"];
const RHYTHM_KEYS = [
  "rhythm",
  "sectionGap",
  "sectionRhythm",
  "heroToNext",
  "verticalRhythm"
];

function isScalarOrAlias(value: unknown): boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    aliasTargetOf(value) !== null
  );
}

function columnCountOf(value: unknown): number | null {
  const n = pxOf(value);
  return n !== null && Number.isInteger(n) && n >= 1 && n <= 48 ? n : null;
}

/** Region lists arrive as string arrays, or "header · hero · content" text. */
function regionListOf(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is string => typeof item === "string" && item.trim() !== ""
    );
  }
  if (typeof value === "string") {
    const parts = value
      .split(/[·,|]/)
      .map((part) => part.trim())
      .filter((part) => part !== "");
    return parts.length > 1 ? parts : [];
  }
  return [];
}

function breakpointMarksOf(value: unknown): LayoutBreakpointMark[] | null {
  if (Array.isArray(value)) {
    const marks: LayoutBreakpointMark[] = [];
    for (const item of value) {
      if (typeof item === "string" || typeof item === "number") {
        marks.push({ name: null, px: pxOf(item), label: formatValueField(item) });
      } else if (isPlainObject(item)) {
        const name = typeof item.name === "string" ? item.name : null;
        const raw = item.px ?? item.value ?? item.width;
        if (raw === undefined) return null;
        marks.push({
          name,
          px: pxOf(raw),
          label: name
            ? `${name} ${formatValueField(raw)}`
            : formatValueField(raw)
        });
      } else {
        return null;
      }
    }
    return marks.length > 0 ? marks : null;
  }
  if (isPlainObject(value) && aliasTargetOf(value) === null) {
    const entries = Object.entries(value);
    if (entries.length === 0) return null;
    return entries.map(([name, raw]) => ({
      name,
      px: pxOf(raw),
      label: `${name} ${formatValueField(raw)}`
    }));
  }
  return null;
}

/**
 * Key-driven recognition inside a composite rule value. First fact per kind
 * wins; unrecognized keys stay visible as field lines on the rule row and in
 * Technical details — the drawing only claims what it understands.
 */
function factsFromValue(value: Record<string, unknown>): LayoutSpatialFact[] {
  const facts: LayoutSpatialFact[] = [];
  const seen = new Set<LayoutFactKind>();
  const push = (fact: LayoutSpatialFact | null) => {
    if (fact !== null && !seen.has(fact.kind)) {
      seen.add(fact.kind);
      facts.push(fact);
    }
  };
  for (const [key, field] of Object.entries(value)) {
    if (RICH_METADATA_KEYS.has(key)) continue;
    if (CONTAINER_KEYS.includes(key)) {
      push(isScalarOrAlias(field)
        ? {
            kind: "container",
            label: formatValueField(field),
            maxWidthPx: pxOf(field)
          }
        : null);
    } else if (REGIONS_KEYS.includes(key)) {
      const regions = regionListOf(field);
      push(
        regions.length > 0
          ? { kind: "regions", label: formatValueField(field), regions }
          : null
      );
    } else if (COLUMNS_KEYS.includes(key)) {
      const columns = columnCountOf(field);
      push(
        columns !== null
          ? { kind: "columns", label: formatValueField(field), columns }
          : null
      );
    } else if (GUTTER_KEYS.includes(key)) {
      push(
        isScalarOrAlias(field)
          ? { kind: "gutter", label: formatValueField(field) }
          : null
      );
    } else if (RHYTHM_KEYS.includes(key)) {
      push(
        isScalarOrAlias(field)
          ? { kind: "rhythm", label: formatValueField(field) }
          : null
      );
    } else if (BREAKPOINT_KEYS.includes(key)) {
      const breakpoints = breakpointMarksOf(field);
      push(
        breakpoints !== null
          ? { kind: "breakpoints", label: formatValueField(field), breakpoints }
          : null
      );
    }
  }
  return facts;
}

const NAME_KIND_PATTERNS: [RegExp, LayoutFactKind][] = [
  [/container|max.?width/i, "container"],
  [/columns?/i, "columns"],
  [/gutter|gap/i, "gutter"],
  [/breakpoints?/i, "breakpoints"],
  [/regions?|shell|stack/i, "regions"],
  [/rhythm|herotonext|section/i, "rhythm"]
];

function kindFromConcern(name: string): LayoutFactKind | null {
  for (const [pattern, kind] of NAME_KIND_PATTERNS) {
    if (pattern.test(name)) return kind;
  }
  return null;
}

/**
 * Name-driven fallback for values whose keys carry no known vocabulary: the
 * concern name classifies the payload fields ("container.maxWidth":
 * { width: "1200px" }; "grid.gap": { desktop: "24px", mobile: "16px" }).
 * Labels join every payload field verbatim ("24px / 16px") so responsive
 * pairs survive without inventing a combined value.
 */
function fallbackFact(
  kind: LayoutFactKind,
  fields: [string, unknown][]
): LayoutSpatialFact | null {
  const joinedLabel = fields
    .map(([, field]) => formatValueField(field))
    .join(" / ");
  switch (kind) {
    case "container": {
      if (!fields.every(([, field]) => isScalarOrAlias(field))) return null;
      const px = fields.map(([, field]) => pxOf(field)).find((n) => n !== null);
      return {
        kind,
        label: joinedLabel,
        maxWidthPx: px ?? null
      };
    }
    case "columns": {
      if (fields.length !== 1) return null;
      const columns = columnCountOf(fields[0]![1]);
      return columns !== null
        ? { kind, label: joinedLabel, columns }
        : null;
    }
    case "gutter":
    case "rhythm": {
      if (!fields.every(([, field]) => isScalarOrAlias(field))) return null;
      return { kind, label: joinedLabel };
    }
    case "regions": {
      if (fields.length !== 1) return null;
      const regions = regionListOf(fields[0]![1]);
      return regions.length > 0
        ? { kind, label: joinedLabel, regions }
        : null;
    }
    case "breakpoints": {
      if (fields.length !== 1) return null;
      const breakpoints = breakpointMarksOf(fields[0]![1]);
      return breakpoints !== null
        ? { kind, label: joinedLabel, breakpoints }
        : null;
    }
  }
}

function projectRule(row: DsRow, anchor: number): LayoutRuleProjection {
  let facts: LayoutSpatialFact[] = [];
  const value = row.entry.value;
  if (isPlainObject(value) && row.entry.alias === null) {
    facts = factsFromValue(value);
    if (facts.length === 0) {
      const kind = kindFromConcern(row.name);
      if (kind !== null) {
        const fields = Object.entries(value).filter(
          ([key]) => !RICH_METADATA_KEYS.has(key)
        );
        if (fields.length > 0) {
          const fact = fallbackFact(kind, fields);
          if (fact !== null) facts = [fact];
        }
      }
    }
  }
  return { row, anchor, concern: row.name, facts };
}

/**
 * Whole-leaf derivation. Rules keep source order; anchors are 1-based
 * positions, so row N in the left pane and anchor N in the drawing always
 * refer to the same rule — including undrawable ones.
 */
function toModel(rules: LayoutRuleProjection[]): LayoutBlueprintModel {
  return {
    rules,
    drawable: rules.filter((rule) => rule.facts.length > 0),
    unavailable: rules.filter((rule) => rule.facts.length === 0)
  };
}

export function projectLayoutBlueprint(
  rows: readonly DsRow[]
): LayoutBlueprintModel {
  return toModel(rows.map((row, index) => projectRule(row, index + 1)));
}

/** First fact of a kind across drawable rules, in rule order — the fact the
 * composed drawing claims. Same-kind facts on later rules stay readable as
 * field lines on their rows. */
export function firstFactOfKind(
  model: LayoutBlueprintModel,
  kind: LayoutFactKind
): { rule: LayoutRuleProjection; fact: LayoutSpatialFact } | null {
  for (const rule of model.drawable) {
    const fact = rule.facts.find((candidate) => candidate.kind === kind);
    if (fact) return { rule, fact };
  }
  return null;
}

/**
 * Isolate/compose slice (09C-B Checklist): narrows a whole-leaf blueprint to
 * the rules behind the given anchors — one anchor for a hover-isolated scene,
 * several for an explicit composition. Anchors are never renumbered: row N in
 * the left pane still keys anchor N in the sliced drawing.
 */
export function sliceLayoutBlueprint(
  model: LayoutBlueprintModel,
  anchors: ReadonlySet<number>
): LayoutBlueprintModel {
  return toModel(model.rules.filter((rule) => anchors.has(rule.anchor)));
}

/** Reference viewport for proportional container drawing. Presentation
 * scaffold, never a source claim — the drawing labels it "nominal". */
export const BLUEPRINT_SCALE_REFERENCE_PX = 1440;

/** Scale eligibility shared by the drawing and the caption's scale note. */
export function containerDrawsToScale(
  maxWidthPx: number | null | undefined
): boolean {
  return (
    maxWidthPx !== null &&
    maxWidthPx !== undefined &&
    maxWidthPx > 0 &&
    maxWidthPx <= BLUEPRINT_SCALE_REFERENCE_PX
  );
}
