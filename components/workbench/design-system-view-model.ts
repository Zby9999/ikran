// Design System Browser view model (Issue 09A, Task E).
//
// Pure mapping from the GET /api/design-system view payload (DB-backed, see
// lib/runtime/design-system-view.ts) into the Section Tabs navigation model
// the bottom sheet renders — plus the small pure state machines that unit
// tests pin: sheet open/close, Esc isolation from the tldraw canvas, and the
// candidate ↔ formalized direct-switch UI states.
//
// Locked decisions honored here:
//   - d.6 rows carry name / value / semantic text / status chip only; the full
//     evidence chain stays nested on the entry for the ⓘ layer.
//   - d.7 no section collapsing — leaves are flat under their tab. 09C-D03
//     exception: the components section sidebar is two-level (group header +
//     component items, Components group before Blocks); foundations leaves
//     stay flat.
//   - d.9 the entry button appears only after the six-part alignment is
//     completed (canOpenDesignSystemBrowser is the single predicate).
//   - token.json's 3 layers project onto Color / Typography / Materials
//     leaves; alias references render as "→ layer.name".

import { specPathMatchesSourceArtifact } from "@/lib/runtime/design-system-spec-path";
import { PROTOTYPE_PRESENTATION_VIEWPORT_WIDTH } from "@/lib/runtime/prototype-screenshot-shared";
import type {
  DesignSystemEntryView,
  DesignSystemLayoutCapture,
  DesignSystemLiveHeroView,
  DesignSystemView
} from "@/lib/runtime/design-system-view";
import type { DesignIntentAlignmentSnapshot } from "@/lib/runtime/design-intent-alignment";

export type {
  DesignSystemEntryView,
  DesignSystemEntryEvidence,
  DesignSystemLayoutCapture,
  DesignSystemLiveHeroView,
  DesignSystemView
} from "@/lib/runtime/design-system-view";

export type DsStatus = DesignSystemEntryView["status"];
export type DsSectionId = "foundations" | "components";
export type TokenLeafId = "color" | "typography" | "materials";
export type FoundationsLeafId =
  | TokenLeafId
  | "layout"
  | "interaction";
/** Component leaves are data-driven: one per inventoried component. */
export type ComponentLeafId = `component:${string}`;
export type DsLeafId = FoundationsLeafId | ComponentLeafId;

export type DsRoute =
  | { kind: "section"; section: DsSectionId }
  | { kind: "leaf"; section: DsSectionId; leaf: DsLeafId };

/* --------------------------------- entry --------------------------------- */

/**
 * The single authoritative visibility condition for the "Draft Design System"
 * entry button (09A d.9): the six-part Design Intent Alignment is completed.
 * Same signal FolderChrome uses to switch Extraction to the post-Complete hint.
 */
export function canOpenDesignSystemBrowser(
  alignment: DesignIntentAlignmentSnapshot | null
): boolean {
  return alignment?.alignment.status === "completed";
}

/* ------------------------------ row mapping ------------------------------ */

