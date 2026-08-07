// Design-system DB ingest (Issue 09 / 09A, Task C).
//
// After a design-system source artifact passes declaration validation, its
// content is ingested into `design_system_entries` in the SAME transaction —
// the DB becomes the Runtime truth the Browser reads (09A decision 2), while
// the JSON sources stay the authoring layer Task D writes back to.
//
// 09A decision 4 hard gate: every entry's declared status is cross-validated
// against answered question cards / Agent annotations at ingest time and ANY
// failure rejects the whole declaration as-is (typed reason + details). The
// prepare phase runs before any write, so a rejected ingest persists no
// index row, no entries and no events.
//
// Ingest is replace-by-source: a re-declared file's rows are deleted and
// re-inserted in one transaction (never hand-merged), so removed entries
// disappear and ordering follows the latest file. The reserved `alias` key
// inside token values (see ./design-system-schema) is persisted verbatim —
// projections downstream treat it as an alias reference, never as content.

import { randomUUID } from "node:crypto";
import type { DatabaseSync as DatabaseType } from "node:sqlite";
import { logEventOnDb } from "./events";
import {
  collectStatusEntries,
  TOKEN_LAYERS,
  type DesignSystemFileKind,
  type DesignSystemEntryKind,
  type DesignSystemSchemaReason,
  type DesignSystemStatus,
  type TokenDomain
} from "./design-system-schema";
import {
  checkDesignSystemEntryStatus,
  loadDesignSystemLinkIndex,
  type DesignSystemStatusCheckReason
} from "./design-system-status";
import { collectDesignSystemEntryContentDigests } from "./design-system-entry-provenance";

// ---------------------------------------------------------------------------
// Section taxonomy — the single owner of the DB section values and how they
// bucket into the Browser view model (design-system-view.ts derives both its
// projection and the derived-export walk from DESIGN_SYSTEM_BUCKETS; adding
// a section is ONE edit here).
// ---------------------------------------------------------------------------

export const DESIGN_SYSTEM_SECTIONS = [
  "foundations.visual-language",
  "foundations.principles",
  "token.primitive",
  "token.semantic",
  "token.component",
  "layout",
  "interaction",
  "components.inventory",
  "components.spec"
] as const;

export type DesignSystemSection = (typeof DESIGN_SYSTEM_SECTIONS)[number];

/** Top-level group keys of the Browser view model. */
export type DesignSystemViewGroup =
  | "foundations"
  | "tokens"
  | "layout"
  | "interaction"
  | "components";

export interface DesignSystemBucket {
  section: DesignSystemSection;
  /** Top-level view group; flat groups (layout/interaction) are plain arrays. */
  group: DesignSystemViewGroup;
  /** Key inside a structured group; null for flat array groups. */
  key:
    | "visualLanguage"
    | "principles"
    | "primitive"
    | "semantic"
    | "component"
    | "inventory"
    | "specs"
    | null;
  /** "one" holds a single entry (visual language); "many" holds a list. */
  cardinality: "one" | "many";
}

export const DESIGN_SYSTEM_BUCKETS: readonly DesignSystemBucket[] = [
  {
    section: "foundations.visual-language",
    group: "foundations",
    key: "visualLanguage",
    cardinality: "one"
  },
  {
    section: "foundations.principles",
    group: "foundations",
    key: "principles",
    cardinality: "many"
  },
  {
    section: "token.primitive",
    group: "tokens",
    key: "primitive",
    cardinality: "many"
  },
  {
    section: "token.semantic",
    group: "tokens",
    key: "semantic",
    cardinality: "many"
  },
  {
    section: "token.component",
    group: "tokens",
    key: "component",
    cardinality: "many"
  },
  { section: "layout", group: "layout", key: null, cardinality: "many" },
  {
    section: "interaction",
    group: "interaction",
    key: null,
    cardinality: "many"
  },
  {
    section: "components.inventory",
    group: "components",
    key: "inventory",
    cardinality: "many"
  },
  {
    section: "components.spec",
    group: "components",
    key: "specs",
    cardinality: "many"
  }
];

export interface DesignSystemEntryRowInput {
  /** Entry identity within the source file (layer-qualified for tokens). */
  entry_id: string;
  section: DesignSystemSection;
  name: string | null;
  /** Explicit foundation content model; null preserves legacy entries. */
  kind: DesignSystemEntryKind | null;
  /** Explicit token taxonomy; null for legacy tokens and non-token entries. */
  domain: TokenDomain | null;
  value: unknown;
  source_captures: unknown[];
  meaning: string;
  status: DesignSystemStatus;
  links: string[];
  /** Source-file order inside the section (display order). */
  position: number;
}

