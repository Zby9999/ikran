// Lazy file→DB sync for design-system sources (storage-consistency fix).
//
// The source JSON files are the authoring layer — the Agent edits them with
// host-native file editing and SHOULD re-declare via record_artifact_written.
// When it forgets, the DB (the Browser's truth) silently goes stale. This
// module closes that gap: before the Browser view is served, every declared +
// ingested design-system artifact is re-hashed and re-ingested when its bytes
// no longer match the digest recorded at declaration time.
//
// Contract notes:
//   - Only artifacts that already passed the declaration gate are synced.
//     Undeclared files on disk are ignored — first-time ingest must go through
//     record_artifact_written (link gate + semantic purpose).
//   - Sync failures NEVER fail the view: an invalid or unverifiable file
//     downgrades to a warning and the last-good DB rows keep being served.
//   - The derived export is NOT written here: sync has no view at hand.
//     getDesignSystemView regenerates it from the freshly built view when
//     this sync re-ingested anything (writing it from here via
//     writeDesignSystemViewExport would recurse through getDesignSystemView).
//   - This is a system-internal write path and stays available while the
//     initial extraction runs: designer edits/approvals rely on the
//     optimistic concurrency guards, not a write lock.

import { existsSync, readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import {
  openProjectDb,
  closeProjectDb,
  withProjectTransaction
} from "./db";
import { emitRecordEvent } from "./record-bus";
import {
  recordSourceContentDigest,
  sourceContentDigestOf
} from "./source-artifact-digest";
import {
  readJsonFileObject,
  validateDesignSystemJson,
  type DesignSystemFileKind
} from "./design-system-schema";
import {
  applyDesignSystemIngestOnDb,
  collectDesignSystemEntryRows,
  prepareDesignSystemIngestOnDb
} from "./design-system-ingest";
import { sortKeysDeep } from "./design-system-entry-provenance";
import { resolveProjectArtifactPath } from "./evidence-package";

const DESIGN_SYSTEM_FILE_KINDS: readonly DesignSystemFileKind[] = [
  "design-system.json",
  "token.json",
  "component-list.json",
  "component-spec",
  "layout-rules.json",
  "interaction-rules.json"
];

export interface DesignSystemSyncWarning {
  path: string;
  reason:
    | "source_file_missing"
    | "invalid_json"
    | "schema_validation_failed"
    | "ingest_rejected";
  details?: unknown;
}

export interface DesignSystemSyncResult {
  reingested: string[];
  warnings: DesignSystemSyncWarning[];
}

type DbEntryRow = {
  entry_id: string;
  section: string;
  name: string | null;
  kind: string | null;
  domain: string | null;
  value_json: string;
  source_captures_json: string;
  meaning: string;
  status: string;
  links_json: string;
  position: number;
};

/**
 * Canonical per-entry comparison between a source file and the DB rows it
 * last produced (key order and JSON formatting normalized away — only real
 * content drift counts). When nothing drifted, the caller records the digest
 * and skips re-ingest entirely: re-ingesting replays the declaration-time
 * status gate, which would wrongly reject entries that reached formalized
 * through the approval flow (their approval events predate digest
 * provenance). design-system.json also carries the system name in
 * design_system_meta, so that file must match it too.
 */
export function designSystemFileMatchesDbRows(
  db: DatabaseSync,
  fileKind: DesignSystemFileKind,
  json: unknown,
  sourcePath: string
): boolean {
  if (fileKind === "design-system.json") {
    const meta = db
      .prepare("SELECT name FROM design_system_meta WHERE singleton = 1")
      .get() as { name: string } | undefined;
    if (meta?.name !== (json as Record<string, unknown>).name) return false;
  }
  const fileRows = collectDesignSystemEntryRows(fileKind, json).map((row) =>
    JSON.stringify(
      sortKeysDeep({
        entry_id: row.entry_id,
        section: row.section,
        name: row.name,
        kind: row.kind,
        domain: row.domain,
        value: row.value,
        source_captures: row.source_captures,
        meaning: row.meaning,
        status: row.status,
        links: row.links,
        position: row.position
      })
    )
  );
  const dbRows = (
    db
      .prepare(
        `SELECT entry_id, section, name, kind, domain, value_json,
                source_captures_json, meaning, status, links_json, position
         FROM design_system_entries WHERE source_artifact_path = ?`
      )
      .all(sourcePath) as unknown as DbEntryRow[]
  ).map((row) =>
    JSON.stringify(
      sortKeysDeep({
        entry_id: row.entry_id,
        section: row.section,
        name: row.name,
        kind: row.kind,
        domain: row.domain,
        value: JSON.parse(row.value_json),
        source_captures: JSON.parse(row.source_captures_json),
        meaning: row.meaning,
        status: row.status,
        links: JSON.parse(row.links_json),
        position: row.position
      })
    )
  );
  if (fileRows.length !== dbRows.length) return false;
  const sortedFile = [...fileRows].sort();
  const sortedDb = [...dbRows].sort();
  return sortedFile.every((row, index) => row === sortedDb[index]);
}

/**
 * Digest-ledger write for the single-entry write-back flows (approve/edit).
 * Those flows rewrite the WHOLE source file while updating a single DB row.
 * Recording the whole-file digest unconditionally would launder any other
 * entry's undeclared drift into the sync ledger: the lazy sync compares file
 * bytes against this digest and skips re-ingest on a match, so the drift
 * would become invisible. Record only when the written file matches the DB
 * rows exactly; otherwise leave the digest stale so the next view read
 * re-ingests (healing legitimate edits) or surfaces a sync warning.
 * Best-effort: a stale digest only costs an extra sync pass.
 */
export function recordDesignSystemDigestIfConsistent(
  projectPath: string,
  fileKind: DesignSystemFileKind,
  json: unknown,
  sourcePath: string,
  content: string
): void {
  try {
    const db = openProjectDb(projectPath);
    try {
      if (designSystemFileMatchesDbRows(db, fileKind, json, sourcePath)) {
        recordSourceContentDigest(db, sourcePath, sourceContentDigestOf(content));
      }
    } finally {
      closeProjectDb(db);
    }
  } catch {
    // Best-effort: leaving the digest stale only triggers an extra sync pass.
  }
}

/**
 * Re-ingest declared design-system artifacts whose file bytes changed since
 * their recorded content digest. Returns what was re-ingested and any
 * per-file warnings (the caller serves last-good DB data for those).
 */
export function syncDesignSystemSources(
  projectPath: string
): DesignSystemSyncResult {
  const result: DesignSystemSyncResult = { reingested: [], warnings: [] };

  const db = openProjectDb(projectPath);
  let artifacts: Array<{
    path: string;
    artifact_type: string;
    content_digest: string | null;
  }>;
  try {
    artifacts = db
      .prepare(
        `SELECT path, artifact_type, content_digest
         FROM source_artifacts
         WHERE status = 'ingested'`
      )
      .all() as typeof artifacts;
  } catch {
    // Schema predates source_artifacts entirely — nothing to sync.
    return result;
  } finally {
    closeProjectDb(db);
  }

  for (const artifact of artifacts) {
    if (
      !DESIGN_SYSTEM_FILE_KINDS.includes(
        artifact.artifact_type as DesignSystemFileKind
      )
    ) {
      continue;
    }
    const fileKind = artifact.artifact_type as DesignSystemFileKind;
    const absolutePath = resolveProjectArtifactPath(projectPath, artifact.path);
    if (absolutePath === null || !existsSync(absolutePath)) {
      result.warnings.push({
        path: artifact.path,
        reason: "source_file_missing"
      });
      continue;
    }

    let content: string;
    try {
      content = readFileSync(absolutePath, "utf8");
    } catch {
      result.warnings.push({
        path: artifact.path,
        reason: "source_file_missing"
      });
      continue;
    }
    const digest = sourceContentDigestOf(content);
    // Null digest = pre-v23 row: verify once (fast path below), then stay
    // current.
    if (artifact.content_digest === digest) continue;

    const file = readJsonFileObject(absolutePath);
    if (!file.ok) {
      result.warnings.push({
        path: artifact.path,
        reason: "invalid_json",
        details: file.reason
      });
      continue;
    }
    const schemaResult = validateDesignSystemJson(fileKind, file.json);
    if (!schemaResult.ok) {
      result.warnings.push({
        path: artifact.path,
        reason: "schema_validation_failed",
        details: schemaResult.details ?? schemaResult.reason
      });
      continue;
    }

    const now = new Date().toISOString();
    const ingest = withProjectTransaction(projectPath, (txnDb) => {
      // The DB may already serve these exact bytes — pre-v23 rows were never
      // registered with the sync ledger, and approval-flow formalizations are
      // legitimate DB truth the declaration gate would wrongly reject. When
      // nothing drifted, just record the digest and stop.
      if (
        designSystemFileMatchesDbRows(txnDb, fileKind, file.json, artifact.path)
      ) {
        recordSourceContentDigest(txnDb, artifact.path, digest);
        return { ok: true as const, reingested: false };
      }
      const prepared = prepareDesignSystemIngestOnDb(txnDb, {
        fileKind,
        json: file.json,
        sourcePath: artifact.path,
        now
      });
      if (!prepared.ok) return prepared;
      applyDesignSystemIngestOnDb(txnDb, prepared.plan);
      recordSourceContentDigest(txnDb, artifact.path, digest);
      return { ok: true as const, reingested: true };
    });
    if (!ingest.ok) {
      // Status cross-validation or another ingest gate rejected the file —
      // keep serving last-good rows.
      result.warnings.push({
        path: artifact.path,
        reason: "ingest_rejected",
        details: "details" in ingest ? ingest.details : ingest.reason
      });
      continue;
    }
    if (!ingest.reingested) continue;

    result.reingested.push(artifact.path);
    emitRecordEvent({
      kind: "design-system",
      action: "updated",
      id: artifact.path,
      projectPath
    });
  }

  return result;
}
