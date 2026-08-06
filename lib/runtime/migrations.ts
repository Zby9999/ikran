// Versioned SQLite schema migrations for project `.ikran/ikran.db`.
//
// `PRAGMA user_version` is the source of truth. Existing DBs without an
// explicit version are treated as v0. New databases land at CURRENT_SCHEMA_VERSION.

import type { DatabaseSync as DatabaseType } from "node:sqlite";
import {
  parseFigmaSeedIdentity,
  figmaSeedIdentityKey
} from "./figma-identity";

export const CURRENT_SCHEMA_VERSION = 27;

export type Migration = {
  /** Schema version after this migration successfully applies. */
  version: number;
  up: (db: DatabaseType) => void;
};

const V1_BASE_TABLES = `
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS seed_references (
  id TEXT PRIMARY KEY,
  figma_seed_reference TEXT NOT NULL,
  original_design_intent TEXT NOT NULL,
  created_at TEXT NOT NULL,
  registered_via TEXT NOT NULL DEFAULT 'agent'
);

CREATE TABLE IF NOT EXISTS figma_evidence_surfaces (
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

CREATE TABLE IF NOT EXISTS region_annotations (
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

CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_seed_references_created_at ON seed_references(created_at);
CREATE INDEX IF NOT EXISTS idx_figma_evidence_surfaces_created_at ON figma_evidence_surfaces(created_at);
CREATE INDEX IF NOT EXISTS idx_figma_evidence_surfaces_frame_node_id ON figma_evidence_surfaces(frame_node_id);
CREATE INDEX IF NOT EXISTS idx_region_annotations_created_at ON region_annotations(created_at);
CREATE INDEX IF NOT EXISTS idx_region_annotations_surface_id ON region_annotations(surface_id);
`;

function seedReferenceColumnNames(db: DatabaseType): string[] {
  return (
    db.prepare("PRAGMA table_info(seed_references)").all() as Array<{
      name: string;
    }>
  ).map((column) => column.name);
}

type LegacySurfaceRow = {
  id: string;
  seed_reference_id: string | null;
  figma_seed_reference: string;
  frame_node_id: string;
  frame_name: string;
  frame_bounds_json: string | null;
  evidence_views_json: string;
  screenshot_artifact_path: string | null;
  screenshot_data_url: string | null;
  design_signals_json: string | null;
  surface_bounds_json: string | null;
  created_at: string;
};

type SeedIdentityRow = {
  id: string;
  file_key: string;
  node_id: string;
};

