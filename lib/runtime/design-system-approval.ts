// Design-system approval write-back (Issue 09A decisions 5 + 8, Task D).
//
// The Browser's ONLY write operation in v1 is candidate → formalized
// approval. One approval writes BOTH sides of the 09A d.2 split:
//   - the DB row (Runtime truth the Browser reads), and
//   - the JSON source file (the authoring layer), with the entry's status
//     flipped and the file re-serialized canonically — sorted keys (the
//     Task C stableJsonStringify ordering), 2-space indent, trailing
//     newline — so diffs show only semantic changes. NOTE: the FIRST
//     approval of a file the Agent wrote in arbitrary key order is a
//     one-time whole-file reformat; afterwards Runtime is the canonical
//     writer and approval diffs are noise-free.
//
// Formalized invariant, enforced AT APPROVAL TIME: the entry's links must
// satisfy the formalized cross-validation rule (checkDesignSystemEntryStatus
// with status "formalized") — i.e. it must link an answered card with
// answer_source "designer-edited". A candidate backed only by an Agent
// annotation is rejected: approving it would violate the invariant every
// formalized entry carries, and the next ingest of its own file would fail.
//
// Status transitions: only candidate → formalized is allowed. A gap entry is
// rejected (gap_entry_not_approvable — a gap must be filled by the Agent,
// not approved). An already-formalized entry is REJECTED with
// already_formalized (not a silent no-op) so the client learns its view is
// stale instead of believing it performed a write.
//
// Atomicity ordering (DB transaction and file write cannot share one atomic
// unit): serialize + validate the new file content → write the file → run
// the DB transaction (row update + formalized-invariant re-check + semantic
// event in one commit — the hard gate is authoritative AT the commit point,
// not just at the Phase-1 pre-check). On DB failure the original file bytes
// held in memory are restored and the failure is reported. The reverse
// order (DB first) would leave the Browser reading a formalized entry whose
// source file still says candidate.
//
// Concurrency is LWW per 09A decision 8: no etag, no locking — last write
// wins. When the in-transaction re-check finds the entry ALREADY formalized,
// a concurrent approval won the race: the winner's canonical formalized
// bytes stand (the loser must NOT restore over them), and the losing
// approval is audited (invalid_output, tool approve_design_system_entry) so
// the conflict stays visible in the event log. Every successful approval
// records a design_system_entry_approved event.
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
  parseTokenEntryRef,
  validateDesignSystemJson,
  type DesignSystemFileKind
} from "./design-system-schema";
import {
  checkDesignSystemEntryStatus,
  loadDesignSystemLinkIndex,
  type DesignSystemStatusCheckReason
} from "./design-system-status";
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
  | "gap_entry_not_approvable"
  | "entry_not_in_source_file"
  | "artifact_path_escape"
  | "artifact_file_missing"
  | "invalid_design_system_json"
  | "write_failed"
  | "db_error"
  | DesignSystemStatusCheckReason
  | string;

export type DesignSystemApprovalResult =
  | {
      ok: true;
      entry: {
        source_artifact_path: string;
        entry_id: string;
        status: "formalized";
        updated_at: string;
      };
      /** The committed design_system_entry_approved event id. */
      event_id: string;
    }
  | { ok: false; reason: DesignSystemApprovalReason; details?: unknown };

export interface ApproveDesignSystemEntryInput {
  /** Project-relative (or absolute, in-scope) source artifact path. */
  sourceArtifactPath: string;
  /** Stable entry identity inside the file (layer-qualified for tokens). */
  entryId: string;
}

export interface ApproveDesignSystemEntryHooks {
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
      // visualLanguage and principles share one id space (ingest enforces
      // global uniqueness inside this file).
      const visual = json.visualLanguage;
      if (isPlainObject(visual) && visual.id === entryId) return visual;
      return byId(json.principles);
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
  status: string;
  links_json: string;
};

