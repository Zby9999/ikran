import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { closeProjectDb, openProjectDb, withProjectTransaction } from "./db";
import { locateEntryObject } from "./design-system-approval";
import {
  validateDesignSystemJson,
  type DesignSystemFileKind,
  type DesignSystemStatus
} from "./design-system-schema";
import {
  stableJsonStringify,
  writeDesignSystemViewExport
} from "./design-system-view";
import {
  assertArtifactPathInProject,
  resolveProjectArtifactPath
} from "./evidence-package";
import {
  buildLoggedEvent,
  insertEvent,
  logInvalidToolEvent
} from "./events";
import { emitRecordEvent } from "./record-bus";
import { canonicalizeArtifactPath } from "./source-artifact";

export type EditableDesignSystemEntryField = "meaning" | "value";

export interface EditDesignSystemEntryInput {
  sourceArtifactPath: string;
  entryId: string;
  field: EditableDesignSystemEntryField;
  text: string;
}

export interface EditDesignSystemEntryHooks {
  beforeCommit?: () => void;
}

export type DesignSystemEditResult =
  | {
      ok: true;
      entry: {
        source_artifact_path: string;
        entry_id: string;
        field: EditableDesignSystemEntryField;
        text: string;
        status: DesignSystemStatus;
        updated_at: string;
      };
      event_id: string;
    }
  | { ok: false; reason: string; details?: unknown };

