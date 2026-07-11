// Versioned SQLite schema migrations for project `.ikran/ikran.db`.
//
// `PRAGMA user_version` is the source of truth. Existing DBs without an
// explicit version are treated as v0. New databases land at CURRENT_SCHEMA_VERSION.

import type { DatabaseSync as DatabaseType } from "node:sqlite";
import {
  parseFigmaSeedIdentity,
  figmaSeedIdentityKey
} from "./figma-identity";

export const CURRENT_SCHEMA_VERSION = 4;

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
