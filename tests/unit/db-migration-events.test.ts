// RED → GREEN: versioned SQLite migrations, backup, transactions, JSONL export,
// and atomic record+event writes (Task 3).

import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, expect } from "vitest";
import {
  openProjectDb,
  closeProjectDb,
  withProjectTransaction,
  CURRENT_SCHEMA_VERSION,
  getProjectDbBackupPath,
  backupProjectDbBeforeMigration
} from "../../lib/runtime/db";
import { getProjectDbPath, getProjectEventsPath } from "../../lib/runtime/paths";
import {
  logEvent,
  listEvents,
  exportEventsJsonl
} from "../../lib/runtime/events";
import { registerSeedReference } from "../../lib/runtime/seed-reference";
import { applyPendingMigrations } from "../../lib/runtime/migrations";

const VALID = "https://www.figma.com/design/AbCdEf/Checkout?node-id=1:2";
const INTENT = "checkout trust signals";

function withTempProject(fn: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), "ikran-mig-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Build a legacy (user_version=0) project DB with the retired tasks table. */
function seedLegacyV0Db(projectPath: string): string {
  const ikran = path.join(projectPath, ".ikran");
  mkdirSync(ikran, { recursive: true });
  const dbPath = getProjectDbPath(projectPath);
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      family TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      result_json TEXT,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE seed_references (
      id TEXT PRIMARY KEY,
      figma_seed_reference TEXT NOT NULL,
      original_design_intent TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE figma_evidence_surfaces (
      id TEXT PRIMARY KEY,
      seed_reference_id TEXT,
      figma_seed_reference TEXT NOT NULL,
      frame_node_id TEXT NOT NULL,
      frame_name TEXT NOT NULL,
      frame_bounds_json TEXT,
      evidence_views_json TEXT NOT NULL,
      screenshot_artifact_path TEXT,
      screenshot_data_url TEXT,
      design_signals_json TEXT,
      surface_bounds_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE region_annotations (
      id TEXT PRIMARY KEY,
      surface_id TEXT NULL,
      surface_artifact_id TEXT NULL,
      surface_node_id TEXT NULL,
      author TEXT NOT NULL,
      type TEXT NOT NULL,
      body TEXT NOT NULL,
      rect_x REAL NOT NULL,
      rect_y REAL NOT NULL,
      rect_w REAL NOT NULL,
      rect_h REAL NOT NULL,
      primary_node_id TEXT NULL,
      candidates_json TEXT NULL,
      created_at TEXT NOT NULL
    );
    INSERT INTO tasks (id, family, payload_json, status, created_at, updated_at)
    VALUES ('t1', 'legacy', '{}', 'done', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z');
    INSERT INTO seed_references (id, figma_seed_reference, original_design_intent, created_at)
    VALUES ('s1', '${VALID}', '${INTENT}', '2020-01-01T00:00:00.000Z');
    PRAGMA user_version = 0;
  `);
  db.close();
  return dbPath;
}

function tableNames(db: DatabaseSync): string[] {
  return (
    db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
      )
      .all() as Array<{ name: string }>
  ).map((r) => r.name);
}

function userVersion(db: DatabaseSync): number {
  return (db.prepare("PRAGMA user_version").get() as { user_version: number })
    .user_version;
}

/** Build a v1 project DB (pre–file_key/node_id) with optional seed rows. */
function seedV1Db(
  projectPath: string,
  seeds: Array<{
    id: string;
    figma_seed_reference: string;
    original_design_intent?: string;
  }> = []
): string {
  const ikran = path.join(projectPath, ".ikran");
  mkdirSync(ikran, { recursive: true });
  const dbPath = getProjectDbPath(projectPath);
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE seed_references (
      id TEXT PRIMARY KEY,
      figma_seed_reference TEXT NOT NULL,
      original_design_intent TEXT NOT NULL,
      created_at TEXT NOT NULL,
      registered_via TEXT NOT NULL DEFAULT 'agent'
    );
    CREATE TABLE figma_evidence_surfaces (
      id TEXT PRIMARY KEY,
      seed_reference_id TEXT,
      figma_seed_reference TEXT NOT NULL,
      frame_node_id TEXT NOT NULL,
      frame_name TEXT NOT NULL,
      frame_bounds_json TEXT,
      evidence_views_json TEXT NOT NULL,
      screenshot_artifact_path TEXT,
      screenshot_data_url TEXT,
      design_signals_json TEXT,
      surface_bounds_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE region_annotations (
      id TEXT PRIMARY KEY,
      surface_id TEXT NULL,
      surface_artifact_id TEXT NULL,
      surface_node_id TEXT NULL,
      author TEXT NOT NULL,
      type TEXT NOT NULL,
      body TEXT NOT NULL,
      rect_x REAL NOT NULL,
      rect_y REAL NOT NULL,
      rect_w REAL NOT NULL,
      rect_h REAL NOT NULL,
      primary_node_id TEXT NULL,
      candidates_json TEXT NULL,
      created_at TEXT NOT NULL
    );
    PRAGMA user_version = 1;
  `);
  const insert = db.prepare(
    `INSERT INTO seed_references
     (id, figma_seed_reference, original_design_intent, created_at, registered_via)
     VALUES (?, ?, ?, ?, 'agent')`
  );
  for (const seed of seeds) {
    insert.run(
      seed.id,
      seed.figma_seed_reference,
      seed.original_design_intent ?? INTENT,
      "2020-01-01T00:00:00.000Z"
    );
  }
  db.close();
  return dbPath;
}

function seedColumns(db: DatabaseSync): string[] {
  return (
    db.prepare("PRAGMA table_info(seed_references)").all() as Array<{
      name: string;
    }>
  ).map((c) => c.name);
}

function surfaceColumns(db: DatabaseSync): string[] {
  return (
    db.prepare("PRAGMA table_info(figma_evidence_surfaces)").all() as Array<{
      name: string;
    }>
  ).map((c) => c.name);
}

/** Build a v2 project DB (identity columns, nullable surface seed_reference_id). */
function seedV2Db(
  projectPath: string,
  opts: {
    seeds?: Array<{
      id: string;
      figma_seed_reference: string;
      file_key: string;
      node_id: string;
      original_design_intent?: string;
      created_at?: string;
    }>;
    surfaces?: Array<{
      id: string;
      seed_reference_id: string | null;
      figma_seed_reference: string;
      frame_node_id?: string;
      frame_name?: string;
      created_at: string;
      screenshot_artifact_path?: string | null;
      screenshot_data_url?: string | null;
    }>;
    annotations?: Array<{
      id: string;
      surface_id: string;
    }>;
  } = {}
): string {
  const ikran = path.join(projectPath, ".ikran");
  mkdirSync(ikran, { recursive: true });
  const dbPath = getProjectDbPath(projectPath);
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE seed_references (
      id TEXT PRIMARY KEY,
      figma_seed_reference TEXT NOT NULL,
      original_design_intent TEXT NOT NULL,
      created_at TEXT NOT NULL,
      registered_via TEXT NOT NULL DEFAULT 'agent',
      file_key TEXT NOT NULL,
      node_id TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_seed_references_file_key_node_id
      ON seed_references(file_key, node_id);
    CREATE TABLE figma_evidence_surfaces (
      id TEXT PRIMARY KEY,
      seed_reference_id TEXT,
      figma_seed_reference TEXT NOT NULL,
      frame_node_id TEXT NOT NULL,
      frame_name TEXT NOT NULL,
      frame_bounds_json TEXT,
      evidence_views_json TEXT NOT NULL,
      screenshot_artifact_path TEXT,
      screenshot_data_url TEXT,
      design_signals_json TEXT,
      surface_bounds_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE region_annotations (
      id TEXT PRIMARY KEY,
      surface_id TEXT NULL,
      surface_artifact_id TEXT NULL,
      surface_node_id TEXT NULL,
      author TEXT NOT NULL,
      type TEXT NOT NULL,
      body TEXT NOT NULL,
      rect_x REAL NOT NULL,
      rect_y REAL NOT NULL,
      rect_w REAL NOT NULL,
      rect_h REAL NOT NULL,
      primary_node_id TEXT NULL,
      candidates_json TEXT NULL,
      created_at TEXT NOT NULL
    );
    PRAGMA user_version = 2;
  `);
  const insertSeed = db.prepare(
    `INSERT INTO seed_references
     (id, figma_seed_reference, original_design_intent, created_at, registered_via, file_key, node_id)
     VALUES (?, ?, ?, ?, 'agent', ?, ?)`
  );
  for (const seed of opts.seeds ?? []) {
    insertSeed.run(
      seed.id,
      seed.figma_seed_reference,
      seed.original_design_intent ?? INTENT,
      seed.created_at ?? "2020-01-01T00:00:00.000Z",
      seed.file_key,
      seed.node_id
    );
  }
  const insertSurface = db.prepare(
    `INSERT INTO figma_evidence_surfaces
     (id, seed_reference_id, figma_seed_reference, frame_node_id, frame_name,
      evidence_views_json, screenshot_artifact_path, screenshot_data_url, created_at)
     VALUES (?, ?, ?, ?, ?, '{}', ?, ?, ?)`
  );
  for (const surface of opts.surfaces ?? []) {
    insertSurface.run(
      surface.id,
      surface.seed_reference_id,
      surface.figma_seed_reference,
      surface.frame_node_id ?? "1:1",
      surface.frame_name ?? "Frame",
      surface.screenshot_artifact_path ?? null,
      surface.screenshot_data_url ?? null,
      surface.created_at
    );
  }
  const insertAnn = db.prepare(
    `INSERT INTO region_annotations
     (id, surface_id, author, type, body, rect_x, rect_y, rect_w, rect_h, created_at)
     VALUES (?, ?, 'agent', 'note', 'body', 0, 0, 10, 10, '2020-01-01T00:00:00.000Z')`
  );
  for (const ann of opts.annotations ?? []) {
    insertAnn.run(ann.id, ann.surface_id);
  }
  db.close();
  return dbPath;
}

/** Build a v3 project DB (surface lineage; nullable annotation surface_id, no geometry cols). */
function seedV3Db(
  projectPath: string,
  opts: {
    seeds?: Array<{
      id: string;
      figma_seed_reference: string;
      file_key: string;
      node_id: string;
      current_surface_id?: string | null;
      original_design_intent?: string;
      created_at?: string;
    }>;
    surfaces?: Array<{
      id: string;
      seed_reference_id: string;
      figma_seed_reference: string;
      frame_node_id?: string;
      frame_name?: string;
      created_at: string;
      superseded_by?: string | null;
    }>;
    annotations?: Array<{
      id: string;
      surface_id: string | null;
      surface_artifact_id?: string | null;
      author?: string;
      rect_x?: number;
      rect_y?: number;
      rect_w?: number;
      rect_h?: number;
      primary_node_id?: string;
    }>;
  } = {}
): string {
  const ikran = path.join(projectPath, ".ikran");
  mkdirSync(ikran, { recursive: true });
  const dbPath = getProjectDbPath(projectPath);
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE seed_references (
      id TEXT PRIMARY KEY,
      figma_seed_reference TEXT NOT NULL,
      original_design_intent TEXT NOT NULL,
      created_at TEXT NOT NULL,
      registered_via TEXT NOT NULL DEFAULT 'agent',
      file_key TEXT NOT NULL,
      node_id TEXT NOT NULL,
      current_surface_id TEXT
    );
    CREATE UNIQUE INDEX idx_seed_references_file_key_node_id
      ON seed_references(file_key, node_id);
    CREATE TABLE figma_evidence_surfaces (
      id TEXT PRIMARY KEY,
      seed_reference_id TEXT NOT NULL REFERENCES seed_references(id) ON DELETE RESTRICT,
      figma_seed_reference TEXT NOT NULL,
      frame_node_id TEXT NOT NULL,
      frame_name TEXT NOT NULL,
      frame_bounds_json TEXT,
      evidence_views_json TEXT NOT NULL,
      screenshot_artifact_path TEXT,
      screenshot_data_url TEXT,
      design_signals_json TEXT,
      surface_bounds_json TEXT,
      created_at TEXT NOT NULL,
      superseded_by TEXT REFERENCES figma_evidence_surfaces(id)
    );
    CREATE TABLE region_annotations (
      id TEXT PRIMARY KEY,
      surface_id TEXT NULL,
      surface_artifact_id TEXT NULL,
      surface_node_id TEXT NULL,
      author TEXT NOT NULL,
      type TEXT NOT NULL,
      body TEXT NOT NULL,
      rect_x REAL NOT NULL,
      rect_y REAL NOT NULL,
      rect_w REAL NOT NULL,
      rect_h REAL NOT NULL,
      primary_node_id TEXT NULL,
      candidates_json TEXT NULL,
      created_at TEXT NOT NULL
    );
    PRAGMA user_version = 3;
  `);
  const insertSeed = db.prepare(
    `INSERT INTO seed_references
     (id, figma_seed_reference, original_design_intent, created_at, registered_via, file_key, node_id, current_surface_id)
     VALUES (?, ?, ?, ?, 'agent', ?, ?, ?)`
  );
  for (const seed of opts.seeds ?? []) {
    insertSeed.run(
      seed.id,
      seed.figma_seed_reference,
      seed.original_design_intent ?? INTENT,
      seed.created_at ?? "2020-01-01T00:00:00.000Z",
      seed.file_key,
      seed.node_id,
      seed.current_surface_id ?? null
    );
  }
  const insertSurface = db.prepare(
    `INSERT INTO figma_evidence_surfaces
     (id, seed_reference_id, figma_seed_reference, frame_node_id, frame_name,
      evidence_views_json, created_at, superseded_by)
     VALUES (?, ?, ?, ?, ?, '{}', ?, ?)`
  );
  for (const surface of opts.surfaces ?? []) {
    insertSurface.run(
      surface.id,
      surface.seed_reference_id,
      surface.figma_seed_reference,
      surface.frame_node_id ?? "1:1",
      surface.frame_name ?? "Frame",
      surface.created_at,
      surface.superseded_by ?? null
    );
  }
  const insertAnn = db.prepare(
    `INSERT INTO region_annotations
     (id, surface_id, surface_artifact_id, author, type, body,
      rect_x, rect_y, rect_w, rect_h, primary_node_id, created_at)
     VALUES (?, ?, ?, ?, 'assumption', 'body', ?, ?, ?, ?, ?, '2020-01-01T00:00:00.000Z')`
  );
  for (const ann of opts.annotations ?? []) {
    insertAnn.run(
      ann.id,
      ann.surface_id,
      ann.surface_artifact_id ?? null,
      ann.author ?? "agent",
      ann.rect_x ?? 0.1,
      ann.rect_y ?? 0.1,
      ann.rect_w ?? 0.2,
      ann.rect_h ?? 0.15,
      ann.primary_node_id ?? null
    );
  }
  db.close();
  return dbPath;
}

test.describe("PRAGMA user_version migration runner", () => {
  test("v12→v13 preserves populated attempt-bound Agent Annotations with a null legacy section", () => {
    withTempProject((dir) => {
      const initialized = openProjectDb(dir);
      closeProjectDb(initialized);
      const dbPath = getProjectDbPath(dir);
      const v12 = new DatabaseSync(dbPath);
      try {
        v12.prepare(
          `INSERT INTO alignment_input_snapshots (id, snapshot_json, created_at)
           VALUES ('snapshot-v12', ?, '2026-07-23T00:00:00.000Z')`
        ).run(
          JSON.stringify({
            design_language_description: "Legacy",
            seed_references: []
          })
        );
        v12.exec(`
          INSERT INTO alignment_attempts
            (id, input_snapshot_id, status, created_at, updated_at)
          VALUES
            ('attempt-v12', 'snapshot-v12', 'preparing',
             '2026-07-23T00:00:00.000Z', '2026-07-23T00:00:00.000Z');
          INSERT INTO agent_alignment_annotations
            (id, inference, title, body, additional_information_json,
             anchor_json, created_at, updated_at, alignment_attempt_id,
             agent_idempotency_key, section)
          VALUES
            ('annotation-v12', 'reasonable', 'Legacy Hypothesis',
             'Preserve this row.', '[]', '{"kind":"single","target":{"kind":"surface"}}',
             '2026-07-23T00:00:00.000Z', '2026-07-23T00:00:00.000Z',
             'attempt-v12', 'annotation-v12-key', 'layout');
          DROP INDEX idx_agent_annotation_attempt_section;
          ALTER TABLE agent_alignment_annotations DROP COLUMN section;
          ALTER TABLE region_annotations DROP COLUMN section;
          PRAGMA user_version = 12;
        `);
      } finally {
        v12.close();
      }

      const migrated = openProjectDb(dir);
      try {
        expect(userVersion(migrated)).toBe(CURRENT_SCHEMA_VERSION);
        expect(
          migrated
            .prepare(
              `SELECT id, alignment_attempt_id, agent_idempotency_key,
                      section, anchor_json
               FROM agent_alignment_annotations
               WHERE id = 'annotation-v12'`
            )
            .get()
        ).toEqual({
          id: "annotation-v12",
          alignment_attempt_id: "attempt-v12",
          agent_idempotency_key: "annotation-v12-key",
          section: null,
          anchor_json: '{"kind":"single","target":{"kind":"surface"}}'
        });
        const indexes = migrated
          .prepare("PRAGMA index_list(agent_alignment_annotations)")
          .all() as Array<{ name: string }>;
        expect(indexes.map((index) => index.name)).toEqual(
          expect.arrayContaining([
            "idx_agent_annotation_attempt_delivery",
            "idx_agent_annotation_attempt_section"
          ])
        );
      } finally {
        closeProjectDb(migrated);
      }
    });
  });

  test("v13→v14 preserves populated Region Annotations with a null legacy section", () => {
    withTempProject((dir) => {
      const initialized = openProjectDb(dir);
      closeProjectDb(initialized);
      const dbPath = getProjectDbPath(dir);
      const v13 = new DatabaseSync(dbPath);
      try {
        v13.exec(`
          INSERT INTO seed_references
            (id, figma_seed_reference, original_design_intent, created_at,
             registered_via, file_key, node_id)
          VALUES
            ('seed-v13', '${VALID}', 'legacy', '2026-07-20T00:00:00.000Z',
             'designer', 'AbCdEf', '1:2');
          INSERT INTO figma_evidence_surfaces
            (id, seed_reference_id, figma_seed_reference, frame_node_id,
             frame_name, evidence_views_json, created_at)
          VALUES
            ('surf-v13', 'seed-v13', '${VALID}', '1:2', 'Checkout', '{}',
             '2026-07-20T00:00:00.000Z');
          INSERT INTO region_annotations
            (id, surface_id, surface_artifact_id, author, type, body,
             rect_x, rect_y, rect_w, rect_h, created_at,
             geometry_version, from_point, target_kind,
             target_evidence_version_id, section)
          VALUES
            ('ann-legacy-v13', 'surf-v13', 'surf-v13', 'designer',
             'explanatory', 'Legacy designer note.',
             0.1, 0.2, 0.3, 0.25, '2026-07-20T00:00:00.000Z',
             'v2_raw', 0, 'figma-region', 'surf-v13', 'layout');
          ALTER TABLE region_annotations DROP COLUMN section;
          PRAGMA user_version = 13;
        `);
      } finally {
        v13.close();
      }

      const migrated = openProjectDb(dir);
      try {
        expect(userVersion(migrated)).toBe(CURRENT_SCHEMA_VERSION);
        // Legacy row stays readable; the dropped-then-readded column is null.
        expect(
          migrated
            .prepare(
              `SELECT id, author, type, body, section
               FROM region_annotations WHERE id = 'ann-legacy-v13'`
            )
            .get()
        ).toEqual({
          id: "ann-legacy-v13",
          author: "designer",
          type: "explanatory",
          body: "Legacy designer note.",
          section: null
        });
        // New inserts may persist a six-part section value.
        migrated
          .prepare(
            `INSERT INTO region_annotations
              (id, surface_id, surface_artifact_id, author, type, body,
               rect_x, rect_y, rect_w, rect_h, created_at,
               geometry_version, from_point, target_kind,
               target_evidence_version_id, section)
             VALUES
              ('ann-new-v14', 'surf-v13', 'surf-v13', 'designer',
               'designer_annotation', 'Section-bound note.',
               0.2, 0.2, 0.2, 0.2, '2026-07-29T00:00:00.000Z',
               'v2_raw', 0, 'figma-region', 'surf-v13', 'token')`
          )
          .run();
        expect(
          migrated
            .prepare(
              `SELECT id, section FROM region_annotations
               WHERE id = 'ann-new-v14'`
            )
            .get()
        ).toEqual({ id: "ann-new-v14", section: "token" });
      } finally {
        closeProjectDb(migrated);
      }
    });
  });

  test("v14→v15 creates the source_artifacts artifact index", () => {
    withTempProject((dir) => {
      const initialized = openProjectDb(dir);
      closeProjectDb(initialized);
      const dbPath = getProjectDbPath(dir);
      const v14 = new DatabaseSync(dbPath);
      try {
        v14.exec(`
          DROP TABLE source_artifacts;
          PRAGMA user_version = 14;
        `);
      } finally {
        v14.close();
      }

      const migrated = openProjectDb(dir);
      try {
        expect(userVersion(migrated)).toBe(CURRENT_SCHEMA_VERSION);
        expect(tableNames(migrated)).toContain("source_artifacts");
        const cols = migrated
          .prepare("PRAGMA table_info(source_artifacts)")
          .all() as Array<{ name: string }>;
        expect(cols.map((c) => c.name)).toEqual(
          expect.arrayContaining([
            "id",
            "path",
            "artifact_type",
            "semantic_purpose",
            "related_record_ids_json",
            "readiness",
            "declaration_version",
            "status",
            "created_at",
            "updated_at"
          ])
        );
        const indexes = migrated
          .prepare("PRAGMA index_list(source_artifacts)")
          .all() as Array<{ name: string; unique: number }>;
        const byName = new Map(indexes.map((i) => [i.name, i]));
        expect(byName.get("idx_source_artifacts_path")?.unique).toBe(1);
        expect(byName.has("idx_source_artifacts_artifact_type")).toBe(true);
        expect(byName.has("idx_source_artifacts_created_at")).toBe(true);
      } finally {
        closeProjectDb(migrated);
      }
    });
  });

  test("v15→v16 creates the design-system ingest tables", () => {
    withTempProject((dir) => {
      const initialized = openProjectDb(dir);
      closeProjectDb(initialized);
      const dbPath = getProjectDbPath(dir);
      const v15 = new DatabaseSync(dbPath);
      try {
        v15.exec(`
          DROP TABLE design_system_entries;
          DROP TABLE design_system_meta;
          PRAGMA user_version = 15;
        `);
      } finally {
        v15.close();
      }

      const migrated = openProjectDb(dir);
      try {
        expect(userVersion(migrated)).toBe(CURRENT_SCHEMA_VERSION);
        expect(tableNames(migrated)).toEqual(
          expect.arrayContaining(["design_system_entries", "design_system_meta"])
        );
        const cols = migrated
          .prepare("PRAGMA table_info(design_system_entries)")
          .all() as Array<{ name: string }>;
        expect(cols.map((c) => c.name)).toEqual(
          expect.arrayContaining([
            "id",
            "file_kind",
            "section",
            "entry_id",
            "name",
            "value_json",
            "meaning",
            "status",
            "links_json",
            "source_artifact_path",
            "position",
            "created_at",
            "updated_at"
          ])
        );
        const indexes = migrated
          .prepare("PRAGMA index_list(design_system_entries)")
          .all() as Array<{ name: string; unique: number }>;
        const byName = new Map(indexes.map((i) => [i.name, i]));
        expect(byName.get("idx_design_system_entries_source_entry")?.unique).toBe(1);
        expect(byName.has("idx_design_system_entries_section")).toBe(true);
        const meta = migrated
          .prepare("SELECT name FROM design_system_meta WHERE singleton = 1")
          .get() as { name: string } | undefined;
        expect(meta?.name).toBe("");
      } finally {
        closeProjectDb(migrated);
      }
    });
  });

  test("v16→v17 adds explicit token domain and extraction manifests", () => {
    withTempProject((dir) => {
      const initialized = openProjectDb(dir);
      closeProjectDb(initialized);
      const dbPath = getProjectDbPath(dir);
      const v16 = new DatabaseSync(dbPath);
      try {
        v16.exec(`
          DROP TABLE design_system_extraction_manifest_requests;
          DROP TABLE design_system_extraction_manifests;
          ALTER TABLE design_system_entries DROP COLUMN domain;
          PRAGMA user_version = 16;
        `);
      } finally {
        v16.close();
      }

      const migrated = openProjectDb(dir);
      try {
        expect(userVersion(migrated)).toBe(CURRENT_SCHEMA_VERSION);
        expect(tableNames(migrated)).toContain(
          "design_system_extraction_manifests"
        );
        expect(tableNames(migrated)).toContain(
          "design_system_extraction_manifest_requests"
        );
        const columns = migrated
          .prepare("PRAGMA table_info(design_system_entries)")
          .all() as Array<{ name: string }>;
        expect(columns.map((column) => column.name)).toContain("domain");
      } finally {
        closeProjectDb(migrated);
      }
    });
  });

  test("v18→v19 adds the nullable foundation entry kind", () => {
    withTempProject((dir) => {
      const initialized = openProjectDb(dir);
      closeProjectDb(initialized);
      const dbPath = getProjectDbPath(dir);
      const v18 = new DatabaseSync(dbPath);
      try {
        v18.exec(`
          ALTER TABLE design_system_entries DROP COLUMN kind;
          PRAGMA user_version = 18;
        `);
      } finally {
        v18.close();
      }

      const migrated = openProjectDb(dir);
      try {
        expect(userVersion(migrated)).toBe(CURRENT_SCHEMA_VERSION);
        const columns = migrated
          .prepare("PRAGMA table_info(design_system_entries)")
          .all() as Array<{ name: string }>;
        expect(columns.map((column) => column.name)).toContain("kind");
      } finally {
        closeProjectDb(migrated);
      }
    });
  });

  test("v20→v21 clears primitive color token meanings, preserving domain rules and other rows", () => {
    withTempProject((dir) => {
      const initialized = openProjectDb(dir);
      closeProjectDb(initialized);
      const dbPath = getProjectDbPath(dir);
      const v20 = new DatabaseSync(dbPath);
      try {
        const insert = v20.prepare(
          `INSERT INTO design_system_entries
           (id, file_kind, section, entry_id, name, kind, domain, value_json,
            meaning, status, links_json, source_artifact_path, position,
            created_at, updated_at)
           VALUES (?, 'token.json', ?, ?, ?, ?, ?, '"#111111"', ?, 'formalized',
                   '["card-1"]', 'design-system/token.json', 0,
                   '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`
        );
        insert.run("e-color", "token.primitive", "primitive.color.ink", "color.ink", "token", "color", "品牌墨色");
        insert.run("e-color-legacy-kind", "token.primitive", "primitive.color.paper", "color.paper", null, "color", "纸张白");
        insert.run("e-color-rule", "token.primitive", "primitive.color-rule", "color-rule", "domain-rule", "color", "Accent restraint");
        insert.run("e-spacing", "token.primitive", "primitive.space.4", "space.4", "token", "spacing", "基础间距");
        insert.run("e-semantic", "token.semantic", "semantic.color.primary", "color.primary", "token", "color", "语义主色");
        v20.exec("PRAGMA user_version = 20");
      } finally {
        v20.close();
      }

      const migrated = openProjectDb(dir);
      try {
        expect(userVersion(migrated)).toBe(CURRENT_SCHEMA_VERSION);
        const meanings = new Map(
          (
            migrated
              .prepare(`SELECT id, meaning FROM design_system_entries`)
              .all() as Array<{ id: string; meaning: string }>
          ).map((row) => [row.id, row.meaning])
        );
        expect(meanings.get("e-color")).toBe("");
        expect(meanings.get("e-color-legacy-kind")).toBe("");
        // domain-rule entries keep their own meaning; other sections and
        // other domains are untouched.
        expect(meanings.get("e-color-rule")).toBe("Accent restraint");
        expect(meanings.get("e-spacing")).toBe("基础间距");
        expect(meanings.get("e-semantic")).toBe("语义主色");
      } finally {
        closeProjectDb(migrated);
      }
    });
  });

  test("v21→v22 discards atomic extraction data and reopens the command", () => {
    withTempProject((dir) => {
      const initialized = openProjectDb(dir);
      closeProjectDb(initialized);
      const dbPath = getProjectDbPath(dir);
      const v21 = new DatabaseSync(dbPath);
      try {
        v21.exec(`
          INSERT INTO alignment_input_snapshots (id, snapshot_json, created_at)
          VALUES ('snapshot-v21', '{}', '2026-08-01T00:00:00.000Z');
          INSERT INTO alignment_attempts
            (id, input_snapshot_id, status, created_at, updated_at, completed_at)
          VALUES
            ('attempt-v21', 'snapshot-v21', 'completed',
             '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z',
             '2026-08-01T00:00:00.000Z');
          INSERT INTO agent_commands
            (id, command_type, status, alignment_attempt_id, payload_json,
             idempotency_key, created_at, updated_at, claimed_at, completed_at)
          VALUES
            ('command-v21', 'prepare_initial_design_system', 'completed',
             'attempt-v21', '{}', 'command-v21-key',
             '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z',
             '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');
          UPDATE project_workflow
          SET stage = 'initial-design-system-preparing',
              current_alignment_attempt_id = 'attempt-v21'
          WHERE singleton = 1;
          INSERT INTO design_system_extraction_manifests
            (id, alignment_attempt_id, agent_command_id, idempotency_key,
             manifest_json, version, created_at, updated_at)
          VALUES
            ('manifest-v21', 'attempt-v21', 'command-v21', 'manifest-key',
             '{"claims":[],"audit":{"status":"passed","checkedClaimIds":[],"issues":[]}}',
             1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');
          INSERT INTO design_system_extraction_manifest_requests
            (alignment_attempt_id, idempotency_key, manifest_id,
             agent_command_id, manifest_json, manifest_version, created_at)
          VALUES
            ('attempt-v21', 'manifest-key', 'manifest-v21', 'command-v21',
             '{}', 1, '2026-08-01T00:00:00.000Z');
          PRAGMA user_version = 21;
        `);
      } finally {
        v21.close();
      }

      const migrated = openProjectDb(dir);
      try {
        expect(userVersion(migrated)).toBe(CURRENT_SCHEMA_VERSION);
        expect(
          migrated.prepare("SELECT COUNT(*) AS count FROM design_system_extraction_manifests").get()
        ).toEqual({ count: 0 });
        expect(
          migrated.prepare("SELECT COUNT(*) AS count FROM design_system_extraction_manifest_requests").get()
        ).toEqual({ count: 0 });
        expect(
          migrated
            .prepare(
              `SELECT status, claimed_at, completed_at
               FROM agent_commands WHERE id = 'command-v21'`
            )
            .get()
        ).toEqual({ status: "pending", claimed_at: null, completed_at: null });
      } finally {
        closeProjectDb(migrated);
      }
    });
  });

  test("v25→v26 creates the rule-update proposal and feedback dismissal tables", () => {
    withTempProject((dir) => {
      const initialized = openProjectDb(dir);
      closeProjectDb(initialized);
      const dbPath = getProjectDbPath(dir);
      const v25 = new DatabaseSync(dbPath);
      try {
        v25.exec(`
          DROP TABLE rule_update_proposals;
          DROP TABLE designer_feedback_dismissals;
          PRAGMA user_version = 25;
        `);
      } finally {
        v25.close();
      }

      const migrated = openProjectDb(dir);
      try {
        expect(userVersion(migrated)).toBe(CURRENT_SCHEMA_VERSION);
        expect(tableNames(migrated)).toEqual(
          expect.arrayContaining([
            "rule_update_proposals",
            "designer_feedback_dismissals"
          ])
        );
        const proposalColumns = migrated
          .prepare("PRAGMA table_info(rule_update_proposals)")
          .all() as Array<{ name: string; notnull: number }>;
        expect(proposalColumns.map((column) => column.name)).toEqual(
          expect.arrayContaining([
            "id",
            "kind",
            "classification",
            "title",
            "change_description",
            "reason",
            "affected_items_json",
            "evidence_record_ids_json",
            "status",
            "source_artifact_path",
            "entry_id",
            "proposed_target_path",
            "created_at",
            "decided_at"
          ])
        );
        // Move-specific columns stay nullable for new / update proposals.
        for (const nullable of [
          "source_artifact_path",
          "entry_id",
          "proposed_target_path",
          "decided_at"
        ]) {
          expect(
            proposalColumns.find((column) => column.name === nullable)?.notnull
          ).toBe(0);
        }
        expect(() =>
          migrated
            .prepare(
              `INSERT INTO rule_update_proposals
                (id, kind, classification, title, change_description, reason,
                 affected_items_json, evidence_record_ids_json, status,
                 created_at)
               VALUES ('p-bad', 'rewrite', 'reusable_candidate', 'T', 'C', 'R',
                       '[]', '[]', 'awaiting_confirmation',
                       '2026-08-06T00:00:00.000Z')`
            )
            .run()
        ).toThrow(/constraint/i);
        const dismissalForeignKeys = migrated
          .prepare("PRAGMA foreign_key_list(designer_feedback_dismissals)")
          .all() as Array<{ table: string; from: string; to: string }>;
        expect(dismissalForeignKeys).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              table: "designer_feedback",
              from: "feedback_id",
              to: "id"
            })
          ])
        );
      } finally {
        closeProjectDb(migrated);
      }
    });
  });

  test("fresh DB opens at CURRENT_SCHEMA_VERSION without backup", () => {
    withTempProject((dir) => {
      const db = openProjectDb(dir);
      try {
        expect(userVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
        expect(CURRENT_SCHEMA_VERSION).toBe(26);
        expect(tableNames(db)).not.toContain("tasks");
        expect(tableNames(db)).toEqual(
          expect.arrayContaining([
            "events",
            "projects",
            "project_meta",
            "seed_references",
            "figma_evidence_surfaces",
            "region_annotations",
            "annotation_primary_confirmations",
            "design_intent_alignment",
            "agent_alignment_annotations",
            "alignment_question_cards",
            "alignment_input_snapshots",
            "alignment_attempts",
            "agent_commands",
            "project_workflow",
            "source_artifacts",
            "design_system_entries",
            "design_system_meta",
            "design_system_extraction_manifests",
            "design_system_extraction_manifest_requests",
            "designer_feedback",
            "project_phase",
            "designer_feedback_review_consumption",
            "rule_update_proposals",
            "designer_feedback_dismissals"
          ])
        );
        const designSystemColumns = db
          .prepare("PRAGMA table_info(design_system_entries)")
          .all() as Array<{ name: string }>;
        expect(designSystemColumns.map((column) => column.name)).toEqual(
          expect.arrayContaining(["domain", "kind"])
        );
        const meta = db
          .prepare(
            `SELECT design_language_description AS d FROM project_meta WHERE singleton = 1`
          )
          .get() as { d: string } | undefined;
        expect(meta?.d).toBe("");
        const cols = seedColumns(db);
        expect(cols).toEqual(
          expect.arrayContaining([
            "file_key",
            "node_id",
            "registered_via",
            "current_surface_id"
          ])
        );
        expect(surfaceColumns(db)).toEqual(
          expect.arrayContaining(["superseded_by", "seed_reference_id"])
        );
        const surfaceColInfo = db
          .prepare("PRAGMA table_info(figma_evidence_surfaces)")
          .all() as Array<{ name: string; notnull: number }>;
        expect(
          surfaceColInfo.find((c) => c.name === "seed_reference_id")?.notnull
        ).toBe(1);
        const annCols = db
          .prepare("PRAGMA table_info(region_annotations)")
          .all() as Array<{ name: string; notnull: number }>;
        expect(annCols.map((c) => c.name)).toEqual(
          expect.arrayContaining([
            "geometry_version",
            "from_point",
            "surface_id",
            "section"
          ])
        );
        expect(annCols.find((c) => c.name === "surface_id")?.notnull).toBe(1);
        const alignmentAnnotationCols = db
          .prepare("PRAGMA table_info(agent_alignment_annotations)")
          .all() as Array<{ name: string; notnull: number }>;
        expect(alignmentAnnotationCols.map((c) => c.name)).toContain("section");
        expect(
          alignmentAnnotationCols.find((c) => c.name === "section")?.notnull
        ).toBe(0);
        const fkViolations = db.prepare("PRAGMA foreign_key_check").all();
        expect(fkViolations).toEqual([]);
        // Final schema: NOT NULL without ALTER DEFAULT '' (table rebuild in v2).
        const colInfo = db
          .prepare("PRAGMA table_info(seed_references)")
          .all() as Array<{
          name: string;
          notnull: number;
          dflt_value: string | null;
        }>;
        for (const name of ["file_key", "node_id"] as const) {
          const col = colInfo.find((c) => c.name === name);
          expect(col?.notnull).toBe(1);
          expect(col?.dflt_value).toBeNull();
        }
        expect(() =>
          db
            .prepare(
              `INSERT INTO seed_references
               (id, figma_seed_reference, original_design_intent, created_at, registered_via)
               VALUES (?, ?, ?, ?, ?)`
            )
            .run(
              "omit-identity",
              VALID,
              INTENT,
              new Date().toISOString(),
              "agent"
            )
        ).toThrow(/not null|NULL/i);
        // UNIQUE(file_key, node_id) present
        const indexes = db
          .prepare(
            `SELECT sql FROM sqlite_master
             WHERE type = 'index' AND tbl_name = 'seed_references'`
          )
          .all() as Array<{ sql: string | null }>;
        expect(
          indexes.some(
            (idx) =>
              typeof idx.sql === "string" &&
              /unique/i.test(idx.sql) &&
              /file_key/i.test(idx.sql) &&
              /node_id/i.test(idx.sql)
          )
        ).toBe(true);
      } finally {
        closeProjectDb(db);
      }
      expect(existsSync(getProjectDbBackupPath(dir, 0))).toBe(false);
    });
  });

  test("v0→v1→v2→v3→v4: migrates user_version, drops tasks, backfills identity, creates v0 backup", () => {
    withTempProject((dir) => {
      const dbPath = seedLegacyV0Db(dir);
      expect(statSync(dbPath).size).toBeGreaterThan(0);

      const db = openProjectDb(dir);
      try {
        expect(userVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
        expect(tableNames(db)).not.toContain("tasks");
        const seeds = db
          .prepare(
            "SELECT id, file_key, node_id, figma_seed_reference FROM seed_references"
          )
          .all() as Array<{
          id: string;
          file_key: string;
          node_id: string;
          figma_seed_reference: string;
        }>;
        expect(seeds.map((s) => s.id)).toEqual(["s1"]);
        expect(seeds[0].file_key).toBe("AbCdEf");
        expect(seeds[0].node_id).toBe("1:2");
        expect(seeds[0].figma_seed_reference).toBe(VALID);
        const cols = seedColumns(db);
        expect(cols).toContain("registered_via");
        expect(cols).toContain("file_key");
        expect(cols).toContain("node_id");
      } finally {
        closeProjectDb(db);
      }

      const bak = getProjectDbBackupPath(dir, 0);
      expect(existsSync(bak)).toBe(true);
      // Backup is the pre-migration snapshot (still has tasks).
      const bakDb = new DatabaseSync(bak, { readOnly: true });
      try {
        expect(userVersion(bakDb)).toBe(0);
        expect(tableNames(bakDb)).toContain("tasks");
      } finally {
        bakDb.close();
      }
    });
  });

  test("v1→v2→v3→v4: backfills file_key/node_id, creates v1 backup, keeps original URL", () => {
    withTempProject((dir) => {
      const urlA =
        "https://www.figma.com/design/FileAAA/Frame?node-id=0-81&t=aaa-11";
      const urlB =
        "https://www.figma.com/design/FileBBB/Frame?node-id=2:3";
      seedV1Db(dir, [
        { id: "a1", figma_seed_reference: urlA },
        { id: "b1", figma_seed_reference: urlB }
      ]);

      const db = openProjectDb(dir);
      try {
        expect(userVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
        const rows = db
          .prepare(
            `SELECT id, file_key, node_id, figma_seed_reference
             FROM seed_references ORDER BY id`
          )
          .all() as Array<{
          id: string;
          file_key: string;
          node_id: string;
          figma_seed_reference: string;
        }>;
        expect(rows).toEqual([
          {
            id: "a1",
            file_key: "FileAAA",
            node_id: "0:81",
            figma_seed_reference: urlA
          },
          {
            id: "b1",
            file_key: "FileBBB",
            node_id: "2:3",
            figma_seed_reference: urlB
          }
        ]);
        const colInfo = db
          .prepare("PRAGMA table_info(seed_references)")
          .all() as Array<{
          name: string;
          notnull: number;
          dflt_value: string | null;
        }>;
        for (const name of ["file_key", "node_id"] as const) {
          const col = colInfo.find((c) => c.name === name);
          expect(col?.notnull).toBe(1);
          expect(col?.dflt_value).toBeNull();
        }
      } finally {
        closeProjectDb(db);
      }

      const bak = getProjectDbBackupPath(dir, 1);
      expect(existsSync(bak)).toBe(true);
      const bakDb = new DatabaseSync(bak, { readOnly: true });
      try {
        expect(userVersion(bakDb)).toBe(1);
        expect(seedColumns(bakDb)).not.toContain("file_key");
      } finally {
        bakDb.close();
      }
    });
  });

  test("v1→v2: invalid URL backfill fails closed and rolls back", () => {
    withTempProject((dir) => {
      const dbPath = seedV1Db(dir, [
        {
          id: "bad1",
          figma_seed_reference: "https://example.com/not-figma"
        }
      ]);

      expect(() => openProjectDb(dir)).toThrow(/bad1|not-figma|parse|identity/i);

      const unchanged = new DatabaseSync(dbPath);
      try {
        expect(userVersion(unchanged)).toBe(1);
        expect(seedColumns(unchanged)).not.toContain("file_key");
        const count = (
          unchanged
            .prepare("SELECT COUNT(*) AS c FROM seed_references")
            .get() as { c: number }
        ).c;
        expect(count).toBe(1);
      } finally {
        unchanged.close();
      }
    });
  });

  test("v1→v2: canonical duplicate backfill fails closed with conflict ids", () => {
    withTempProject((dir) => {
      const dbPath = seedV1Db(dir, [
        {
          id: "dup-a",
          figma_seed_reference:
            "https://www.figma.com/design/SameKey/X?node-id=0-81&t=aaa"
        },
        {
          id: "dup-b",
          figma_seed_reference:
            "https://www.figma.com/design/SameKey/X?node-id=0:81&t=bbb"
        }
      ]);

      expect(() => openProjectDb(dir)).toThrow(/dup-a|dup-b|SameKey|0:81|duplicate/i);

      const unchanged = new DatabaseSync(dbPath);
      try {
        expect(userVersion(unchanged)).toBe(1);
        expect(seedColumns(unchanged)).not.toContain("file_key");
        const ids = (
          unchanged
            .prepare("SELECT id FROM seed_references ORDER BY id")
            .all() as Array<{ id: string }>
        ).map((r) => r.id);
        expect(ids).toEqual(["dup-a", "dup-b"]);
      } finally {
        unchanged.close();
      }
    });
  });

  test("failed migration rolls back DDL and user_version together", () => {
    const db = new DatabaseSync(":memory:");
    try {
      const failingMigrations = [
        {
          version: 1,
          up(database: DatabaseSync) {
            database.exec("CREATE TABLE partial_migration (id TEXT)");
            throw new Error("forced migration failure");
          }
        }
      ];

      expect(() =>
        (
          applyPendingMigrations as unknown as (
            database: DatabaseSync,
            fromVersion: number,
            migrations: typeof failingMigrations
          ) => void
        )(db, 0, failingMigrations)
      ).toThrow("forced migration failure");
      expect(userVersion(db)).toBe(0);
      expect(tableNames(db)).not.toContain("partial_migration");
    } finally {
      db.close();
    }
  });

  test("registered_via ALTER errors fail closed instead of being swallowed", () => {
    withTempProject((dir) => {
      mkdirSync(path.join(dir, ".ikran"), { recursive: true });
      const dbPath = getProjectDbPath(dir);
      const db = new DatabaseSync(dbPath);
      try {
        const fillerColumns = Array.from(
          { length: 1996 },
          (_, index) => `extra_${index} TEXT`
        ).join(", ");
        db.exec(`
          CREATE TABLE seed_references (
            id TEXT PRIMARY KEY,
            figma_seed_reference TEXT NOT NULL,
            original_design_intent TEXT NOT NULL,
            created_at TEXT NOT NULL,
            ${fillerColumns}
          );
          PRAGMA user_version = 0;
        `);
      } finally {
        db.close();
      }

      expect(() => openProjectDb(dir)).toThrow();
      const unchanged = new DatabaseSync(dbPath);
      try {
        expect(userVersion(unchanged)).toBe(0);
        const columns = unchanged
          .prepare("PRAGMA table_info(seed_references)")
          .all() as Array<{ name: string }>;
        expect(columns.some((column) => column.name === "registered_via")).toBe(
          false
        );
      } finally {
        unchanged.close();
      }
    });
  });

  test("backup conflict fail-closed: existing v0 backup blocks v0 migration", () => {
    withTempProject((dir) => {
      const dbPath = seedLegacyV0Db(dir);
      writeFileSync(getProjectDbBackupPath(dir, 0), "occupied", "utf-8");

      expect(() => openProjectDb(dir)).toThrow(/backup/i);
      // Original DB untouched (still v0 with tasks).
      const db = new DatabaseSync(dbPath);
      try {
        expect(userVersion(db)).toBe(0);
        expect(tableNames(db)).toContain("tasks");
      } finally {
        db.close();
      }
    });
  });

  test("migration backup includes committed rows still resident in WAL", () => {
    withTempProject((dir) => {
      const dbPath = seedLegacyV0Db(dir);
      const writer = new DatabaseSync(dbPath);
      try {
        writer.exec("PRAGMA journal_mode = WAL");
        writer.exec("PRAGMA wal_autocheckpoint = 0");
        writer
          .prepare(
            `INSERT INTO seed_references
             (id, figma_seed_reference, original_design_intent, created_at)
             VALUES (?, ?, ?, ?)`
          )
          .run(
            "wal-seed",
            "https://www.figma.com/design/WalSeed/Frame?node-id=4:2",
            "committed in WAL",
            "2020-01-02T00:00:00.000Z"
          );

        const migrated = openProjectDb(dir);
        closeProjectDb(migrated);

        const backup = new DatabaseSync(getProjectDbBackupPath(dir, 0), {
          readOnly: true
        });
        try {
          const row = backup
            .prepare(
              "SELECT original_design_intent FROM seed_references WHERE id = ?"
            )
            .get("wal-seed") as
            | { original_design_intent: string }
            | undefined;
          expect(row?.original_design_intent).toBe("committed in WAL");
        } finally {
          backup.close();
        }
      } finally {
        writer.close();
      }
    });
  });

  test("v0 backup does not block a later v1 migration backup", () => {
    withTempProject((dir) => {
      seedLegacyV0Db(dir);
      const migrated = openProjectDb(dir);
      closeProjectDb(migrated);

      const v0Backup = getProjectDbBackupPath(dir, 0);
      const v1Backup = backupProjectDbBeforeMigration(dir, 1);

      expect(v1Backup).toBe(getProjectDbBackupPath(dir, 1));
      expect(v1Backup).not.toBe(v0Backup);
      expect(existsSync(v0Backup)).toBe(true);
      expect(existsSync(v1Backup)).toBe(true);

      // Conflict remains fail-closed for the same source version.
      expect(() => backupProjectDbBeforeMigration(dir, 1)).toThrow(/backup/i);
    });
  });

  test("v1 backup conflict fail-closed: existing v1 backup blocks v1→v2", () => {
    withTempProject((dir) => {
      const dbPath = seedV1Db(dir, [
        { id: "s1", figma_seed_reference: VALID }
      ]);
      writeFileSync(getProjectDbBackupPath(dir, 1), "occupied", "utf-8");

      expect(() => openProjectDb(dir)).toThrow(/backup/i);
      const db = new DatabaseSync(dbPath);
      try {
        expect(userVersion(db)).toBe(1);
        expect(seedColumns(db)).not.toContain("file_key");
      } finally {
        db.close();
      }
    });
  });

  test("v2→v3: builds superseded_by lineage + current_surface_id, keeps surface ids, creates .v2.bak", () => {
    withTempProject((dir) => {
      const seedUrl =
        "https://www.figma.com/design/AbCdEf/Checkout?node-id=1:2&t=seed-token";
      const surfUrlOlder =
        "https://www.figma.com/design/AbCdEf/Checkout?node-id=1-2&t=old";
      const surfUrlNewer =
        "https://www.figma.com/design/AbCdEf/Checkout?node-id=1:2&t=new";
      seedV2Db(dir, {
        seeds: [
          {
            id: "seed-1",
            figma_seed_reference: seedUrl,
            file_key: "AbCdEf",
            node_id: "1:2"
          }
        ],
        surfaces: [
          {
            id: "surf-old",
            seed_reference_id: null,
            figma_seed_reference: surfUrlOlder,
            created_at: "2020-01-01T00:00:00.000Z"
          },
          {
            id: "surf-new",
            seed_reference_id: "seed-1",
            figma_seed_reference: surfUrlNewer,
            created_at: "2020-01-02T00:00:00.000Z"
          }
        ],
        annotations: [{ id: "ann-1", surface_id: "surf-old" }]
      });

      const db = openProjectDb(dir);
      try {
        expect(userVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
        const surfaces = db
          .prepare(
            `SELECT id, seed_reference_id, superseded_by
             FROM figma_evidence_surfaces ORDER BY created_at ASC, id ASC`
          )
          .all() as Array<{
          id: string;
          seed_reference_id: string;
          superseded_by: string | null;
        }>;
        expect(surfaces).toEqual([
          {
            id: "surf-old",
            seed_reference_id: "seed-1",
            superseded_by: "surf-new"
          },
          {
            id: "surf-new",
            seed_reference_id: "seed-1",
            superseded_by: null
          }
        ]);
        const seed = db
          .prepare(
            "SELECT current_surface_id FROM seed_references WHERE id = ?"
          )
          .get("seed-1") as { current_surface_id: string };
        expect(seed.current_surface_id).toBe("surf-new");
        const seedForeignKeys = db
          .prepare("PRAGMA foreign_key_list(seed_references)")
          .all() as Array<{
          table: string;
          from: string;
          to: string;
        }>;
        expect(seedForeignKeys).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              table: "figma_evidence_surfaces",
              from: "current_surface_id",
              to: "id"
            })
          ])
        );
        expect(() =>
          db
            .prepare(
              `UPDATE seed_references
               SET current_surface_id = 'missing-surface'
               WHERE id = 'seed-1'`
            )
            .run()
        ).toThrow(/foreign key/i);
        const ann = db
          .prepare(
            `SELECT surface_id, geometry_version, from_point
             FROM region_annotations WHERE id = ?`
          )
          .get("ann-1") as {
          surface_id: string;
          geometry_version: string;
          from_point: number;
        };
        expect(ann.surface_id).toBe("surf-old");
        expect(ann.geometry_version).toBe("v1_padded");
        expect(ann.from_point).toBe(0);
        expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      } finally {
        closeProjectDb(db);
      }

      const bak = getProjectDbBackupPath(dir, 2);
      expect(bak.endsWith(".v2.bak")).toBe(true);
      expect(existsSync(bak)).toBe(true);
      const bakDb = new DatabaseSync(bak, { readOnly: true });
      try {
        expect(userVersion(bakDb)).toBe(2);
        expect(surfaceColumns(bakDb)).not.toContain("superseded_by");
        expect(seedColumns(bakDb)).not.toContain("current_surface_id");
      } finally {
        bakDb.close();
      }
    });
  });

  test("v2→v3: orphan seed_reference_id fails closed with surface/seed ids and rolls back", () => {
    withTempProject((dir) => {
      const dbPath = seedV2Db(dir, {
        seeds: [
          {
            id: "seed-1",
            figma_seed_reference: VALID,
            file_key: "AbCdEf",
            node_id: "1:2"
          }
        ],
        surfaces: [
          {
            id: "surf-orphan",
            seed_reference_id: "missing-seed",
            figma_seed_reference: VALID,
            created_at: "2020-01-01T00:00:00.000Z"
          }
        ]
      });

      expect(() => openProjectDb(dir)).toThrow(
        /surf-orphan|missing-seed|seed_reference/i
      );

      const unchanged = new DatabaseSync(dbPath);
      try {
        expect(userVersion(unchanged)).toBe(2);
        expect(seedColumns(unchanged)).not.toContain("current_surface_id");
        expect(surfaceColumns(unchanged)).not.toContain("superseded_by");
      } finally {
        unchanged.close();
      }
    });
  });

  test("v2→v3: identity mismatch fails closed with surface/seed ids and rolls back", () => {
    withTempProject((dir) => {
      const dbPath = seedV2Db(dir, {
        seeds: [
          {
            id: "seed-1",
            figma_seed_reference: VALID,
            file_key: "AbCdEf",
            node_id: "1:2"
          }
        ],
        surfaces: [
          {
            id: "surf-mismatch",
            seed_reference_id: "seed-1",
            figma_seed_reference:
              "https://www.figma.com/design/OtherFile/X?node-id=9:9",
            created_at: "2020-01-01T00:00:00.000Z"
          }
        ]
      });

      expect(() => openProjectDb(dir)).toThrow(
        /surf-mismatch|seed-1|mismatch|OtherFile/i
      );

      const unchanged = new DatabaseSync(dbPath);
      try {
        expect(userVersion(unchanged)).toBe(2);
        expect(seedColumns(unchanged)).not.toContain("current_surface_id");
      } finally {
        unchanged.close();
      }
    });
  });

  test("v2→v3: unresolvable empty seed_reference_id fails closed", () => {
    withTempProject((dir) => {
      const dbPath = seedV2Db(dir, {
        seeds: [
          {
            id: "seed-1",
            figma_seed_reference: VALID,
            file_key: "AbCdEf",
            node_id: "1:2"
          }
        ],
        surfaces: [
          {
            id: "surf-no-seed",
            seed_reference_id: null,
            figma_seed_reference:
              "https://www.figma.com/design/NoMatch/X?node-id=3:3",
            created_at: "2020-01-01T00:00:00.000Z"
          }
        ]
      });

      expect(() => openProjectDb(dir)).toThrow(
        /surf-no-seed|NoMatch|resolve|seed/i
      );

      const unchanged = new DatabaseSync(dbPath);
      try {
        expect(userVersion(unchanged)).toBe(2);
      } finally {
        unchanged.close();
      }
    });
  });

  test("v2 backup conflict fail-closed: existing v2 backup blocks v2→v3", () => {
    withTempProject((dir) => {
      const dbPath = seedV2Db(dir, {
        seeds: [
          {
            id: "s1",
            figma_seed_reference: VALID,
            file_key: "AbCdEf",
            node_id: "1:2"
          }
        ]
      });
      writeFileSync(getProjectDbBackupPath(dir, 2), "occupied", "utf-8");

      expect(() => openProjectDb(dir)).toThrow(/backup/i);
      const db = new DatabaseSync(dbPath);
      try {
        expect(userVersion(db)).toBe(2);
        expect(seedColumns(db)).not.toContain("current_surface_id");
      } finally {
        db.close();
      }
    });
  });

  test("v3→v4: marks old rows v1_padded, enforces surface_id FK/NOT NULL, creates .v3.bak", () => {
    withTempProject((dir) => {
      seedV3Db(dir, {
        seeds: [
          {
            id: "seed-1",
            figma_seed_reference: VALID,
            file_key: "AbCdEf",
            node_id: "1:2",
            current_surface_id: "surf-1"
          }
        ],
        surfaces: [
          {
            id: "surf-1",
            seed_reference_id: "seed-1",
            figma_seed_reference: VALID,
            created_at: "2020-01-01T00:00:00.000Z"
          }
        ],
        annotations: [
          {
            id: "ann-agent",
            surface_id: "surf-1",
            author: "agent",
            rect_x: 0.05,
            rect_y: 0.05,
            rect_w: 0.224,
            rect_h: 0.124,
            primary_node_id: "12:34"
          },
          {
            id: "ann-backfill",
            surface_id: null,
            surface_artifact_id: "surf-1",
            author: "designer",
            rect_x: 0.1,
            rect_y: 0.2,
            rect_w: 0.3,
            rect_h: 0.25
          }
        ]
      });

      const db = openProjectDb(dir);
      try {
        expect(userVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
        const cols = (
          db.prepare("PRAGMA table_info(region_annotations)").all() as Array<{
            name: string;
            notnull: number;
          }>
        ).map((c) => c.name);
        expect(cols).toEqual(
          expect.arrayContaining(["geometry_version", "from_point", "surface_id"])
        );
        const surfaceIdInfo = (
          db.prepare("PRAGMA table_info(region_annotations)").all() as Array<{
            name: string;
            notnull: number;
          }>
        ).find((c) => c.name === "surface_id");
        expect(surfaceIdInfo?.notnull).toBe(1);

        const rows = db
          .prepare(
            `SELECT id, surface_id, geometry_version, from_point, rect_w
             FROM region_annotations ORDER BY id ASC`
          )
          .all() as Array<{
          id: string;
          surface_id: string;
          geometry_version: string;
          from_point: number;
          rect_w: number;
        }>;
        expect(rows).toEqual([
          {
            id: "ann-agent",
            surface_id: "surf-1",
            geometry_version: "v1_padded",
            from_point: 0,
            rect_w: 0.224
          },
          {
            id: "ann-backfill",
            surface_id: "surf-1",
            geometry_version: "v1_padded",
            from_point: 0,
            rect_w: 0.3
          }
        ]);
        const legacyConfirmation = db
          .prepare(
            `SELECT annotation_id, evidence_version_id, source_node_id
             FROM annotation_primary_confirmations
             WHERE annotation_id = ?`
          )
          .get("ann-agent") as {
          annotation_id: string;
          evidence_version_id: string;
          source_node_id: string;
        };
        expect(legacyConfirmation).toEqual({
          annotation_id: "ann-agent",
          evidence_version_id: "surf-1",
          source_node_id: "12:34"
        });

        const fks = db
          .prepare("PRAGMA foreign_key_list(region_annotations)")
          .all() as Array<{ table: string; from: string; to: string }>;
        expect(fks).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              table: "figma_evidence_surfaces",
              from: "surface_id",
              to: "id"
            })
          ])
        );
        expect(() =>
          db
            .prepare(
              `INSERT INTO region_annotations
               (id, surface_id, author, type, body, rect_x, rect_y, rect_w, rect_h,
                geometry_version, from_point, created_at)
               VALUES ('bad', 'missing-surf', 'agent', 'assumption', 'x',
                       0, 0, 0.1, 0.1, 'v2_raw', 0, '2020-01-01T00:00:00.000Z')`
            )
            .run()
        ).toThrow(/foreign key/i);
        expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      } finally {
        closeProjectDb(db);
      }

      const bak = getProjectDbBackupPath(dir, 3);
      expect(bak.endsWith(".v3.bak")).toBe(true);
      expect(existsSync(bak)).toBe(true);
      const bakDb = new DatabaseSync(bak, { readOnly: true });
      try {
        expect(userVersion(bakDb)).toBe(3);
        const bakCols = (
          bakDb.prepare("PRAGMA table_info(region_annotations)").all() as Array<{
            name: string;
          }>
        ).map((c) => c.name);
        expect(bakCols).not.toContain("geometry_version");
      } finally {
        bakDb.close();
      }
    });
  });

  test("v3→v4: orphan annotation surface fails closed with annotation id and rolls back", () => {
    withTempProject((dir) => {
      const dbPath = seedV3Db(dir, {
        seeds: [
          {
            id: "seed-1",
            figma_seed_reference: VALID,
            file_key: "AbCdEf",
            node_id: "1:2",
            current_surface_id: "surf-1"
          }
        ],
        surfaces: [
          {
            id: "surf-1",
            seed_reference_id: "seed-1",
            figma_seed_reference: VALID,
            created_at: "2020-01-01T00:00:00.000Z"
          }
        ],
        annotations: [
          {
            id: "ann-orphan",
            surface_id: null,
            surface_artifact_id: "missing-surface"
          }
        ]
      });

      expect(() => openProjectDb(dir)).toThrow(/ann-orphan|surface/i);

      const unchanged = new DatabaseSync(dbPath);
      try {
        expect(userVersion(unchanged)).toBe(3);
        const cols = (
          unchanged
            .prepare("PRAGMA table_info(region_annotations)")
            .all() as Array<{ name: string }>
        ).map((c) => c.name);
        expect(cols).not.toContain("geometry_version");
      } finally {
        unchanged.close();
      }
    });
  });

  test("v3 backup conflict fail-closed: existing v3 backup blocks v3→v4", () => {
    withTempProject((dir) => {
      const dbPath = seedV3Db(dir, {
        seeds: [
          {
            id: "seed-1",
            figma_seed_reference: VALID,
            file_key: "AbCdEf",
            node_id: "1:2"
          }
        ]
      });
      writeFileSync(getProjectDbBackupPath(dir, 3), "occupied", "utf-8");

      expect(() => openProjectDb(dir)).toThrow(/backup/i);
      const db = new DatabaseSync(dbPath);
      try {
        expect(userVersion(db)).toBe(3);
      } finally {
        db.close();
      }
    });
  });

  test("does not backup a brand-new missing DB", () => {
    withTempProject((dir) => {
      expect(existsSync(getProjectDbPath(dir))).toBe(false);
      const db = openProjectDb(dir);
      closeProjectDb(db);
      expect(existsSync(getProjectDbBackupPath(dir, 0))).toBe(false);
    });
  });

  test("each connection enables foreign_keys", () => {
    withTempProject((dir) => {
      const db = openProjectDb(dir);
      try {
        const row = db.prepare("PRAGMA foreign_keys").get() as {
          foreign_keys: number;
        };
        expect(row.foreign_keys).toBe(1);
      } finally {
        closeProjectDb(db);
      }
    });
  });
});