export interface DsRow {
  /** React key + approval identity lookup key. */
  key: string;
  entryId: string;
  sourceArtifactPath: string;
  name: string;
  /** Display value: "→ layer.name" for alias refs, concrete value otherwise. */
  value: string;
  meaning: string;
  status: DsStatus;
  /** CSS color when the concrete value looks like one, else null. */
  swatch: string | null;
  /** Full entry (nested evidence chain) for the ⓘ layer. */
  entry: DesignSystemEntryView;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const COLOR_VALUE_PATTERN =
  /^(#(?:[0-9a-f]{3,4}|(?:[0-9a-f]{2}){3,4})|(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\(.+\))$/i;

/** Color-looking concrete values get a swatch next to the row. */
export function detectSwatch(value: string): string | null {
  const trimmed = value.trim();
  return COLOR_VALUE_PATTERN.test(trimmed) ? trimmed : null;
}

/**
 * Display string for an entry value. A pure alias object (already projected
 * to `entry.alias` by the API) renders as "→ layer.name"; concrete values
 * render verbatim (objects compactly serialized).
 */
export function formatEntryValue(entry: DesignSystemEntryView): string {
  if (entry.alias !== null) return `→ ${entry.alias}`;
  const value = entry.value;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null || value === undefined) return "—";
  // Narrative payloads (design-concept statements, visual language descriptions)
  // display their text, not their JSON envelope.
  if (isPlainObject(value) && Object.keys(value).length === 1) {
    const only = Object.values(value)[0];
    if (typeof only === "string") return only;
  }
  return JSON.stringify(value);
}

export function entryDisplayName(entry: DesignSystemEntryView): string {
  return entry.name ?? entry.entry_id;
}

/** Rules keep their meaning title. Token semantic text lives inside value as
 * usage (most domains) or usedFor (typography). */
export function entrySemanticText(entry: DesignSystemEntryView): string {
  if (
    entry.section.startsWith("token.") &&
    entry.kind !== "domain-rule" &&
    isPlainObject(entry.value)
  ) {
    if (typeof entry.value.usage === "string") return entry.value.usage;
    if (typeof entry.value.usedFor === "string") return entry.value.usedFor;
    return "";
  }
  return entry.meaning;
}

/**
 * Single owner of the row-key derivation (`${path}::${id}`) — used by toRow
 * and by ad-hoc rows (e.g. ComponentDetail's inventory/spec status rows) so
 * approval state keyed by row.key always matches.
 */
export function entryRowKey(
  sourceArtifactPath: string,
  entryId: string
): string {
  return `${sourceArtifactPath}::${entryId}`;
}

export function toRow(entry: DesignSystemEntryView): DsRow {
  const value = formatEntryValue(entry);
  return {
    key: entryRowKey(entry.source_artifact_path, entry.entry_id),
    entryId: entry.entry_id,
    sourceArtifactPath: entry.source_artifact_path,
    name: entryDisplayName(entry),
    value,
    meaning: entrySemanticText(entry),
    status: entry.status,
    swatch: entry.alias === null ? detectSwatch(value) : null,
    entry
  };
}

/** Stat dot labels, prototype style: ["3 formalized", "2 candidate", "1 open gap"]. */
export function statusChips(rows: readonly { status: DsStatus }[]): string[] {
  const counts: Record<DsStatus, number> = {
    formalized: 0,
    candidate: 0,
    gap: 0
  };
  for (const row of rows) counts[row.status] += 1;
  const chips: string[] = [];
  if (counts.formalized > 0) chips.push(`${counts.formalized} formalized`);
  if (counts.candidate > 0) chips.push(`${counts.candidate} candidate`);
  if (counts.gap > 0) chips.push(`${counts.gap} open gap${counts.gap > 1 ? "s" : ""}`);
  return chips;
}

/* --------------------------- token leaf mapping --------------------------- */

const COLOR_TOKEN_PATTERN =
  /color|colour|background|foreground|surface|ink|fill|stroke|border|accent|brand|neutral|gr[ae]y|text|bg/i;
const TYPOGRAPHY_TOKEN_PATTERN =
  /font|typo|typeface|display|heading|title|body|label|caption|letter|leading|line-?height|tracking|weight/i;

/**
 * Name-keyword projection of token entries onto the three token leaves
 * (09A: token.json → Color / Typography / Materials). Color wins over
 * typography ("text.primary" is a color role); Materials is the honest
 * catch-all (radius, shadow, spacing, opacity, …).
 */
export function classifyToken(
  name: string,
  domain: DesignSystemEntryView["domain"] | string | null = null
): TokenLeafId {
  if (domain === "color") return "color";
  if (domain === "typography") return "typography";
  if (domain !== null && domain !== undefined) return "materials";
  if (COLOR_TOKEN_PATTERN.test(name)) return "color";
  if (TYPOGRAPHY_TOKEN_PATTERN.test(name)) return "typography";
  return "materials";
}

export const TOKEN_LAYER_LABELS = {
  primitive: "Primitive",
  semantic: "Semantic",
  component: "Component"
} as const;
export type TokenLayerKey = keyof typeof TOKEN_LAYER_LABELS;
const TOKEN_LAYER_ORDER: readonly TokenLayerKey[] = [
  "primitive",
  "semantic",
  "component"
];

export interface DsTokenLeafModel {
  id: TokenLeafId;
  name: string;
  /** Domain-level judgement rules for this leaf, in source order. */
  rules: DsRow[];
  /** Non-empty layer groups, primitive → semantic → component. */
  groups: { layer: TokenLayerKey; rows: DsRow[] }[];
  chips: string[];
}

const TOKEN_LEAF_IDS: readonly TokenLeafId[] = [
  "color",
  "typography",
  "materials"
];

const TOKEN_LEAF_NAMES: Record<TokenLeafId, string> = {
  color: "Color",
  typography: "Typography",
  materials: "Materials"
};

/* ----------------------------- color page model ----------------------------- */

/** One rendered color row: the semantic/component token plus the concrete
 * color its alias chain resolves to. `source` is the terminal token name
 * behind the chain (hover-tooltip provenance); null for concrete tokens. */
export interface DsColorToken {
  row: DsRow;
  name: string;
  meaning: string;
  status: DsStatus;
  hex: string;
  source: string | null;
}

export interface DsColorLeafModel {
  /** Domain-level judgement rules (color), in source order. */
  rules: DsRow[];
  semantic: DsColorToken[];
  component: DsColorToken[];
}

/** Alias targets are "layer.name"; the name may itself contain dots, so the
 * split happens at the FIRST dot (mirrors parseTokenEntryRef in the schema). */
function splitTokenRef(ref: string): { layer: TokenLayerKey; name: string } | null {
  const dot = ref.indexOf(".");
  if (dot <= 0 || dot === ref.length - 1) return null;
  const layer = ref.slice(0, dot);
  if (!(TOKEN_LAYER_ORDER as readonly string[]).includes(layer)) return null;
  return { layer: layer as TokenLayerKey, name: ref.slice(dot + 1) };
}

/** Color leaf of the token.json layers: primitives collapse into resolved
 * swatch provenance (the redesign drops the Primitive section), semantic and
 * component tokens stay as governed rows. Domain rules split out. */
export function buildColorLeafModel(view: DesignSystemView): DsColorLeafModel {
  // Qualified lookup ("layer.name" → entry). Tokens address each other by
  // `name`; legacy rows without a name fall back to their entry_id.
  const byQualified = new Map<string, DesignSystemEntryView>();
  for (const layer of TOKEN_LAYER_ORDER) {
    for (const entry of view.tokens[layer]) {
      byQualified.set(`${layer}.${entry.name ?? entry.entry_id}`, entry);
      if (entry.entry_id.startsWith(`${layer}.`)) {
        byQualified.set(entry.entry_id, entry);
      }
    }
  }

  const isColor = (entry: DesignSystemEntryView) =>
    entry.kind !== "domain-rule" &&
    entry.status !== "gap" &&
    classifyToken(entry.name ?? entry.entry_id, entry.domain ?? null) === "color";

  const resolve = (
    entry: DesignSystemEntryView
  ): { hex: string | null; source: string | null } => {
    if (entry.status === "gap" || entry.alias === null) {
      const hex = entry.alias === null ? detectSwatch(formatEntryValue(entry)) : null;
      return { hex, source: null };
    }
    // Walk the chain to its terminal concrete token. The schema rejects
    // cycles at ingest; the depth cap keeps stale DB rows honest.
    let ref: string | null = entry.alias;
    let terminal: DesignSystemEntryView | null = null;
    for (let depth = 0; ref !== null && depth < 8; depth += 1) {
      const target = splitTokenRef(ref);
      const next = target ? byQualified.get(`${target.layer}.${target.name}`) : undefined;
      if (!next || next.status === "gap") return { hex: null, source: null };
      terminal = next;
      ref = next.alias;
    }
    if (terminal === null || ref !== null) return { hex: null, source: null };
    const hex = detectSwatch(formatEntryValue(terminal));
    if (hex === null) return { hex: null, source: null };
    return { hex, source: entryDisplayName(terminal) };
  };

  const toColorToken = (entry: DesignSystemEntryView): DsColorToken | null => {
    const resolved = resolve(entry);
    if (resolved.hex === null) return null;
    return {
      row: toRow(entry),
      name: entryDisplayName(entry),
      meaning: entrySemanticText(entry),
      status: entry.status,
      hex: resolved.hex,
      source: resolved.source
    };
  };

  const rules: DsRow[] = [];
  const semantic: DsColorToken[] = [];
  const component: DsColorToken[] = [];
  for (const entry of view.tokens.semantic) {
    if (entry.kind === "domain-rule" && entry.domain === "color") {
      rules.push(toRow(entry));
    } else if (isColor(entry)) {
      const token = toColorToken(entry);
      if (token) semantic.push(token);
    }
  }
  for (const entry of view.tokens.component) {
    if (entry.kind === "domain-rule" && entry.domain === "color") {
      rules.push(toRow(entry));
    } else if (isColor(entry)) {
      const token = toColorToken(entry);
      if (token) component.push(token);
    }
  }

  return { rules, semantic, component };
}

/* ---------------------------- component mapping ---------------------------- */

/** Sidebar grouping (09C-D03): the spec's optional `value.group` declares a
 * page-structure Block; everything else is a Component. */
export type DsComponentGroupId = "component" | "block";

export interface DsComponentProp extends Record<string, unknown> {
  name: string;
  type: string;
}

export type DsComponentDetailGroupId = "token-links" | "code-links";

export interface DsComponentGuideline extends Record<string, unknown> {
  kind: "do" | "dont";
  text: string;
}

/** One optional placard group (09B rich fields): prose lines plus object
 * rows, both verbatim from the spec. Empty fields never reach this list —
 * omission is silent in the UI but stays auditable in the source. */
export interface DsComponentDetailGroup {
  id: DsComponentDetailGroupId;
  label: string;
  lines: string[];
  rows: Record<string, unknown>[];
}

export interface DsComponentDetail {
  description: string;
  props: DsComponentProp[];
  /** Style, size, and viewport rows carried verbatim from the spec. */
  variants: Record<string, unknown>[];
  /** State matrix rows: { state, ...behavior } verbatim from the spec. */
  stateMatrix: Record<string, unknown>[];
  guidelines: DsComponentGuideline[];
  /** Hero states row names, derived from the state matrix. */
  stateNames: string[];
  /** Full-fidelity technical references in fixed placard order. */
  referenceGroups: DsComponentDetailGroup[];
}

export interface DsComponentModel {
  leafId: ComponentLeafId;
  entryId: string;
  name: string;
  /** Sidebar grouping from the spec's `value.group` (default component). */
  group: DsComponentGroupId;
  /** Worst of inventory/spec (gap > candidate > formalized) — drives the
   * sidebar status dot and the placard title chip. */
  status: DsStatus;
  inventory: DesignSystemEntryView | null;
  spec: DesignSystemEntryView | null;
  detail: DsComponentDetail | null;
  /** Source captures the Runtime view decorated onto the spec ([] = none). */
  captures: DesignSystemLayoutCapture[];
  /** Screenshot-free code-backed iframe declaration. */
  liveHero: DesignSystemLiveHeroView | null;
  chips: string[];
}

/* ----------------------- technical reference tables ----------------------- */

const RICH_GROUP_DEFS: readonly {
  id: DsComponentDetailGroupId;
  label: string;
  fields: readonly string[];
}[] = [
  { id: "token-links", label: "Token links", fields: ["tokenLinks"] },
  { id: "code-links", label: "Code links", fields: ["codeLinks"] }
];

/** Tolerant rich-field parse: real data mixes string lines and object rows;
 * anything else (numbers, nulls, empty strings) is dropped item by item. */
function parseRichItems(raw: unknown): {
  lines: string[];
  rows: Record<string, unknown>[];
} {
  const lines: string[] = [];
  const rows: Record<string, unknown>[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string") {
        if (item.trim().length > 0) lines.push(item);
      } else if (isPlainObject(item)) {
        rows.push(item);
      }
    }
  }
  return { lines, rows };
}