/**
 * Approve one candidate entry: flip DB + source file to formalized, log the
 * semantic event, then (post-commit) invalidate the Browser and regenerate
 * the derived export.
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

  // -- Phase 1 (read-only): row lookup + status gate + formalized invariant.
  let row: EntryRow;
  {
    const db = openProjectDb(projectPath);
    try {
      const found = db
        .prepare(
          `SELECT id, file_kind, status, links_json
           FROM design_system_entries
           WHERE source_artifact_path = ? AND entry_id = ?`
        )
        .get(relativePath, input.entryId) as EntryRow | undefined;
      if (!found) return { ok: false, reason: "not_found" };
      row = found;

      if (row.status === "formalized") {
        return { ok: false, reason: "already_formalized" };
      }
      if (row.status === "gap") {
        return { ok: false, reason: "gap_entry_not_approvable" };
      }

      // Formalized invariant at approval time (see module header). The links
      // come from the DB row — the declaration-time truth cross-validated at
      // ingest — NOT from the possibly-drifted source file on disk.
      const links = JSON.parse(row.links_json) as string[];
      const check = checkDesignSystemEntryStatus(
        { status: "formalized", links },
        loadDesignSystemLinkIndex(db)
      );
      if (!check.ok) {
        return {
          ok: false,
          reason: check.reason,
          details: check.details ?? { links }
        };
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
  entryObject.status = "formalized";

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
    writeFileSync(absolutePath, newContent, "utf-8");
  } catch {
    return { ok: false, reason: "write_failed" };
  }

  // -- Phase 3: DB transaction (row update + semantic event in one commit).
  //    Re-check the row AND the formalized invariant inside the transaction
  //    so the hard gate is authoritative at the commit point: under LWW a
  //    concurrent approval may have landed first — last write wins, but we
  //    never flip a row that is no longer a candidate (e.g. re-ingested as
  //    gap) or whose links no longer back formalized, and the file is
  //    restored on any such failure EXCEPT the already_formalized race loss
  //    (see below).
  const now = new Date().toISOString();
  const restoreFile = () => {
    try {
      writeFileSync(absolutePath, originalContent, "utf-8");
    } catch {
      // Best-effort restore; the reported failure reason stands.
    }
  };

  hooks.beforeCommit?.();

  type TxnResult =
    | { ok: true; eventId: string }
    | {
        ok: false;
        reason:
          | "not_found"
          | "already_formalized"
          | "gap_entry_not_approvable"
          | string;
        details?: unknown;
      };
  let txn: TxnResult;
  try {
    txn = withProjectTransaction(projectPath, (db): TxnResult => {
      const current = db
        .prepare(
          `SELECT status, links_json FROM design_system_entries
           WHERE source_artifact_path = ? AND entry_id = ?`
        )
        .get(relativePath, input.entryId) as
        | { status: string; links_json: string }
        | undefined;
      if (!current) return { ok: false, reason: "not_found" };
      if (current.status === "formalized") {
        return { ok: false, reason: "already_formalized" };
      }
      if (current.status !== "candidate") {
        return { ok: false, reason: "gap_entry_not_approvable" };
      }

      // Formalized invariant, authoritative at the commit point (Phase 1 is
      // only the fast-fail pre-check): links/answer sources may have changed
      // since, on this same transaction's snapshot.
      const links = JSON.parse(current.links_json) as string[];
      const check = checkDesignSystemEntryStatus(
        { status: "formalized", links },
        loadDesignSystemLinkIndex(db)
      );
      if (!check.ok) {
        return {
          ok: false,
          reason: check.reason,
          details: check.details ?? { links }
        };
      }

      db.prepare(
        `UPDATE design_system_entries
         SET status = 'formalized', updated_at = ?
         WHERE source_artifact_path = ? AND entry_id = ?`
      ).run(now, relativePath, input.entryId);

      const event = logEventOnDb(db, "design_system_entry_approved", {
        source_artifact_path: relativePath,
        entry_id: input.entryId,
        from: "candidate",
        to: "formalized"
      });
      return { ok: true, eventId: event.event_id };
    });
  } catch {
    restoreFile();
    return { ok: false, reason: "db_error" };
  }
  if (!txn.ok) {
    if (txn.reason === "already_formalized") {
      // Lost the LWW race: a concurrent approval already formalized this
      // entry and wrote the canonical formalized bytes — do NOT restore our
      // pre-write bytes over the winner's. Audit the losing approval so the
      // conflict stays visible in the event log (09A decision 8).
      logInvalidToolEvent(
        projectPath,
        "invalid_output",
        "approve_design_system_entry",
        "already_formalized",
        { source_artifact_path: relativePath, entry_id: input.entryId }
      );
      return { ok: false, reason: "already_formalized" };
    }
    restoreFile();
    return txn.details !== undefined
      ? { ok: false, reason: txn.reason, details: txn.details }
      : { ok: false, reason: txn.reason };
  }

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
      status: "formalized",
      updated_at: now
    },
    event_id: txn.eventId
  };
}