type EntryRow = {
  file_kind: DesignSystemFileKind;
  status: DesignSystemStatus;
  meaning: string;
  value_json: string;
  links_json: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Designer-authored rule edit. The source file is written first, then the DB
 * row and semantic event commit together. Any DB failure restores the exact
 * source bytes that preceded the edit.
 */
export function editDesignSystemEntry(
  projectPath: string,
  input: EditDesignSystemEntryInput,
  hooks: EditDesignSystemEntryHooks = {}
): DesignSystemEditResult {
  const text = input.field === "value" ? input.text : input.text.trim();
  if (input.text.trim().length === 0) return { ok: false, reason: "empty_text" };
  if (input.field !== "meaning" && input.field !== "value") {
    return { ok: false, reason: "unsupported_field" };
  }
  if (assertArtifactPathInProject(projectPath, input.sourceArtifactPath) !== null) {
    return { ok: false, reason: "artifact_path_escape" };
  }
  const relativePath = canonicalizeArtifactPath(
    projectPath,
    input.sourceArtifactPath
  );
  const absolutePath = resolveProjectArtifactPath(
    projectPath,
    input.sourceArtifactPath
  );
  if (relativePath === null || absolutePath === null) {
    return { ok: false, reason: "artifact_path_escape" };
  }

  let row: EntryRow;
  const db = openProjectDb(projectPath);
  try {
    const found = db
      .prepare(
        `SELECT file_kind, status, meaning, value_json, links_json
         FROM design_system_entries
         WHERE source_artifact_path = ? AND entry_id = ?`
      )
      .get(relativePath, input.entryId) as EntryRow | undefined;
    if (!found) return { ok: false, reason: "not_found" };
    row = found;
  } catch {
    return { ok: false, reason: "db_error" };
  } finally {
    closeProjectDb(db);
  }

  let originalContent: string;
  try {
    originalContent = readFileSync(absolutePath, "utf8");
  } catch {
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
  const entryObject = locateEntryObject(row.file_kind, parsed, input.entryId);
  if (entryObject === null) {
    return { ok: false, reason: "entry_not_in_source_file" };
  }
  let dbValue: unknown;
  let dbLinks: string[];
  try {
    dbValue = JSON.parse(row.value_json);
    dbLinks = JSON.parse(row.links_json) as string[];
  } catch {
    return { ok: false, reason: "db_error" };
  }
  const sourceStatusCompatible =
    entryObject.status === row.status ||
    (row.status === "gap" && entryObject.status === "candidate");
  const sourceMeaningCompatible =
    input.field === "meaning" || entryObject.meaning === row.meaning;
  const sourceValueCompatible =
    input.field === "value" ||
    stableJsonStringify(entryObject.value) === stableJsonStringify(dbValue);
  if (
    !sourceStatusCompatible ||
    !sourceMeaningCompatible ||
    !sourceValueCompatible
  ) {
    return {
      ok: false,
      reason: "source_db_drift",
      details: { source_artifact_path: relativePath, entry_id: input.entryId }
    };
  }

  let before = row.meaning;
  if (input.field === "value") {
    try {
      const priorValue = JSON.parse(row.value_json) as unknown;
      before =
        typeof priorValue === "string"
          ? priorValue
          : stableJsonStringify(priorValue);
    } catch {
      before = row.value_json;
    }
  }
  const nextStatus: DesignSystemStatus =
    row.status === "gap" ? "candidate" : row.status;
  const editEvent = buildLoggedEvent("design_system_entry_edited", {
    source_artifact_path: relativePath,
    entry_id: input.entryId,
    field: input.field,
    before,
    after: text,
    from_status: row.status,
    to_status: nextStatus
  });
  // DB links are the evidence-authoritative envelope. Reusing them repairs a
  // source-only links drift and prevents an uncommitted writer's event id
  // from leaking into the winning transaction.
  const currentLinks = dbLinks;
  const nextLinks = [...currentLinks, editEvent.event_id];
  entryObject[input.field] = text;
  entryObject.status = nextStatus;
  entryObject.links = nextLinks;

  const validation = validateDesignSystemJson(row.file_kind, parsed);
  if (!validation.ok) {
    return {
      ok: false,
      reason: validation.reason,
      details: validation.details
    };
  }

  const nextContent = `${stableJsonStringify(parsed)}\n`;
  try {
    if (readFileSync(absolutePath, "utf8") !== originalContent) {
      return { ok: false, reason: "concurrent_source_changed" };
    }
    writeFileSync(absolutePath, nextContent, "utf8");
  } catch {
    return { ok: false, reason: "write_failed" };
  }
  const restoreOwnFileChange = () => {
    try {
      const currentContent = readFileSync(absolutePath, "utf8");
      if (currentContent === nextContent) {
        writeFileSync(absolutePath, originalContent, "utf8");
        return;
      }
      const currentParsed = JSON.parse(currentContent) as unknown;
      if (!isPlainObject(currentParsed)) return;
      const currentEntry = locateEntryObject(
        row.file_kind,
        currentParsed,
        input.entryId
      );
      const stillContainsOwnWrite =
        currentEntry !== null &&
        currentEntry[input.field] === text &&
        currentEntry.status === nextStatus &&
        stableJsonStringify(currentEntry.links) === stableJsonStringify(nextLinks);
      if (!stillContainsOwnWrite || currentEntry === null) return;
      currentEntry.meaning = row.meaning;
      currentEntry.value = dbValue;
      currentEntry.status = row.status;
      currentEntry.links = dbLinks;
      writeFileSync(
        absolutePath,
        `${stableJsonStringify(currentParsed)}\n`,
        "utf8"
      );
    } catch {
      // Best-effort rollback; the primary DB failure remains authoritative.
    }
  };
  hooks.beforeCommit?.();
  try {
    const currentContent = readFileSync(absolutePath, "utf8");
    let ownWritePreserved = currentContent === nextContent;
    if (!ownWritePreserved) {
      try {
        const currentParsed = JSON.parse(currentContent) as unknown;
        if (isPlainObject(currentParsed)) {
          const currentEntry = locateEntryObject(
            row.file_kind,
            currentParsed,
            input.entryId
          );
          ownWritePreserved =
            currentEntry !== null &&
            currentEntry[input.field] === text &&
            currentEntry.status === nextStatus &&
            stableJsonStringify(currentEntry.links) ===
              stableJsonStringify(nextLinks);
        }
      } catch {
        ownWritePreserved = false;
      }
    }
    if (!ownWritePreserved) {
      logInvalidToolEvent(
        projectPath,
        "invalid_output",
        "edit_design_system_entry",
        "concurrent_edit_superseded",
        { source_artifact_path: relativePath, entry_id: input.entryId }
      );
      return { ok: false, reason: "concurrent_edit_superseded" };
    }
  } catch {
    return { ok: false, reason: "artifact_file_missing" };
  }

  const now = new Date().toISOString();
  let transaction:
    | { ok: true; eventId: string }
    | {
        ok: false;
        reason: "not_found" | "concurrent_edit_superseded";
      };
  try {
    transaction = withProjectTransaction(projectPath, (transactionDb) => {
      const current = transactionDb
        .prepare(
          `SELECT status, links_json FROM design_system_entries
           WHERE source_artifact_path = ? AND entry_id = ?`
        )
        .get(relativePath, input.entryId) as
        | { status: DesignSystemStatus; links_json: string }
        | undefined;
      if (!current) return { ok: false as const, reason: "not_found" as const };
      if (
        current.status !== row.status ||
        current.links_json !== row.links_json
      ) {
        return {
          ok: false as const,
          reason: "concurrent_edit_superseded" as const
        };
      }

      if (input.field === "meaning") {
        transactionDb
          .prepare(
            `UPDATE design_system_entries
             SET meaning = ?, status = ?, links_json = ?, updated_at = ?
             WHERE source_artifact_path = ? AND entry_id = ?`
          )
          .run(
            text,
            nextStatus,
            JSON.stringify(nextLinks),
            now,
            relativePath,
            input.entryId
          );
      } else {
        transactionDb
          .prepare(
            `UPDATE design_system_entries
             SET value_json = ?, status = ?, links_json = ?, updated_at = ?
             WHERE source_artifact_path = ? AND entry_id = ?`
          )
          .run(
            JSON.stringify(text),
            nextStatus,
            JSON.stringify(nextLinks),
            now,
            relativePath,
            input.entryId
          );
      }
      insertEvent(transactionDb, editEvent);
      return { ok: true as const, eventId: editEvent.event_id };
    });
  } catch {
    restoreOwnFileChange();
    return { ok: false, reason: "db_error" };
  }
  if (!transaction.ok) {
    if (transaction.reason === "concurrent_edit_superseded") {
      logInvalidToolEvent(
        projectPath,
        "invalid_output",
        "edit_design_system_entry",
        transaction.reason,
        { source_artifact_path: relativePath, entry_id: input.entryId }
      );
      return transaction;
    }
    restoreOwnFileChange();
    return transaction;
  }

  emitRecordEvent({
    kind: "design-system",
    action: "updated",
    id: relativePath,
    projectPath: path.resolve(projectPath)
  });
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
      field: input.field,
      text,
      status: nextStatus,
      updated_at: now
    },
    event_id: transaction.eventId
  };
}
