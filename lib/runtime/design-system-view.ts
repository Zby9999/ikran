// Design-system Browser read model + derived export (Issue 09 / 09A, Task C).
//
// The DB is the Runtime truth (09A decision 2): this module builds the
// Browser view model from `design_system_entries` with the evidence chain
// joined in real time (09A decisions 6 + 8 — the chain is nested per entry
// for the ⓘ hover layer, never pre-baked into a view file and never
// flattened into rows):
//   - linked answered question cards (question + final_answer + answer_source)
//   - linked Agent annotations (title / body / inference)
//   - the evidence versions those records' anchors reference
//   - Designer Annotations on those evidence versions — read via the 08A
//     alignment snapshot surface `designer_annotations`
//     (getDesignIntentAlignment), never via list_region_annotations filtering
//
// `design-system-view.json` under `.ikran/artifacts/` is a DERIVED export
// regenerated from the DB after each successful ingest and after a lazy
// file→DB sync re-ingests — research export / external consumption only.
// The Browser must never read it.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { openProjectDb, closeProjectDb } from "./db";
import { logInvalidToolEvent } from "./events";
import { getArtifactsDir } from "./paths";
import {
  getDesignIntentAlignment,
  targetsFromAnchor
} from "./design-intent-alignment";
import {
  isCaptureNodeRectBounds
} from "./design-system-schema";
import type {
  DesignSystemEntryKind,
  DesignSystemFileKind,
  DesignSystemStatus,
  TokenDomain
} from "./design-system-schema";
import {
  DESIGN_SYSTEM_BUCKETS,
  resolveEntrySourceCaptures,
  type DesignSystemBucket,
  type DesignSystemSection
} from "./design-system-ingest";
import {
  syncDesignSystemSources,
  type DesignSystemSyncResult,
  type DesignSystemSyncWarning
} from "./design-system-sync";

// ---------------------------------------------------------------------------
// View model shapes
// ---------------------------------------------------------------------------

export interface DesignSystemEvidenceCard {
  id: string;
  section: string;
  question: string;
  final_answer: string;
  answer_source: string | null;
}

export interface DesignSystemEvidenceAnnotation {
  id: string;
  title: string;
  body: string;
  inference: string;
}

export interface DesignSystemEvidenceVersion {
  id: string;
  frame_node_id: string;
  frame_name: string;
  created_at: string;
}

export interface DesignSystemEvidenceDesignerAnnotation {
  id: string;
  body: string;
  section: string | null;
  evidence_version_id: string;
  node_id: string | null;
  created_at: string;
}

export interface DesignSystemEvidenceEdit {
  id: string;
  field: string;
  before: string;
  after: string;
  created_at: string;
}

/** Evidence chain for one entry — nested for the ⓘ hover layer (09A d.6). */
export interface DesignSystemEntryEvidence {
  question_cards: DesignSystemEvidenceCard[];
  annotations: DesignSystemEvidenceAnnotation[];
  evidence_versions: DesignSystemEvidenceVersion[];
  designer_annotations: DesignSystemEvidenceDesignerAnnotation[];
  edit_history?: DesignSystemEvidenceEdit[];
  /** Links that resolve to no answered card / annotation (surfaced, not hidden). */
  unresolved_links: string[];
}

/** The node's position inside the capture image (0–1 fractions of the
 * image), declared by the Agent from Figma node bounds. Drives the v2
 * orientation pick and the hairline position mark; null when undeclared or
 * malformed in a legacy row. */
export interface LayoutCaptureNodeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One Figma node screenshot backing a layout rule (09C-D02) or a component
 * spec (09C-D03 hero). The Agent captures the node via Figma MCP, stores the
 * image as a project artifact, and records the provenance in the entry's
 * `value.sourceCaptures`; the view layers the freshness verdict (`stale`)
 * on top from evidence lineage. */
