// Prototype → Design System code backfill (Issue 31).
//
// formalize_design_system flips entry status but never touches spec value, so
// the real code components produced during the Prototype phase had no channel
// back into the Design System: codeLinks only ever appeared when the Agent
// hand-wrote a spec. This module is that channel. The Agent explicitly
// declares entryId ↔ code-path mappings (no name/filename auto-matching —
// ambiguous matches would pollute the fact source); Runtime validates
// fail-closed and then writes value.codeLinks back into each entry's source
// spec JSON, reusing the formalize Phase-2 write-back pattern:
//   - entry must exist and be a component spec (the only kind whose schema
//     carries codeLinks);
//   - every code path must resolve inside the project, exist on disk, AND be
//     declared in the source artifact registry (record_artifact_written);
//   - digest + schema validation + canonical serialization per file, files
//     written before the transaction and restored on any failure;
//   - row value_json update + the backfill event commit in one transaction.
//
// A formalized entry whose content changes needs fresh approval-grade
// provenance (same rationale as formalizeDesignSystem): without a
// design_system_entry_approved event carrying the new content digest, the
// next re-ingest's status gate would reject the formalized claim Runtime
// itself just rewrote.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  closeProjectDb,
  openProjectDb,
  withProjectTransaction
} from "./db";
import {
  buildLoggedEvent,
  insertEvent,
  logEventOnDb,
  logInvalidToolEvent
} from "./events";
import { emitRecordEvent } from "./record-bus";
import { locateEntryObject } from "./design-system-approval";
import { designSystemEntryContentDigest } from "./design-system-entry-provenance";
import { stripSourceCaptures } from "./design-system-ingest";
import {
  validateDesignSystemJson,
  type DesignSystemFileKind
} from "./design-system-schema";
import { recordDesignSystemDigestIfConsistent } from "./design-system-sync";
import {
  stableJsonStringify,
  writeDesignSystemViewExport
} from "./design-system-view";
import {
  assertArtifactPathInProject,
  resolveProjectArtifactPath
} from "./evidence-package";
import {
  canonicalizeArtifactPath,
  SOURCE_ARTIFACT_TYPE_REGISTRY
} from "./source-artifact";

export interface BackfillCodeLinkMapping {
  /** design_system_entries row id or entry_id of a component spec entry. */
  entryId: string;
  /** Project-relative code paths backing the entry (one or more). */
  codeLinks: readonly string[];
}

export type BackfillCodeLinksFailure = {
  ok: false;
  reason:
    | "empty_mappings"
    | "empty_code_links"
    | "entry_not_found"
    | "entry_not_component_spec"
    | "artifact_path_escape"
    | "code_file_missing"
    | "code_path_not_declared"
    | "code_path_not_code_artifact"
    | "artifact_file_missing"
    | "invalid_design_system_json"
    | "entry_not_in_source_file"
    | "write_failed"
    | "db_error";
  details?: unknown;
};

export type BackfillCodeLinksResult =
  | {
      ok: true;
      entries: Array<{
        entry_id: string;
        source_artifact_path: string;
        code_links: string[];
      }>;
      event_id: string;
    }
  | BackfillCodeLinksFailure;