function parseComponentDetail(
  spec: DesignSystemEntryView | null
): DsComponentDetail | null {
  if (!spec || !isPlainObject(spec.value)) return null;
  const value = spec.value;
  const props: DsComponentProp[] = [];
  if (Array.isArray(value.props)) {
    for (const raw of value.props) {
      if (!isPlainObject(raw)) continue;
      if (typeof raw.name !== "string" || typeof raw.type !== "string") {
        continue;
      }
      props.push({
        ...raw,
        name: raw.name,
        type: raw.type
      });
    }
  }
  const stateMatrix = Array.isArray(value.stateMatrix)
    ? value.stateMatrix.filter(isPlainObject)
    : [];
  const variants = Array.isArray(value.variants)
    ? value.variants.filter(isPlainObject)
    : [];
  const guidelines: DsComponentGuideline[] = Array.isArray(value.guidelines)
    ? value.guidelines.flatMap((raw) =>
        isPlainObject(raw) &&
        (raw.kind === "do" || raw.kind === "dont") &&
        typeof raw.text === "string"
          ? [{ ...raw, kind: raw.kind, text: raw.text }]
          : []
      )
    : [];

  const referenceGroups: DsComponentDetailGroup[] = [];
  for (const def of RICH_GROUP_DEFS) {
    const lines: string[] = [];
    const rows: Record<string, unknown>[] = [];
    for (const field of def.fields) {
      const parsed = parseRichItems(value[field]);
      lines.push(...parsed.lines);
      rows.push(...parsed.rows);
    }
    if (lines.length > 0 || rows.length > 0) {
      referenceGroups.push({ id: def.id, label: def.label, lines, rows });
    }
  }

  const stateNames = stateMatrix.flatMap((row) =>
    typeof row.state === "string" && row.state.trim().length > 0
      ? [row.state]
      : []
  );

  return {
    description:
      typeof value.description === "string" ? value.description : "",
    props,
    variants,
    stateMatrix,
    guidelines,
    stateNames,
    referenceGroups
  };
}

