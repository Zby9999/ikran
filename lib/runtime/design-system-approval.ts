// Design-system designer status write-back (Issue 09A decisions 5 + 8, Task D).
//
// The Browser lets the designer switch candidate ↔ formalized directly.
// One transition writes BOTH sides of the 09A d.2 split:
//   - the DB row (Runtime truth the Browser reads), and
//   - the JSON source file (the authoring layer), with the entry's status
//     flipped and the file re-serialized canonically — sorted keys (the
//     Task C stableJsonStringify ordering), 2-space indent, trailing
//     newline — so diffs show only semantic changes. NOTE: the FIRST
//     approval of a file the Agent wrote in arbitrary key order is a
//     one-time whole-file reformat; afterwards Runtime is the canonical
//     writer and approval diffs are noise-free.
//
// A Browser approval is itself direct designer intent. It deliberately does
// not require an earlier designer-edited Question card: the semantic approval
// event written in the same transaction is the durable provenance that later
// ingests use to distinguish this path from an Agent-authored formalized claim.
//
// Status transitions are candidate ↔ formalized. A gap entry is
// rejected (gap_entry_not_approvable — a gap must be filled by the Agent,
// not switched). A request already at its target is rejected with a typed
// stale-state reason so the client can reload the authoritative view.
//
// Atomicity ordering (DB transaction and file write cannot share one atomic
// unit): serialize + validate the new file content → write the file → run
// the DB transaction (row status re-check + semantic event in one commit).
// On DB failure the original file bytes
// held in memory are restored and the failure is reported. The reverse
// order (DB first) would leave the Browser reading a formalized entry whose
// source file still says candidate.
//
// Concurrency is LWW per 09A decision 8: no etag, no locking — last write
// wins. If another writer reaches the requested status between the source
// write and transaction, Runtime preserves those bytes and still commits the
// designer's semantic status event so intent cannot be swallowed.
//
// The write-back never goes through recordSourceArtifact: Runtime wrote the
// file itself and the DB is already consistent, so approval must NOT trigger
// re-ingest (no declaration, no ingest events, no index-row version bump).

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { openProjectDb, closeProjectDb, withProjectTransaction } from "./db";
import { logEventOnDb, logInvalidToolEvent } from "./events";
import { emitRecordEvent } from "./record-bus";
import {
  assertArtifactPathInProject,
  resolveProjectArtifactPath
} from "./evidence-package";
import { canonicalizeArtifactPath } from "./source-artifact";
import {
  recordDesignSystemDigestIfConsistent
} from "./design-system-sync";
import { designSystemEntryContentDigest } from "./design-system-entry-provenance";
import { sourceContentDigestOf } from "./source-artifact-digest";
import { collectDesignSystemEntryRows } from "./design-system-ingest";
import { hasPendingAuthorizedRuleUpdateProposalForPathOnDb } from "./rule-update-policy";
import {
  parseTokenEntryRef,
  validateDesignSystemJson,
  type DesignSystemFileKind
} from "./design-system-schema";
import {
  stableJsonStringify,
  writeDesignSystemViewExport
} from "./design-system-view";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type DesignSystemApprovalReason =
  | "not_found"
  | "already_formalized"
  | "already_candidate"
  | "gap_entry_not_approvable"
  | "entry_not_in_source_file"
  | "artifact_path_escape"
  | "artifact_file_missing"
  | "invalid_design_system_json"
  | "write_failed"
  | "db_error"
  | string;

export type DesignSystemApprovalResult =
  | {
      ok: true;
      entry: {
        source_artifact_path: string;
        entry_id: string;
        status: "candidate" | "formalized";
        updated_at: string;
      };
      /** The committed designer status-change event id. */
      event_id: string;
    }
  | { ok: false; reason: DesignSystemApprovalReason; details?: unknown };

export interface ApproveDesignSystemEntryInput {
  /** Project-relative (or absolute, in-scope) source artifact path. */
  sourceArtifactPath: string;
  /** Stable entry identity inside the file (layer-qualified for tokens). */
  entryId: string;
  /** Destination selected by the designer. */
  targetStatus: "candidate" | "formalized";
}

export interface ApproveDesignSystemEntryHooks {
  /**
   * Command preflight CAS: protected-phase approval must still read the exact
   * source bytes that passed metadata reconciliation.
   */
  expectedSourceDigest?: string;
  /**
   * Test seam: runs after the source-file write and before the DB commit so
   * tests can simulate a concurrent writer landing in between. Never used by
   * the command/HTTP surface.
   */
  beforeCommit?: () => void;
}