export interface DesignSystemLayoutCapture {
  nodeId: string | null;
  nodeName: string;
  /** Project-relative image path, served via /api/artifacts. */
  artifactPath: string;
  capturedAt: string;
  surfaceId: string | null;
  /** True when the linked surface was superseded or no longer exists —
   * the capture may not match the current source anymore. */
  stale: boolean;
  nodeRect: LayoutCaptureNodeRect | null;
}

export interface DesignSystemEntryView {
  /**
   * DB row id (uuid) — volatile across re-ingests (replace-by-source deletes
   * and re-inserts rows). The stable entry identity Task D's write-back keys
   * on is (source_artifact_path, entry_id) — the table's unique index.
   */
  id: string;
  /** Entry identity within the source file (layer-qualified for tokens). */
  entry_id: string;
  file_kind: DesignSystemFileKind;
  section: DesignSystemSection;
  name: string | null;
  /** Explicit source content model; null/omitted only for legacy entries. */
  kind?: DesignSystemEntryKind | null;
  /** Explicit source taxonomy; null/omitted only for legacy token rows. */
  domain?: TokenDomain | null;
  /** Structured payload verbatim from the source (token values may be alias objects). */
  value: unknown;
  /** Reserved token alias target ("layer.name") when `value` is an alias object. */
  alias: string | null;
  /** Rule/component-inventory title. Empty for token entries and component specs. */
  meaning: string;
  status: DesignSystemStatus;
  links: string[];
  source_artifact_path: string;
  evidence: DesignSystemEntryEvidence;
  /** Layout rules and component specs only: parsed `sourceCaptures` with the
   * freshness verdict joined from evidence lineage (09C-D02 layout rules;
   * 09C-D03 component spec hero). Undefined for other sections and for
   * entries that declare no captures. */
  captures?: DesignSystemLayoutCapture[];
}

export interface DesignSystemView {
  generated_at: string;
  /** System name from design-system.json ("" before any meta ingest). */
  name: string;
  foundations: {
    visualLanguage: DesignSystemEntryView | null;
    principles: DesignSystemEntryView[];
  };
  tokens: {
    primitive: DesignSystemEntryView[];
    semantic: DesignSystemEntryView[];
    component: DesignSystemEntryView[];
  };
  layout: DesignSystemEntryView[];
  interaction: DesignSystemEntryView[];
  components: {
    inventory: DesignSystemEntryView[];
    specs: DesignSystemEntryView[];
  };
  /** Files that failed lazy file→DB sync this read — the view is serving
   * their last-good DB rows. Absent when everything synced cleanly. */
  sync_warnings?: DesignSystemSyncWarning[];
}

export type DesignSystemViewResult =
  | { ok: true; view: DesignSystemView }
  | { ok: false; reason: "db_error" | string };

// ---------------------------------------------------------------------------
// Evidence-chain join (real time, per entry)
// ---------------------------------------------------------------------------

type EntryRow = {
  id: string;
  file_kind: string;
  section: string;
  entry_id: string;
  name: string | null;
  kind: string | null;
  domain: string | null;
  value_json: string;
  source_captures_json: string;
  meaning: string;
  status: string;
  links_json: string;
  source_artifact_path: string;
  position: number;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Reserved `alias` key projection. Token aliases may additionally carry the
 * schema-approved usage / usedFor metadata inside value. */
function aliasOf(value: unknown): string | null {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value);
  if (
    !keys.includes("alias") ||
    keys.some((key) => !["alias", "usage", "usedFor"].includes(key))
  ) {
    return null;
  }
  return typeof value.alias === "string" ? value.alias : null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Defensive nodeRect read: declaration schema enforces the shape, but a
 * legacy or hand-edited DB row may carry anything — degrade to null. */
function nodeRectOfItem(item: Record<string, unknown>): LayoutCaptureNodeRect | null {
  const rect = item.nodeRect;
  if (!isPlainObject(rect)) return null;
  const { x, y, width, height } = rect;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    !isCaptureNodeRectBounds(x, y, width, height)
  ) {
    return null;
  }
  return { x, y, width, height };
}

