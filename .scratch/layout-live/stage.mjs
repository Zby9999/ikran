// .scratch/layout-live/stage.ts
import { mkdirSync as mkdirSync2, rmSync, writeFileSync } from "node:fs";
import path6 from "node:path";

// lib/runtime/evidence-package.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import { existsSync as existsSync2, realpathSync } from "node:fs";
import path2 from "node:path";

// lib/runtime/db.ts
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, statSync } from "node:fs";

// lib/runtime/paths.ts
import { homedir } from "node:os";
import path from "node:path";
var HOME = homedir();
var STATE_DIR_OVERRIDE = process.env.IKRAN_STATE_DIR;
var RUNTIME_STATE_DIR = STATE_DIR_OVERRIDE ? path.resolve(STATE_DIR_OVERRIDE) : path.join(HOME, ".ikran");
var RUNTIME_STATE_FILE = path.join(RUNTIME_STATE_DIR, "runtime-state.json");
function getIkranDir(projectPath) {
  return path.resolve(projectPath, ".ikran");
}
function getProjectDbPath(projectPath) {
  return path.join(getIkranDir(projectPath), "ikran.db");
}

// lib/runtime/figma-identity.ts
function normalizeFigmaNodeId(raw) {
  return raw.trim().replace(/-/g, ":");
}
function isFigmaHostname(hostname) {
  return hostname === "figma.com" || hostname === "www.figma.com";
}
function hasFigmaDesignOrFilePath(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  return parts.length >= 2 && (parts[0] === "design" || parts[0] === "file") && Boolean(parts[1]);
}
function parseFigmaSeedIdentity(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (!isFigmaHostname(url.hostname)) return null;
  if (!hasFigmaDesignOrFilePath(url.pathname)) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const fileKey = parts[1];
  const rawNode = url.searchParams.get("node-id") ?? url.searchParams.get("nodeId") ?? "";
  const nodeId = normalizeFigmaNodeId(rawNode);
  return { fileKey, nodeId };
}
function figmaSeedIdentitiesEqual(a, b) {
  return a.fileKey === b.fileKey && a.nodeId === b.nodeId;
}
function figmaSeedIdentityKey(identity) {
  return `${identity.fileKey}\0${identity.nodeId}`;
}

// lib/runtime/migrations.ts
var CURRENT_SCHEMA_VERSION = 18;
var V1_BASE_TABLES = `
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
function seedReferenceColumnNames(db) {
  return db.prepare("PRAGMA table_info(seed_references)").all().map((column) => column.name);
}
function resolveLegacySurfaceSeedId(db, surface) {
  const surfaceIdentity = parseFigmaSeedIdentity(surface.figma_seed_reference);
  if (!surfaceIdentity) {
    throw new Error(
      `Migration v3 failed: cannot parse figma_seed_reference for figma_evidence_surfaces.id=${surface.id} url=${JSON.stringify(surface.figma_seed_reference)}`
    );
  }
  const linkedId = typeof surface.seed_reference_id === "string" && surface.seed_reference_id.trim().length > 0 ? surface.seed_reference_id.trim() : null;
  if (linkedId !== null) {
    const seed2 = db.prepare(
      `SELECT id, file_key, node_id FROM seed_references WHERE id = ?`
    ).get(linkedId);
    if (!seed2) {
      throw new Error(
        `Migration v3 failed: orphan seed_reference_id for figma_evidence_surfaces.id=${surface.id} seed_reference_id=${linkedId}`
      );
    }
    if (seed2.file_key !== surfaceIdentity.fileKey || seed2.node_id !== surfaceIdentity.nodeId) {
      throw new Error(
        `Migration v3 failed: canonical identity mismatch for figma_evidence_surfaces.id=${surface.id} seed_reference_id=${seed2.id} surface_file_key=${JSON.stringify(surfaceIdentity.fileKey)} surface_node_id=${JSON.stringify(surfaceIdentity.nodeId)} seed_file_key=${JSON.stringify(seed2.file_key)} seed_node_id=${JSON.stringify(seed2.node_id)}`
      );
    }
    return seed2.id;
  }
  const matches = db.prepare(
    `SELECT id, file_key, node_id FROM seed_references
       WHERE file_key = ? AND node_id = ?`
  ).all(surfaceIdentity.fileKey, surfaceIdentity.nodeId);
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
var MIGRATIONS = [
  {
    version: 1,
    up(db) {
      db.exec(V1_BASE_TABLES);
      const seedColumns = seedReferenceColumnNames(db);
      const hasRegisteredVia = seedColumns.includes("registered_via");
      if (!hasRegisteredVia) {
        db.exec(
          `ALTER TABLE seed_references ADD COLUMN registered_via TEXT NOT NULL DEFAULT 'agent'`
        );
      }
      db.exec(`DROP INDEX IF EXISTS idx_tasks_status`);
      db.exec(`DROP INDEX IF EXISTS idx_tasks_family`);
      db.exec(`DROP INDEX IF EXISTS idx_tasks_created_at`);
      db.exec(`DROP TABLE IF EXISTS tasks`);
    }
  },
  {
    version: 2,
    up(db) {
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
      const rows = db.prepare(
        `SELECT id, figma_seed_reference FROM seed_references ORDER BY created_at ASC, id ASC`
      ).all();
      const seen = /* @__PURE__ */ new Map();
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
        if (priorId !== void 0) {
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
      const surfaces = db.prepare(
        `SELECT id, seed_reference_id, figma_seed_reference, frame_node_id,
                  frame_name, frame_bounds_json, evidence_views_json,
                  screenshot_artifact_path, screenshot_data_url,
                  design_signals_json, surface_bounds_json, created_at
           FROM figma_evidence_surfaces
           ORDER BY created_at ASC, id ASC`
      ).all();
      const resolvedSeedBySurfaceId = /* @__PURE__ */ new Map();
      for (const surface of surfaces) {
        resolvedSeedBySurfaceId.set(
          surface.id,
          resolveLegacySurfaceSeedId(db, surface)
        );
      }
      const surfacesBySeed = /* @__PURE__ */ new Map();
      for (const surface of surfaces) {
        const seedId = resolvedSeedBySurfaceId.get(surface.id);
        const list = surfacesBySeed.get(seedId) ?? [];
        list.push(surface);
        surfacesBySeed.set(seedId, list);
      }
      const supersededBy = /* @__PURE__ */ new Map();
      const currentBySeed = /* @__PURE__ */ new Map();
      for (const [seedId, list] of surfacesBySeed) {
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
          resolvedSeedBySurfaceId.get(surface.id),
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
      const annotations = db.prepare(
        `SELECT id, surface_id, surface_artifact_id, surface_node_id,
                  author, type, body, rect_x, rect_y, rect_w, rect_h,
                  primary_node_id, candidates_json, created_at
           FROM region_annotations
           ORDER BY created_at ASC, id ASC`
      ).all();
      const surfaceExists = db.prepare(
        `SELECT 1 AS ok FROM figma_evidence_surfaces WHERE id = ?`
      );
      const resolved = [];
      for (const ann of annotations) {
        const direct = typeof ann.surface_id === "string" && ann.surface_id.trim().length > 0 ? ann.surface_id.trim() : null;
        const fromArtifact = typeof ann.surface_artifact_id === "string" && ann.surface_artifact_id.trim().length > 0 ? ann.surface_artifact_id.trim() : null;
        let resolvedId = null;
        if (direct !== null) {
          const hit = surfaceExists.get(direct);
          if (!hit) {
            throw new Error(
              `Migration v4 failed: orphan surface_id for region_annotations.id=${ann.id} surface_id=${direct}`
            );
          }
          resolvedId = direct;
        } else if (fromArtifact !== null) {
          const hit = surfaceExists.get(fromArtifact);
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
      db.exec(
        `ALTER TABLE figma_evidence_surfaces
         ADD COLUMN positional_nodes_json TEXT`
      );
    }
  },
  {
    version: 6,
    up(db) {
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
      db.exec(`