// ---------------------------------------------------------------------------
// Per-kind entry location — mirrors collectDesignSystemEntryRows /
// collectStatusEntries (./design-system-ingest, ./design-system-schema) so the
// write-back finds exactly the entry the ingest flattened. Token layer
// vocabulary comes from ./design-system-schema (TOKEN_LAYERS /
// parseTokenEntryRef), the single owner.
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Locate the mutable entry object for `entryId` inside a parsed source file.
 * Returns null when the file no longer contains the entry (DB/file drift).
 */
export function locateEntryObject(
  fileKind: DesignSystemFileKind,
  json: Record<string, unknown>,
  entryId: string
): Record<string, unknown> | null {
  const byId = (list: unknown): Record<string, unknown> | null => {
    if (!Array.isArray(list)) return null;
    for (const raw of list) {
      if (isPlainObject(raw) && raw.id === entryId) return raw;
    }
    return null;
  };

  switch (fileKind) {
    case "design-system.json": {
      // visualLanguage and concepts share one id space (ingest enforces
      // global uniqueness inside this file).
      const visual = json.visualLanguage;
      if (isPlainObject(visual) && visual.id === entryId) return visual;
      return byId(json.concepts);
    }
    case "token.json": {
      // Layer-qualified identity: "<layer>.<name>" (name may contain dots).
      const ref = parseTokenEntryRef(entryId);
      if (!ref) return null;
      const entries = json[ref.layer];
      if (!isPlainObject(entries)) return null;
      const entry = entries[ref.name];
      return isPlainObject(entry) ? entry : null;
    }
    case "component-list.json":
      return byId(json.components);
    case "component-spec":
      // One component per file: the root object IS the entry.
      return json.id === entryId ? json : null;
    case "layout-rules.json":
    case "interaction-rules.json":
      return byId(json.rules);
  }
}

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

