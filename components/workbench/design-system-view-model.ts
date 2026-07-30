// Design System Browser view model (Issue 09A, Task E).
//
// Pure mapping from the GET /api/design-system view payload (DB-backed, see
// lib/runtime/design-system-view.ts) into the Section Tabs navigation model
// the bottom sheet renders — plus the small pure state machines that unit
// tests pin: sheet open/close, Esc isolation from the tldraw canvas, and the
// candidate → formalized approval UI states.
//
// Locked decisions honored here:
//   - d.6 rows carry name / value / meaning / status chip only; the full
//     evidence chain stays nested on the entry for the ⓘ layer.
//   - d.7 no section collapsing — leaves are flat under their tab.
//   - d.9 the entry button appears only after the six-part alignment is
//     completed (canOpenDesignSystemBrowser is the single predicate).
//   - token.json's 3 layers project onto Color / Typography / Materials
//     leaves; alias references render as "→ layer.name".

import { specPathMatchesSourceArtifact } from "@/lib/runtime/design-system-spec-path";
import type {
  DesignSystemEntryView,
  DesignSystemView
} from "@/lib/runtime/design-system-view";
import type { DesignIntentAlignmentSnapshot } from "@/lib/runtime/design-intent-alignment";

export type {
  DesignSystemEntryView,
  DesignSystemEntryEvidence,
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
 * Same signal AlignmentStagePanel's complete tray reports as "Completed".
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
  // Narrative payloads (principle statements, visual language descriptions)
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
    meaning: entry.meaning,
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
  /** Non-empty layer groups, primitive → semantic → component. */
  groups: { layer: TokenLayerKey; rows: DsRow[] }[];
  chips: string[];
}

const TOKEN_LEAF_NAMES: Record<TokenLeafId, string> = {
  color: "Color",
  typography: "Typography",
  materials: "Materials"
};

/* ---------------------------- component mapping ---------------------------- */

export interface DsComponentProp {
  name: string;
  type: string;
  /** Optional extra columns carried verbatim when the source declares them. */
  required?: boolean;
  description?: string;
}

export interface DsComponentDetail {
  description: string;
  props: DsComponentProp[];
  boundaries: string[];
  /** State matrix rows: { state, ...behavior } verbatim from the spec. */
  stateMatrix: Record<string, unknown>[];
}

export interface DsComponentModel {
  leafId: ComponentLeafId;
  entryId: string;
  name: string;
  inventory: DesignSystemEntryView | null;
  spec: DesignSystemEntryView | null;
  detail: DsComponentDetail | null;
  chips: string[];
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
        name: raw.name,
        type: raw.type,
        ...(typeof raw.required === "boolean" ? { required: raw.required } : {}),
        ...(typeof raw.description === "string"
          ? { description: raw.description }
          : {})
      });
    }
  }
  return {
    description:
      typeof value.description === "string" ? value.description : "",
    props,
    boundaries: Array.isArray(value.boundaries)
      ? value.boundaries.filter((b): b is string => typeof b === "string")
      : [],
    stateMatrix: Array.isArray(value.stateMatrix)
      ? value.stateMatrix.filter(isPlainObject)
      : []
  };
}

/* ------------------------------ whole model ------------------------------ */

export interface DsBrowserModel {
  name: string;
  /** Alignment done but nothing ingested yet — the sheet renders honestly. */
  empty: boolean;
  foundations: {
    chips: string[];
    /** Foundations Home: principle rule cards + visual language narrative. */
    principles: DsRow[];
    visualLanguage: { description: string; row: DsRow } | null;
    tokenLeaves: DsTokenLeafModel[];
    layout: { rows: DsRow[]; chips: string[] };
    interaction: { rows: DsRow[]; chips: string[] };
  };
  components: {
    chips: string[];
    list: DsComponentModel[];
  };
}

export function buildDesignSystemBrowserModel(
  view: DesignSystemView
): DsBrowserModel {
  const principles = view.foundations.principles.map(toRow);
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
  const tokenLeafIds: TokenLeafId[] = ["color", "typography", "materials"];
  const byLeafLayer = new Map<TokenLeafId, Map<TokenLayerKey, DsRow[]>>(
    tokenLeafIds.map((id) => [id, new Map()])
  );
  for (const layer of TOKEN_LAYER_ORDER) {
    for (const entry of view.tokens[layer]) {
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
      groups,
      chips: statusChips(groups.flatMap((group) => group.rows))
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
      const name = entryDisplayName(entry);
      return {
        leafId: `component:${entry.entry_id}`,
        entryId: entry.entry_id,
        name,
        inventory: entry,
        spec,
        detail: parseComponentDetail(spec),
        chips: statusChips(spec ? [entry, spec] : [entry])
      };
    }
  );
  for (const spec of view.components.specs) {
    if (usedSpecs.has(spec.entry_id)) continue;
    components.push({
      leafId: `component:${spec.entry_id}`,
      entryId: spec.entry_id,
      name: entryDisplayName(spec),
      inventory: null,
      spec,
      detail: parseComponentDetail(spec),
      chips: statusChips([spec])
    });
  }

  const foundationsRows = [
    ...principles,
    ...(visualLanguage ? [visualLanguage.row] : []),
    ...tokenLeaves.flatMap((leaf) =>
      leaf.groups.flatMap((group) => group.rows)
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
      principles,
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
      list: components
    }
  };
}

export const DS_SECTION_NAMES: Record<DsSectionId, string> = {
  foundations: "Foundations",
  components: "Components"
};

export function componentLeafId(leaf: DsLeafId): string | null {
  return leaf.startsWith("component:") ? leaf.slice("component:".length) : null;
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

/** Typed approval failure → readable reason shown in place (never toast-only). */
export function approvalErrorMessage(
  reason: string,
  details?: unknown
): string {
  switch (reason) {
    case "formalized_requires_designer_edited_link":
      return "Needs a designer-edited answered card before it can be formalized.";
    case "already_formalized":
      return "Already formalized — refresh to see the latest state.";
    case "not_found":
      return "Entry no longer exists — the design system was re-ingested.";
    case "gap_entry_not_approvable":
      return "Open gaps must be filled by the agent, not approved.";
    case "entry_not_in_source_file":
      return "Entry is missing from its source file — reload the browser.";
    case "artifact_path_escape":
      return "Source artifact path is outside the project.";
    case "artifact_file_missing":
      return "Source artifact file is missing on disk.";
    case "invalid_design_system_json":
      return "Source file no longer passes the design-system schema.";
    case "db_error":
      return "Runtime database error — try again.";
    default: {
      const detailLinks =
        isPlainObject(details) && Array.isArray(details.links)
          ? ` (links: ${(details.links as unknown[]).join(", ")})`
          : "";
      return `${reason}${detailLinks}`;
    }
  }
}

/**
 * Optimistic status flip for the approval flow: returns a new view with the
 * matching entry's status replaced. On approval failure the caller applies
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
      principles: patchList(view.foundations.principles)
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