/** Parse an entry's structured source captures into view captures.
 * Ingest schema already enforces the item shape; the view still guards item
 * by item so a hand-edited legacy row degrades to "no captures" instead of
 * breaking the whole view. */
function capturesOfRaw(
  raw: unknown,
  staleOf: (surfaceId: string) => boolean
): DesignSystemLayoutCapture[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const captures: DesignSystemLayoutCapture[] = [];
  for (const item of raw) {
    if (!isPlainObject(item)) continue;
    if (
      !nonEmptyString(item.nodeName) ||
      !nonEmptyString(item.artifactPath) ||
      !nonEmptyString(item.capturedAt)
    ) {
      continue;
    }
    const surfaceId = nonEmptyString(item.surfaceId) ? item.surfaceId : null;
    captures.push({
      nodeId: nonEmptyString(item.nodeId) ? item.nodeId : null,
      nodeName: item.nodeName,
      artifactPath: item.artifactPath,
      capturedAt: item.capturedAt,
      surfaceId,
      stale: surfaceId !== null ? staleOf(surfaceId) : false,
      nodeRect: nodeRectOfItem(item)
    });
  }
  return captures.length > 0 ? captures : undefined;
}

/** evidenceVersionIds referenced by a stored alignment anchor (anchor_json).
 * Shape knowledge lives in ./design-intent-alignment's targetsFromAnchor. */
