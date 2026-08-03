// Design System Layout Source Capture projection (Issue 09C-D02).
//
// A deterministic derivation from DB-backed layout rule rows into the pieces
// the Source Capture placard stream renders: a human-readable headline, the
// spatial measurements recognized from the rule value (verbatim source
// labels, alias-aware — never invented facts), and the Figma node captures
// the Runtime view decorated onto the entry. Rules with no captures surface
// as honest unavailable blocks instead of fabricated visuals.
//
// Every projected rule keeps its canonical `row` so status, the ⓘ evidence
// popover and candidate approval stay wired to the DB entry.

import {
  aliasTargetOf,
  formatValueField,
  pxOf
} from "./design-system-reader-projection";
import type {
  DesignSystemLayoutCapture,
  LayoutCaptureNodeRect
} from "@/lib/runtime/design-system-view";
import type { DsRow } from "./design-system-view-model";

/* ------------------------------- v2 display ------------------------------- */

/** A node occupying at least this much of the capture area IS the picture —
 * framing it again would be noise, so the position mark is skipped. */
const NODE_MARK_FILL_THRESHOLD = 0.85;

/** Fixed-ratio figure orientation (v2): 3:2 landscape for wide nodes, 2:3
 * portrait for tall ones. Derived from the declared nodeRect (the node's
 * own shape); legacy captures without one default to landscape. */
export function captureOrientation(
  capture: DesignSystemLayoutCapture
): "landscape" | "portrait" {
  const rect = capture.nodeRect;
  if (rect == null) return "landscape";
  return rect.width >= rect.height ? "landscape" : "portrait";
}

/** The hairline position mark's rect, or null when no mark should render —
 * either undeclared (legacy capture) or the node nearly fills the image. */
export function captureNodeMark(
  capture: DesignSystemLayoutCapture
): LayoutCaptureNodeRect | null {
  const rect = capture.nodeRect;
  if (rect == null) return null;
  return rect.width * rect.height < NODE_MARK_FILL_THRESHOLD ? rect : null;
}

/* --------------------------------- model --------------------------------- */

export type LayoutFactKind =
  | "container"
  | "regions"
  | "columns"
  | "gutter"
  | "rhythm"
  | "breakpoints";

export interface LayoutSpatialFact {
  kind: LayoutFactKind;
  /** Verbatim source display ("1120px", "→ spacing.200", "96 → 56px"). */
  label: string;
}

export interface LayoutRuleProjection {
  row: DsRow;
  /** Display headline: the rule's human-readable claim (meaning), with the
   * concern name as the fallback when no meaning was written. */
  headline: string;
  /** Verbatim prose body; null for legacy rich-object rules. */
  body: string | null;
  /** The rule's source key ("grid.page") — identity, not display. */
  concern: string;
  facts: LayoutSpatialFact[];
  /** Node captures decorated by the Runtime view ([] when undeclared). */
  captures: DesignSystemLayoutCapture[];
}

export interface LayoutLeafModel {
  rules: LayoutRuleProjection[];
}

/* ------------------------------- recognition ------------------------------ */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Rich metadata fields (schema RICH_LAYOUT_RULE_FIELDS) plus the capture
 * provenance list (09C-D02) describe the rule's lineage, not its geometry —
 * never interpreted as spatial values. */
const RICH_METADATA_KEYS = new Set([
  "relationship",
  "responsiveBehavior",
  "tokenLinks",
  "acceptanceChecks",
  "sourceCaptures"
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

/** Internal breakpoint reading — marks exist only to build a readable label;
 * the projection exposes no parsed geometry. */
function breakpointLabelsOf(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    const labels: string[] = [];
    for (const item of value) {
      if (typeof item === "string" || typeof item === "number") {
        labels.push(formatValueField(item));
      } else if (isPlainObject(item)) {
        const name = typeof item.name === "string" ? item.name : null;
        const raw = item.px ?? item.value ?? item.width;
        if (raw === undefined) return null;
        labels.push(name ? `${name} ${formatValueField(raw)}` : formatValueField(raw));
      } else {
        return null;
      }
    }
    return labels.length > 0 ? labels : null;
  }
  if (isPlainObject(value) && aliasTargetOf(value) === null) {
    const entries = Object.entries(value);
    if (entries.length === 0) return null;
    return entries.map(([name, raw]) => `${name} ${formatValueField(raw)}`);
  }
  return null;
}

/**
 * Key-driven recognition inside a composite rule value. First fact per kind
 * wins; unrecognized keys stay visible in Technical details — the projection
 * only claims what it understands.
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
      push(
        isScalarOrAlias(field)
          ? { kind: "container", label: formatValueField(field) }
          : null
      );
    } else if (REGIONS_KEYS.includes(key)) {
      push(
        regionListOf(field).length > 0
          ? { kind: "regions", label: formatValueField(field) }
          : null
      );
    } else if (COLUMNS_KEYS.includes(key)) {
      push(
        columnCountOf(field) !== null
          ? { kind: "columns", label: formatValueField(field) }
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
      const labels = breakpointLabelsOf(field);
      push(
        labels !== null
          ? { kind: "breakpoints", label: labels.join(", ") }
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
    case "container":
    case "gutter":
    case "rhythm": {
      if (!fields.every(([, field]) => isScalarOrAlias(field))) return null;
      return { kind, label: joinedLabel };
    }
    case "columns": {
      if (fields.length !== 1) return null;
      return columnCountOf(fields[0]![1]) !== null
        ? { kind, label: joinedLabel }
        : null;
    }
    case "regions": {
      if (fields.length !== 1) return null;
      return regionListOf(fields[0]![1]).length > 0
        ? { kind, label: joinedLabel }
        : null;
    }
    case "breakpoints": {
      if (fields.length !== 1) return null;
      const labels = breakpointLabelsOf(fields[0]![1]);
      return labels !== null ? { kind, label: labels.join(", ") } : null;
    }
  }
}

function projectRule(row: DsRow): LayoutRuleProjection {
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
  return {
    row,
    headline: row.meaning.trim() !== "" ? row.meaning : row.name,
    body: typeof value === "string" ? value : null,
    concern: row.name,
    facts,
    captures: row.entry.layoutCaptures ?? []
  };
}

/**
 * Whole-leaf derivation. Rules keep source order; each rule's own `captures`
 * decides whether it shows a source visual or the honest unavailable block.
 */
export function projectLayoutLeaf(rows: readonly DsRow[]): LayoutLeafModel {
  return { rules: rows.map((row) => projectRule(row)) };
}