type EntryRow = {
  id: string;
  entry_id: string;
  source_artifact_path: string;
  file_kind: string;
  status: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Artifact types whose declaration can back a code link — the registry's
 * `code` validation class (`code`, `prototype`). A path declared as any
 * design-system type is evidence, not code, and never counts.
 */
const CODE_ARTIFACT_TYPES: ReadonlySet<string> = new Set(
  Object.entries(SOURCE_ARTIFACT_TYPE_REGISTRY)
    .filter(([, spec]) => spec.validationClass === "code")
    .map(([type]) => type)
);

export function backfillComponentCodeLinks(
  projectPath: string,
  mappings: readonly BackfillCodeLinkMapping[]
): BackfillCodeLinksResult {
  const normalized: Array<{ entryId: string; codeLinks: string[] }> = [];
  for (const mapping of mappings) {
    const entryId = mapping.entryId.trim();
    const codeLinks = [
      ...new Set(
        mapping.codeLinks.map((link) => link.trim()).filter((l) => l.length > 0)
      )
    ];
    if (codeLinks.length === 0) {
      return {
        ok: false,
        reason: "empty_code_links",
        details: { entryId: mapping.entryId }
      };
    }
    normalized.push({ entryId, codeLinks });
  }
  if (normalized.length === 0) return { ok: false, reason: "empty_mappings" };

  // -- Phase 1 (read-only): entry lookup + code-path validation. Every
  //    declared code path must exist on disk AND be in the source artifact
  //    registry as a code-class artifact (code/prototype — a design-system
  //    declaration is evidence, not code) before anything is written.
  const rows: EntryRow[] = [];
  const codeLinksByRow = new Map<string, string[]>();
  {
    let db;
    try {
      db = openProjectDb(projectPath);
    } catch {
      return { ok: false, reason: "db_error" };
    }
    try {
      const entryStmt = db.prepare(
        `SELECT id, entry_id, source_artifact_path, file_kind, status
         FROM design_system_entries WHERE id = ? OR entry_id = ?`
      );
      const declaredStmt = db.prepare(
        `SELECT artifact_type FROM source_artifacts WHERE path = ?`
      );
      for (const mapping of normalized) {
        const row = entryStmt.get(mapping.entryId, mapping.entryId) as
          | EntryRow
          | undefined;
        if (!row) {
          return {
            ok: false,
            reason: "entry_not_found",
            details: { entryId: mapping.entryId }
          };
        }
        if (row.file_kind !== "component-spec") {
          return {
            ok: false,
            reason: "entry_not_component_spec",
            details: { entryId: row.entry_id, file_kind: row.file_kind }
          };
        }
        rows.push(row);
        codeLinksByRow.set(row.id, mapping.codeLinks);
      }
      for (const mapping of normalized) {
        for (const codePath of mapping.codeLinks) {
          if (assertArtifactPathInProject(projectPath, codePath) !== null) {
            return {
              ok: false,
              reason: "artifact_path_escape",
              details: { path: codePath }
            };
          }
          const relative = canonicalizeArtifactPath(projectPath, codePath);
          const absolute = resolveProjectArtifactPath(projectPath, codePath);
          if (relative === null || absolute === null) {
            return {
              ok: false,
              reason: "artifact_path_escape",
              details: { path: codePath }
            };
          }
          if (!existsSync(absolute)) {
            return {
              ok: false,
              reason: "code_file_missing",
              details: { path: relative }
            };
          }
          const declared = declaredStmt.get(relative) as
            | { artifact_type: string }
            | undefined;
          if (declared === undefined) {
            return {
              ok: false,
              reason: "code_path_not_declared",
              details: { path: relative }
            };
          }
          if (!CODE_ARTIFACT_TYPES.has(declared.artifact_type)) {
            return {
              ok: false,
              reason: "code_path_not_code_artifact",
              details: { path: relative, artifact_type: declared.artifact_type }
            };
          }
        }
      }
    } catch {
      return { ok: false, reason: "db_error" };
    } finally {
      closeProjectDb(db);
    }
  }

  // -- Phase 2: write codeLinks into the source spec files. Original bytes
  //    stay in memory for the restore path; a file the Runtime cannot rewrite
  //    fails the whole backfill before any DB write.
  const writtenFiles: Array<{
    absolutePath: string;
    relativePath: string;
    fileKind: DesignSystemFileKind;
    originalContent: string;
    newContent: string;
    parsed: Record<string, unknown>;
  }> = [];
  /** New DB value per row id (captures stay out of value_json). */
  const dbValueByRow = new Map<string, string>();
  /** Fresh approval-grade digest per formalized row id. */
  const approvedDigestByRow = new Map<string, string>();
  const restoreWrittenFiles = () => {
    for (const file of writtenFiles) {
      try {
        writeFileSync(file.absolutePath, file.originalContent, "utf-8");
      } catch {
        // Best-effort restore; the reported failure reason stands.
      }
    }
  };
  {
    const rowsByPath = new Map<string, EntryRow[]>();
    for (const row of rows) {
      const list = rowsByPath.get(row.source_artifact_path) ?? [];
      list.push(row);
      rowsByPath.set(row.source_artifact_path, list);
    }
    for (const [sourcePath, pathRows] of rowsByPath) {
      const absolutePath = resolveProjectArtifactPath(projectPath, sourcePath);
      if (absolutePath === null) {
        restoreWrittenFiles();
        return { ok: false, reason: "artifact_path_escape" };
      }
      const fileKind = pathRows[0].file_kind as DesignSystemFileKind;
      let originalContent: string;
      try {
        originalContent = readFileSync(absolutePath, "utf-8");
      } catch {
        restoreWrittenFiles();
        return { ok: false, reason: "artifact_file_missing" };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(originalContent);
      } catch {
        restoreWrittenFiles();
        return { ok: false, reason: "invalid_design_system_json" };
      }
      if (!isPlainObject(parsed)) {
        restoreWrittenFiles();
        return { ok: false, reason: "invalid_design_system_json" };
      }
      for (const row of pathRows) {
        const entryObject = locateEntryObject(fileKind, parsed, row.entry_id);
        if (entryObject === null) {
          restoreWrittenFiles();
          return {
            ok: false,
            reason: "entry_not_in_source_file",
            details: {
              source_artifact_path: sourcePath,
              entry_id: row.entry_id
            }
          };
        }
        if (!isPlainObject(entryObject.value)) {
          restoreWrittenFiles();
          return { ok: false, reason: "invalid_design_system_json" };
        }
        const codeLinks = codeLinksByRow.get(row.id)!;
        const nextValue = { ...entryObject.value, codeLinks };
        entryObject.value = nextValue;
        dbValueByRow.set(row.id, JSON.stringify(stripSourceCaptures(nextValue)));
        if (row.status === "formalized") {
          approvedDigestByRow.set(
            row.id,
            designSystemEntryContentDigest(entryObject)
          );
        }
      }
      const validation = validateDesignSystemJson(fileKind, parsed);
      if (!validation.ok) {
        restoreWrittenFiles();
        return {
          ok: false,
          reason: "invalid_design_system_json",
          details: { reason: validation.reason, details: validation.details }
        };
      }
      const newContent = `${stableJsonStringify(parsed)}\n`;
      try {
        writeFileSync(absolutePath, newContent, "utf-8");
      } catch {
        restoreWrittenFiles();
        return { ok: false, reason: "write_failed" };
      }
      writtenFiles.push({
        absolutePath,
        relativePath: sourcePath,
        fileKind,
        originalContent,
        newContent,
        parsed
      });
    }
  }

  // -- Phase 3: transaction (row value updates + events in one commit),
  //    re-checking every entry still exists so a concurrent delete fails
  //    without keeping the file writes.
  try {
    const transaction = withProjectTransaction(projectPath, (db) => {
      const now = new Date().toISOString();
      const eventEntries: Array<{
        entry_id: string;
        source_artifact_path: string;
        code_links: string[];
      }> = [];
      for (const row of rows) {
        const current = db
          .prepare(
            `SELECT status FROM design_system_entries WHERE id = ?`
          )
          .get(row.id) as { status: string } | undefined;
        if (current === undefined) {
          return {
            ok: false as const,
            reason: "entry_not_found" as const,
            details: { entryId: row.entry_id }
          };
        }
        db.prepare(
          `UPDATE design_system_entries
           SET value_json = ?, updated_at = ?
           WHERE id = ?`
        ).run(dbValueByRow.get(row.id)!, now, row.id);
        eventEntries.push({
          entry_id: row.entry_id,
          source_artifact_path: row.source_artifact_path,
          code_links: codeLinksByRow.get(row.id)!
        });
      }
      const event = buildLoggedEvent("design_system_code_links_backfilled", {
        command: "backfill_component_code_links",
        entries: eventEntries
      });
      insertEvent(db, event);
      // Approval-grade provenance per formalized entry: the status gate
      // checks source path + entry id + content digest on re-ingest.
      for (const row of rows) {
        const digest = approvedDigestByRow.get(row.id);
        if (digest === undefined) continue;
        logEventOnDb(db, "design_system_entry_approved", {
          source_artifact_path: row.source_artifact_path,
          entry_id: row.entry_id,
          content_digest: digest,
          from: "formalized",
          to: "formalized",
          via: "backfill_component_code_links"
        });
      }
      return { ok: true as const, event, entries: eventEntries };
    });
    if (!transaction.ok) {
      restoreWrittenFiles();
      return transaction;
    }

    // -- Phase 4 (post-commit): digest ledger (only when the written file
    //    matches the DB rows), invalidation, derived export.
    for (const file of writtenFiles) {
      recordDesignSystemDigestIfConsistent(
        projectPath,
        file.fileKind,
        file.parsed,
        file.relativePath,
        file.newContent
      );
      emitRecordEvent({
        kind: "design-system",
        action: "updated",
        id: file.relativePath,
        projectPath: path.resolve(projectPath)
      });
    }
    const exportResult = writeDesignSystemViewExport(projectPath);
    if (!exportResult.ok) {
      logInvalidToolEvent(
        projectPath,
        "invalid_output",
        "design_system_view_export",
        exportResult.reason
      );
    }
    return {
      ok: true,
      entries: transaction.entries,
      event_id: transaction.event.event_id
    };
  } catch {
    restoreWrittenFiles();
    return { ok: false, reason: "db_error" };
  }
}