/** Attention-first ordering: anything unapproved outranks formalized. */
function componentStatusOf(
  entries: readonly DesignSystemEntryView[]
): DsStatus {
  if (entries.some((entry) => entry.status === "gap")) return "gap";
  if (entries.some((entry) => entry.status === "candidate")) return "candidate";
  return "formalized";
}

/* ------------------------- hero live plan (Issue 33) ------------------------- */

/** Why a DECLARED live hero could not render and fell back to source evidence.
 * "surface_not_ready": the linked prototype surface is not running
 * (readiness not "ready", or its row is gone). "surface_stale": the surface
 * is up but was marked stale (code changed / dev server exited) and is not
 * re-serving the current code. "live_unreachable": the surface looked live
 * but the harness did not provide valid, current-navigation component
 * geometry (the route moved, broke, or still uses the legacy protocol). */
export type DsHeroLiveFallbackReason =
  | "surface_not_ready"
  | "surface_stale"
  | "live_unreachable";

/** Hero tier for the component placard: live sandboxed render of the current
 * code when a harness was declared and its surface is live; otherwise a
 * source capture; otherwise the explicit unavailable block. Generated code
 * screenshots are deliberately absent from this chain. `liveKey` identifies the
 * current live target AND its readiness (see componentHeroLiveKey) so the
 * client can pin its geometry-timeout verdict to it. A changed key — new
 * capture, or the surface's readiness/staleness flipping on a refetch —
 * re-arms the target; state URL navigation re-arms within that same key. */
export type DsHeroPlan =
  | {
      kind: "live";
      liveHero: DesignSystemLiveHeroView;
      liveKey: string | null;
    }
  | {
      kind: "static";
      capture: DesignSystemLayoutCapture;
      liveFallback: DsHeroLiveFallbackReason | null;
      liveKey: string | null;
    }
  | {
      kind: "unavailable";
      liveFallback: DsHeroLiveFallbackReason | null;
      liveKey: string | null;
    };

/** Identity of the live-hero attempt: the render target (preview origin +
 * harness route + capture) PLUS the surface's readiness/staleness. The
 * readiness fields are part of the key so a surface that flips
 * starting → ready on a view refetch forms a NEW key and the hero re-tries
 * the live render; an unchanged surface keeps the same key, so a timed-out
 * verdict stays terminal and the hero never loops back into the iframe.
 * Every segment is URI-encoded so the separator cannot collide. Null when
 * the capture declares no harness (no live attempt possible). */
export function componentHeroLiveKey(
  liveHero: DesignSystemLiveHeroView | null
): string | null {
  if (liveHero === null) return null;
  const availabilitySegment =
    liveHero.liveAvailability ?? String(liveHero.surfaceStale);
  return [
    liveHero.previewUrl,
    liveHero.harnessPath,
    liveHero.harnessArtifactPath,
    liveHero.surfaceReadiness,
    availabilitySegment
  ]
    .map((segment) => encodeURIComponent(String(segment)))
    .join("|");
}

/** Tier verdict for the hero. `unreachableKey` is the client's geometry-
 * timed-out live key (heroLiveVerdictReducer); when it matches the current
 * attempt the plan demotes to the static capture with "live_unreachable".
 * Owns the code-first tier ordering — callers pass captures in declared
 * order. */
export function planComponentHero(
  liveHero: DesignSystemLiveHeroView | null,
  captures: readonly DesignSystemLayoutCapture[],
  unreachableKey: string | null
): DsHeroPlan {
  const capture = captures.find((item) => item.origin === "source") ?? null;
  const liveKey = componentHeroLiveKey(liveHero);
  if (liveHero !== null) {
    if (unreachableKey !== null && unreachableKey === liveKey) {
      return capture
        ? { kind: "static", capture, liveFallback: "live_unreachable", liveKey }
        : { kind: "unavailable", liveFallback: "live_unreachable", liveKey };
    }
    if (
      liveHero.previewUrl === null ||
      liveHero.surfaceReadiness !== "ready" ||
      liveHero.liveAvailability === "unavailable"
    ) {
      return capture
        ? { kind: "static", capture, liveFallback: "surface_not_ready", liveKey }
        : { kind: "unavailable", liveFallback: "surface_not_ready", liveKey };
    }
    if (liveHero.liveAvailability === undefined && liveHero.surfaceStale) {
      return capture
        ? { kind: "static", capture, liveFallback: "surface_stale", liveKey }
        : { kind: "unavailable", liveFallback: "surface_stale", liveKey };
    }
    return { kind: "live", liveHero, liveKey };
  }
  return capture
    ? { kind: "static", capture, liveFallback: null, liveKey }
    : { kind: "unavailable", liveFallback: null, liveKey: null };
}

/** The harness URL the live iframe navigates to. `state` is a spec
 * stateMatrix name; null restores the harness default (no query). A spec
 * state literally named "default" denotes that same resting state, so it
 * normalizes to the no-query URL — forcing `?state=default` would re-navigate
 * for nothing and rely on the harness special-casing a query the contract
 * never sends. */
export function componentHeroLiveUrl(
  liveHero: DesignSystemLiveHeroView,
  state: string | null
): string | null {
  if (liveHero.previewUrl === null) return null;
  const base = `${liveHero.previewUrl}${liveHero.harnessPath}`;
  if (state === null || state.trim().toLowerCase() === "default") return base;
  return `${base}?state=${encodeURIComponent(state)}`;
}

/** One-way sizing message emitted by a standalone component harness. The
 * parent validates both event.source and event.origin before accepting it;
 * the harness only reports geometry and never receives Runtime data. */
export const DS_HERO_SIZE_MESSAGE = "ikran:component-size";
export const DS_HERO_SIZE_PROTOCOL_VERSION = 2;