function resolveLegacySurfaceSeedId(
  db: DatabaseType,
  surface: LegacySurfaceRow
): string {
  const surfaceIdentity = parseFigmaSeedIdentity(surface.figma_seed_reference);
  if (!surfaceIdentity) {
    throw new Error(
      `Migration v3 failed: cannot parse figma_seed_reference for figma_evidence_surfaces.id=${surface.id} url=${JSON.stringify(surface.figma_seed_reference)}`
    );
  }

  const linkedId =
    typeof surface.seed_reference_id === "string" &&
    surface.seed_reference_id.trim().length > 0
      ? surface.seed_reference_id.trim()
      : null;

  if (linkedId !== null) {
    const seed = db
      .prepare(
        `SELECT id, file_key, node_id FROM seed_references WHERE id = ?`
      )
      .get(linkedId) as SeedIdentityRow | undefined;
    if (!seed) {
      throw new Error(
        `Migration v3 failed: orphan seed_reference_id for figma_evidence_surfaces.id=${surface.id} seed_reference_id=${linkedId}`
      );
    }
    if (
      seed.file_key !== surfaceIdentity.fileKey ||
      seed.node_id !== surfaceIdentity.nodeId
    ) {
      throw new Error(
        `Migration v3 failed: canonical identity mismatch for figma_evidence_surfaces.id=${surface.id} seed_reference_id=${seed.id} surface_file_key=${JSON.stringify(surfaceIdentity.fileKey)} surface_node_id=${JSON.stringify(surfaceIdentity.nodeId)} seed_file_key=${JSON.stringify(seed.file_key)} seed_node_id=${JSON.stringify(seed.node_id)}`
      );
    }
    return seed.id;
  }

  const matches = db
    .prepare(
      `SELECT id, file_key, node_id FROM seed_references
       WHERE file_key = ? AND node_id = ?`
    )
    .all(surfaceIdentity.fileKey, surfaceIdentity.nodeId) as SeedIdentityRow[];

  if (matches.length === 0) {
    throw new Error(
      `Migration v3 failed: cannot resolve seed for figma_evidence_surfaces.id=${surface.id} file_key=${JSON.stringify(surfaceIdentity.fileKey)} node_id=${JSON.stringify(surfaceIdentity.nodeId)}`
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Migration v3 failed: multiple seeds for figma_evidence_surfaces.id=${surface.id} file_key=${JSON.stringify(surfaceIdentity.fileKey)} node_id=${JSON.stringify(surfaceIdentity.nodeId)} seed_ids=${matches.map((m) => m.id).join(",")}`
    );
  }
  return matches[0].id;
}

/**
 * Ordered migrations. Append new entries for future schema bumps; never rewrite
 * historical `up` bodies once shipped.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up(db) {
      db.exec(V1_BASE_TABLES);

      // Legacy v0 DBs may lack registered_via. Inspect explicitly so an
      // unrelated ALTER failure is never mistaken for "column already exists".
      const seedColumns = seedReferenceColumnNames(db);
      const hasRegisteredVia = seedColumns.includes("registered_via");
      if (!hasRegisteredVia) {
        db.exec(
          `ALTER TABLE seed_references ADD COLUMN registered_via TEXT NOT NULL DEFAULT 'agent'`
        );
      }

      // Retired task plane — drop leftover table/indexes from v0.
      db.exec(`DROP INDEX IF EXISTS idx_tasks_status`);
      db.exec(`DROP INDEX IF EXISTS idx_tasks_family`);
      db.exec(`DROP INDEX IF EXISTS idx_tasks_created_at`);
      db.exec(`DROP TABLE IF EXISTS tasks`);
    }
  },
  {
    version: 2,
    up(db) {
      // Step 1: ALTER + DEFAULT '' only as a temporary vehicle so existing rows
      // can gain columns. Backfill overwrites every value from the original URL
      // (fail-closed). Step 2 rebuilds the table so the final schema is
      // NOT NULL without DEFAULT — SQLite cannot DROP an ALTER-added DEFAULT.
      const seedColumns = seedReferenceColumnNames(db);
      if (!seedColumns.includes("file_key")) {
        db.exec(
          `ALTER TABLE seed_references ADD COLUMN file_key TEXT NOT NULL DEFAULT ''`
        );
      }
      if (!seedColumns.includes("node_id")) {
        db.exec(
          `ALTER TABLE seed_references ADD COLUMN node_id TEXT NOT NULL DEFAULT ''`
        );
      }

      const rows = db
        .prepare(
          `SELECT id, figma_seed_reference FROM seed_references ORDER BY created_at ASC, id ASC`
        )
        .all() as Array<{ id: string; figma_seed_reference: string }>;

      const seen = new Map<string, string>();
      const update = db.prepare(
        `UPDATE seed_references SET file_key = ?, node_id = ? WHERE id = ?`
      );

      for (const row of rows) {
        const identity = parseFigmaSeedIdentity(row.figma_seed_reference);
        if (!identity) {
          throw new Error(
            `Migration v2 failed: cannot parse figma_seed_reference for seed_references.id=${row.id} url=${JSON.stringify(row.figma_seed_reference)}`
          );
        }
        const key = figmaSeedIdentityKey(identity);
        const priorId = seen.get(key);
        if (priorId !== undefined) {
          throw new Error(
            `Migration v2 failed: duplicate canonical identity file_key=${JSON.stringify(identity.fileKey)} node_id=${JSON.stringify(identity.nodeId)} between records ${priorId} and ${row.id}`
          );
        }
        seen.set(key, row.id);
        update.run(identity.fileKey, identity.nodeId, row.id);
      }

      db.exec(`
CREATE TABLE seed_references_v2 (
  id TEXT PRIMARY KEY,
  figma_seed_reference TEXT NOT NULL,
  original_design_intent TEXT NOT NULL,
  created_at TEXT NOT NULL,
  registered_via TEXT NOT NULL DEFAULT 'agent',
  file_key TEXT NOT NULL,
  node_id TEXT NOT NULL
);
`);
      db.exec(`
INSERT INTO seed_references_v2
  (id, figma_seed_reference, original_design_intent, created_at, registered_via, file_key, node_id)
SELECT
  id, figma_seed_reference, original_design_intent, created_at, registered_via, file_key, node_id
FROM seed_references;
`);
      db.exec(`DROP TABLE seed_references`);
      db.exec(`ALTER TABLE seed_references_v2 RENAME TO seed_references`);
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_seed_references_created_at ON seed_references(created_at)`
      );
      db.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_seed_references_file_key_node_id
         ON seed_references(file_key, node_id)`
      );
    }
  },
  {
    version: 3,
    up(db) {
      const seedColumns = seedReferenceColumnNames(db);
      if (!seedColumns.includes("current_surface_id")) {
        db.exec(
          `ALTER TABLE seed_references
           ADD COLUMN current_surface_id TEXT
           REFERENCES figma_evidence_surfaces(id)`
        );
      }

      const surfaces = db
        .prepare(
          `SELECT id, seed_reference_id, figma_seed_reference, frame_node_id,
                  frame_name, frame_bounds_json, evidence_views_json,
                  screenshot_artifact_path, screenshot_data_url,
                  design_signals_json, surface_bounds_json, created_at
           FROM figma_evidence_surfaces
           ORDER BY created_at ASC, id ASC`
        )
        .all() as LegacySurfaceRow[];

      const resolvedSeedBySurfaceId = new Map<string, string>();
      for (const surface of surfaces) {
        resolvedSeedBySurfaceId.set(
          surface.id,
          resolveLegacySurfaceSeedId(db, surface)
        );
      }

      const surfacesBySeed = new Map<string, LegacySurfaceRow[]>();
      for (const surface of surfaces) {
        const seedId = resolvedSeedBySurfaceId.get(surface.id)!;
        const list = surfacesBySeed.get(seedId) ?? [];
        list.push(surface);
        surfacesBySeed.set(seedId, list);
      }

      const supersededBy = new Map<string, string | null>();
      const currentBySeed = new Map<string, string>();
      for (const [seedId, list] of surfacesBySeed) {
        // Already ordered by created_at ASC, id ASC from the global query,
        // but re-sort per seed for safety.
        list.sort((a, b) => {
          if (a.created_at !== b.created_at) {
            return a.created_at < b.created_at ? -1 : 1;
          }
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
        for (let i = 0; i < list.length; i++) {
          const next = list[i + 1];
          supersededBy.set(list[i].id, next ? next.id : null);
        }
        currentBySeed.set(seedId, list[list.length - 1].id);
      }

      db.exec(`
CREATE TABLE figma_evidence_surfaces_v3 (
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
  superseded_by TEXT REFERENCES figma_evidence_surfaces_v3(id)
);
`);

      const insert = db.prepare(
        `INSERT INTO figma_evidence_surfaces_v3 (
          id, seed_reference_id, figma_seed_reference,
          frame_node_id, frame_name, frame_bounds_json,
          evidence_views_json, screenshot_artifact_path, screenshot_data_url,
          design_signals_json, surface_bounds_json, created_at, superseded_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
      );

      for (const surface of surfaces) {
        insert.run(
          surface.id,
          resolvedSeedBySurfaceId.get(surface.id)!,
          surface.figma_seed_reference,
          surface.frame_node_id,
          surface.frame_name,
          surface.frame_bounds_json,
          surface.evidence_views_json,
          surface.screenshot_artifact_path,
          surface.screenshot_data_url,
          surface.design_signals_json,
          surface.surface_bounds_json,
          surface.created_at
        );
      }

      const updateSuperseded = db.prepare(
        `UPDATE figma_evidence_surfaces_v3 SET superseded_by = ? WHERE id = ?`
      );
      for (const [surfaceId, nextId] of supersededBy) {
        if (nextId !== null) {
          updateSuperseded.run(nextId, surfaceId);
        }
      }

      db.exec(`DROP TABLE figma_evidence_surfaces`);
      db.exec(
        `ALTER TABLE figma_evidence_surfaces_v3 RENAME TO figma_evidence_surfaces`
      );

      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_figma_evidence_surfaces_created_at
         ON figma_evidence_surfaces(created_at)`
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_figma_evidence_surfaces_frame_node_id
         ON figma_evidence_surfaces(frame_node_id)`
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_figma_evidence_surfaces_seed_reference_id
         ON figma_evidence_surfaces(seed_reference_id)`
      );

      const updateCurrent = db.prepare(
        `UPDATE seed_references SET current_surface_id = ? WHERE id = ?`
      );
      for (const [seedId, surfaceId] of currentBySeed) {
        updateCurrent.run(surfaceId, seedId);
      }

      // Clear current pointers for seeds with no surfaces (explicit null).
      db.exec(
        `UPDATE seed_references SET current_surface_id = NULL
         WHERE id NOT IN (SELECT DISTINCT seed_reference_id FROM figma_evidence_surfaces)`
      );

      const fkViolations = db.prepare("PRAGMA foreign_key_check").all();
      if (fkViolations.length > 0) {
        throw new Error(
          `Migration v3 failed: PRAGMA foreign_key_check violations: ${JSON.stringify(fkViolations)}`
        );
      }
    }
  },
  {
    version: 4,
    up(db) {
      type AnnRow = {
        id: string;
        surface_id: string | null;
        surface_artifact_id: string | null;
        surface_node_id: string | null;
        author: string;
        type: string;
        body: string;
        rect_x: number;
        rect_y: number;
        rect_w: number;
        rect_h: number;
        primary_node_id: string | null;
        candidates_json: string | null;
        created_at: string;
      };

      const annotations = db
        .prepare(
          `SELECT id, surface_id, surface_artifact_id, surface_node_id,
                  author, type, body, rect_x, rect_y, rect_w, rect_h,
                  primary_node_id, candidates_json, created_at
           FROM region_annotations
           ORDER BY created_at ASC, id ASC`
        )
        .all() as AnnRow[];

      const surfaceExists = db.prepare(
        `SELECT 1 AS ok FROM figma_evidence_surfaces WHERE id = ?`
      );

      const resolved: Array<AnnRow & { resolved_surface_id: string }> = [];
      for (const ann of annotations) {
        const direct =
          typeof ann.surface_id === "string" && ann.surface_id.trim().length > 0
            ? ann.surface_id.trim()
            : null;
        const fromArtifact =
          typeof ann.surface_artifact_id === "string" &&
          ann.surface_artifact_id.trim().length > 0
            ? ann.surface_artifact_id.trim()
            : null;

        let resolvedId: string | null = null;
        if (direct !== null) {
          const hit = surfaceExists.get(direct) as { ok: number } | undefined;
          if (!hit) {
            throw new Error(
              `Migration v4 failed: orphan surface_id for region_annotations.id=${ann.id} surface_id=${direct}`
            );
          }
          resolvedId = direct;
        } else if (fromArtifact !== null) {
          const hit = surfaceExists.get(fromArtifact) as
            | { ok: number }
            | undefined;
          if (!hit) {
            throw new Error(
              `Migration v4 failed: cannot resolve surface for region_annotations.id=${ann.id} surface_artifact_id=${fromArtifact}`
            );
          }
          resolvedId = fromArtifact;
        } else {
          throw new Error(
            `Migration v4 failed: cannot resolve surface for region_annotations.id=${ann.id}`
          );
        }

        resolved.push({ ...ann, resolved_surface_id: resolvedId });
      }

      db.exec(`
CREATE TABLE region_annotations_v4 (
  id TEXT PRIMARY KEY,
  surface_id TEXT NOT NULL REFERENCES figma_evidence_surfaces(id) ON DELETE RESTRICT,
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
  created_at TEXT NOT NULL,
  geometry_version TEXT NOT NULL,
  from_point INTEGER NOT NULL
);
`);

      const insert = db.prepare(
        `INSERT INTO region_annotations_v4 (
          id, surface_id, surface_artifact_id, surface_node_id,
          author, type, body,
          rect_x, rect_y, rect_w, rect_h,
          primary_node_id, candidates_json, created_at,
          geometry_version, from_point
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'v1_padded', 0)`
      );

      for (const ann of resolved) {
        insert.run(
          ann.id,
          ann.resolved_surface_id,
          ann.surface_artifact_id,
          ann.surface_node_id,
          ann.author,
          ann.type,
          ann.body,
          ann.rect_x,
          ann.rect_y,
          ann.rect_w,
          ann.rect_h,
          ann.primary_node_id,
          ann.candidates_json,
          ann.created_at
        );
      }

      db.exec(`DROP TABLE region_annotations`);
      db.exec(
        `ALTER TABLE region_annotations_v4 RENAME TO region_annotations`
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_region_annotations_created_at
         ON region_annotations(created_at)`
      );
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_region_annotations_surface_id
         ON region_annotations(surface_id)`
      );

      const fkViolations = db.prepare("PRAGMA foreign_key_check").all();
      if (fkViolations.length > 0) {
        throw new Error(
          `Migration v4 failed: PRAGMA foreign_key_check violations: ${JSON.stringify(fkViolations)}`
        );
      }
    }
  },
  {
    version: 5,
    up(db) {
      // Runtime-owned Figma positional node index (ADR 0003 / Issue 05A).
      db.exec(
        `ALTER TABLE figma_evidence_surfaces
         ADD COLUMN positional_nodes_json TEXT`
      );
    }
  },
  {
    version: 6,
    up(db) {
      // Project-scoped Design Language Description (Issue 05B) — one row.
      db.exec(`
CREATE TABLE IF NOT EXISTS project_meta (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  design_language_description TEXT NOT NULL DEFAULT ''
);
`);
      db.prepare(
        `INSERT OR IGNORE INTO project_meta (singleton, design_language_description)
         VALUES (1, '')`
      ).run();
    }
  },
  {
    version: 7,
    up(db) {
      // Issue 06: make the annotation target an explicit, versioned union.
      // Existing region annotations retain their original surface anchor.
      db.exec(`
ALTER TABLE region_annotations
  ADD COLUMN target_kind TEXT NOT NULL DEFAULT 'figma-region';
ALTER TABLE region_annotations
  ADD COLUMN target_evidence_version_id TEXT;
ALTER TABLE region_annotations
  ADD COLUMN target_node_id TEXT;
UPDATE region_annotations
SET target_evidence_version_id = surface_id
WHERE target_evidence_version_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_region_annotations_target_evidence_version_id
  ON region_annotations(target_evidence_version_id);
CREATE TABLE annotation_primary_confirmations (
  id TEXT PRIMARY KEY,
  annotation_id TEXT NOT NULL REFERENCES region_annotations(id) ON DELETE CASCADE,
  evidence_version_id TEXT NOT NULL REFERENCES figma_evidence_surfaces(id) ON DELETE RESTRICT,
  source_node_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_annotation_primary_confirmations_annotation_id
  ON annotation_primary_confirmations(annotation_id);
INSERT INTO annotation_primary_confirmations (
  id, annotation_id, evidence_version_id, source_node_id, created_at
)
SELECT
  'legacy-primary:' || id,
  id,
  surface_id,
  primary_node_id,
  created_at
FROM region_annotations
WHERE primary_node_id IS NOT NULL AND TRIM(primary_node_id) <> '';
      `);
    }
  },
  {
    version: 8,
    up(db) {
      // Issue 07: Runtime-owned six-part Design Intent Alignment records.
      db.exec(`
CREATE TABLE design_intent_alignment (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  status TEXT NOT NULL DEFAULT 'draft',
  completed_at TEXT
);
INSERT OR IGNORE INTO design_intent_alignment (singleton, status)
VALUES (1, 'draft');

CREATE TABLE agent_alignment_annotations (
  id TEXT PRIMARY KEY,
  inference TEXT NOT NULL,
  body TEXT NOT NULL,
  additional_information_json TEXT NOT NULL DEFAULT '[]',
  anchor_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE alignment_question_cards (
  id TEXT PRIMARY KEY,
  section TEXT NOT NULL,
  observation TEXT NOT NULL,
  question TEXT NOT NULL,
  proposed_answer TEXT,
  final_answer TEXT,
  answer_source TEXT,
  anchor_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_alignment_question_cards_section
  ON alignment_question_cards(section);
CREATE INDEX idx_alignment_question_cards_created_at
  ON alignment_question_cards(created_at);
      `);
    }
  },
  {
    version: 9,
    up(db) {
      // Issue 07 Figma parity: gray Agent Annotation cards have a short title.
      db.exec(`
ALTER TABLE agent_alignment_annotations
  ADD COLUMN title TEXT NOT NULL DEFAULT 'Agent Annotation';
`);
    }
  },
  {
    version: 10,
    up(db) {
      // Issue 07A: durable workflow handoff from Seed Reference registration
      // into an immutable Alignment input snapshot and Agent command.
      db.exec(`
CREATE TABLE alignment_input_snapshots (
  id TEXT PRIMARY KEY,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TRIGGER alignment_input_snapshots_no_update
BEFORE UPDATE ON alignment_input_snapshots
BEGIN
  SELECT RAISE(ABORT, 'alignment_input_snapshot_immutable');
END;
CREATE TRIGGER alignment_input_snapshots_no_delete
BEFORE DELETE ON alignment_input_snapshots
BEGIN
  SELECT RAISE(ABORT, 'alignment_input_snapshot_immutable');
END;

CREATE TABLE alignment_attempts (
  id TEXT PRIMARY KEY,
  input_snapshot_id TEXT NOT NULL REFERENCES alignment_input_snapshots(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('preparing', 'answering', 'completed', 'abandoned')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  abandoned_at TEXT
);

CREATE TABLE agent_commands (
  id TEXT PRIMARY KEY,
  command_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'claimed', 'completed', 'cancelled', 'failed')),
  alignment_attempt_id TEXT NOT NULL REFERENCES alignment_attempts(id) ON DELETE RESTRICT,
  payload_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  claimed_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT
);
CREATE INDEX idx_agent_commands_status_created_at
  ON agent_commands(status, created_at, id);
CREATE INDEX idx_agent_commands_alignment_attempt_id
  ON agent_commands(alignment_attempt_id);

CREATE TABLE project_workflow (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  stage TEXT NOT NULL CHECK (stage IN (
    'seed-reference-registration',
    'alignment-preparing',
    'alignment-answering',
    'initial-design-system-preparing'
  )),
  current_alignment_attempt_id TEXT REFERENCES alignment_attempts(id) ON DELETE RESTRICT,
  updated_at TEXT
);

ALTER TABLE alignment_question_cards
  ADD COLUMN alignment_attempt_id TEXT REFERENCES alignment_attempts(id) ON DELETE RESTRICT;
ALTER TABLE agent_alignment_annotations
  ADD COLUMN alignment_attempt_id TEXT REFERENCES alignment_attempts(id) ON DELETE RESTRICT;
      `);

      const legacyState = db
        .prepare(
          `SELECT status, completed_at
           FROM design_intent_alignment
           WHERE singleton = 1`
        )
        .get() as { status: string; completed_at: string | null } | undefined;
      const legacyQuestionCount = (
        db
          .prepare("SELECT COUNT(*) AS count FROM alignment_question_cards")
          .get() as { count: number }
      ).count;
      const hasLegacyAttempt =
        legacyQuestionCount > 0 || legacyState?.status === "completed";

      if (hasLegacyAttempt) {
        const now = legacyState?.completed_at ?? new Date().toISOString();
        const description = db
          .prepare(
            `SELECT design_language_description AS value
             FROM project_meta WHERE singleton = 1`
          )
          .get() as { value: string } | undefined;
        const seedRows = db
          .prepare(
            `SELECT s.id, s.figma_seed_reference, s.file_key, s.node_id,
                    s.original_design_intent AS reference_note,
                    e.id AS evidence_version_id, e.frame_node_id,
                    e.frame_name, e.created_at AS evidence_created_at
             FROM seed_references s
             LEFT JOIN figma_evidence_surfaces e ON e.id = s.current_surface_id
             ORDER BY s.created_at ASC, s.id ASC`
          )
          .all() as Array<Record<string, unknown>>;
        const snapshot = {
          design_language_description: description?.value ?? "",
          seed_references: seedRows.map((row) => ({
            id: String(row.id),
            figma_seed_reference: String(row.figma_seed_reference),
            file_key: String(row.file_key),
            node_id: String(row.node_id),
            reference_note: String(row.reference_note ?? ""),
            evidence_version:
              typeof row.evidence_version_id === "string"
                ? {
                    id: row.evidence_version_id,
                    frame_node_id: String(row.frame_node_id),
                    frame_name: String(row.frame_name),
                    created_at: String(row.evidence_created_at)
                  }
                : null
          }))
        };
        db.prepare(
          `INSERT INTO alignment_input_snapshots (id, snapshot_json, created_at)
           VALUES ('legacy-alignment-snapshot', ?, ?)`
        ).run(JSON.stringify(snapshot), now);
        db.prepare(
          `INSERT INTO alignment_attempts
             (id, input_snapshot_id, status, created_at, updated_at, completed_at, abandoned_at)
           VALUES ('legacy-alignment-attempt', 'legacy-alignment-snapshot', ?, ?, ?, ?, NULL)`
        ).run(
          legacyState?.status === "completed" ? "completed" : "answering",
          now,
          now,
          legacyState?.status === "completed" ? now : null
        );
        db.exec(
          `UPDATE alignment_question_cards
           SET alignment_attempt_id = 'legacy-alignment-attempt';
           UPDATE agent_alignment_annotations
           SET alignment_attempt_id = 'legacy-alignment-attempt';`
        );
        db.prepare(
          `INSERT INTO project_workflow
             (singleton, stage, current_alignment_attempt_id, updated_at)
           VALUES (1, ?, 'legacy-alignment-attempt', ?)`
        ).run(
          legacyState?.status === "completed"
            ? "initial-design-system-preparing"
            : "alignment-answering",
          now
        );
      } else {
        db.exec(`
INSERT INTO project_workflow
  (singleton, stage, current_alignment_attempt_id, updated_at)
VALUES (1, 'seed-reference-registration', NULL, NULL);
        `);
      }
    }
  },
  {
    version: 11,
    up(db) {
      // Issue 07B: each Agent-authored question belongs to one Alignment
      // attempt and has a stable delivery key for safe MCP retries.
      db.exec(`
ALTER TABLE alignment_question_cards
  ADD COLUMN agent_idempotency_key TEXT;
CREATE UNIQUE INDEX idx_alignment_question_attempt_delivery
  ON alignment_question_cards(alignment_attempt_id, agent_idempotency_key)
  WHERE alignment_attempt_id IS NOT NULL AND agent_idempotency_key IS NOT NULL;
      `);
    }
  },
  {
    version: 12,
    up(db) {
      // Agent Annotations are mandatory preparation outputs, so retries must
      // be attempt-bound and idempotent just like Question cards.
      db.exec(`
ALTER TABLE agent_alignment_annotations
  ADD COLUMN agent_idempotency_key TEXT;
CREATE UNIQUE INDEX idx_agent_annotation_attempt_delivery
  ON agent_alignment_annotations(alignment_attempt_id, agent_idempotency_key)
  WHERE alignment_attempt_id IS NOT NULL AND agent_idempotency_key IS NOT NULL;
      `);
    }
  },
  {
    version: 13,
    up(db) {
      // Agent Annotations belong to one Alignment section. The nullable
      // column keeps historical annotations readable without pretending that
      // a legacy global annotation belongs to every section.
      db.exec(`
ALTER TABLE agent_alignment_annotations
  ADD COLUMN section TEXT;
CREATE INDEX idx_agent_annotation_attempt_section
  ON agent_alignment_annotations(alignment_attempt_id, section);
      `);
    }
  },
  {
    version: 14,
    up(db) {
      // Designer Annotations belong to one six-part section. The nullable
      // column keeps historical annotations readable without pretending that
      // a legacy annotation belongs to a section it never declared.
      db.exec(`
ALTER TABLE region_annotations
  ADD COLUMN section TEXT;
      `);
    }
  },
  {
    version: 15,
    up(db) {
      // Issue 08: artifact index for declared + validated source artifacts.
      // `path` is the canonical project-relative path (index identity);
      // re-declaration updates the row and bumps declaration_version.
      db.exec(`
CREATE TABLE IF NOT EXISTS source_artifacts (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  semantic_purpose TEXT NOT NULL,
  related_record_ids_json TEXT NOT NULL DEFAULT '[]',
  readiness TEXT,
  declaration_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'declared',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_source_artifacts_path
  ON source_artifacts(path);
CREATE INDEX IF NOT EXISTS idx_source_artifacts_artifact_type
  ON source_artifacts(artifact_type);
CREATE INDEX IF NOT EXISTS idx_source_artifacts_created_at
  ON source_artifacts(created_at);
      `);
    }
  },
  {
    version: 16,
    up(db) {
      // Issue 09 / 09A (Task C): ingested design-system content is the
      // Runtime truth the Browser reads (09A decision 2 — the Browser never
      // reads the source files or the derived view.json export). Entries are
      // keyed by (source file, entry id); re-ingest of a file replaces its
      // rows wholesale in one transaction, never hand-merged. Structured
      // payloads (token values incl. the reserved `alias` key, component
      // props / boundaries / stateMatrix, rule objects) stay in value_json;
      // `position` preserves source-file order inside each section.
      db.exec(`
CREATE TABLE IF NOT EXISTS design_system_entries (
  id TEXT PRIMARY KEY,
  file_kind TEXT NOT NULL,
  section TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  name TEXT,
  value_json TEXT NOT NULL,
  meaning TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('formalized', 'candidate', 'gap')),
  links_json TEXT NOT NULL DEFAULT '[]',
  source_artifact_path TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_design_system_entries_source_entry
  ON design_system_entries(source_artifact_path, entry_id);
CREATE INDEX IF NOT EXISTS idx_design_system_entries_section
  ON design_system_entries(section);
CREATE INDEX IF NOT EXISTS idx_design_system_entries_file_kind
  ON design_system_entries(file_kind);
CREATE INDEX IF NOT EXISTS idx_design_system_entries_status
  ON design_system_entries(status);

-- File-level meta from design-system.json (the system name is not an entry).
CREATE TABLE IF NOT EXISTS design_system_meta (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  name TEXT NOT NULL DEFAULT '',
  updated_at TEXT
);
INSERT OR IGNORE INTO design_system_meta (singleton, name, updated_at)
VALUES (1, '', NULL);
      `);
    }
  },
  {
    version: 17,
    up(db) {
      // Issue 09B: one replace-by-attempt extraction manifest records the
      // atomic Alignment claims and their design-system entry targets. The
      // manifest is a Runtime semantic record, not a source artifact.
      // Token domain is stored separately from value_json so consumers can
      // classify known typography/color/material decisions deterministically;
      // NULL preserves backward compatibility with pre-09B sources.
      const designSystemColumns = db
        .prepare("PRAGMA table_info(design_system_entries)")
        .all() as Array<{ name: string }>;
      if (!designSystemColumns.some((column) => column.name === "domain")) {
        db.exec("ALTER TABLE design_system_entries ADD COLUMN domain TEXT");
      }
      db.exec(`
CREATE TABLE IF NOT EXISTS design_system_extraction_manifests (
  id TEXT PRIMARY KEY,
  alignment_attempt_id TEXT NOT NULL UNIQUE
    REFERENCES alignment_attempts(id) ON DELETE RESTRICT,
  agent_command_id TEXT NOT NULL
    REFERENCES agent_commands(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_design_system_extraction_manifest_command
  ON design_system_extraction_manifests(agent_command_id);

-- Keep every idempotency result so a delayed retry of v1 can never replace a
-- newer corrected manifest v2.
CREATE TABLE IF NOT EXISTS design_system_extraction_manifest_requests (
  alignment_attempt_id TEXT NOT NULL
    REFERENCES alignment_attempts(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  manifest_id TEXT NOT NULL
    REFERENCES design_system_extraction_manifests(id) ON DELETE RESTRICT,
  agent_command_id TEXT NOT NULL
    REFERENCES agent_commands(id) ON DELETE RESTRICT,
  manifest_json TEXT NOT NULL,
  manifest_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (alignment_attempt_id, idempotency_key)
);
      `);
    }
  },
  {
    version: 18,
    up(db) {
      // Designer Annotation deletion is reversible from the Workbench. Keep
      // the exact Runtime-owned row (plus primary-node confirmations) outside
      // the live annotation table so Command-Z can restore identity, text,
      // evidence target, and geometry without trusting a canvas projection.
      db.exec(`
CREATE TABLE IF NOT EXISTS region_annotation_delete_tombstones (
  annotation_id TEXT PRIMARY KEY,
  annotation_json TEXT NOT NULL,
  confirmations_json TEXT NOT NULL DEFAULT '[]',
  deleted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_region_annotation_tombstones_deleted_at
  ON region_annotation_delete_tombstones(deleted_at);
      `);
    }
  },
  {
    version: 19,
    up(db) {
      // Issue 09B / 09C-D04: preserve the declared foundation entry kind
      // independently from value_json so Browser projection can separate
      // domain rules from tokens without inference. NULL is the legacy value.
      const designSystemColumns = db
        .prepare("PRAGMA table_info(design_system_entries)")
        .all() as Array<{ name: string }>;
      if (!designSystemColumns.some((column) => column.name === "kind")) {
        db.exec("ALTER TABLE design_system_entries ADD COLUMN kind TEXT");
      }
    }
  },
  {
    version: 20,
    up(db) {
      const columns = db
        .prepare("PRAGMA table_info(design_system_entries)")
        .all() as Array<{ name: string }>;
      if (!columns.some((column) => column.name === "source_captures_json")) {
        db.exec(
          "ALTER TABLE design_system_entries ADD COLUMN source_captures_json TEXT NOT NULL DEFAULT '[]'"
        );
      }
    }
  },
  {
    version: 21,
    up(db) {
      // Historical v21 normalization: primitive color rows created before
      // token meanings were retired stored usage prose in this column. New
      // token source entries omit meaning entirely; domain rules still keep
      // their rule title. The migration remains immutable for old databases.
      db.exec(
        `UPDATE design_system_entries SET meaning = ''
         WHERE section = 'token.primitive' AND domain = 'color'
           AND (kind IS NULL OR kind <> 'domain-rule')`
      );
    }
  },
  {
    version: 22,
    up(db) {
      // Progressive extraction deliberately does not read the legacy atomic
      // manifest payload. Test-stage projects must re-extract from their
      // frozen Alignment input using output work units and a global audit.
      db.exec(`
DELETE FROM design_system_extraction_manifest_requests;
DELETE FROM design_system_extraction_manifests;
UPDATE agent_commands
SET status = 'pending', claimed_at = NULL, completed_at = NULL,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE command_type = 'prepare_initial_design_system'
  AND status = 'completed'
  AND alignment_attempt_id = (
    SELECT current_alignment_attempt_id
    FROM project_workflow
    WHERE singleton = 1
  );
      `);
    }
  },
  {
    version: 23,
    up(db) {
      // Lazy file→DB sync (design-system-sync) needs the declared content
      // digest to detect undeclared source edits. Null means "unknown" —
      // pre-v23 rows re-ingest once on first sync and then stay current.
      const columns = db
        .prepare("PRAGMA table_info(source_artifacts)")
        .all() as Array<{ name: string }>;
      if (!columns.some((column) => column.name === "content_digest")) {
        db.exec(
          "ALTER TABLE source_artifacts ADD COLUMN content_digest TEXT"
        );
      }
    }
  },
  {
    version: 24,
    up(db) {
      // Issue 27: chat-first designer feedback declarations. Write-only
      // record store; Consolidate reads land in Issue 29. Prototype surface
      // ids are stored without FK until Issue 30 creates that table.
      db.exec(`
CREATE TABLE IF NOT EXISTS designer_feedback (
  id TEXT PRIMARY KEY,
  summary TEXT NOT NULL,
  run_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  evidence_surface_id TEXT REFERENCES figma_evidence_surfaces(id),
  prototype_surface_id TEXT,
  region_annotation_id TEXT REFERENCES region_annotations(id),
  seed_reference_id TEXT REFERENCES seed_references(id),
  opaque_context_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_designer_feedback_created_at
  ON designer_feedback(created_at);
CREATE INDEX IF NOT EXISTS idx_designer_feedback_run_session
  ON designer_feedback(run_id, session_id);
      `);
    }
  },
  {
    version: 25,
    up(db) {
      // Issue 28: project completion-phase state machine. Issue 29 writes
      // designer_feedback_review_consumption when a confirmed proposal
      // consumes feedback; Issue 28 formalize only reads that table.
      const now = new Date().toISOString();
      db.exec(`
CREATE TABLE IF NOT EXISTS project_phase (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  phase TEXT NOT NULL CHECK (phase IN (
    'seed',
    'draft_design_system',
    'prototype_validation',
    'design_system_formal',
    'ready_for_new_design'
  )),
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS designer_feedback_review_consumption (
  feedback_id TEXT PRIMARY KEY
    REFERENCES designer_feedback(id) ON DELETE RESTRICT,
  proposal_id TEXT NOT NULL,
  consumed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_review_consumption_proposal
  ON designer_feedback_review_consumption(proposal_id);
      `);
      db.prepare(
        `INSERT OR IGNORE INTO project_phase (singleton, phase, updated_at)
         VALUES (1, 'seed', ?)`
      ).run(now);
      const completedExtraction = db
        .prepare(
          `SELECT 1 AS ok FROM agent_commands
           WHERE command_type = 'prepare_initial_design_system'
             AND status = 'completed'
           LIMIT 1`
        )
        .get() as { ok: number } | undefined;
      if (completedExtraction) {
        db.prepare(
          `UPDATE project_phase
           SET phase = 'draft_design_system', updated_at = ?
           WHERE singleton = 1 AND phase = 'seed'`
        ).run(now);
      }
    }
  },
  {
    version: 26,
    up(db) {
      // Issue 29 (MVP chat path): rule-update proposals become durable rows,
      // not event-only records, so confirm/cancel can flip one identity and
      // record_artifact_written can require a confirmed proposal id. Every
      // feedback row needs an explicit disposition — consumed by a confirmed
      // proposal (v25 table) or dismissed with a reason here.
      db.exec(`
CREATE TABLE IF NOT EXISTS rule_update_proposals (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('new', 'update', 'move')),
  classification TEXT NOT NULL CHECK (classification IN (
    'local_exception',
    'reusable_candidate',
    'rule_conflict',
    'open_gap',
    'proposed_update',
    'no_finding'
  )),
  title TEXT NOT NULL,
  change_description TEXT NOT NULL,
  reason TEXT NOT NULL,
  affected_items_json TEXT NOT NULL,
  evidence_record_ids_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'awaiting_confirmation',
    'confirmed',
    'canceled'
  )),
  source_artifact_path TEXT,
  entry_id TEXT,
  proposed_target_path TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_rule_update_proposals_status
  ON rule_update_proposals(status);
CREATE INDEX IF NOT EXISTS idx_rule_update_proposals_created_at
  ON rule_update_proposals(created_at);

CREATE TABLE IF NOT EXISTS designer_feedback_dismissals (
  feedback_id TEXT PRIMARY KEY
    REFERENCES designer_feedback(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  dismissed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_designer_feedback_dismissals_dismissed_at
  ON designer_feedback_dismissals(dismissed_at);
      `);
    }
  },
  {
    version: 27,
    up(db) {
      // Issue 30: prototype runs and their Prototype Evidence Surfaces. A run
      // freezes the inputs a reconstruction was built from (seed reference
      // ids, evidence versions, design-system version) so a later reading can
      // tell which evidence a preview actually reflects. Surfaces carry the
      // Runtime-owned dev-server lifecycle: readiness is explicit
      // (installing / starting / ready / failed) instead of a vague loading
      // state, and the port is persisted so the preview URL stays stable
      // across restarts. `stale` marks a surface whose dev server exited or
      // whose code changed; Runtime never auto-restarts it.
      //
      // designer_feedback.prototype_surface_id (v24) has no FK — SQLite
      // cannot add one to an existing table. prototype_surface_id linkage is
      // enforced in designer-feedback.ts against this table instead.
      db.exec(`
CREATE TABLE IF NOT EXISTS prototype_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  source_artifact_path TEXT NOT NULL,
  prototype_root TEXT NOT NULL,
  dev_command TEXT NOT NULL,
  seed_reference_ids_json TEXT NOT NULL,
  evidence_version_ids_json TEXT NOT NULL,
  design_system_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prototype_runs_created_at
  ON prototype_runs(created_at);

CREATE TABLE IF NOT EXISTS prototype_surfaces (
  id TEXT PRIMARY KEY,
  prototype_run_id TEXT NOT NULL
    REFERENCES prototype_runs(id) ON DELETE RESTRICT,
  surface_key TEXT NOT NULL,
  name TEXT NOT NULL,
  preview_url TEXT NOT NULL,
  preview_port INTEGER NOT NULL,
  readiness TEXT NOT NULL CHECK (readiness IN (
    'installing',
    'starting',
    'ready',
    'failed'
  )),
  readiness_reason TEXT,
  stale INTEGER NOT NULL DEFAULT 0,
  stale_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (prototype_run_id, surface_key)
);
CREATE INDEX IF NOT EXISTS idx_prototype_surfaces_run
  ON prototype_surfaces(prototype_run_id);
CREATE INDEX IF NOT EXISTS idx_prototype_surfaces_created_at
  ON prototype_surfaces(created_at);
      `);
    }
  }
];

export function getUserVersion(db: DatabaseType): number {
  return (db.prepare("PRAGMA user_version").get() as { user_version: number })
    .user_version;
}

export function setUserVersion(db: DatabaseType, version: number): void {
  // PRAGMA user_version cannot be bound as a parameter.
  db.exec(`PRAGMA user_version = ${Number(version)}`);
}

export function applyPendingMigrations(
  db: DatabaseType,
  fromVersion: number,
  migrations: readonly Migration[] = MIGRATIONS
): void {
  for (const migration of migrations) {
    if (migration.version <= fromVersion) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      migration.up(db);
      setUserVersion(db, migration.version);
      db.exec("COMMIT");
    } catch (migrationError) {
      try {
        db.exec("ROLLBACK");
      } catch (rollbackError) {
        throw new AggregateError(
          [migrationError, rollbackError],
          `Migration to version ${migration.version} failed and rollback also failed`
        );
      }
      throw migrationError;
    }
  }
}