function anchorEvidenceVersionIds(anchorJson: unknown): string[] {
  if (typeof anchorJson !== "string") return [];
  let anchor: unknown;
  try {
    anchor = JSON.parse(anchorJson);
  } catch {
    return [];
  }
  const parsed = targetsFromAnchor(anchor);
  if (!parsed.ok) return [];
  const ids: string[] = [];
  for (const target of parsed.targets) {
    const id = target.evidenceVersionId;
    if (typeof id === "string" && id.trim().length > 0) ids.push(id);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Bucket-driven view assembly — the taxonomy lives in ./design-system-ingest
// (DESIGN_SYSTEM_BUCKETS); this module never re-enumerates sections.
// ---------------------------------------------------------------------------

const BUCKET_BY_SECTION = new Map<DesignSystemSection, DesignSystemBucket>(
  DESIGN_SYSTEM_BUCKETS.map((bucket) => [bucket.section, bucket])
);

function emptyViewGroups(name: string): DesignSystemView {
  const view: Record<string, unknown> = {
    generated_at: new Date().toISOString(),
    name
  };
  for (const bucket of DESIGN_SYSTEM_BUCKETS) {
    if (!(bucket.group in view)) {
      view[bucket.group] = bucket.key === null ? [] : {};
    }
    if (bucket.key !== null) {
      (view[bucket.group] as Record<string, unknown>)[bucket.key] =
        bucket.cardinality === "one" ? null : [];
    }
  }
  return view as unknown as DesignSystemView;
}

function assignEntryToView(
  view: DesignSystemView,
  bucket: DesignSystemBucket,
  entry: DesignSystemEntryView
): void {
  if (bucket.key === null) {
    (view[bucket.group] as unknown as DesignSystemEntryView[]).push(entry);
    return;
  }
  const group = view[bucket.group] as unknown as Record<string, unknown>;
  if (bucket.cardinality === "one") {
    group[bucket.key] = entry;
  } else {
    (group[bucket.key] as DesignSystemEntryView[]).push(entry);
  }
}

/**
 * Build the Browser view model from the DB. Empty before the first ingest —
 * the Browser renders the empty state, never an error.
 */
export function getDesignSystemView(
  projectPath: string
): DesignSystemViewResult {
  // Converge file→DB first: undeclared Agent edits are re-ingested here so
  // the Browser never serves silently-stale rows. Failures downgrade to
  // warnings; the view below keeps serving last-good data regardless.
  const sync = syncDesignSystemSources(projectPath);
  return buildDesignSystemViewFromDb(projectPath, sync);
}

/**
 * View assembly from the DB rows (Runtime truth) once convergence is settled.
 * Split from getDesignSystemView so writeDesignSystemViewExport can build the
 * derived export WITHOUT running the lazy sync: approve/edit call the export
 * post-commit while another write-back flow may hold uncommitted whole-file
 * bytes on disk, and syncing at that moment would re-ingest those bytes into
 * the DB ahead of their transaction.
 */
function buildDesignSystemViewFromDb(
  projectPath: string,
  sync: DesignSystemSyncResult
): DesignSystemViewResult {
  let name = "";
  const pending: Array<{ view: DesignSystemEntryView; versionIds: string[] }> =
    [];

  const db = openProjectDb(projectPath);
  try {
    const meta = db
      .prepare("SELECT name FROM design_system_meta WHERE singleton = 1")
      .get() as { name: string } | undefined;
    name = meta?.name ?? "";

    const rows = db
      .prepare(
        `SELECT id, file_kind, section, entry_id, name, kind, domain, value_json,
                source_captures_json, meaning, status, links_json,
                source_artifact_path, position
         FROM design_system_entries
         ORDER BY section ASC, position ASC, entry_id ASC`
      )
      .all() as unknown as EntryRow[];

    const cardStmt = db.prepare(
      `SELECT id, section, question, final_answer, answer_source, anchor_json
       FROM alignment_question_cards WHERE id = ?`
    );
    const annotationStmt = db.prepare(
      `SELECT id, title, body, inference, anchor_json
       FROM agent_alignment_annotations WHERE id = ?`
    );
    const editStmt = db.prepare(
      `SELECT event_id, payload, created_at FROM events
       WHERE event_id = ? AND type = 'design_system_entry_edited'`
    );
    const versionStmt = db.prepare(
      `SELECT id, frame_node_id, frame_name, created_at
       FROM figma_evidence_surfaces WHERE id = ?`
    );
    // Capture freshness (09C-D02): a linked surface is stale once superseded
    // (lineage tip moved on) or when it no longer exists at all.
    const captureStaleStmt = db.prepare(
      `SELECT superseded_by FROM figma_evidence_surfaces WHERE id = ?`
    );
    const captureStaleOf = (surfaceId: string): boolean => {
      const surface = captureStaleStmt.get(surfaceId) as
        | { superseded_by: string | null }
        | undefined;
      return surface === undefined || surface.superseded_by !== null;
    };

    for (const row of rows) {
      const value = JSON.parse(row.value_json) as unknown;
      const sourceCaptures = resolveEntrySourceCaptures(
        row.source_captures_json,
        value
      );
      const links = JSON.parse(row.links_json) as string[];
      const evidence: DesignSystemEntryEvidence = {
        question_cards: [],
        annotations: [],
        evidence_versions: [],
        designer_annotations: [],
        edit_history: [],
        unresolved_links: []
      };
      const versionIds: string[] = [];

      for (const link of links) {
        const card = cardStmt.get(link) as
          | {
              id: string;
              section: string;
              question: string;
              final_answer: string | null;
              answer_source: string | null;
              anchor_json: string;
            }
          | undefined;
        const answered =
          typeof card?.final_answer === "string" &&
          card.final_answer.trim().length > 0;
        if (card && answered) {
          evidence.question_cards.push({
            id: card.id,
            section: card.section,
            question: card.question,
            final_answer: card.final_answer!,
            answer_source: card.answer_source
          });
          versionIds.push(...anchorEvidenceVersionIds(card.anchor_json));
          continue;
        }
        const annotation = annotationStmt.get(link) as
          | {
              id: string;
              title: string;
              body: string;
              inference: string;
              anchor_json: string;
            }
          | undefined;
        if (annotation) {
          evidence.annotations.push({
            id: annotation.id,
            title: annotation.title,
            body: annotation.body,
            inference: annotation.inference
          });
          versionIds.push(...anchorEvidenceVersionIds(annotation.anchor_json));
          continue;
        }
        const edit = editStmt.get(link) as
          | { event_id: string; payload: string; created_at: string }
          | undefined;
        if (edit) {
          let payload: Record<string, unknown> = {};
          try {
            payload = JSON.parse(edit.payload) as Record<string, unknown>;
          } catch {
            payload = {};
          }
          evidence.edit_history!.push({
            id: edit.event_id,
            field: typeof payload.field === "string" ? payload.field : "unknown",
            before: typeof payload.before === "string" ? payload.before : "",
            after: typeof payload.after === "string" ? payload.after : "",
            created_at: edit.created_at
          });
          continue;
        }
        evidence.unresolved_links.push(link);
      }

      for (const versionId of [...new Set(versionIds)]) {
        const version = versionStmt.get(versionId) as
          | {
              id: string;
              frame_node_id: string;
              frame_name: string;
              created_at: string;
            }
          | undefined;
        if (version) {
          evidence.evidence_versions.push({
            id: version.id,
            frame_node_id: version.frame_node_id,
            frame_name: version.frame_name,
            created_at: version.created_at
          });
        }
      }

      pending.push({
        view: {
          id: row.id,
          entry_id: row.entry_id,
          file_kind: row.file_kind as DesignSystemFileKind,
          section: row.section as DesignSystemSection,
          name: row.name,
          kind: row.kind as DesignSystemEntryKind | null,
          domain: row.domain as TokenDomain | null,
          value,
          alias: aliasOf(value),
          meaning: row.meaning,
          status: row.status as DesignSystemStatus,
          links,
          source_artifact_path: row.source_artifact_path,
          evidence,
          ...(row.section === "layout" || row.section === "components.spec"
            ? {
                captures: capturesOfRaw(
                  sourceCaptures,
                  captureStaleOf
                )
              }
            : {})
        },
        versionIds: [...new Set(versionIds)]
      });
    }
  } catch {
    return { ok: false, reason: "db_error" };
  } finally {
    closeProjectDb(db);
  }

  // Designer Annotations join via the 08A alignment snapshot surface — the
  // semantic read channel, never a direct region_annotations filter.
  let designerByVersion: Map<
    string,
    DesignSystemEvidenceDesignerAnnotation[]
  >;
  try {
    const snapshot = getDesignIntentAlignment(projectPath);
    designerByVersion = new Map();
    for (const da of snapshot.designer_annotations) {
      const list = designerByVersion.get(da.target_evidence_version_id) ?? [];
      list.push({
        id: da.id,
        body: da.body,
        section: da.section,
        evidence_version_id: da.target_evidence_version_id,
        node_id: da.target_node_id,
        created_at: da.created_at
      });
      designerByVersion.set(da.target_evidence_version_id, list);
    }
  } catch {
    return { ok: false, reason: "db_error" };
  }

  for (const entry of pending) {
    const seen = new Set<string>();
    for (const versionId of entry.versionIds) {
      for (const da of designerByVersion.get(versionId) ?? []) {
        if (seen.has(da.id)) continue;
        seen.add(da.id);
        entry.view.evidence.designer_annotations.push(da);
      }
    }
  }

  const view = emptyViewGroups(name);
  for (const { view: entry } of pending) {
    const bucket = BUCKET_BY_SECTION.get(entry.section);
    if (!bucket) continue;
    assignEntryToView(view, bucket, entry);
  }
  if (sync.reingested.length > 0) {
    // Lazy sync changed the DB, so the derived export is stale. Regenerate it
    // from the view just built — never via writeDesignSystemViewExport, which
    // would recurse through getDesignSystemView. Best-effort with the same
    // invalid_output audit convention as the ingest/approve/edit paths, and
    // deliberately NO design_system_view_generated event (that event means a
    // declared ingest; lazy sync is a convergence write).
    const exportResult = writeDesignSystemExportFile(
      projectPath,
      buildDesignSystemViewExport(view)
    );
    if (!exportResult.ok) {
      logInvalidToolEvent(
        projectPath,
        "invalid_output",
        "design_system_view_export",
        exportResult.reason
      );
    }
  }
  if (sync.warnings.length > 0) {
    view.sync_warnings = sync.warnings;
  }
  return { ok: true, view };
}

// ---------------------------------------------------------------------------
// Derived export — .ikran/artifacts/design-system-view.json
// ---------------------------------------------------------------------------

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeysDeep(value[key]);
    }
    return out;
  }
  return value;
}