ALTER TABLE agent_alignment_annotations
  ADD COLUMN title TEXT NOT NULL DEFAULT 'Agent Annotation';
`);
    }
  },
  {
    version: 10,
    up(db) {
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
      const legacyState = db.prepare(
        `SELECT status, completed_at
           FROM design_intent_alignment
           WHERE singleton = 1`
      ).get();
      const legacyQuestionCount = db.prepare("SELECT COUNT(*) AS count FROM alignment_question_cards").get().count;
      const hasLegacyAttempt = legacyQuestionCount > 0 || legacyState?.status === "completed";
      if (hasLegacyAttempt) {
        const now = legacyState?.completed_at ?? (/* @__PURE__ */ new Date()).toISOString();
        const description = db.prepare(
          `SELECT design_language_description AS value
             FROM project_meta WHERE singleton = 1`
        ).get();
        const seedRows = db.prepare(
          `SELECT s.id, s.figma_seed_reference, s.file_key, s.node_id,
                    s.original_design_intent AS reference_note,
                    e.id AS evidence_version_id, e.frame_node_id,
                    e.frame_name, e.created_at AS evidence_created_at
             FROM seed_references s
             LEFT JOIN figma_evidence_surfaces e ON e.id = s.current_surface_id
             ORDER BY s.created_at ASC, s.id ASC`
        ).all();
        const snapshot = {
          design_language_description: description?.value ?? "",
          seed_references: seedRows.map((row) => ({
            id: String(row.id),
            figma_seed_reference: String(row.figma_seed_reference),
            file_key: String(row.file_key),
            node_id: String(row.node_id),
            reference_note: String(row.reference_note ?? ""),
            evidence_version: typeof row.evidence_version_id === "string" ? {
              id: row.evidence_version_id,
              frame_node_id: String(row.frame_node_id),
              frame_name: String(row.frame_name),
              created_at: String(row.evidence_created_at)
            } : null
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
          legacyState?.status === "completed" ? "initial-design-system-preparing" : "alignment-answering",
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
      db.exec(`
ALTER TABLE region_annotations
  ADD COLUMN section TEXT;
      `);
    }
  },
  {
    version: 15,
    up(db) {
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
      const designSystemColumns = db.prepare("PRAGMA table_info(design_system_entries)").all();
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
  }
];
function getUserVersion(db) {
  return db.prepare("PRAGMA user_version").get().user_version;
}
function setUserVersion(db, version) {
  db.exec(`PRAGMA user_version = ${Number(version)}`);
}
function applyPendingMigrations(db, fromVersion, migrations = MIGRATIONS) {
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

// lib/runtime/db.ts
function getProjectDbBackupPath(projectPath, fromVersion) {
  if (!Number.isInteger(fromVersion) || fromVersion < 0) {
    throw new Error(`Invalid database backup source version: ${fromVersion}`);
  }
  return `${getProjectDbPath(projectPath)}.v${fromVersion}.bak`;
}
function isExistingNonEmptyDb(dbPath) {
  if (!existsSync(dbPath)) return false;
  try {
    return statSync(dbPath).size > 0;
  } catch (err) {
    throw new Error(
      `Failed to stat project database before migration: ${dbPath}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
