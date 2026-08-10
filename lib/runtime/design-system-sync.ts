// Lazy file→DB sync for design-system sources (storage-consistency fix).
//
// The source JSON files are the authoring layer — the Agent edits them with
// host-native file editing and SHOULD re-declare via record_artifact_written.
// When it forgets, the DB (the Browser's truth) silently goes stale. This
// module closes that gap during Initial extraction and Draft review: before
// the Browser view is served, every declared + ingested design-system artifact
// is re-hashed and re-ingested when its bytes no longer match the digest
// recorded at declaration time. From Prototype validation onward, the same
// drift is kept out of the DB and surfaced as a Rule Update authorization
// warning; a confirmed proposal + explicit declaration is required.
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

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
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
import {
  designSystemEntryContentDigest,
  sortKeysDeep
} from "./design-system-entry-provenance";
import { resolveProjectArtifactPath } from "./evidence-package";
import {
  hasPendingAuthorizedRuleUpdateProposalForPathOnDb,
  projectRequiresRuleUpdateProposalOnDb
} from "./rule-update-policy";
import { logEventOnDb } from "./events";

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
    | "rule_update_proposal_required"
    | "ingest_rejected";
  details?: unknown;
}

export interface DesignSystemSyncResult {
  reingested: string[];
  warnings: DesignSystemSyncWarning[];
}

/**
 * Immutable source expectations captured from the post-sync ledger. Keeping
 * this as data (rather than an open DB transaction) lets callers perform
 * Runtime-owned file rewrites and then prove that no other source bytes
 * changed before committing the corresponding DB transition.
 */
export interface DesignSystemSourceDigestSnapshot {
  sources: Array<{
    path: string;
    digest: string | null;
  }>;
}

export type DesignSystemSourceDigestIssue =
  | {
      path: string;
      reason: "source_file_missing";
    }
  | {
      path: string;
      reason: "source_digest_missing";
    }
  | {
      path: string;
      reason: "source_content_changed";
      expectedDigest: string;
      actualDigest: string;
    };

export interface DesignSystemSourceDigestVerification {
  ok: boolean;
  issues: DesignSystemSourceDigestIssue[];
}

/**
 * Capture every ingested Design System source and the digest currently
 * authorized by the source-artifact ledger. Call this only after
 * syncDesignSystemSources returned without warnings; a null digest is kept
 * explicit so verification fails closed for legacy/incomplete state.
 */
export function captureDesignSystemSourceDigestSnapshot(
  projectPath: string
): DesignSystemSourceDigestSnapshot {
  const db = openProjectDb(projectPath);
  try {
    const rows = db
      .prepare(
        `SELECT path, artifact_type, content_digest
         FROM source_artifacts
         WHERE status = 'ingested'
         ORDER BY path ASC`
      )
      .all() as Array<{
      path: string;
      artifact_type: string;
      content_digest: string | null;
    }>;
    return {
      sources: rows
        .filter((row) =>
          DESIGN_SYSTEM_FILE_KINDS.includes(
            row.artifact_type as DesignSystemFileKind
          )
        )
        .map((row) => ({ path: row.path, digest: row.content_digest }))
    };
  } finally {
    closeProjectDb(db);
  }
}

/**
 * Verify that the captured Design System sources still contain the expected
 * bytes. Runtime-owned promotion writes can replace a captured expectation
 * with the digest of the exact content they wrote; all other paths remain
 * pinned to the post-sync ledger snapshot.
 */