export type DsHeroContentSize = {
  /** Tight visual/scroll bounds of the declared component root, in iframe
   * document coordinates. The marker itself must not be transformed. */
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DsHeroFrameLayout = {
  frameWidth: number;
  frameHeight: number;
  frameLeft: number;
  frameTop: number;
  displayHeight: number;
  scale: number;
};

/** Small components keep a useful presentation stage instead of collapsing
 * to their raw control height. Larger components expand the stage. */
export const DS_HERO_MIN_FRAME_HEIGHT = 240;
/** Match the stable responsive context used by Prototype live/screenshot
 * surfaces. Empty iframe space is clipped by the hero stage; the measured
 * component root, rather than the viewport, is what gets centered. */
export const DS_HERO_PRESENTATION_VIEWPORT_WIDTH =
  PROTOTYPE_PRESENTATION_VIEWPORT_WIDTH;
const DS_HERO_MAX_REPORTED_EXTENT = 16_384;

/** Parse the deliberately tiny cross-origin harness protocol. Rejecting
 * non-finite and implausibly large values keeps untrusted preview documents
 * from influencing the Workbench layout outside this component stage. */
export function parseComponentHeroSizeMessage(
  value: unknown,
  expectedHref: string
): DsHeroContentSize | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (
    record.type !== DS_HERO_SIZE_MESSAGE ||
    record.version !== DS_HERO_SIZE_PROTOCOL_VERSION ||
    typeof record.href !== "string"
  ) {
    return null;
  }
  try {
    if (new URL(record.href).href !== new URL(expectedHref).href) return null;
  } catch {
    return null;
  }
  const { x, y, width, height } = record;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    x < 0 ||
    y < 0 ||
    width <= 0 ||
    height <= 0 ||
    x + width > DS_HERO_PRESENTATION_VIEWPORT_WIDTH ||
    y + height > DS_HERO_MAX_REPORTED_EXTENT
  ) {
    return null;
  }
  return { x, y, width, height };
}

/** Fit a measured live component into the available stage. Height is
 * content-driven; only over-wide content is uniformly scaled down. The iframe
 * keeps the product's fixed presentation viewport; a harness whose root
 * exceeds that viewport is invalid rather than allowed to change responsive
 * breakpoints. */
export function componentHeroFrameLayout(
  stageWidth: number,
  contentSize: DsHeroContentSize | null
): DsHeroFrameLayout | null {
  if (!Number.isFinite(stageWidth) || stageWidth <= 0) return null;
  if (contentSize === null) {
    return {
      frameWidth: DS_HERO_PRESENTATION_VIEWPORT_WIDTH,
      frameHeight: DS_HERO_MIN_FRAME_HEIGHT,
      frameLeft: 0,
      frameTop: 0,
      displayHeight: DS_HERO_MIN_FRAME_HEIGHT,
      scale: 1
    };
  }
  if (
    !Number.isFinite(contentSize.x) ||
    !Number.isFinite(contentSize.y) ||
    !Number.isFinite(contentSize.width) ||
    !Number.isFinite(contentSize.height) ||
    contentSize.x < 0 ||
    contentSize.y < 0 ||
    contentSize.width <= 0 ||
    contentSize.height <= 0 ||
    contentSize.x + contentSize.width >
      DS_HERO_PRESENTATION_VIEWPORT_WIDTH ||
    contentSize.y + contentSize.height > DS_HERO_MAX_REPORTED_EXTENT
  ) {
    return null;
  }
  const frameWidth = DS_HERO_PRESENTATION_VIEWPORT_WIDTH;
  const frameHeight = Math.max(
    DS_HERO_MIN_FRAME_HEIGHT,
    contentSize.y + contentSize.height
  );
  const scale = Math.min(1, stageWidth / contentSize.width);
  const scaledHeight = contentSize.height * scale;
  const displayHeight = Math.max(DS_HERO_MIN_FRAME_HEIGHT, scaledHeight);
  return {
    frameWidth,
    frameHeight,
    frameLeft:
      stageWidth / 2 -
      (contentSize.x + contentSize.width / 2) * scale,
    frameTop:
      displayHeight / 2 -
      (contentSize.y + contentSize.height / 2) * scale,
    displayHeight,
    scale
  };
}

/** Client-side live phase: a harness navigation starts "pending"; its first
 * valid, current-URL geometry report promotes to "live", while a timeout
 * demotes to "unreachable" and the plan falls back. A new declared state URL
 * explicitly re-arms pending on the same live key. */
export type DsHeroLivePhase = "pending" | "live" | "unreachable";

/** The geometry-readiness verdict pinned to the exact harness navigation it
 * belongs to. `key` identifies the live surface; `href` distinguishes default
 * and declared-state navigations on that surface. Both are required so a late
 * message/timer from the previous iframe document cannot settle the current
 * attempt. */
export type DsHeroLiveVerdict = {
  key: string | null;
  href: string | null;
  phase: DsHeroLivePhase;
};

export type DsHeroLiveVerdictAction =
  /** The plan's liveKey changed (new capture, readiness flip) → re-arm. */
  | { type: "retarget"; key: string | null; href: string | null }
  /** The same harness navigated to another declared `?state=` URL. */
  | { type: "navigate"; key: string | null; href: string }
  | { type: "loaded"; key: string | null; href: string }
  | { type: "timeout"; key: string | null; href: string };

export function heroLiveVerdictReducer(
  verdict: DsHeroLiveVerdict,
  action: DsHeroLiveVerdictAction
): DsHeroLiveVerdict {
  if (action.type === "retarget") {
    return action.key === verdict.key
      ? verdict
      : { key: action.key, href: action.href, phase: "pending" };
  }
  if (action.type === "navigate") {
    return action.key === verdict.key
      ? { key: action.key, href: action.href, phase: "pending" }
      : verdict;
  }
  if (action.key !== verdict.key || action.href !== verdict.href) return verdict;
  if (verdict.phase !== "pending") return verdict;
  switch (action.type) {
    case "loaded":
      return { ...verdict, phase: "live" };
    case "timeout":
      return { ...verdict, phase: "unreachable" };
  }
}

/** Grace for a valid, current-URL geometry report before static fallback. */
export const DS_HERO_LIVE_TIMEOUT_MS = 5000;
/** Hover/focus debounce before the iframe re-navigates to `?state=<name>`. */
export const DS_HERO_STATE_DEBOUNCE_MS = 150;

/** Timeout routing for a live attempt (B3): the DEFAULT document's failure
 * demotes the whole live tier to the static fallback; a declared state's
 * failure is per-state — the hero reverts to the default document and marks
 * only that state, so one broken state never kills a healthy component. */