test.describe("withProjectTransaction", () => {
  test("rolls back domain writes when fn throws", () => {
    withTempProject((dir) => {
      expect(() =>
        withProjectTransaction(dir, (db) => {
          db.prepare(
            `INSERT INTO seed_references
             (id, figma_seed_reference, original_design_intent, created_at, registered_via, file_key, node_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).run(
            "x1",
            VALID,
            INTENT,
            new Date().toISOString(),
            "agent",
            "AbCdEf",
            "1:2"
          );
          throw new Error("boom");
        })
      ).toThrow("boom");

      const db = openProjectDb(dir);
      try {
        const count = (
          db.prepare("SELECT COUNT(*) AS c FROM seed_references").get() as {
            c: number;
          }
        ).c;
        expect(count).toBe(0);
      } finally {
        closeProjectDb(db);
      }
    });
  });

  test("commits when fn returns", () => {
    withTempProject((dir) => {
      withProjectTransaction(dir, (db) => {
        db.prepare(
          `INSERT INTO seed_references
           (id, figma_seed_reference, original_design_intent, created_at, registered_via, file_key, node_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          "x2",
          VALID,
          INTENT,
          new Date().toISOString(),
          "agent",
          "AbCdEf",
          "1:2"
        );
      });
      const db = openProjectDb(dir);
      try {
        const count = (
          db.prepare("SELECT COUNT(*) AS c FROM seed_references").get() as {
            c: number;
          }
        ).c;
        expect(count).toBe(1);
      } finally {
        closeProjectDb(db);
      }
    });
  });
});

test.describe("events: SQLite canonical + JSONL export", () => {
  test("logEvent does not append events.jsonl on the hot path", () => {
    withTempProject((dir) => {
      logEvent(dir, "project_created", { path: dir });
      expect(existsSync(getProjectEventsPath(dir))).toBe(false);
      expect(listEvents(dir, "project_created").length).toBe(1);
    });
  });

  test("exportEventsJsonl rebuilds deterministic JSONL after file deleted", () => {
    withTempProject((dir) => {
      const a = logEvent(dir, "project_created", { n: 1 });
      const b = logEvent(dir, "folder_selected", { n: 2 });

      const target = getProjectEventsPath(dir);
      exportEventsJsonl(dir);
      expect(existsSync(target)).toBe(true);

      rmSync(target, { force: true });
      expect(existsSync(target)).toBe(false);

      const written = exportEventsJsonl(dir);
      expect(written).toBe(target);
      const lines = readFileSync(target, "utf-8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l) as { event_id: string; type: string });
      expect(lines.map((l) => l.event_id)).toEqual([a.event_id, b.event_id]);
      expect(lines.map((l) => l.type)).toEqual([
        "project_created",
        "folder_selected"
      ]);
    });
  });

  test("exportEventsJsonl creates a nested custom target directory", () => {
    withTempProject((dir) => {
      const event = logEvent(dir, "project_created", { nested: true });
      const target = path.join(dir, ".ikran", "export", "events.jsonl");

      expect(exportEventsJsonl(dir, target)).toBe(target);
      const lines = readFileSync(target, "utf-8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { event_id: string });
      expect(lines.map((line) => line.event_id)).toEqual([event.event_id]);
    });
  });
});

test.describe("atomic record + event", () => {
  test("event INSERT failure rolls back seed record and returns ok:false", () => {
    withTempProject((dir) => {
      // Install a trigger that aborts every events INSERT.
      const db = openProjectDb(dir);
      try {
        db.exec(`
          CREATE TRIGGER fail_event_insert
          BEFORE INSERT ON events
          BEGIN
            SELECT RAISE(ABORT, 'forced_event_insert_failure');
          END;
        `);
      } finally {
        closeProjectDb(db);
      }

      const res = registerSeedReference(dir, {
        figmaSeedReference: VALID,
        originalDesignIntent: INTENT
      });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("db_error");

      const check = openProjectDb(dir);
      try {
        const seeds = (
          check.prepare("SELECT COUNT(*) AS c FROM seed_references").get() as {
            c: number;
          }
        ).c;
        const events = (
          check.prepare("SELECT COUNT(*) AS c FROM events").get() as {
            c: number;
          }
        ).c;
        expect(seeds).toBe(0);
        expect(events).toBe(0);
      } finally {
        closeProjectDb(check);
      }
    });
  });

  test("legacy reused seed returns an event_id that exists in events", () => {
    withTempProject((dir) => {
      seedLegacyV0Db(dir);

      const result = registerSeedReference(dir, {
        figmaSeedReference: VALID,
        originalDesignIntent: "ignored on reuse"
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.reused).toBe(true);

      const db = openProjectDb(dir);
      try {
        const event = db
          .prepare(
            `SELECT event_id, type, payload
             FROM events
             WHERE event_id = ?`
          )
          .get(result.event_id) as
          | { event_id: string; type: string; payload: string }
          | undefined;
        expect(event).toBeDefined();
        expect(event?.type).toBe("seed_reference_registered");
        expect(JSON.parse(event?.payload ?? "{}").seed_reference_id).toBe("s1");
      } finally {
        closeProjectDb(db);
      }
    });
  });
});