type RawEntry = {
  id?: string;
  kind?: DesignSystemEntryKind;
  domain?: TokenDomain;
  value: unknown;
  sourceCaptures?: unknown[];
  meaning?: string;
  status: DesignSystemStatus;
  links: string[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Read an entry's source captures from storage. The source_captures column
 * is canonical; the value.sourceCaptures fallback only serves rows ingested
 * before value_json was stripped of that key (see stripSourceCaptures).
 */
export function resolveEntrySourceCaptures(
  sourceCapturesJson: string | null,
  value: unknown
): unknown[] {
  const stored =
    typeof sourceCapturesJson === "string"
      ? (JSON.parse(sourceCapturesJson) as unknown)
      : null;
  if (Array.isArray(stored) && stored.length > 0) return stored;
  if (isPlainObject(value) && "sourceCaptures" in value) {
    const legacy = value.sourceCaptures;
    return Array.isArray(legacy) ? legacy : [legacy];
  }
  return [];
}

/** Captures live ONLY in the source_captures column (single storage).
 * Component specs carry them inside value.sourceCaptures in the source file;
 * strip the key from the stored value so value_json can never diverge from
 * the column. */
export function stripSourceCaptures(
  value: Record<string, unknown>
): Record<string, unknown> {
  const { sourceCaptures: _stripped, ...rest } = value;
  return rest;
}

/**
 * Flatten a schema-validated file into ingest rows. Mirrors the shapes owned
 * by ./design-system-schema; callers must have run validateDesignSystemJson
 * first (declaration + ingest both do).
 */
export function collectDesignSystemEntryRows(
  fileKind: DesignSystemFileKind,
  json: unknown
): DesignSystemEntryRowInput[] {
  const root = json as Record<string, unknown>;
  const row = (
    raw: unknown,
    section: DesignSystemSection,
    entryId: string,
    name: string | null,
    position: number,
    domain: TokenDomain | null = null
  ): DesignSystemEntryRowInput => {
    const entry = raw as RawEntry;
    // The resolveEntrySourceCaptures value fallback stays for rows ingested
    // before the strip rule.
    const value =
      isPlainObject(entry.value) && "sourceCaptures" in entry.value
        ? stripSourceCaptures(entry.value)
        : entry.value;
    return {
      entry_id: entryId,
      section,
      name,
      kind: entry.kind ?? null,
      domain,
      value,
      source_captures: Array.isArray(entry.sourceCaptures)
        ? entry.sourceCaptures
        : isPlainObject(entry.value) && Array.isArray(entry.value.sourceCaptures)
          ? entry.value.sourceCaptures
          : [],
      meaning: entry.meaning ?? "",
      status: entry.status,
      links: entry.links,
      position
    };
  };

  switch (fileKind) {
    case "design-system.json": {
      const visual = root.visualLanguage as RawEntry;
      const principles = root.principles as unknown[];
      return [
        row(visual, "foundations.visual-language", visual.id!, null, 0),
        ...principles.map((p, i) =>
          row(p, "foundations.principles", (p as RawEntry).id!, null, i)
        )
      ];
    }
    case "token.json": {
      const out: DesignSystemEntryRowInput[] = [];
      for (const layer of TOKEN_LAYERS) {
        const entries = root[layer] as Record<string, unknown>;
        let position = 0;
        for (const [name, raw] of Object.entries(entries)) {
          out.push(
            row(
              raw,
              `token.${layer}`,
              `${layer}.${name}`,
              name,
              position++,
              (raw as RawEntry).domain ?? null
            )
          );
        }
      }
      return out;
    }
    case "component-list.json":
      return (root.components as unknown[]).map((c, i) => {
        const entry = c as RawEntry & { value: { name: string } };
        return row(c, "components.inventory", entry.id!, entry.value.name, i);
      });
    case "component-spec": {
      const entry = root as RawEntry & { name: string };
      return [row(root, "components.spec", entry.id!, entry.name, 0)];
    }
    case "layout-rules.json":
      return (root.rules as unknown[]).map((r, i) =>
        row(r, "layout", (r as RawEntry).id!, null, i)
      );
    case "interaction-rules.json":
      return (root.rules as unknown[]).map((r, i) =>
        row(r, "interaction", (r as RawEntry).id!, null, i)
      );
  }
}

// ---------------------------------------------------------------------------
// Prepare / apply — split so declaration writes (index row + declared event)
// land between the cross-validation gate and the ingest writes, while any
// failure still happens before the transaction has written anything.
// ---------------------------------------------------------------------------

export type DesignSystemIngestReason =
  | DesignSystemSchemaReason
  | DesignSystemStatusCheckReason
  | string;

export type DesignSystemIngestFailure = {
  ok: false;
  reason: DesignSystemIngestReason;
  details?: unknown;
};

export interface DesignSystemIngestPlan {
  fileKind: DesignSystemFileKind;
  sourcePath: string;
  rows: DesignSystemEntryRowInput[];
  /** The project had no ingested design-system content before this file. */
  firstIngest: boolean;
  /** design-system.json file-level system name (meta singleton), else null. */
  systemName: string | null;
  now: string;
}

export type DesignSystemIngestPrepareResult =
  | { ok: true; plan: DesignSystemIngestPlan }
  | DesignSystemIngestFailure;

/**
 * Validate-and-stage phase: builds rows and cross-checks every entry status
 * against the pre-fetched link index (loaded once per file). Pure reads on
 * `db` — nothing is written here.
 */
export function prepareDesignSystemIngestOnDb(
  db: DatabaseType,
  args: {
    fileKind: DesignSystemFileKind;
    json: Record<string, unknown>;
    sourcePath: string;
    now: string;
  }
): DesignSystemIngestPrepareResult {
  const rows = collectDesignSystemEntryRows(args.fileKind, args.json);

  // Global entry-id uniqueness inside design-system.json: visualLanguage and
  // principles share one id space (09A — Task B acceptance deferred nit).
  if (args.fileKind === "design-system.json") {
    const seen = new Map<string, DesignSystemSection>();
    for (const r of rows) {
      const prior = seen.get(r.entry_id);
      if (prior !== undefined) {
        return {
          ok: false,
          reason: "duplicate_entry_id",
          details: { entry_id: r.entry_id, sections: [prior, r.section] }
        };
      }
      seen.set(r.entry_id, r.section);
    }
  }

  const statusEntries = collectStatusEntries(args.fileKind, args.json);
  const contentDigests = collectDesignSystemEntryContentDigests(
    args.fileKind,
    args.json
  );
  const index = loadDesignSystemLinkIndex(db);
  for (const entry of statusEntries) {
    const check = checkDesignSystemEntryStatus(
      {
        ...entry,
        sourceArtifactPath: args.sourcePath,
        entryId: entry.id,
        contentDigest: contentDigests.get(entry.id)
      },
      index
    );
    if (!check.ok) {
      const detailObj =
        check.details !== null &&
        typeof check.details === "object" &&
        !Array.isArray(check.details)
          ? (check.details as Record<string, unknown>)
          : { links: entry.links };
      return {
        ok: false,
        reason: check.reason,
        details: { entry_id: entry.id, ...detailObj }
      };
    }
  }

  const existing = db
    .prepare("SELECT COUNT(*) AS count FROM design_system_entries")
    .get() as { count: number };
  const systemName =
    args.fileKind === "design-system.json"
      ? (args.json.name as string)
      : null;

  return {
    ok: true,
    plan: {
      fileKind: args.fileKind,
      sourcePath: args.sourcePath,
      rows,
      firstIngest: existing.count === 0,
      systemName,
      now: args.now
    }
  };
}

/**
 * Write phase: replace-by-source + meta + audit events. Runs on the
 * declaration transaction's connection AFTER the index row and the
 * `source_artifact_declared` event, so a crash never leaves entries without
 * their declaration.
 *
 * Event semantics (append-only):
 *   - `draft_design_system_generated`: exactly once per project — the first
 *     ingest that puts content into design_system_entries (the draft design
 *     system now exists as Runtime truth).
 *   - `design_system_view_generated`: every successful design-system ingest —
 *     the DB view (and the regenerated derived export) now reflects this
 *     source file.
 */
export function applyDesignSystemIngestOnDb(
  db: DatabaseType,
  plan: DesignSystemIngestPlan
): void {
  db.prepare(
    "DELETE FROM design_system_entries WHERE source_artifact_path = ?"
  ).run(plan.sourcePath);

  const insert = db.prepare(
    `INSERT INTO design_system_entries (
      id, file_kind, section, entry_id, name, kind, domain, value_json,
      source_captures_json, meaning, status, links_json, source_artifact_path,
      position, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const row of plan.rows) {
    insert.run(
      randomUUID(),
      plan.fileKind,
      row.section,
      row.entry_id,
      row.name,
      row.kind,
      row.domain,
      JSON.stringify(row.value),
      JSON.stringify(row.source_captures),
      row.meaning,
      row.status,
      JSON.stringify(row.links),
      plan.sourcePath,
      row.position,
      plan.now,
      plan.now
    );
  }

  if (plan.systemName !== null) {
    db.prepare(
      "UPDATE design_system_meta SET name = ?, updated_at = ? WHERE singleton = 1"
    ).run(plan.systemName, plan.now);
  }

  const contentAppears = plan.firstIngest && plan.rows.length > 0;
  if (contentAppears) {
    logEventOnDb(db, "draft_design_system_generated", {
      source_artifact_path: plan.sourcePath,
      file_kind: plan.fileKind,
      entry_count: plan.rows.length
    });
  }
  logEventOnDb(db, "design_system_view_generated", {
    source_artifact_path: plan.sourcePath,
    file_kind: plan.fileKind,
    entry_count: plan.rows.length,
    first_ingest: contentAppears
  });
}