type EntryRow = {
  id: string;
  file_kind: string;
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

function dbEntrySemanticFingerprint(row: Omit<EntryRow, "id" | "file_kind" | "status" | "links_json">): string {
  return stableJsonStringify({
    section: row.section,
    name: row.name,
    kind: row.kind,
    domain: row.domain,
    value: JSON.parse(row.value_json),
    source_captures: JSON.parse(row.source_captures_json),
    meaning: row.meaning,
    position: row.position
  });
}

function sourceEntrySemanticsMatchDbRow(
  fileKind: DesignSystemFileKind,
  parsed: Record<string, unknown>,
  entryId: string,
  row: EntryRow
): boolean {
  try {
    const sourceRow = collectDesignSystemEntryRows(fileKind, parsed).find(
      (entry) => entry.entry_id === entryId
    );
    if (sourceRow === undefined) return false;
    return (
      stableJsonStringify({
        section: sourceRow.section,
        name: sourceRow.name,
        kind: sourceRow.kind,
        domain: sourceRow.domain,
        value: sourceRow.value,
        source_captures: sourceRow.source_captures,
        meaning: sourceRow.meaning,
        position: sourceRow.position
      }) === dbEntrySemanticFingerprint(row)
    );
  } catch {
    return false;
  }
}

/**
 * Apply a designer-selected candidate/formalized status to DB + source,
 * append a semantic event, then invalidate the Browser and derived export.
 */
export function approveDesignSystemEntry(
  projectPath: string,
  input: ApproveDesignSystemEntryInput,
  hooks: ApproveDesignSystemEntryHooks = {}
): DesignSystemApprovalResult {
  // Project-scope check (same fail-closed seam as recordSourceArtifact).
  if (assertArtifactPathInProject(projectPath, input.sourceArtifactPath) !== null) {
    return { ok: false, reason: "artifact_path_escape" };
  }
  const relativePath = canonicalizeArtifactPath(
    projectPath,
    input.sourceArtifactPath
  );
  if (relativePath === null) return { ok: false, reason: "artifact_path_escape" };
  const absolutePath = resolveProjectArtifactPath(
    projectPath,
    input.sourceArtifactPath
  );
  if (absolutePath === null) return { ok: false, reason: "artifact_path_escape" };

  // -- Phase 1 (read-only): row lookup + status gate.
  let row: EntryRow;
  {
    const db = openProjectDb(projectPath);
    try {
      const found = db
        .prepare(
          `SELECT id, file_kind, section, name, kind, domain, value_json,
                  source_captures_json, meaning, status, links_json, position
           FROM design_system_entries
           WHERE source_artifact_path = ? AND entry_id = ?`
        )
        .get(relativePath, input.entryId) as EntryRow | undefined;
      if (!found) return { ok: false, reason: "not_found" };
      row = found;

      if (row.status === input.targetStatus) {
        return {
          ok: false,
          reason:
            input.targetStatus === "formalized"
              ? "already_formalized"
              : "already_candidate"
        };
      }
      if (row.status === "gap") {
        return { ok: false, reason: "gap_entry_not_approvable" };
      }

    } catch {
      return { ok: false, reason: "db_error" };
    } finally {
      closeProjectDb(db);
    }
  }
  const fileKind = row.file_kind as DesignSystemFileKind;

  // -- Phase 2: locate the entry in the current file, flip status, validate,
  //    serialize canonically, write. Original bytes stay in memory for the
  //    DB-failure restore path.
  let originalContent: string;
  try {
    originalContent = readFileSync(absolutePath, "utf-8");
  } catch {
    // Missing or unreadable source file (DB/file drift).
    return { ok: false, reason: "artifact_file_missing" };
  }
  if (
    hooks.expectedSourceDigest !== undefined &&
    sourceContentDigestOf(originalContent) !== hooks.expectedSourceDigest
  ) {
    return { ok: false, reason: "concurrent_source_changed" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(originalContent);
  } catch {
    return { ok: false, reason: "invalid_design_system_json" };
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, reason: "invalid_design_system_json" };
  }

  const entryObject = locateEntryObject(fileKind, parsed, input.entryId);
  if (entryObject === null) {
    return { ok: false, reason: "entry_not_in_source_file" };
  }
  if (!sourceEntrySemanticsMatchDbRow(fileKind, parsed, input.entryId, row)) {
    return {
      ok: false,
      reason: "source_db_drift",
      details: { source_artifact_path: relativePath, entry_id: input.entryId }
    };
  }
  const sourceStatusCompatible =
    entryObject.status === row.status || entryObject.status === input.targetStatus;
  if (!sourceStatusCompatible || JSON.stringify(entryObject.links) !== row.links_json) {
    return {
      ok: false,
      reason: "source_db_drift",
      details: { source_artifact_path: relativePath, entry_id: input.entryId }
    };
  }
  entryObject.status = input.targetStatus;
  const writtenEntryDigest = designSystemEntryContentDigest(entryObject);
  const approvedContentDigest =
    input.targetStatus === "formalized"
      ? writtenEntryDigest
      : null;

  // Self-check: the file Runtime is about to write must pass its own schema
  // (a flip is structure-preserving, so a failure here means drift we refuse
  // to persist).
  const validation = validateDesignSystemJson(fileKind, parsed);
  if (!validation.ok) {
    return {
      ok: false,
      reason: validation.reason,
      details: validation.details
    };
  }
  const newContent = `${stableJsonStringify(parsed)}\n`;
  try {
    if (readFileSync(absolutePath, "utf-8") !== originalContent) {
      return { ok: false, reason: "concurrent_source_changed" };
    }
    writeFileSync(absolutePath, newContent, "utf-8");
  } catch {
    return { ok: false, reason: "write_failed" };
  }

  // -- Phase 3: DB transaction (row update + semantic event in one commit).
  //    Re-check status + links inside the transaction. A concurrent writer
  //    that already reached the target still gets this designer decision
  //    recorded; incompatible edits fail without overwriting their bytes.
  const now = new Date().toISOString();
  const targetAlreadyCommitted = () => {
    const checkDb = openProjectDb(projectPath);
    try {
      const current = checkDb
        .prepare(
          `SELECT status FROM design_system_entries
           WHERE source_artifact_path = ? AND entry_id = ?`
        )
        .get(relativePath, input.entryId) as { status: string } | undefined;
      return current?.status === input.targetStatus;
    } catch {
      return false;
    } finally {
      closeProjectDb(checkDb);
    }
  };
  const restoreOwnFileChange = () => {
    try {
      if (targetAlreadyCommitted()) return;
      const currentContent = readFileSync(absolutePath, "utf-8");
      if (currentContent === newContent) {
        writeFileSync(absolutePath, originalContent, "utf-8");
        return;
      }
      // A protected command is bound to the preflight source digest. Any
      // different bytes are a superseding Rule Update writer, even when that
      // writer happens to use the same target status and links. Never merge a
      // rollback into bytes Runtime did not write.
      if (hooks.expectedSourceDigest !== undefined) return;
      const currentParsed = JSON.parse(currentContent) as unknown;
      if (!isPlainObject(currentParsed)) return;
      const currentEntry = locateEntryObject(
        fileKind,
        currentParsed,
        input.entryId
      );
      if (
        currentEntry === null ||
        currentEntry.status !== input.targetStatus ||
        JSON.stringify(currentEntry.links) !== row.links_json
      ) return;
      currentEntry.status = row.status;
      writeFileSync(
        absolutePath,
        `${stableJsonStringify(currentParsed)}\n`,
        "utf-8"
      );
    } catch {
      // Best-effort restore; the reported failure reason stands.
    }
  };

  hooks.beforeCommit?.();

  try {
    const currentContent = readFileSync(absolutePath, "utf-8");
    const currentParsed = JSON.parse(currentContent) as unknown;
    const currentEntry = isPlainObject(currentParsed)
      ? locateEntryObject(fileKind, currentParsed, input.entryId)
      : null;
    if (
      currentEntry === null ||
      designSystemEntryContentDigest(currentEntry) !== writtenEntryDigest
    ) {
      restoreOwnFileChange();
      logInvalidToolEvent(
        projectPath,
        "invalid_output",
        "approve_design_system_entry",
        "concurrent_edit_superseded",
        { source_artifact_path: relativePath, entry_id: input.entryId }
      );
      return { ok: false, reason: "concurrent_edit_superseded" };
    }
  } catch {
    return { ok: false, reason: "artifact_file_missing" };
  }

  type TxnResult =
    | { ok: true; eventId: string }
    | {
        ok: false;
        reason:
          | "not_found"
          | "gap_entry_not_approvable"
          | string;
        details?: unknown;
      };
  let txn: TxnResult;
  try {
    txn = withProjectTransaction(projectPath, (db): TxnResult => {
      if (
        hooks.expectedSourceDigest !== undefined &&
        hasPendingAuthorizedRuleUpdateProposalForPathOnDb(db, relativePath)
      ) {
        return {
          ok: false,
          reason: "source_db_drift",
          details: {
            source_artifact_path: relativePath,
            entry_id: input.entryId,
            conflict: "pending_rule_update_write"
          }
        };
      }
      const current = db
        .prepare(
          `SELECT section, name, kind, domain, value_json,
                  source_captures_json, meaning, status, links_json, position
           FROM design_system_entries
           WHERE source_artifact_path = ? AND entry_id = ?`
        )
        .get(relativePath, input.entryId) as
        | Omit<EntryRow, "id" | "file_kind">
        | undefined;
      if (!current) return { ok: false, reason: "not_found" };
      if (
        dbEntrySemanticFingerprint(current) !==
        dbEntrySemanticFingerprint(row)
      ) {
        return { ok: false, reason: "concurrent_edit_superseded" };
      }
      if (current.status === input.targetStatus) {
        if (
          input.targetStatus === "formalized" &&
          current.links_json !== row.links_json
        ) {
          return { ok: false, reason: "concurrent_edit_superseded" };
        }
        const event = logEventOnDb(
          db,
          input.targetStatus === "formalized"
            ? "design_system_entry_approved"
            : "design_system_entry_reverted",
          {
            source_artifact_path: relativePath,
            entry_id: input.entryId,
            ...(approvedContentDigest === null
              ? {}
              : { content_digest: approvedContentDigest }),
            from: row.status,
            to: input.targetStatus
          }
        );
        return { ok: true, eventId: event.event_id };
      }
      if (current.status === "gap") {
        return { ok: false, reason: "gap_entry_not_approvable" };
      }
      if (current.status !== row.status || current.links_json !== row.links_json) {
        return { ok: false, reason: "concurrent_edit_superseded" };
      }

      db.prepare(
        `UPDATE design_system_entries
         SET status = ?, updated_at = ?
         WHERE source_artifact_path = ? AND entry_id = ?`
      ).run(input.targetStatus, now, relativePath, input.entryId);

      const event = logEventOnDb(
        db,
        input.targetStatus === "formalized"
          ? "design_system_entry_approved"
          : "design_system_entry_reverted",
        {
          source_artifact_path: relativePath,
          entry_id: input.entryId,
          ...(approvedContentDigest === null
            ? {}
            : { content_digest: approvedContentDigest }),
          from: current.status,
          to: input.targetStatus
        }
      );
      return { ok: true, eventId: event.event_id };
    });
  } catch {
    restoreOwnFileChange();
    return { ok: false, reason: "db_error" };
  }
  if (!txn.ok) {
    restoreOwnFileChange();
    return txn.details !== undefined
      ? { ok: false, reason: txn.reason, details: txn.details }
      : { ok: false, reason: txn.reason };
  }

  // Phase 2 rewrote the whole source file while the transaction updated a
  // single row. Record the new bytes in the digest ledger only when the
  // whole file now matches the DB rows; otherwise the record would launder
  // another entry's undeclared drift past the lazy file→DB sync.
  recordDesignSystemDigestIfConsistent(
    projectPath,
    fileKind,
    parsed,
    relativePath,
    newContent
  );

  // -- Phase 4 (post-commit): Browser invalidation + derived export.
  emitRecordEvent({
    kind: "design-system",
    action: "updated",
    id: relativePath,
    projectPath: path.resolve(projectPath)
  });

  // The DB changed, so the derived export is stale; regenerate best-effort
  // with the same invalid_output audit convention as Task C's ingest path.
  // Deliberately NO design_system_view_generated event here: that event
  // means "a source file was ingested", and approval is not an ingest (a
  // test pins this asymmetry).
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
    entry: {
      source_artifact_path: relativePath,
      entry_id: input.entryId,
      status: input.targetStatus,
      updated_at: now
    },
    event_id: txn.eventId
  };
}