/**
 * Deterministic JSON (sorted keys, 2-space indent). Task D's canonical
 * write-back serializer builds on the same ordering rule.
 */
export function stableJsonStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value), null, 2);
}

export type DesignSystemViewExportResult =
  | { ok: true; path: string }
  | { ok: false; reason: "db_error" | "write_failed" | string };

/**
 * Build the deterministic export payload from a view: volatile fields
 * (generated_at, sync_warnings, per-ingest row uuids) are stripped and the
 * bucket walk mirrors the view projection — no second section enumeration.
 */
function buildDesignSystemViewExport(
  view: DesignSystemView
): Record<string, unknown> {
  const {
    generated_at: _generatedAt,
    sync_warnings: _syncWarnings,
    ...content
  } = view;
  const stripRowId = (entry: DesignSystemEntryView) => {
    const { id: _id, ...rest } = entry;
    if (entry.section.startsWith("token.") && entry.kind !== "domain-rule") {
      const { meaning: _meaning, ...tokenEntry } = rest;
      return tokenEntry;
    }
    return rest;
  };
  const exportView: Record<string, unknown> = { name: content.name };
  for (const bucket of DESIGN_SYSTEM_BUCKETS) {
    if (!(bucket.group in exportView)) {
      exportView[bucket.group] = bucket.key === null ? [] : {};
    }
    const source = content[bucket.group] as unknown;
    if (bucket.key === null) {
      exportView[bucket.group] = (source as DesignSystemEntryView[]).map(
        stripRowId
      );
      continue;
    }
    const group = source as Record<string, unknown>;
    if (bucket.cardinality === "one") {
      const entry = group[bucket.key] as DesignSystemEntryView | null;
      (exportView[bucket.group] as Record<string, unknown>)[bucket.key] = entry
        ? stripRowId(entry)
        : null;
    } else {
      (exportView[bucket.group] as Record<string, unknown>)[bucket.key] = (
        group[bucket.key] as DesignSystemEntryView[]
      ).map(stripRowId);
    }
  }
  return exportView;
}

function writeDesignSystemExportFile(
  projectPath: string,
  exportView: Record<string, unknown>
): DesignSystemViewExportResult {
  const outPath = path.join(
    getArtifactsDir(projectPath),
    "design-system-view.json"
  );
  try {
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${stableJsonStringify(exportView)}\n`, "utf-8");
    return { ok: true, path: outPath };
  } catch {
    return { ok: false, reason: "write_failed" };
  }
}

/**
 * Regenerate the derived export from the DB (never from the source files).
 * Deterministic: identical content yields identical bytes, so exports do not
 * diff-noise. Deliberately skips the lazy file→DB sync: callers (ingest /
 * approve / edit) invoke this right after their own commit, possibly while a
 * concurrent write-back flow's uncommitted bytes are on disk — syncing here
 * would ingest those bytes ahead of their transaction.
 */
export function writeDesignSystemViewExport(
  projectPath: string
): DesignSystemViewExportResult {
  const result = buildDesignSystemViewFromDb(projectPath, {
    reingested: [],
    warnings: []
  });
  if (!result.ok) return { ok: false, reason: result.reason };
  return writeDesignSystemExportFile(
    projectPath,
    buildDesignSystemViewExport(result.view)
  );
}
