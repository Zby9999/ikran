// Design-system open-question answer write-back (Issue 09C-B03).
//
// The Atlas card's Open Questions panel lets the designer answer a question
// the extraction left open. One answer writes BOTH sides of the 09A d.2
// split, mirroring the approval write-back (./design-system-approval):
//   - the JSON source file (authoring layer): the question moves from
//     value.openQuestions to value.openQuestionAnswers ({question, answer}),
//     re-serialized canonically so diffs show only the semantic change; and
//   - the DB row (Runtime truth the Browser reads): value_json updated.
//
// Answering does NOT change status, links, or meaning, and never promotes
// the answer into a rule — turning an answer into reusable guidance is the
// rule-update flow (Issue 12), not this write. The entry's schema stays a
// soft contract: openQuestionAnswers is an extra value key the layout /
// interaction rules validation already tolerates.
//
// Atomicity mirrors approval: serialize + validate the new file content →
// write the file → run the DB transaction (row re-check + update + semantic
// event in one commit). On DB failure the original file bytes held in
// memory are restored. Concurrency is LWW (09A decision 8): the transaction
// re-checks that the question is still open on the commit-point snapshot; a
// concurrent answer of the same question loses with question_not_open and
// the file is restored.
//
// Like approval, this write never goes through recordSourceArtifact:
// Runtime wrote the file itself and the DB is already consistent, so it
// must NOT trigger re-ingest.

import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { openProjectDb, closeProjectDb, withProjectTransaction } from "./db";
import { logEventOnDb } from "./events";
import { emitRecordEvent } from "./record-bus";
import {
  assertArtifactPathInProject,
  resolveProjectArtifactPath
} from "./evidence-package";
import { canonicalizeArtifactPath } from "./source-artifact";
import { locateEntryObject } from "./design-system-approval";
import {
  validateDesignSystemJson,
  type DesignSystemFileKind
} from "./design-system-schema";
import {
  stableJsonStringify,
  writeDesignSystemViewExport
} from "./design-system-view";
import { logInvalidToolEvent } from "./events";

export type DesignSystemOpenQuestionAnswerReason =
  | "artifact_path_escape"
  | "artifact_file_missing"
  | "invalid_design_system_json"
  | "not_found"
  | "entry_not_in_source_file"
  | "question_not_open"
  | "missing_answer"
  | "concurrent_modification"
  | "write_failed"
  | "db_error";

export type DesignSystemOpenQuestionAnswerResult =
  | {
      ok: true;
      entry: {
        source_artifact_path: string;
        entry_id: string;
        question: string;
        answer: string;
        updated_at: string;
      };
      /** The committed design_system_open_question_answered event id. */
      event_id: string;
    }
  | {
      ok: false;
      reason: DesignSystemOpenQuestionAnswerReason;
      details?: unknown;
    };

export interface AnswerDesignSystemOpenQuestionInput {
  /** Project-relative (or absolute, in-scope) source artifact path. */
  sourceArtifactPath: string;
  /** Stable entry identity inside the file. */
  entryId: string;
  /** Exact verbatim question string from value.openQuestions. */
  question: string;
  /** The designer's answer (trimmed; must be non-empty). */
  answer: string;
}