export type DsHeroTimeoutDecision =
  | { kind: "demote" }
  | { kind: "state-failure"; state: string | null };

export function heroLiveTimeoutDecision(
  href: string,
  defaultHref: string | null
): DsHeroTimeoutDecision {
  if (defaultHref === null || href === defaultHref) {
    return { kind: "demote" };
  }
  try {
    return {
      kind: "state-failure",
      state: new URL(href).searchParams.get("state")
    };
  } catch {
    return { kind: "state-failure", state: null };
  }
}

/** Fallback caption copy — says what happened and what is shown instead;
 * a blank hero is an accident, an explained static capture is a conclusion. */
export function heroLiveFallbackCopy(reason: DsHeroLiveFallbackReason): string {
  switch (reason) {
    case "surface_not_ready":
      return "Live preview unavailable — the prototype surface is not running; showing the source fallback.";
    case "surface_stale":
      return "Live preview unavailable — the prototype surface is stale (its code changed); showing the source fallback.";
    case "live_unreachable":
      return "Live preview unavailable — the harness did not report valid component geometry; showing the source fallback.";
  }
}

/* --------------------------- sidebar projection --------------------------- */

export interface DsComponentSidebarItem {
  leafId: ComponentLeafId;
  name: string;
  status: DsStatus;
  /** Candidate entries get the blue dot (#2473cc, the chip color). */
  candidate: boolean;
}

export interface DsComponentSidebarGroup {
  id: DsComponentGroupId;
  name: string;
  items: DsComponentSidebarItem[];
}

const COMPONENT_GROUP_NAMES: Record<DsComponentGroupId, string> = {
  component: "Components",
  block: "Blocks"
};

/** Components group first, Blocks second; empty groups are omitted. */
export function projectComponentSidebarGroups(
  components: readonly DsComponentModel[]
): DsComponentSidebarGroup[] {
  const groups: DsComponentSidebarGroup[] = [];
  for (const id of ["component", "block"] as const) {
    const members = components.filter((component) => component.group === id);
    if (members.length === 0) continue;
    groups.push({
      id,
      name: COMPONENT_GROUP_NAMES[id],
      items: members.map((component) => ({
        leafId: component.leafId,
        name: component.name,
        status: component.status,
        candidate: component.status === "candidate"
      }))
    });
  }
  return groups;
}

/* ------------------------------ whole model ------------------------------ */

export interface DsBrowserModel {
  name: string;
  /** Alignment done but nothing ingested yet — the sheet renders honestly. */
  empty: boolean;
  foundations: {
    chips: string[];
    /** Foundations Home: Design Concept rule cards + visual language narrative. */
    concepts: DsRow[];
    visualLanguage: { description: string; row: DsRow } | null;
    tokenLeaves: DsTokenLeafModel[];
    layout: { rows: DsRow[]; chips: string[] };
    interaction: { rows: DsRow[]; chips: string[] };
  };
  components: {
    chips: string[];
    list: DsComponentModel[];
    /** Components group first, Blocks second; empty groups omitted. */
    groups: DsComponentSidebarGroup[];
    /** Where the Components tab lands: the first component, null when empty. */
    landingLeaf: ComponentLeafId | null;
  };
}

export function buildDesignSystemBrowserModel(
  view: DesignSystemView
): DsBrowserModel {
  const concepts = view.foundations.concepts.map(toRow);
  const visualLanguageEntry = view.foundations.visualLanguage;
  const visualLanguage = visualLanguageEntry
    ? {
        description:
          isPlainObject(visualLanguageEntry.value) &&
          typeof visualLanguageEntry.value.description === "string"
            ? visualLanguageEntry.value.description
            : "",
        row: toRow(visualLanguageEntry)
      }
    : null;

  // Token leaves: classify each layer's entries, keep layer grouping inside
  // each leaf (primitive → semantic → component), drop empty groups.
  const tokenLeafIds = TOKEN_LEAF_IDS;
  const byLeafLayer = new Map<TokenLeafId, Map<TokenLayerKey, DsRow[]>>(
    tokenLeafIds.map((id) => [id, new Map()])
  );
  const rulesByLeaf = new Map<TokenLeafId, DsRow[]>(
    tokenLeafIds.map((id) => [id, []])
  );
  for (const layer of TOKEN_LAYER_ORDER) {
    for (const entry of view.tokens[layer]) {
      if (entry.kind === "domain-rule") {
        const leafId =
          entry.domain === "color"
            ? "color"
            : entry.domain === "typography"
              ? "typography"
              : "materials";
        rulesByLeaf.get(leafId)!.push(toRow(entry));
        continue;
      }
      // A global rule cannot legally live in token.json. Defensive DB reads
      // omit it instead of disguising it as a token via name classification.
      if (entry.kind === "global-rule") continue;
      // Legacy DB rows may predate the schema gate. Never surface an
      // unresolved value as a token; unresolved decisions belong in Rules.
      if (entry.status === "gap") continue;
      const leafId = classifyToken(
        entryDisplayName(entry),
        entry.domain ?? null
      );
      const groups = byLeafLayer.get(leafId)!;
      const rows = groups.get(layer) ?? [];
      rows.push(toRow(entry));
      groups.set(layer, rows);
    }
  }
  const tokenLeaves: DsTokenLeafModel[] = tokenLeafIds.map((id) => {
    const groups = TOKEN_LAYER_ORDER.flatMap((layer) => {
      const rows = byLeafLayer.get(id)!.get(layer) ?? [];
      return rows.length > 0 ? [{ layer, rows }] : [];
    });
    return {
      id,
      name: TOKEN_LEAF_NAMES[id],
      rules: rulesByLeaf.get(id)!,
      groups,
      chips: statusChips([
        ...rulesByLeaf.get(id)!,
        ...groups.flatMap((group) => group.rows)
      ])
    };
  });

  const layoutRows = view.layout.map(toRow);
  const interactionRows = view.interaction.map(toRow);

  // Component leaves: data-driven from the inventory, paired with the spec
  // whose source artifact path matches the inventory's specPath (both the
  // project-relative and design-system-root-relative spellings pair — see
  // specPathMatchesSourceArtifact). Specs with no inventory row still
  // surface (honest about what's in the DB).
  const usedSpecs = new Set<string>();
  const toComponentModel = (
    entry: DesignSystemEntryView | null,
    spec: DesignSystemEntryView | null
  ): DsComponentModel => {
    const anchor = entry ?? spec!;
    const entries = [entry, spec].flatMap((e) => (e ? [e] : []));
    const group =
      spec && isPlainObject(spec.value) && spec.value.group === "block"
        ? ("block" as const)
        : ("component" as const);
    return {
      leafId: `component:${anchor.entry_id}`,
      entryId: anchor.entry_id,
      name: entryDisplayName(anchor),
      group,
      status: componentStatusOf(entries),
      inventory: entry,
      spec,
      detail: parseComponentDetail(spec),
      captures: spec?.captures ?? [],
      liveHero: spec?.liveHero ?? null,
      chips: statusChips(entries)
    };
  };
  const components: DsComponentModel[] = view.components.inventory.map(
    (entry) => {
      const specPath =
        isPlainObject(entry.value) && typeof entry.value.specPath === "string"
          ? entry.value.specPath
          : null;
      const spec =
        (specPath
          ? view.components.specs.find((candidate) =>
              specPathMatchesSourceArtifact(
                specPath,
                candidate.source_artifact_path
              )
            )
          : undefined) ?? null;
      if (spec) usedSpecs.add(spec.entry_id);
      return toComponentModel(entry, spec);
    }
  );
  for (const spec of view.components.specs) {
    if (usedSpecs.has(spec.entry_id)) continue;
    components.push(toComponentModel(null, spec));
  }

  const foundationsRows = [
    ...concepts,
    ...(visualLanguage ? [visualLanguage.row] : []),
    ...tokenLeaves.flatMap((leaf) =>
      [...leaf.rules, ...leaf.groups.flatMap((group) => group.rows)]
    ),
    ...layoutRows,
    ...interactionRows
  ];
  const componentRows = components.flatMap((component) =>
    [component.inventory, component.spec].flatMap((entry) =>
      entry ? [entry] : []
    )
  );

  return {
    name: view.name,
    empty: foundationsRows.length === 0 && componentRows.length === 0,
    foundations: {
      chips: statusChips(foundationsRows),
      concepts,
      visualLanguage,
      tokenLeaves,
      layout: { rows: layoutRows, chips: statusChips(layoutRows) },
      interaction: {
        rows: interactionRows,
        chips: statusChips(interactionRows)
      }
    },
    components: {
      chips: statusChips(componentRows),
      list: components,
      groups: projectComponentSidebarGroups(components),
      landingLeaf: components[0]?.leafId ?? null
    }
  };
}