function backupProjectDbBeforeMigration(projectPath, fromVersion) {
  const dbPath = getProjectDbPath(projectPath);
  const bakPath = getProjectDbBackupPath(projectPath, fromVersion);
  if (!isExistingNonEmptyDb(dbPath)) {
    throw new Error(
      `Refusing backup: project database is missing or empty: ${dbPath}`
    );
  }
  if (existsSync(bakPath)) {
    throw new Error(
      `Database migration backup already exists (refusing to overwrite): ${bakPath}`
    );
  }
  const source = new DatabaseSync(dbPath);
  try {
    source.prepare("VACUUM INTO ?").run(bakPath);
  } catch (err) {
    throw new Error(
      `Failed to create database migration backup at ${bakPath}: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    closeProjectDb(source);
  }
  return bakPath;
}
function openProjectDb(projectPath) {
  const dbPath = getProjectDbPath(projectPath);
  mkdirSync(getIkranDir(projectPath), { recursive: true });
  const existedNonEmpty = isExistingNonEmptyDb(dbPath);
  let currentVersion = 0;
  if (existedNonEmpty) {
    const peek = new DatabaseSync(dbPath);
    try {
      peek.exec("PRAGMA busy_timeout = 5000");
      currentVersion = getUserVersion(peek);
    } finally {
      closeProjectDb(peek);
    }
    if (currentVersion < CURRENT_SCHEMA_VERSION) {
      backupProjectDbBeforeMigration(projectPath, currentVersion);
    }
  }
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA journal_mode = WAL");
    currentVersion = getUserVersion(db);
    if (currentVersion < CURRENT_SCHEMA_VERSION) {
      applyPendingMigrations(db, currentVersion);
    }
    const after = getUserVersion(db);
    if (after !== CURRENT_SCHEMA_VERSION) {
      throw new Error(
        `Database schema version mismatch after migration: expected ${CURRENT_SCHEMA_VERSION}, got ${after}`
      );
    }
    return db;
  } catch (err) {
    closeProjectDb(db);
    throw err;
  }
}
function closeProjectDb(db) {
  try {
    db.close();
  } catch {
  }
}
function withProjectTransaction(projectPath, fn) {
  const db = openProjectDb(projectPath);
  try {
    db.exec("BEGIN");
    try {
      const result = fn(db);
      db.exec("COMMIT");
      return result;
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch {
      }
      throw err;
    }
  } finally {
    closeProjectDb(db);
  }
}

// lib/runtime/record-bus.ts
import { EventEmitter } from "node:events";
var GLOBAL_KEY = "__IKRAN_RECORD_BUS__";
function getBus() {
  const g = globalThis;
  if (!g[GLOBAL_KEY]) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(0);
    g[GLOBAL_KEY] = { emitter };
  }
  return g[GLOBAL_KEY];
}
function emitRecordEvent(event) {
  const full = {
    ...event,
    timestamp: event.timestamp ?? (/* @__PURE__ */ new Date()).toISOString()
  };
  for (const listener of getBus().emitter.listeners("record")) {
    try {
      listener(full);
    } catch (err) {
      console.error("[record-bus] listener error:", err);
    }
  }
}

// lib/runtime/events.ts
import { randomUUID } from "node:crypto";
function insertEvent(db, event) {
  const stmt = db.prepare(
    `INSERT INTO events (event_id, type, payload, created_at)
     VALUES (?, ?, ?, ?)`
  );
  stmt.run(event.event_id, event.type, JSON.stringify(event.payload), event.created_at);
}
function buildLoggedEvent(type, payload = {}) {
  return {
    event_id: randomUUID(),
    type,
    payload,
    created_at: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function logEventOnDb(db, type, payload = {}) {
  const event = buildLoggedEvent(type, payload);
  insertEvent(db, event);
  return event;
}
function logEvent(projectPath, type, payload = {}) {
  const event = buildLoggedEvent(type, payload);
  const db = openProjectDb(projectPath);
  try {
    insertEvent(db, event);
  } finally {
    closeProjectDb(db);
  }
  return event;
}
function logInvalidToolEvent(projectPath, type, tool, reason, details) {
  try {
    const payload = {
      tool,
      reason
    };
    if (details !== void 0) payload.details = details;
    logEvent(projectPath, type, payload);
  } catch {
  }
}

// lib/runtime/evidence-package.ts
var SCREENSHOT_DATA_URL_MAX_CHARS = 2e6;
var SCREENSHOT_IMAGE_DATA_URL_RE = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/]+=*$/i;
function isScreenshotImageDataUrl(value) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("data:image/")) return false;
  return SCREENSHOT_IMAGE_DATA_URL_RE.test(trimmed);
}
var DESIGN_SIGNALS_MAX = 20;
function validateFigmaSeedReferenceUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return "invalid_figma_url";
  }
  if (url.protocol !== "https:") {
    return "invalid_figma_url";
  }
  if (url.hostname !== "figma.com" && url.hostname !== "www.figma.com") {
    return "not_figma_host";
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const hasDesignPath = parts.length >= 2 && (parts[0] === "design" || parts[0] === "file");
  if (!hasDesignPath) {
    return "not_figma_design_path";
  }
  return null;
}
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function isEvidenceViewStatus(value) {
  return value === "available" || value === "missing";
}
function fail(reason, details) {
  return details === void 0 ? { ok: false, reason } : { ok: false, reason, details };
}
function validateEvidencePackage(input) {
  if (input === null || typeof input !== "object") {
    return fail("missing_frame", { message: "input must be an object" });
  }
  const raw = input;
  const figmaRaw = raw.figmaSeedReference;
  const seedIdRaw = raw.seedReferenceId;
  const hasFigma = typeof figmaRaw === "string" && figmaRaw.trim().length > 0;
  const hasSeedId = typeof seedIdRaw === "string" && seedIdRaw.trim().length > 0;
  if (!hasFigma && !hasSeedId) {
    return fail("missing_seed_reference");
  }
  let figmaSeedReference;
  if (hasFigma) {
    const urlError = validateFigmaSeedReferenceUrl(figmaRaw);
    if (urlError) {
      return fail(urlError);
    }
    figmaSeedReference = figmaRaw;
  }
  const seedReferenceId = hasSeedId ? seedIdRaw : void 0;
  const frameRaw = raw.frame;
  if (frameRaw === null || typeof frameRaw !== "object") {
    return fail("missing_frame");
  }
  const frameObj = frameRaw;
  if (!isNonEmptyString(frameObj.nodeId)) {
    return fail("missing_frame_node_id");
  }
  if (!isNonEmptyString(frameObj.name)) {
    return fail("missing_frame_name");
  }
  const frame = {
    nodeId: frameObj.nodeId,
    name: frameObj.name
  };
  if (isNonEmptyString(frameObj.fileKey)) {
    frame.fileKey = frameObj.fileKey;
  }
  if (frameObj.bounds !== void 0) {
    if (frameObj.bounds === null || typeof frameObj.bounds !== "object") {
      return fail("invalid_frame_bounds");
    }
    const b = frameObj.bounds;
    if (!isFiniteNumber(b.x) || !isFiniteNumber(b.y) || !isFiniteNumber(b.width) || !isFiniteNumber(b.height)) {
      return fail("invalid_frame_bounds");
    }
    frame.bounds = {
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height
    };
  }
  const viewsRaw = raw.evidenceViews;
  if (viewsRaw === null || typeof viewsRaw !== "object") {
    return fail("missing_evidence_views");
  }
  const viewsObj = viewsRaw;
  if (!isEvidenceViewStatus(viewsObj.rawData) || !isEvidenceViewStatus(viewsObj.screenshot)) {
    return fail("invalid_evidence_views");
  }
  const evidenceViews = {
    rawData: viewsObj.rawData,
    screenshot: viewsObj.screenshot
  };
  let screenshot;
  const shotRaw = raw.screenshot;
  if (evidenceViews.screenshot === "available") {
    if (shotRaw === null || typeof shotRaw !== "object") {
      return fail("screenshot_required_when_available");
    }
    const shot = shotRaw;
    const artifactPath = typeof shot.artifactPath === "string" ? shot.artifactPath : void 0;
    const dataUrl = typeof shot.dataUrl === "string" ? shot.dataUrl : void 0;
    const hasArtifact = typeof artifactPath === "string" && artifactPath.trim().length > 0;
    const hasDataUrl = typeof dataUrl === "string" && dataUrl.trim().length > 0;
    if (!hasArtifact && !hasDataUrl) {
      return fail("screenshot_required_when_available");
    }
    if (hasDataUrl && !isScreenshotImageDataUrl(dataUrl)) {
      return fail("invalid_screenshot_data_url");
    }
    if (hasDataUrl && dataUrl.length > SCREENSHOT_DATA_URL_MAX_CHARS) {
      return fail("screenshot_too_large", {
        maxChars: SCREENSHOT_DATA_URL_MAX_CHARS,
        length: dataUrl.length
      });
    }
    screenshot = {};
    if (hasArtifact) screenshot.artifactPath = artifactPath;
    if (hasDataUrl) screenshot.dataUrl = dataUrl.trim();
  } else {
    if (shotRaw !== void 0 && shotRaw !== null) {
      if (typeof shotRaw !== "object") {
        return fail("screenshot_payload_when_missing");
      }
      const shot = shotRaw;
      const hasArtifact = typeof shot.artifactPath === "string" && shot.artifactPath.trim().length > 0;
      const hasDataUrl = typeof shot.dataUrl === "string" && shot.dataUrl.trim().length > 0;
      if (hasArtifact || hasDataUrl) {
        return fail("screenshot_payload_when_missing");
      }
    }
  }
  let designSignals;
  if (raw.designSignals !== void 0) {
    if (!Array.isArray(raw.designSignals)) {
      return fail("invalid_design_signals");
    }
    if (raw.designSignals.length > DESIGN_SIGNALS_MAX) {
      return fail("design_signals_too_many", { max: DESIGN_SIGNALS_MAX });
    }
    designSignals = [];
    for (let i = 0; i < raw.designSignals.length; i++) {
      const item = raw.designSignals[i];
      if (item === null || typeof item !== "object") {
        return fail("invalid_design_signals", { index: i });
      }
      const s = item;
      if (!isNonEmptyString(s.id) || !isNonEmptyString(s.label) || !isNonEmptyString(s.evidence)) {
        return fail("invalid_design_signals", { index: i });
      }
      designSignals.push({
        id: s.id,
        label: s.label,
        evidence: s.evidence
      });
    }
  }
  let surfaceBounds;
  if (raw.surfaceBounds !== void 0) {
    if (raw.surfaceBounds === null || typeof raw.surfaceBounds !== "object") {
      return fail("invalid_surface_bounds");
    }
    const sb = raw.surfaceBounds;
    if (!isFiniteNumber(sb.width) || !isFiniteNumber(sb.height) || sb.width <= 0 || sb.height <= 0) {
      return fail("invalid_surface_bounds");
    }
    surfaceBounds = { width: sb.width, height: sb.height };
  }
  const normalized = {
    frame,
    evidenceViews
  };
  if (figmaSeedReference !== void 0) {
    normalized.figmaSeedReference = figmaSeedReference;
  }
  if (seedReferenceId !== void 0) {
    normalized.seedReferenceId = seedReferenceId;
  }
  if (screenshot !== void 0) {
    normalized.screenshot = screenshot;
  }
  if (designSignals !== void 0) {
    normalized.designSignals = designSignals;
  }
  if (surfaceBounds !== void 0) {
    normalized.surfaceBounds = surfaceBounds;
  }
  return { ok: true, package: normalized };
}
function logInvalidOutput(projectPath, reason, details) {
  logInvalidToolEvent(
    projectPath,
    "invalid_output",
    "record_evidence_package",
    reason,
    details
  );
}
function isStrictlyInsideRoot(root, candidate) {
  const relative = path2.relative(root, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(".." + path2.sep) && !path2.isAbsolute(relative);
}
function realpathMaybeMissing(candidate) {
  const missing = [];
  let cursor = candidate;
  while (!existsSync2(cursor)) {
    const parent = path2.dirname(cursor);
    if (parent === cursor) {
      return null;
    }
    missing.unshift(path2.basename(cursor));
    cursor = parent;
  }
  let realExisting;
  try {
    realExisting = realpathSync(cursor);
  } catch {
    return null;
  }
  return missing.length === 0 ? realExisting : path2.resolve(realExisting, ...missing);
}
function assertArtifactPathInProject(projectPath, artifactPath) {
  const projectRoot = path2.resolve(projectPath);
  const resolved = path2.resolve(projectRoot, artifactPath);
  if (!isStrictlyInsideRoot(projectRoot, resolved)) {
    return "artifact_path_escape";
  }
  let projectReal;
  try {
    projectReal = realpathSync(projectRoot);
  } catch {
    return "artifact_path_escape";
  }
  const realFinal = realpathMaybeMissing(resolved);
  if (realFinal === null || !isStrictlyInsideRoot(projectReal, realFinal)) {
    return "artifact_path_escape";
  }
  return null;
}
function lookupSeedById(db, seedReferenceId) {
  const row = db.prepare(
    `SELECT id, figma_seed_reference, file_key, node_id, current_surface_id
       FROM seed_references WHERE id = ?`
  ).get(seedReferenceId);
  return row ?? null;
}
function lookupSeedByIdentity(db, fileKey, nodeId) {
  const row = db.prepare(
    `SELECT id, figma_seed_reference, file_key, node_id, current_surface_id
       FROM seed_references WHERE file_key = ? AND node_id = ?`
  ).get(fileKey, nodeId);
  return row ?? null;
}
function resolveEvidenceSeed(db, pkg) {
  const hasUrl = pkg.figmaSeedReference !== void 0;
  const hasSeedId = pkg.seedReferenceId !== void 0;
  if (hasSeedId && !hasUrl) {
    const seed3 = lookupSeedById(db, pkg.seedReferenceId);
    if (!seed3) {
      return { ok: false, reason: "seed_reference_not_found" };
    }
    return {
      ok: true,
      seedId: seed3.id,
      figmaSeedReference: seed3.figma_seed_reference,
      fileKey: seed3.file_key,
      nodeId: seed3.node_id,
      previousCurrentSurfaceId: seed3.current_surface_id
    };
  }
  if (hasUrl && !hasSeedId) {
    const identity = parseFigmaSeedIdentity(pkg.figmaSeedReference);
    if (!identity) {
      return { ok: false, reason: "seed_reference_not_found" };
    }
    const seed3 = lookupSeedByIdentity(db, identity.fileKey, identity.nodeId);
    if (!seed3) {
      return { ok: false, reason: "seed_reference_not_found" };
    }
    return {
      ok: true,
      seedId: seed3.id,
      // Keep declared URL verbatim (may differ in t= from seed row).
      figmaSeedReference: pkg.figmaSeedReference,
      fileKey: seed3.file_key,
      nodeId: seed3.node_id,
      previousCurrentSurfaceId: seed3.current_surface_id
    };
  }
  const seed2 = lookupSeedById(db, pkg.seedReferenceId);
  if (!seed2) {
    return { ok: false, reason: "seed_reference_not_found" };
  }
  const urlIdentity = parseFigmaSeedIdentity(pkg.figmaSeedReference);
  if (!urlIdentity) {
    return { ok: false, reason: "seed_reference_mismatch" };
  }
  if (!figmaSeedIdentitiesEqual(urlIdentity, {
    fileKey: seed2.file_key,
    nodeId: seed2.node_id
  })) {
    return { ok: false, reason: "seed_reference_mismatch" };
  }
  return {
    ok: true,
    seedId: seed2.id,
    figmaSeedReference: pkg.figmaSeedReference,
    fileKey: seed2.file_key,
    nodeId: seed2.node_id,
    previousCurrentSurfaceId: seed2.current_surface_id
  };
}
function assertFrameMatchesSeed(pkg, seed2) {
  if (normalizeFigmaNodeId(pkg.frame.nodeId) !== seed2.nodeId) {
    return { ok: false, reason: "frame_node_mismatch" };
  }
  if (pkg.frame.fileKey !== void 0 && pkg.frame.fileKey !== seed2.fileKey) {
    return { ok: false, reason: "frame_node_mismatch" };
  }
  return { ok: true };
}
function recordEvidencePackage(projectPath, input) {
  const validated = validateEvidencePackage(input);
  if (!validated.ok) {
    logInvalidOutput(projectPath, validated.reason, validated.details);
    return { ok: false, reason: validated.reason };
  }
  const pkg = validated.package;
  let screenshotArtifactPath = null;
  let screenshotDataUrl = null;
  if (pkg.screenshot?.artifactPath) {
    const escape = assertArtifactPathInProject(
      projectPath,
      pkg.screenshot.artifactPath
    );
    if (escape) {
      logInvalidOutput(projectPath, escape);
      return { ok: false, reason: escape };
    }
    screenshotArtifactPath = pkg.screenshot.artifactPath;
  }
  if (pkg.screenshot?.dataUrl) {
    screenshotDataUrl = pkg.screenshot.dataUrl;
  }
  const surfaceId = randomUUID2();
  const createdAt = (/* @__PURE__ */ new Date()).toISOString();
  try {
    const result = withProjectTransaction(projectPath, (db) => {
      const resolved = resolveEvidenceSeed(db, pkg);
      if (!resolved.ok) {
        const err = new Error(`EVIDENCE_RESOLVE:${resolved.reason}`);
        err.evidenceReason = resolved.reason;
        throw err;
      }
      const frameMatch = assertFrameMatchesSeed(pkg, {
        fileKey: resolved.fileKey,
        nodeId: resolved.nodeId
      });
      if (!frameMatch.ok) {
        const err = new Error(`EVIDENCE_RESOLVE:${frameMatch.reason}`);
        err.evidenceReason = frameMatch.reason;
        throw err;
      }
      const record = {
        id: surfaceId,
        seed_reference_id: resolved.seedId,
        figma_seed_reference: resolved.figmaSeedReference,
        frame_node_id: pkg.frame.nodeId,
        frame_name: pkg.frame.name,
        frame_bounds_json: pkg.frame.bounds ? JSON.stringify(pkg.frame.bounds) : null,
        evidence_views_json: JSON.stringify(pkg.evidenceViews),
        screenshot_artifact_path: screenshotArtifactPath,
        screenshot_data_url: screenshotDataUrl,
        design_signals_json: pkg.designSignals ? JSON.stringify(pkg.designSignals) : null,
        surface_bounds_json: pkg.surfaceBounds ? JSON.stringify(pkg.surfaceBounds) : null,
        created_at: createdAt,
        superseded_by: null
      };
      db.prepare(
        `INSERT INTO figma_evidence_surfaces (
          id, seed_reference_id, figma_seed_reference,
          frame_node_id, frame_name, frame_bounds_json,
          evidence_views_json, screenshot_artifact_path, screenshot_data_url,
          design_signals_json, surface_bounds_json, created_at, superseded_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
      ).run(
        record.id,
        record.seed_reference_id,
        record.figma_seed_reference,
        record.frame_node_id,
        record.frame_name,
        record.frame_bounds_json,
        record.evidence_views_json,
        record.screenshot_artifact_path,
        record.screenshot_data_url,
        record.design_signals_json,
        record.surface_bounds_json,
        record.created_at
      );
      if (resolved.previousCurrentSurfaceId) {
        const advanceTip = db.prepare(
          `UPDATE figma_evidence_surfaces
             SET superseded_by = ?
             WHERE id = ? AND superseded_by IS NULL`
        ).run(record.id, resolved.previousCurrentSurfaceId);
        if (advanceTip.changes !== 1) {
          throw new Error(
            `Evidence lineage conflict: expected current surface ${resolved.previousCurrentSurfaceId} to be an unsuperseded tip`
          );
        }
      }
      const advanceCurrent = resolved.previousCurrentSurfaceId === null ? db.prepare(
        `UPDATE seed_references
                 SET current_surface_id = ?
                 WHERE id = ? AND current_surface_id IS NULL`
      ).run(record.id, resolved.seedId) : db.prepare(
        `UPDATE seed_references
                 SET current_surface_id = ?
                 WHERE id = ? AND current_surface_id = ?`
      ).run(
        record.id,
        resolved.seedId,
        resolved.previousCurrentSurfaceId
      );
      if (advanceCurrent.changes !== 1) {
        throw new Error(
          `Evidence current pointer conflict for seed ${resolved.seedId}`
        );
      }
      const event = logEventOnDb(db, "evidence_package_recorded", {
        surface_id: record.id,
        seed_reference_id: record.seed_reference_id,
        figma_seed_reference: record.figma_seed_reference,
        frame_node_id: record.frame_node_id,
        frame_name: record.frame_name
      });
      return { ok: true, record, event_id: event.event_id };
    });
    if (result.ok) {
      emitRecordEvent({
        kind: "evidence",
        action: "created",
        id: result.record.id,
        projectPath: path2.resolve(projectPath)
      });
    }
    return result;
  } catch (err) {
    const reason = err instanceof Error && typeof err.evidenceReason === "string" ? err.evidenceReason : err instanceof Error && err.message.startsWith("EVIDENCE_RESOLVE:") ? err.message.slice("EVIDENCE_RESOLVE:".length) : null;
    if (reason === "seed_reference_not_found" || reason === "seed_reference_mismatch" || reason === "frame_node_mismatch") {
      logInvalidOutput(projectPath, reason);
      return { ok: false, reason };
    }
    return { ok: false, reason: "db_error" };
  }
}

