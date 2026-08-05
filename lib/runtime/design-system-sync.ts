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
//   - This is a system-internal write path: the initial-preparation write
//     gate (design-system-write-gate) guards designer edits/approvals only,
//     not convergence of the Runtime truth.

import { existsSync, readFileSync } from "node:fs";
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
  prepareDesignSystemIngestOnDb
} from "./design-system-ingest";
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
    // Null digest = pre-v23 row: re-ingest once, then stay current.
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
      const prepared = prepareDesignSystemIngestOnDb(txnDb, {
        fileKind,
        json: file.json,
        sourcePath: artifact.path,
        now
      });
      if (!prepared.ok) return prepared;
      applyDesignSystemIngestOnDb(txnDb, prepared.plan);
      recordSourceContentDigest(txnDb, artifact.path, digest);
      return { ok: true as const };
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