export function verifyDesignSystemSourceDigestSnapshot(
  projectPath: string,
  snapshot: DesignSystemSourceDigestSnapshot,
  expectedDigestOverrides: Readonly<Record<string, string>> = {}
): DesignSystemSourceDigestVerification {
  const issues: DesignSystemSourceDigestIssue[] = [];

  for (const source of snapshot.sources) {
    const absolutePath = resolveProjectArtifactPath(projectPath, source.path);
    if (absolutePath === null || !existsSync(absolutePath)) {
      issues.push({ path: source.path, reason: "source_file_missing" });
      continue;
    }

    const expectedDigest = expectedDigestOverrides[source.path] ?? source.digest;
    if (expectedDigest === null) {
      issues.push({ path: source.path, reason: "source_digest_missing" });
      continue;
    }

    let content: string;
    try {
      content = readFileSync(absolutePath, "utf8");
    } catch {
      issues.push({ path: source.path, reason: "source_file_missing" });
      continue;
    }
    const actualDigest = sourceContentDigestOf(content);
    if (actualDigest !== expectedDigest) {
      issues.push({
        path: source.path,
        reason: "source_content_changed",
        expectedDigest,
        actualDigest
      });
    }
  }

  return { ok: issues.length === 0, issues };
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

type MutableJsonObject = Record<string, unknown>;

type MetadataReconciliationChange = {
  entry_id: string;
  source_status: string;
  db_status: string;
  source_links: string[];
  db_links: string[];
  resolved_links: string[];
  resolved_content_digest: string;
};

export type DesignSystemMetadataReconciliationResult =
  | { ok: true; reconciled: false; source_content_digest?: string }
  | {
      ok: true;
      reconciled: true;
      source_artifact_path: string;
      source_content_digest: string;
    }
  | {
      ok: false;
      reason:
        | "not_ingested"
        | "source_file_missing"
        | "invalid_json"
        | "schema_validation_failed"
        | "semantic_drift"
        | "untrusted_source_link"
        | "pending_rule_update_write"
        | "concurrent_source_changed"
        | "concurrent_db_changed"
        | "write_failed"
        | "db_error";
      details?: unknown;
    };

function loadDbEntryRowsOnDb(
  db: DatabaseSync,
  sourcePath: string
): DbEntryRow[] {
  return db
    .prepare(
      `SELECT entry_id, section, name, kind, domain, value_json,
              source_captures_json, meaning, status, links_json, position
       FROM design_system_entries
       WHERE source_artifact_path = ?
       ORDER BY entry_id ASC`
    )
    .all(sourcePath) as unknown as DbEntryRow[];
}

function designSystemSemanticFingerprint(value: {
  entry_id: string;
  section: string;
  name: string | null;
  kind: string | null;
  domain: string | null;
  value: unknown;
  source_captures: unknown;
  meaning: string;
  position: number;
}): string {
  return JSON.stringify(sortKeysDeep(value));
}

/**
 * The metadata repair seam is deliberately narrower than lazy ingest: every
 * identity and author-authored field must already equal the DB's last-good
 * projection. Only `status` and `links` may differ.
 */
function designSystemSemanticsMatchDbRows(
  db: DatabaseSync,
  fileKind: DesignSystemFileKind,
  json: Record<string, unknown>,
  sourcePath: string
): boolean {
  if (fileKind === "design-system.json") {
    const meta = db
      .prepare("SELECT name FROM design_system_meta WHERE singleton = 1")
      .get() as { name: string } | undefined;
    if (meta?.name !== json.name) return false;
  }

  const fileRows = collectDesignSystemEntryRows(fileKind, json)
    .map((row) =>
      designSystemSemanticFingerprint({
        entry_id: row.entry_id,
        section: row.section,
        name: row.name,
        kind: row.kind,
        domain: row.domain,
        value: row.value,
        source_captures: row.source_captures,
        meaning: row.meaning,
        position: row.position
      })
    )
    .sort();
  const dbRows = loadDbEntryRowsOnDb(db, sourcePath)
    .map((row) =>
      designSystemSemanticFingerprint({
        entry_id: row.entry_id,
        section: row.section,
        name: row.name,
        kind: row.kind,
        domain: row.domain,
        value: JSON.parse(row.value_json),
        source_captures: JSON.parse(row.source_captures_json),
        meaning: row.meaning,
        position: row.position
      })
    )
    .sort();
  return (
    fileRows.length === dbRows.length &&
    fileRows.every((row, index) => row === dbRows[index])
  );
}

function collectMutableSourceEntries(
  fileKind: DesignSystemFileKind,
  json: MutableJsonObject
): Map<string, MutableJsonObject> {
  const entries = new Map<string, MutableJsonObject>();
  const add = (entryId: unknown, raw: unknown) => {
    if (
      typeof entryId === "string" &&
      raw !== null &&
      typeof raw === "object" &&
      !Array.isArray(raw)
    ) {
      entries.set(entryId, raw as MutableJsonObject);
    }
  };
  const addList = (raw: unknown) => {
    if (!Array.isArray(raw)) return;
    for (const entry of raw) {
      if (
        entry !== null &&
        typeof entry === "object" &&
        !Array.isArray(entry)
      ) {
        add((entry as MutableJsonObject).id, entry);
      }
    }
  };

  switch (fileKind) {
    case "design-system.json": {
      const visualLanguage = json.visualLanguage;
      if (
        visualLanguage !== null &&
        typeof visualLanguage === "object" &&
        !Array.isArray(visualLanguage)
      ) {
        add((visualLanguage as MutableJsonObject).id, visualLanguage);
      }
      addList(json.principles);
      break;
    }
    case "token.json":
      for (const layer of ["primitive", "semantic", "component"] as const) {
        const layerEntries = json[layer];
        if (
          layerEntries === null ||
          typeof layerEntries !== "object" ||
          Array.isArray(layerEntries)
        ) continue;
        for (const [name, raw] of Object.entries(layerEntries)) {
          add(`${layer}.${name}`, raw);
        }
      }
      break;
    case "component-list.json":
      addList(json.components);
      break;
    case "component-spec":
      add(json.id, json);
      break;
    case "layout-rules.json":
    case "interaction-rules.json":
      addList(json.rules);
      break;
  }
  return entries;
}

function isMatchingDesignerEditEventOnDb(
  db: DatabaseSync,
  eventId: string,
  sourcePath: string,
  entryId: string
): boolean {
  const row = db
    .prepare("SELECT type, payload FROM events WHERE event_id = ?")
    .get(eventId) as { type: string; payload: string } | undefined;
  if (row?.type !== "design_system_entry_edited") return false;
  try {
    const payload = JSON.parse(row.payload) as Record<string, unknown>;
    return (
      payload.source_artifact_path === sourcePath &&
      payload.entry_id === entryId
    );
  } catch {
    return false;
  }
}

/**
 * Adding historical edit provenance changes the exact entry digest. Carry a
 * Formalized decision across that metadata-only enrichment only when the
 * entry is independently backed by a designer-edited answer, or when every
 * added edit event predates the latest exact-content Formalized decision.
 */
function canCarryFormalizedDecisionAcrossLinksOnDb(
  db: DatabaseSync,
  sourcePath: string,
  entryId: string,
  existingLinks: readonly string[],
  sourceOnlyLinks: readonly string[]
): boolean {
  if (sourceOnlyLinks.length === 0) return true;
  const designerEditedCard = db.prepare(
    `SELECT 1 AS backed FROM alignment_question_cards
     WHERE id = ?
       AND final_answer IS NOT NULL
       AND TRIM(final_answer) <> ''
       AND answer_source = 'designer-edited'`
  );
  if (existingLinks.some((link) => designerEditedCard.get(link) !== undefined)) {
    return true;
  }

  const latest = db
    .prepare(
      `SELECT id, type, payload FROM events
       WHERE type IN (
         'design_system_entry_approved',
         'design_system_entry_reverted',
         'design_system_entry_edited'
       )
         AND json_extract(payload, '$.source_artifact_path') = ?
         AND json_extract(payload, '$.entry_id') = ?
       ORDER BY id DESC
       LIMIT 1`
    )
    .get(sourcePath, entryId) as
    | { id: number; type: string; payload: string }
    | undefined;
  if (latest === undefined) return false;
  let latestPayload: Record<string, unknown>;
  try {
    latestPayload = JSON.parse(latest.payload) as Record<string, unknown>;
  } catch {
    return false;
  }
  const latestIsFormalizedDecision =
    typeof latestPayload.content_digest === "string" &&
    (latest.type === "design_system_entry_approved" ||
      (latest.type === "design_system_entry_edited" &&
        latestPayload.to_status === "formalized"));
  if (!latestIsFormalizedDecision) return false;

  const eventPosition = db.prepare(
    "SELECT id FROM events WHERE event_id = ? AND type = 'design_system_entry_edited'"
  );
  return sourceOnlyLinks.every((eventId) => {
    const row = eventPosition.get(eventId) as { id: number } | undefined;
    return row !== undefined && row.id < latest.id;
  });
}

function dbMetadataSnapshotOnDb(
  db: DatabaseSync,
  sourcePath: string,
  fileKind: DesignSystemFileKind
): string {
  const name =
    fileKind === "design-system.json"
      ? (db
          .prepare("SELECT name FROM design_system_meta WHERE singleton = 1")
          .get() as { name: string } | undefined)?.name ?? null
      : null;
  return JSON.stringify({ name, rows: loadDbEntryRowsOnDb(db, sourcePath) });
}

function canonicalSourcePath(
  projectPath: string,
  sourceArtifactPath: string
): { absolutePath: string; relativePath: string } | null {
  const projectRoot = path.resolve(projectPath);
  const lexicalPath = path.resolve(projectRoot, sourceArtifactPath);
  const relativePath = path.relative(projectRoot, lexicalPath);
  if (
    relativePath.length === 0 ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) return null;
  const absolutePath = resolveProjectArtifactPath(
    projectPath,
    sourceArtifactPath
  );
  if (absolutePath === null) return null;
  return { absolutePath, relativePath };
}

/**
 * Reconcile a single declared source only when its authored semantics already
 * equal the DB. DB status (the last designer decision) wins; source-only links
 * are preserved only when they are real edit events for this exact entry.
 * The whole repair is audited, digest-tracked, and fails closed on concurrent
 * DB/file changes.
 */
function reconcileDesignSystemSourceMetadata(
  projectPath: string,
  sourceArtifactPath: string,
  options: { allowStatusRepair: boolean; emitInvalidation: boolean }
): DesignSystemMetadataReconciliationResult {
  const resolved = canonicalSourcePath(projectPath, sourceArtifactPath);
  if (resolved === null) return { ok: false, reason: "not_ingested" };
  const { absolutePath, relativePath } = resolved;

  let originalContent: string;
  try {
    originalContent = readFileSync(absolutePath, "utf8");
  } catch {
    return { ok: false, reason: "source_file_missing" };
  }
  const file = readJsonFileObject(absolutePath);
  if (!file.ok) {
    return { ok: false, reason: "invalid_json", details: file.reason };
  }

  let fileKind: DesignSystemFileKind;
  let dbSnapshot: string;
  let changes: MetadataReconciliationChange[];
  const mutableJson = file.json as MutableJsonObject;
  try {
    const db = openProjectDb(projectPath);
    try {
      const artifact = db
        .prepare(
          `SELECT artifact_type FROM source_artifacts
           WHERE path = ? AND status = 'ingested'`
        )
        .get(relativePath) as { artifact_type: string } | undefined;
      if (
        artifact === undefined ||
        !DESIGN_SYSTEM_FILE_KINDS.includes(
          artifact.artifact_type as DesignSystemFileKind
        )
      ) {
        return { ok: false, reason: "not_ingested" };
      }
      fileKind = artifact.artifact_type as DesignSystemFileKind;
      const validation = validateDesignSystemJson(fileKind, mutableJson);
      if (!validation.ok) {
        return {
          ok: false,
          reason: "schema_validation_failed",
          details: validation.details ?? validation.reason
        };
      }
      if (
        hasPendingAuthorizedRuleUpdateProposalForPathOnDb(db, relativePath)
      ) {
        return { ok: false, reason: "pending_rule_update_write" };
      }
      if (
        !designSystemSemanticsMatchDbRows(
          db,
          fileKind,
          mutableJson,
          relativePath
        )
      ) {
        return { ok: false, reason: "semantic_drift" };
      }

      const mutableEntries = collectMutableSourceEntries(fileKind, mutableJson);
      changes = [];
      for (const dbRow of loadDbEntryRowsOnDb(db, relativePath)) {
        const sourceEntry = mutableEntries.get(dbRow.entry_id);
        if (sourceEntry === undefined) {
          return { ok: false, reason: "semantic_drift" };
        }
        const sourceStatus = sourceEntry.status as string;
        const sourceLinks = [...(sourceEntry.links as string[])];
        const dbLinks = JSON.parse(dbRow.links_json) as string[];
        if (!options.allowStatusRepair && sourceStatus !== dbRow.status) {
          return { ok: false, reason: "semantic_drift" };
        }
        const dbLinkSet = new Set(dbLinks);
        const sourceOnlyLinks = sourceLinks.filter(
          (link) => !dbLinkSet.has(link)
        );
        for (const sourceOnlyLink of sourceOnlyLinks) {
          if (
            !isMatchingDesignerEditEventOnDb(
              db,
              sourceOnlyLink,
              relativePath,
              dbRow.entry_id
            )
          ) {
            return {
              ok: false,
              reason: "untrusted_source_link",
              details: { entry_id: dbRow.entry_id, link: sourceOnlyLink }
            };
          }
        }
        if (
          dbRow.status === "formalized" &&
          !canCarryFormalizedDecisionAcrossLinksOnDb(
            db,
            relativePath,
            dbRow.entry_id,
            dbLinks,
            sourceOnlyLinks
          )
        ) {
          return {
            ok: false,
            reason: "untrusted_source_link",
            details: {
              entry_id: dbRow.entry_id,
              links: sourceOnlyLinks,
              reason: "edit_provenance_not_covered_by_formalized_decision"
            }
          };
        }

        const resolvedLinks = [...new Set([...sourceLinks, ...dbLinks])];
        const metadataChanged =
          sourceStatus !== dbRow.status ||
          JSON.stringify(sourceLinks) !== JSON.stringify(resolvedLinks) ||
          JSON.stringify(dbLinks) !== JSON.stringify(resolvedLinks);
        if (!metadataChanged) continue;
        sourceEntry.status = dbRow.status;
        sourceEntry.links = resolvedLinks;
        changes.push({
          entry_id: dbRow.entry_id,
          source_status: sourceStatus,
          db_status: dbRow.status,
          source_links: sourceLinks,
          db_links: dbLinks,
          resolved_links: resolvedLinks,
          resolved_content_digest: designSystemEntryContentDigest(sourceEntry)
        });
      }
      if (changes.length === 0) {
        recordSourceContentDigest(
          db,
          relativePath,
          sourceContentDigestOf(originalContent)
        );
        return {
          ok: true,
          reconciled: false,
          source_content_digest: sourceContentDigestOf(originalContent)
        };
      }
      dbSnapshot = dbMetadataSnapshotOnDb(db, relativePath, fileKind);
    } finally {
      closeProjectDb(db);
    }
  } catch {
    return { ok: false, reason: "db_error" };
  }

  const nextContent = `${JSON.stringify(sortKeysDeep(mutableJson), null, 2)}\n`;
  const nextDigest = sourceContentDigestOf(nextContent);
  const wroteFile = nextContent !== originalContent;
  if (wroteFile) {
    try {
      if (readFileSync(absolutePath, "utf8") !== originalContent) {
        return { ok: false, reason: "concurrent_source_changed" };
      }
      writeFileSync(absolutePath, nextContent, "utf8");
    } catch {
      return { ok: false, reason: "write_failed" };
    }
  }

  const restoreOwnWrite = () => {
    if (!wroteFile) return;
    try {
      if (readFileSync(absolutePath, "utf8") === nextContent) {
        writeFileSync(absolutePath, originalContent, "utf8");
      }
    } catch {
      // Best effort. A later sync will keep the digest mismatch visible.
    }
  };

  try {
    const committed = withProjectTransaction(projectPath, (db) => {
      if (
        hasPendingAuthorizedRuleUpdateProposalForPathOnDb(db, relativePath)
      ) {
        return { ok: false as const, reason: "pending_rule_update_write" as const };
      }
      if (
        dbMetadataSnapshotOnDb(db, relativePath, fileKind) !== dbSnapshot
      ) {
        return { ok: false as const, reason: "concurrent_db_changed" as const };
      }
      let currentContent: string;
      try {
        currentContent = readFileSync(absolutePath, "utf8");
      } catch {
        return { ok: false as const, reason: "concurrent_source_changed" as const };
      }
      if (currentContent !== nextContent) {
        return { ok: false as const, reason: "concurrent_source_changed" as const };
      }

      const now = new Date().toISOString();
      const updateLinks = db.prepare(
        `UPDATE design_system_entries
         SET links_json = ?, updated_at = ?
         WHERE source_artifact_path = ? AND entry_id = ?`
      );
      for (const change of changes) {
        if (
          JSON.stringify(change.db_links) !==
          JSON.stringify(change.resolved_links)
        ) {
          updateLinks.run(
            JSON.stringify(change.resolved_links),
            now,
            relativePath,
            change.entry_id
          );
        }
      }
      recordSourceContentDigest(db, relativePath, nextDigest);
      logEventOnDb(db, "design_system_source_metadata_reconciled", {
        source_artifact_path: relativePath,
        content_digest: nextDigest,
        entries: changes
      });
      return { ok: true as const };
    });
    if (!committed.ok) {
      restoreOwnWrite();
      return { ok: false, reason: committed.reason };
    }
  } catch {
    restoreOwnWrite();
    return { ok: false, reason: "db_error" };
  }

  if (options.emitInvalidation) {
    emitRecordEvent({
      kind: "design-system",
      action: "updated",
      id: relativePath,
      projectPath: path.resolve(projectPath)
    });
  }
  return {
    ok: true,
    reconciled: true,
    source_artifact_path: relativePath,
    source_content_digest: nextDigest
  };
}

/**
 * POST/command preflight: direct Draft authoring keeps its existing semantics;
 * only protected phases receive the narrow, metadata-only repair.
 */
export function reconcileProtectedDesignSystemSourceMetadata(
  projectPath: string,
  sourceArtifactPath: string
): DesignSystemMetadataReconciliationResult {
  try {
    const db = openProjectDb(projectPath);
    try {
      if (!projectRequiresRuleUpdateProposalOnDb(db)) {
        return { ok: true, reconciled: false };
      }
    } finally {
      closeProjectDb(db);
    }
  } catch {
    return { ok: false, reason: "db_error" };
  }
  return reconcileDesignSystemSourceMetadata(projectPath, sourceArtifactPath, {
    allowStatusRepair: true,
    emitInvalidation: false
  });
}

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
 * their recorded content digest while direct Draft authoring is still legal.
 * In Rule Update-protected phases, changed bytes stay on disk but are not
 * absorbed. Returns what was re-ingested and any per-file warnings (the caller
 * serves last-good DB data for those).
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
      if (projectRequiresRuleUpdateProposalOnDb(txnDb)) {
        return {
          ok: false as const,
          reason: "rule_update_proposal_required" as const
        };
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
      // A full ingest can be rejected solely because provenance links changed
      // the exact approval digest, or because a protected-phase source carries
      // stale status metadata. If every authored field still equals the DB,
      // run the audited narrow reconciliation once before surfacing a warning.
      const reconciled = reconcileDesignSystemSourceMetadata(
        projectPath,
        artifact.path,
        {
          // Direct status authoring is still legal before protected phases;
          // only repair status from DB when Rule Update policy already makes
          // undeclared source status changes unauthorized.
          allowStatusRepair:
            ingest.reason === "rule_update_proposal_required",
          emitInvalidation: true
        }
      );
      if (reconciled.ok) {
        if (reconciled.reconciled) result.reingested.push(artifact.path);
        continue;
      }
      // Status cross-validation or another ingest gate rejected the file —
      // keep serving last-good rows.
      result.warnings.push({
        path: artifact.path,
        reason:
          ingest.reason === "rule_update_proposal_required"
            ? "rule_update_proposal_required"
            : "ingest_rejected",
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