// lib/runtime/project-readiness.ts
function ensureProjectMetaRow(db) {
  db.prepare(
    `INSERT OR IGNORE INTO project_meta (singleton, design_language_description)
     VALUES (1, '')`
  ).run();
}
function normalizeDesignLanguageDescription(raw) {
  if (typeof raw !== "string") return "";
  return raw.trim();
}
function setDesignLanguageDescription(projectPath, description) {
  const normalized = normalizeDesignLanguageDescription(description);
  try {
    withProjectTransaction(projectPath, (db) => {
      ensureProjectMetaRow(db);
      db.prepare(
        `UPDATE project_meta
         SET design_language_description = ?
         WHERE singleton = 1`
      ).run(normalized);
    });
    return { ok: true, designLanguageDescription: normalized };
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

// lib/runtime/seed-reference.ts
import { randomUUID as randomUUID3 } from "node:crypto";
import path3 from "node:path";

// lib/runtime/seed-row-map.ts
function mapSeedRow(row) {
  return {
    id: String(row.id),
    figma_seed_reference: String(row.figma_seed_reference),
    // Column stores CONTEXT Reference Note (historical name retained).
    original_design_intent: String(row.original_design_intent),
    created_at: String(row.created_at),
    registered_via: row.registered_via === "ui" ? "ui" : "agent",
    file_key: String(row.file_key ?? ""),
    node_id: String(row.node_id ?? ""),
    current_surface_id: typeof row.current_surface_id === "string" && row.current_surface_id.trim().length > 0 ? row.current_surface_id : null
  };
}
function lookupSeedRegisteredEventId(db, seedReferenceId) {
  const eventRow = db.prepare(
    `SELECT event_id FROM events
       WHERE type = 'seed_reference_registered'
         AND json_extract(payload, '$.seed_reference_id') = ?
       ORDER BY created_at ASC, id ASC
       LIMIT 1`
  ).get(seedReferenceId);
  return eventRow?.event_id ?? null;
}

// lib/runtime/seed-reference.ts
function validateSeedReferenceInput(input) {
  const rawUrl = input?.figmaSeedReference;
  if (typeof rawUrl !== "string" || rawUrl.trim().length === 0) {
    return "missing_figma_seed_reference";
  }
  const intent = input?.originalDesignIntent;
  if (typeof intent !== "string" || intent.trim().length === 0) {
    return "missing_original_design_intent";
  }
  let url;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return "invalid_figma_url";
  }
  if (url.protocol !== "https:") {
    return "invalid_figma_url";
  }
  if (url.hostname !== "figma.com" && url.hostname !== "www.figma.com") {
    return "not_figma_host";
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const hasDesignPath = parts.length >= 2 && (parts[0] === "design" || parts[0] === "file");
  if (!hasDesignPath) {
    return "not_figma_design_path";
  }
  return null;
}
function lookupSeedEventId(db, seedReferenceId) {
  return lookupSeedRegisteredEventId(db, seedReferenceId);
}
function registerSeedReference(projectPath, input) {
  const validationError = validateSeedReferenceInput(input);
  if (validationError) {
    return { ok: false, reason: validationError };
  }
  const identity = parseFigmaSeedIdentity(input.figmaSeedReference);
  if (!identity) {
    return { ok: false, reason: "invalid_figma_url" };
  }
  const registeredVia = input.registeredVia === "ui" ? "ui" : "agent";
  const candidateId = randomUUID3();
  const createdAt = (/* @__PURE__ */ new Date()).toISOString();
  try {
    const result = withProjectTransaction(projectPath, (db) => {
      const insertResult = db.prepare(
        `INSERT INTO seed_references
           (id, figma_seed_reference, original_design_intent, created_at, registered_via, file_key, node_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(file_key, node_id) DO NOTHING`
      ).run(
        candidateId,
        input.figmaSeedReference,
        input.originalDesignIntent,
        createdAt,
        registeredVia,
        identity.fileKey,
        identity.nodeId
      );
      if (insertResult.changes === 0) {
        const existingRow = db.prepare(
          `SELECT * FROM seed_references WHERE file_key = ? AND node_id = ?`
        ).get(identity.fileKey, identity.nodeId);
        if (!existingRow) {
          throw new Error(
            `seed_references ON CONFLICT but no row for file_key=${identity.fileKey} node_id=${identity.nodeId}`
          );
        }
        const record2 = mapSeedRow(existingRow);
        let eventId = lookupSeedEventId(db, record2.id);
        if (eventId === null) {
          const event2 = logEventOnDb(db, "seed_reference_registered", {
            seed_reference_id: record2.id,
            figma_seed_reference: record2.figma_seed_reference,
            original_design_intent: record2.original_design_intent,
            registered_via: record2.registered_via
          });
          eventId = event2.event_id;
        }
        return {
          ok: true,
          record: record2,
          event_id: eventId,
          reused: true
        };
      }
      const record = {
        id: candidateId,
        figma_seed_reference: input.figmaSeedReference,
        original_design_intent: input.originalDesignIntent,
        created_at: createdAt,
        registered_via: registeredVia,
        file_key: identity.fileKey,
        node_id: identity.nodeId,
        current_surface_id: null
      };
      const event = logEventOnDb(db, "seed_reference_registered", {
        seed_reference_id: record.id,
        figma_seed_reference: record.figma_seed_reference,
        original_design_intent: record.original_design_intent,
        registered_via: record.registered_via
      });
      return { ok: true, record, event_id: event.event_id };
    });
    if (result.ok && !("reused" in result && result.reused)) {
      emitRecordEvent({
        kind: "seed",
        action: "created",
        id: result.record.id,
        projectPath: path3.resolve(projectPath)
      });
    }
    return result;
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

// tests/helpers/mcp.ts
import { existsSync as existsSync3, readFileSync } from "node:fs";
import path5 from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// tests/e2e-constants.ts
import path4 from "node:path";
var SHARED_BUILD_DIR = path4.join(".next", "e2e-build");

// tests/helpers/mcp.ts
var MCP_BIN = path5.join(process.cwd(), "bin", "ikran-mcp.mjs");
function structuredContent(res) {
  if (typeof res === "object" && res !== null) {
    const r = res;
    if (r.structuredContent && typeof r.structuredContent === "object") {
      return r.structuredContent;
    }
  }
  return {};
}
function readEndpointFile(stateDir2) {
  try {
    const file = path5.join(stateDir2, "runtime-endpoint.json");
    if (!existsSync3(file)) return null;
    const ep = JSON.parse(readFileSync(file, "utf-8"));
    if (!ep || typeof ep.host !== "string" || typeof ep.port !== "number" || typeof ep.token !== "string" || typeof ep.pid !== "number") {
      return null;
    }
    return ep;
  } catch {
    return null;
  }
}
function killRecordedRuntime(stateDir2) {
  try {
    const ep = readEndpointFile(stateDir2);
    if (ep && typeof ep.pid === "number") {
      try {
        process.kill(ep.pid, "SIGKILL");
      } catch {
      }
    }
  } catch {
  }
}
async function spawnMcpClient(stateDir2, options = {}) {
  const { rootsProvider, env = {}, cwd } = options;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_BIN, "--prod"],
    cwd,
    env: {
      ...process.env,
      IKRAN_STATE_DIR: stateDir2,
      IKRAN_HOST: "127.0.0.1",
      IKRAN_NEXT_DIST_DIR: SHARED_BUILD_DIR,
      // Issue 05A/05D: MCP e2e never touches real Keychain / Figma network.
      IKRAN_FIGMA_CREDENTIAL_STORE: "memory",
      IKRAN_FIGMA_API_MODE: "mock",
      ...env
    },
    stderr: "pipe"
  });
  const client2 = new Client(
    { name: "ikran-e2e", version: "0.0.0" },
    { capabilities: rootsProvider ? { roots: {} } : {} }
  );
  if (rootsProvider) {
    client2.setRequestHandler(ListRootsRequestSchema, async () => ({
      roots: rootsProvider().map((r) => ({ uri: r.uri, name: r.name }))
    }));
  }
  await client2.connect(transport);
  const pid = transport.pid;
  if (typeof pid !== "number" || pid <= 0) {
    throw new Error("MCP StdioClientTransport did not expose a child pid");
  }
  return { client: client2, transport, pid };
}

// tests/helpers/alignment.ts
var ALIGNMENT_SECTIONS = [
  "design-principle",
  "visual-language",
  "token",
  "layout",
  "component",
  "interaction"
];
async function stageAlignmentAnswering(client2, args) {
  const anchor = {
    kind: "single",
    target: {
      kind: "surface",
      seedReferenceId: args.seedReferenceId,
      evidenceSurfaceId: args.evidenceId,
      evidenceVersionId: args.evidenceId
    }
  };
  const claimed = structuredContent(await client2.callTool({
    name: "claim_alignment_preparation",
    arguments: {}
  }));
  if (claimed.ok !== true) {
    throw new Error(`claim_alignment_preparation failed: ${JSON.stringify(claimed)}`);
  }
  const attemptId = String(claimed.attempt.id);
  const annotationIds = {};
  const cards2 = {};
  for (const section of ALIGNMENT_SECTIONS) {
    const annotation = structuredContent(await client2.callTool({
      name: "create_agent_annotation",
      arguments: {
        alignmentAttemptId: attemptId,
        idempotencyKey: `${args.keyPrefix}:${section}:assumption`,
        section,
        inference: "reasonable",
        title: "Section Hypothesis",
        body: `The current ${section} choices appear intentional.`,
        anchor
      }
    }));
    if (annotation.ok !== true) {
      throw new Error(
        `create_agent_annotation(${section}) failed: ${JSON.stringify(annotation)}`
      );
    }
    annotationIds[section] = String(annotation.record.id);
    cards2[section] = [];
    for (let index = 1; index <= 2; index += 1) {
      const proposedAnswer = `Proposal ${index} for ${section}`;
      const created = structuredContent(await client2.callTool({
        name: "create_alignment_question_card",
        arguments: {
          alignmentAttemptId: attemptId,
          idempotencyKey: `${args.keyPrefix}:${section}:${index}`,
          section,
          observation: `${section} ${index}`,
          question: `Question ${index} for ${section}?`,
          proposedAnswer,
          anchor
        }
      }));
      if (created.ok !== true) {
        throw new Error(
          `create_alignment_question_card(${section}/${index}) failed: ${JSON.stringify(created)}`
        );
      }
      cards2[section].push({
        id: String(created.record.id),
        answer: proposedAnswer
      });
    }
  }
  const finalized = structuredContent(await client2.callTool({
    name: "finalize_alignment_preparation",
    arguments: { alignmentAttemptId: attemptId }
  }));
  if (finalized.ok !== true) {
    throw new Error(
      `finalize_alignment_preparation failed: ${JSON.stringify(finalized)}`
    );
  }
  return { attemptId, annotationIds, cards: cards2 };
}

// .scratch/layout-live/stage.ts
var ROOT = path6.join(process.cwd(), ".scratch", "layout-live");
var stateDir = path6.join(ROOT, "state");
var projectDir = path6.join(ROOT, "project");
rmSync(stateDir, { recursive: true, force: true });
rmSync(projectDir, { recursive: true, force: true });
mkdirSync2(stateDir, { recursive: true });
mkdirSync2(path6.join(projectDir, "design-system"), { recursive: true });
var handle = await spawnMcpClient(stateDir);
var client = handle.client;
var opened = structuredContent(
  await client.callTool({
    name: "create_or_open_project",
    arguments: { path: projectDir }
  })
);
if (opened.ok !== true) {
  throw new Error(`create_or_open_project failed: ${JSON.stringify(opened)}`);
}
var token = String(opened.session);
var workbenchUrl = String(opened.workbench_url);
var seed = registerSeedReference(projectDir, {
  figmaSeedReference: "https://www.figma.com/design/DsReader/Fixture?node-id=1:2",
  originalDesignIntent: "Layout blueprint live fixture"
});
if (!seed.ok) throw new Error(`seed failed: ${seed.reason}`);
var evidence = recordEvidencePackage(projectDir, {
  seedReferenceId: seed.record.id,
  frame: { nodeId: "1:2", name: "DS reader fixture" },
  evidenceViews: { rawData: "available", screenshot: "missing" }
});
if (!evidence.ok) throw new Error(`evidence failed: ${evidence.reason}`);
setDesignLanguageDescription(projectDir, "A calm, precise product language");
var patchAlignment = async (body) => {
  const res = await fetch(
    new URL("/api/design-intent-alignment", workbenchUrl),
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-ikran-session": token
      },
      body: JSON.stringify(body)
    }
  );
  if (res.status !== 200) {
    throw new Error(`alignment PATCH ${String(body.action)} \u2192 ${res.status}`);
  }
};
await patchAlignment({ action: "prepare" });
var staged = await stageAlignmentAnswering(client, {
  seedReferenceId: seed.record.id,
  evidenceId: evidence.record.id,
  keyPrefix: "layout-live"
});
var { cards } = staged;
var designerEditedCardId = cards["token"][0].id;
await patchAlignment({
  action: "record-designer-answer",
  input: {
    questionCardId: designerEditedCardId,
    finalAnswer: "\u8BBE\u8BA1\u5E08\u6539\u5199\u540E\u7684\u56DE\u7B54"
  }
});
for (const section of ALIGNMENT_SECTIONS) {
  for (const card of cards[section]) {
    if (card.id === designerEditedCardId) continue;
    const res = structuredContent(
      await client.callTool({
        name: "record_designer_answer",
        arguments: { questionCardId: card.id, finalAnswer: card.answer }
      })
    );
    if (res.ok !== true) {
      throw new Error(`record_designer_answer failed: ${JSON.stringify(res)}`);
    }
  }
}
await patchAlignment({ action: "complete" });
var writeSource = (relative, json) => writeFileSync(
  path6.join(projectDir, relative),
  `${JSON.stringify(json, null, 2)}
`,
  "utf-8"
);
writeSource("design-system/design-system.json", {
  name: "Ikran Reader System",
  visualLanguage: {
    id: "visual-language",
    value: { description: "Calm, precise product language." },
    meaning: "Overall visual tone",
    status: "formalized",
    links: [designerEditedCardId]
  },
  principles: [
    {
      id: "principle-intent",
      value: {
        statement: "Design with intent.",
        rationale: "Every choice needs a reason the designer can repeat.",
        scope: "All product surfaces",
        use: ["State the reason next to the choice"],
        avoid: ["Decoration without a job"],
        exceptions: ["Marketing one-offs"]
      },
      meaning: "Intent over decoration",
      status: "candidate",
      links: [designerEditedCardId]
    }
  ]
});
writeSource("design-system/token.json", {
  primitive: {
    "font.family.sans": {
      value: "Instrument Sans, system-ui, sans-serif",
      meaning: "Primary typeface stack",
      status: "formalized",
      links: [designerEditedCardId],
      domain: "typography"
    },
    "font.size.400": {
      value: "16px",
      meaning: "Base body size",
      status: "formalized",
      links: [designerEditedCardId],
      domain: "typography"
    },
    "font.size.700": {
      value: "32px",
      meaning: "Alternate hero size",
      status: "formalized",
      links: [designerEditedCardId],
      domain: "typography"
    },
    "letterSpacing.hero": {
      value: "-0.04em",
      meaning: "Hero tracking",
      status: "formalized",
      links: [designerEditedCardId],
      domain: "typography"
    },
    "font.weight.bold": {
      value: "700",
      meaning: "Bold weight",
      status: "gap",
      links: [],
      domain: "typography"
    }
  },
  semantic: {
    body: {
      value: { family: "Inter", size: "16px", weight: "400", tracking: "0.01em" },
      meaning: "Default reading role",
      status: "candidate",
      links: [designerEditedCardId],
      domain: "typography"
    },
    "display.large": {
      value: {
        fontFamily: { alias: "primitive.font.family.sans" },
        fontSize: "64px",
        fontWeight: "700",
        lineHeight: "1.05"
      },
      meaning: "Hero display role",
      status: "formalized",
      links: [designerEditedCardId],
      domain: "typography"
    }
  },
  component: {}
});
writeSource("design-system/layout-rules.json", {
  rules: [
    {
      id: "grid-page",
      value: { columns: "12", gutter: { alias: "spacing.200" }, maxWidth: "1120px" },
      meaning: "Default page grid",
      status: "candidate",
      links: [designerEditedCardId]
    },
    {
      id: "shell-regions",
      value: { regions: ["header", "hero", "content", "footer"] },
      meaning: "Page shell vertical stack",
      status: "candidate",
      links: [designerEditedCardId]
    },
    {
      id: "section-rhythm",
      value: { heroToNext: "96 \u2192 56px" },
      meaning: "Scroll rhythm, desktop \u2192 mobile",
      status: "candidate",
      links: [designerEditedCardId]
    },
    {
      id: "breakpoints",
      value: { breakpoints: ["640", "768", "1024", "1280"] },
      meaning: "Same source as code",
      status: "formalized",
      links: [designerEditedCardId]
    },
    {
      id: "nav-mobile",
      value: { layout: "\u2014" },
      meaning: "Mobile navigation layout \u2014 open state missing",
      status: "gap",
      links: []
    }
  ]
});
var declareArtifact = async (artifactPath, artifactType) => {
  const res = structuredContent(
    await client.callTool({
      name: "record_artifact_written",
      arguments: {
        path: artifactPath,
        artifactType,
        semanticPurpose: `${artifactType} source`,
        relatedRecordIds: [designerEditedCardId]
      }
    })
  );
  if (res.ok !== true) {
    throw new Error(`declare ${artifactPath} failed: ${JSON.stringify(res)}`);
  }
};
await declareArtifact("design-system/design-system.json", "design-system.json");
await declareArtifact("design-system/token.json", "token.json");
await declareArtifact("design-system/layout-rules.json", "layout-rules.json");
console.log(`WORKBENCH_URL=${workbenchUrl}`);
console.log(`TOKEN=${token}`);
console.log(`PROJECT_DIR=${projectDir}`);
console.log("staging complete \u2014 runtime stays up; Ctrl+C to stop.");
var shutdown = () => {
  killRecordedRuntime(stateDir);
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
setInterval(() => {
}, 1 << 30);