/** Rows that can still light a leaf's sidebar blue dot. Color collapses
 * primitive tokens into swatch provenance, so they are not Color-page
 * options and do not count. */
function tokenLeafGovernedRows(leaf: DsTokenLeafModel): DsRow[] {
  const layerRows =
    leaf.id === "color"
      ? leaf.groups
          .filter((group) => group.layer !== "primitive")
          .flatMap((group) => group.rows)
      : leaf.groups.flatMap((group) => group.rows);
  return [...leaf.rules, ...layerRows];
}

/** Sidebar candidate dot for a Foundations leaf. Matches the options the
 * designer can still act on on that page — not hidden provenance tokens. */
export function foundationLeafHasCandidate(
  model: DsBrowserModel,
  leafId: DsLeafId
): boolean {
  if (leafId === "layout") {
    return model.foundations.layout.rows.some(
      (row) => row.status === "candidate"
    );
  }
  if (leafId === "interaction") {
    return model.foundations.interaction.rows.some(
      (row) => row.status === "candidate"
    );
  }
  const leaf = model.foundations.tokenLeaves.find(
    (candidate) => candidate.id === leafId
  );
  return Boolean(
    leaf && tokenLeafGovernedRows(leaf).some((row) => row.status === "candidate")
  );
}

const FOUNDATION_ATTENTION_LEAVES: readonly FoundationsLeafId[] = [
  "color",
  "typography",
  "materials",
  "layout",
  "interaction"
];

/**
 * True when any Browser sidebar row would still show the candidate blue
 * dot. The Draft Design System entry reuses this same attention signal.
 */
export function designSystemHasActionableCandidate(
  view: DesignSystemView | null
): boolean {
  if (!view) return false;
  const model = buildDesignSystemBrowserModel(view);
  const homeRows = [
    ...model.foundations.concepts,
    ...(model.foundations.visualLanguage
      ? [model.foundations.visualLanguage.row]
      : [])
  ];
  if (homeRows.some((row) => row.status === "candidate")) return true;
  if (
    FOUNDATION_ATTENTION_LEAVES.some((leafId) =>
      foundationLeafHasCandidate(model, leafId)
    )
  ) {
    return true;
  }
  return model.components.groups.some((group) =>
    group.items.some((item) => item.candidate)
  );
}

export const DS_SECTION_NAMES: Record<DsSectionId, string> = {
  foundations: "Foundations",
  components: "Components"
};

export function componentLeafId(leaf: DsLeafId): string | null {
  return leaf.startsWith("component:") ? leaf.slice("component:".length) : null;
}

/* --------------------------- sync warning routing --------------------------- */

/**
 * Which synced source file feeds which page: warnings mount per page, so a
 * stale file only flags the pages whose data came from it. Paths arrive
 * project-relative ("design-system/token.json"); the root-relative spelling
 * is accepted too (same normalization as specPathMatchesSourceArtifact).
 */