export interface AnswerDesignSystemOpenQuestionHooks {
  /**
   * Test seam: runs after the content is serialized and validated but
   * before the file write, so tests can simulate a concurrent file writer
   * landing in between. Never used by the command/HTTP surface.
   */
  beforeWrite?: () => void;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Read value.openQuestions from a DB row's value_json (tolerant). */
function openQuestionsOf(valueJson: string): string[] {
  try {
    const value = JSON.parse(valueJson) as unknown;
    if (!isPlainObject(value) || !Array.isArray(value.openQuestions)) return [];
    return value.openQuestions.filter(
      (item): item is string => typeof item === "string"
    );
  } catch {
    return [];
  }
}

/**
 * Record the designer's answer to one open question: move it from
 * openQuestions to openQuestionAnswers in the source file AND the DB row,
 * log the semantic event, then (post-commit) invalidate the Browser and
 * regenerate the derived export.
 */
export function answerDesignSystemOpenQuestion(
  projectPath: string,
  input: AnswerDesignSystemOpenQuestionInput,
  hooks: AnswerDesignSystemOpenQuestionHooks = {}
): DesignSystemOpenQuestionAnswerResult {
  const answer = input.answer.trim();
  if (answer === "") return { ok: false, reason: "missing_answer" };

  // Project-scope check (same fail-closed seam as approval/declaration).
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

  // -- Phase 1: locate the entry in the current file and confirm the
  //    question is still open there.
  let originalContent: string;
  let originalMtimeMs: number;
  try {
    originalContent = readFileSync(absolutePath, "utf-8");
    originalMtimeMs = statSync(absolutePath).mtimeMs;
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

  // The file_kind lookup needs the DB row (the file itself does not declare
  // its kind in a machine-readable envelope across all kinds).
  let fileKind: DesignSystemFileKind;
  {
    const db = openProjectDb(projectPath);
    try {
      const row = db
        .prepare(
          `SELECT file_kind FROM design_system_entries
           WHERE source_artifact_path = ? AND entry_id = ?`
        )
        .get(relativePath, input.entryId) as { file_kind: string } | undefined;
      if (!row) return { ok: false, reason: "not_found" };
      fileKind = row.file_kind as DesignSystemFileKind;
    } catch {
      return { ok: false, reason: "db_error" };
    } finally {
      closeProjectDb(db);
    }
  }

  const entryObject = locateEntryObject(fileKind, parsed, input.entryId);
  if (entryObject === null) {
    return { ok: false, reason: "entry_not_in_source_file" };
  }
  const value = entryObject.value;
  if (!isPlainObject(value)) {
    return { ok: false, reason: "question_not_open" };
  }
  const openQuestions = Array.isArray(value.openQuestions)
    ? value.openQuestions.filter(
        (item): item is string => typeof item === "string"
      )
    : [];
  if (!openQuestions.includes(input.question)) {
    return { ok: false, reason: "question_not_open" };
  }

  // -- Phase 2: move the question into openQuestionAnswers, validate the
  //    result against the file's own schema, serialize canonically, write.
  value.openQuestions = openQuestions.filter((q) => q !== input.question);
  const priorAnswers = Array.isArray(value.openQuestionAnswers)
    ? value.openQuestionAnswers
    : [];
  value.openQuestionAnswers = [
    ...priorAnswers,
    { question: input.question, answer }
  ];

  const validation = validateDesignSystemJson(fileKind, parsed);
  if (!validation.ok) {
    return {
      ok: false,
      reason: "invalid_design_system_json",
      details: validation.details
    };
  }
  const newContent = `${stableJsonStringify(parsed)}\n`;
  // Concurrency guard (09A decision 8, cross-process LWW): if another
  // writer touched the file between our read and this write, ABORT instead
  // of clobbering their answer with our stale snapshot — the client retries
  // and merges onto the winner's state. Without this guard, two concurrent
  // answers to DIFFERENT questions would fork source and DB (the file loses
  // the winner's answer while the DB merge keeps both).
  hooks.beforeWrite?.();
  let currentMtimeMs: number;
  try {
    currentMtimeMs = statSync(absolutePath).mtimeMs;
  } catch {
    return { ok: false, reason: "artifact_file_missing" };
  }
  if (currentMtimeMs !== originalMtimeMs) {
    logInvalidToolEvent(
      projectPath,
      "invalid_output",
      "answer_design_system_open_question",
      "concurrent_modification",
      { source_artifact_path: relativePath, entry_id: input.entryId }
    );
    return { ok: false, reason: "concurrent_modification" };
  }
  try {
    writeFileSync(absolutePath, newContent, "utf-8");
  } catch {
    return { ok: false, reason: "write_failed" };
  }

  // -- Phase 3: DB transaction (re-check + value_json update + event).
  const now = new Date().toISOString();
  const writtenMtimeMs = (() => {
    try {
      return statSync(absolutePath).mtimeMs;
    } catch {
      return null;
    }
  })();
  // Restore ONLY our own write: if a concurrent winner rewrote the file
  // after us (mtime moved), restoring would clobber their committed answer
  // — the same no-restore-over-the-winner rule approval applies to the
  // already_formalized race loss (09A decision 8).
  const restoreFile = () => {
    try {
      if (
        writtenMtimeMs !== null &&
        statSync(absolutePath).mtimeMs === writtenMtimeMs
      ) {
        writeFileSync(absolutePath, originalContent, "utf-8");
      }
    } catch {
      // Best-effort restore; the reported failure reason stands.
    }
  };

  type TxnResult =
    | { ok: true; eventId: string }
    | { ok: false; reason: "entry_not_in_source_file" | "question_not_open" };
  let txn: TxnResult;
  try {
    txn = withProjectTransaction(projectPath, (db): TxnResult => {
      const current = db
        .prepare(
          `SELECT value_json FROM design_system_entries
           WHERE source_artifact_path = ? AND entry_id = ?`
        )
        .get(relativePath, input.entryId) as { value_json: string } | undefined;
      if (!current) return { ok: false, reason: "entry_not_in_source_file" };
      // LWW guard, authoritative at the commit point: the question must
      // still be open on this transaction's snapshot.
      if (!openQuestionsOf(current.value_json).includes(input.question)) {
        return { ok: false, reason: "question_not_open" };
      }

      let valueParsed: unknown;
      try {
        valueParsed = JSON.parse(current.value_json);
      } catch {
        return { ok: false, reason: "question_not_open" };
      }
      if (!isPlainObject(valueParsed)) {
        return { ok: false, reason: "question_not_open" };
      }
      const dbOpen = openQuestionsOf(current.value_json).filter(
        (q) => q !== input.question
      );
      const dbPrior = Array.isArray(valueParsed.openQuestionAnswers)
        ? valueParsed.openQuestionAnswers
        : [];
      valueParsed.openQuestions = dbOpen;
      valueParsed.openQuestionAnswers = [
        ...dbPrior,
        { question: input.question, answer }
      ];

      db.prepare(
        `UPDATE design_system_entries
         SET value_json = ?, updated_at = ?
         WHERE source_artifact_path = ? AND entry_id = ?`
      ).run(
        JSON.stringify(valueParsed),
        now,
        relativePath,
        input.entryId
      );

      const event = logEventOnDb(db, "design_system_open_question_answered", {
        source_artifact_path: relativePath,
        entry_id: input.entryId,
        question: input.question,
        answer
      });
      return { ok: true, eventId: event.event_id };
    });
  } catch {
    restoreFile();
    return { ok: false, reason: "db_error" };
  }
  if (!txn.ok) {
    restoreFile();
    return { ok: false, reason: txn.reason };
  }

  // -- Phase 4 (post-commit): Browser invalidation + derived export.
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
      question: input.question,
      answer,
      updated_at: now
    },
    event_id: txn.eventId
  };
}