export function syncWarningAppliesToRoute(
  path: string,
  route: DsRoute,
  model: DsBrowserModel
): boolean {
  const rel = path.startsWith("design-system/")
    ? path.slice("design-system/".length)
    : path;
  if (rel === "design-system.json") {
    // Foundations Home is the only page rendering concepts + visual language.
    return route.kind === "section" && route.section === "foundations";
  }
  if (rel === "token.json") {
    return (
      route.kind === "leaf" &&
      route.section === "foundations" &&
      (TOKEN_LEAF_IDS as readonly string[]).includes(route.leaf)
    );
  }
  if (rel === "layout-rules.json") {
    return (
      route.kind === "leaf" &&
      route.section === "foundations" &&
      route.leaf === "layout"
    );
  }
  if (rel === "interaction-rules.json") {
    return (
      route.kind === "leaf" &&
      route.section === "foundations" &&
      route.leaf === "interaction"
    );
  }
  if (rel === "component-list.json") {
    // Inventory rows feed the components landing and every component page.
    return route.section === "components";
  }
  if (rel.startsWith("components/")) {
    // A component spec flags its own component page — and the components
    // section landing when that component is the one it renders.
    const component =
      model.components.list.find(
        (candidate) =>
          candidate.spec !== null &&
          specPathMatchesSourceArtifact(
            candidate.spec.source_artifact_path,
            path
          )
      ) ?? null;
    if (route.kind === "section") {
      return (
        route.section === "components" &&
        (component === null ||
          model.components.landingLeaf === component.leafId)
      );
    }
    return (
      route.section === "components" &&
      (component === null || route.leaf === component.leafId)
    );
  }
  return false;
}

export function breadcrumbFor(
  route: DsRoute,
  model: DsBrowserModel
): string[] {
  const sectionName = DS_SECTION_NAMES[route.section];
  if (route.kind === "section") return [sectionName, "Home"];
  const leafName =
    route.section === "foundations"
      ? route.leaf === "layout"
        ? "Layout"
        : route.leaf === "interaction"
          ? "Interaction"
          : (TOKEN_LEAF_NAMES[route.leaf as TokenLeafId] ?? route.leaf)
      : (model.components.list.find(
          (component) => component.leafId === route.leaf
        )?.name ?? route.leaf);
  return [sectionName, leafName];
}

/* ----------------------------- sheet machine ----------------------------- */

export type SheetCloseSource = "scrim" | "escape" | "button";

export type SheetState = { open: boolean };

export type SheetAction =
  | { type: "open" }
  | { type: "close"; source: SheetCloseSource };

/**
 * Bottom-sheet open/close. Close sources are explicit (09A d.9: scrim click,
 * Esc, close button) so the caller can log/test each path.
 */
export function sheetReducer(state: SheetState, action: SheetAction): SheetState {
  if (action.type === "open") return state.open ? state : { open: true };
  return state.open ? { open: false } : state;
}

/**
 * Esc (and every other key) originating inside the open sheet must not reach
 * the tldraw canvas: capture-phase listener stops propagation for events
 * whose target is inside the sheet root. Closed sheet captures nothing.
 */
export type SheetEscapeAction = "close-info" | "close-sheet" | "swallow";

/**
 * Layered Esc dismissal inside the sheet: an open ⓘ popover closes first,
 * the sheet second. During the exit window (still mounted, no longer shown)
 * Esc never closes the sheet again — but it can still close an open ⓘ
 * layer, which can't outlive the sheet anyway.
 */
export function sheetEscapeAction(
  infoOpen: boolean,
  sheetShown: boolean
): SheetEscapeAction {
  if (infoOpen) return "close-info";
  return sheetShown ? "close-sheet" : "swallow";
}

/* ---------------------------- approval machine ---------------------------- */

export type ApprovalState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "error"; reason: string; message: string };

export type ApprovalAction =
  | { type: "start" }
  | { type: "succeeded" }
  | { type: "failed"; reason: string; details?: unknown };

/** Optimistic flip → pending; success confirms (idle, chip already flipped
 * locally and the SSE design-system event refetches); failure reverts the
 * flip (caller) and pins the typed reason next to the row. */
export function approvalReducer(
  state: ApprovalState,
  action: ApprovalAction
): ApprovalState {
  switch (action.type) {
    case "start":
      return state.kind === "pending" ? state : { kind: "pending" };
    case "succeeded":
      return { kind: "idle" };
    case "failed":
      return {
        kind: "error",
        reason: action.reason,
        message: approvalErrorMessage(action.reason, action.details)
      };
  }
}

/** Status-write failure → short retry guidance shown beside the row. Typed
 * reasons get actionable copy; anything unexpected stays on the generic
 * fallback. */
export function approvalErrorMessage(
  reason: string,
  _details?: unknown
): string {
  switch (reason) {
    case "source_db_drift":
      return "Source file changed outside this view. Reload and try again.";
    case "concurrent_source_changed":
    case "concurrent_edit_superseded":
      return "Changed while you worked. Reload and try again.";
    case "already_formalized":
    case "already_candidate":
      return "Already up to date. Reload to refresh.";
    case "gap_entry_not_approvable":
      return "Gaps can't be switched — the agent fills them first.";
    case "not_found":
    case "entry_not_in_source_file":
      return "Entry no longer exists. Reload to refresh.";
    default:
      return "Couldn't update. Try again.";
  }
}

/**
 * Optimistic direct status switch: returns a new view with the matching
 * entry's status replaced. On failure the caller applies
 * the same helper with the previous status to revert; on success the SSE
 * design-system event refetches the authoritative view anyway.
 */
export function withEntryStatus(
  view: DesignSystemView,
  sourceArtifactPath: string,
  entryId: string,
  status: DsStatus
): DesignSystemView {
  const patch = (entry: DesignSystemEntryView): DesignSystemEntryView =>
    entry.source_artifact_path === sourceArtifactPath &&
    entry.entry_id === entryId
      ? { ...entry, status }
      : entry;
  const patchList = (entries: DesignSystemEntryView[]) => entries.map(patch);
  return {
    ...view,
    foundations: {
      visualLanguage: view.foundations.visualLanguage
        ? patch(view.foundations.visualLanguage)
        : null,
      concepts: patchList(view.foundations.concepts)
    },
    tokens: {
      primitive: patchList(view.tokens.primitive),
      semantic: patchList(view.tokens.semantic),
      component: patchList(view.tokens.component)
    },
    layout: patchList(view.layout),
    interaction: patchList(view.interaction),
    components: {
      inventory: patchList(view.components.inventory),
      specs: patchList(view.components.specs)
    }
  };
}
