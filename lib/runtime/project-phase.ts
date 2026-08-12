import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

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
import {
  validateDesignSystemJson,
  type DesignSystemFileKind
} from "./design-system-schema";
import {
  captureDesignSystemSourceDigestSnapshot,
  recordDesignSystemDigestIfConsistent,
  syncDesignSystemSources,
  verifyDesignSystemSourceDigestSnapshot,
  type DesignSystemSourceDigestIssue,
  type DesignSystemSyncWarning
} from "./design-system-sync";
import {
  stableJsonStringify,
  writeDesignSystemViewExport
} from "./design-system-view";
import { resolveProjectArtifactPath } from "./evidence-package";
import { sourceContentDigestOf } from "./source-artifact-digest";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export const PROJECT_PHASES = [
  "seed",
  "draft_design_system",
  "prototype_validation",
  "design_system_formal",
  "ready_for_new_design"
] as const;

export type ProjectPhase = (typeof PROJECT_PHASES)[number];

export type PhaseGateFailure = {
  ok: false;
  reason: "phase_gate";
  phase: ProjectPhase;
};

export type PhaseCommandSuccess = {
  ok: true;
  phase: ProjectPhase;
  from_phase: ProjectPhase;
  event_id: string;
};

export type FormalizeFailure =
  | PhaseGateFailure
  | { ok: false; reason: "empty_modification_review" }
  | {
      ok: false;
      reason: "rule_update_review_required";
      phase: ProjectPhase;
    }
  | {
      ok: false;
      reason: "rule_update_review_incomplete";
      phase: ProjectPhase;
    }
  | {
      ok: false;
      reason: "rule_update_proposal_required";
      phase: ProjectPhase;
      changed_artifact_paths: string[];
    }
  | {
      ok: false;
      reason: "design_system_source_not_ready";
      phase: ProjectPhase;
      source_warnings: DesignSystemSyncWarning[];
    }
  | {
      ok: false;
      reason: "design_system_source_changed_during_formalize";
      phase: ProjectPhase;
      source_issues: DesignSystemSourceDigestIssue[];
    }
  | {
      ok: false;
      reason: "unreviewed_feedback";
      phase: ProjectPhase;
      unreviewed_feedback_count: number;
    }
  | {
      ok: false;
      reason: "candidate_entry_not_found" | "candidate_entry_not_candidate";
    }
  | { ok: false; reason: "db_error" }
  | {
      ok: false;
      reason:
        | "artifact_path_escape"
        | "artifact_file_missing"
        | "invalid_design_system_json"
        | "entry_not_in_source_file"
        | "write_failed";
      details?: unknown;
    };

export type PhaseCommandResult =
  | PhaseCommandSuccess
  | PhaseGateFailure
  | { ok: false; reason: "db_error" };

const ABANDONABLE: ReadonlySet<ProjectPhase> = new Set([
  "draft_design_system",
  "prototype_validation",
  "design_system_formal"
]);

function isProjectPhase(value: unknown): value is ProjectPhase {
  return (
    typeof value === "string" &&
    (PROJECT_PHASES as readonly string[]).includes(value)
  );
}

export function ensureProjectPhaseRow(db: DatabaseType): void {
  db.prepare(
    `INSERT OR IGNORE INTO project_phase (singleton, phase, updated_at)
     VALUES (1, 'seed', ?)`
  ).run(new Date().toISOString());
}

export function readProjectPhaseOnDb(db: DatabaseType): ProjectPhase {
  ensureProjectPhaseRow(db);
  const row = db
    .prepare(`SELECT phase FROM project_phase WHERE singleton = 1`)
    .get() as { phase: string } | undefined;
  return isProjectPhase(row?.phase) ? row.phase : "seed";
}

export function getProjectPhase(projectPath: string): ProjectPhase {
  const db = openProjectDb(projectPath);
  try {
    return readProjectPhaseOnDb(db);
  } finally {
    closeProjectDb(db);
  }
}

/**
 * Reusable phase gate for Issue 30 / 13 and in-module transitions.
 * Returns the current phase on both success and gate failure.
 */
export function requireProjectPhase(
  projectPath: string,
  allowed: ProjectPhase | readonly ProjectPhase[]
): { ok: true; phase: ProjectPhase } | PhaseGateFailure {
  const phase = getProjectPhase(projectPath);
  const allowedList = Array.isArray(allowed) ? allowed : [allowed];
  if (!allowedList.includes(phase)) {
    return { ok: false, reason: "phase_gate", phase };
  }
  return { ok: true, phase };
}

/**
 * Feedback with no recorded disposition: neither consumed by a confirmed
 * rule-update proposal (Issue 29 confirm path) nor explicitly dismissed.
 * Shared seam between the Consolidate review and the formalize gate.
 */
const UNREVIEWED_FEEDBACK_PREDICATE = `
  NOT EXISTS (
    SELECT 1 FROM designer_feedback_review_consumption c
    WHERE c.feedback_id = f.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM designer_feedback_dismissals d
    WHERE d.feedback_id = f.id
  )
`;

export function listUnreviewedDesignerFeedbackOnDb(
  db: DatabaseType
): string[] {
  return (
    db
      .prepare(
        `SELECT f.id AS id
         FROM designer_feedback f
         WHERE ${UNREVIEWED_FEEDBACK_PREDICATE}
         ORDER BY f.created_at ASC, f.id ASC`
      )
      .all() as Array<{ id: string }>
  ).map((row) => row.id);
}

export function countUnreviewedDesignerFeedbackOnDb(
  db: DatabaseType
): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM designer_feedback f
       WHERE ${UNREVIEWED_FEEDBACK_PREDICATE}`
    )
    .get() as { count: number };
  return Number(row.count);
}

/**
 * A formalization cycle is reviewable only when both the frozen conversation
 * and the resulting Consolidate claim happened after the latest Prototype
 * confirmation. Event ids are the canonical transaction order; timestamps
 * can collide within one millisecond and are intentionally not used here.
 */
export function hasCurrentRuleUpdateReviewOnDb(db: DatabaseType): boolean {
  const confirmation = db
    .prepare(
      `SELECT id, event_id
       FROM events
       WHERE type = 'project_phase_confirmed'
         AND json_extract(payload, '$.command') = 'confirm_prototype'
       ORDER BY id DESC
       LIMIT 1`
    )
    .get() as { id: number; event_id: string } | undefined;
  if (!confirmation) return false;

  const review = db
    .prepare(
      `SELECT 1 AS ok
       FROM events review
       WHERE review.type = 'consolidate_review_started'
         AND review.id > ?
         AND json_extract(review.payload, '$.prototype_confirmation_event_id') = ?
         AND EXISTS (
           SELECT 1
           FROM events reconciliation
           WHERE reconciliation.type = 'conversation_reconciliation_completed'
             AND reconciliation.id > ?
             AND reconciliation.id < review.id
             AND json_extract(reconciliation.payload, '$.reconciliation_id') =
                 json_extract(review.payload, '$.reconciliation_id')
         )
       ORDER BY review.id DESC
       LIMIT 1`
    )
    .get(
      confirmation.id,
      confirmation.event_id,
      confirmation.id
    ) as { ok: number } | undefined;
  return review !== undefined;
}

/** Compatibility: projects without the Issue 36 aggregate keep the legacy
 * Consolidate gate. Once a managed Review exists for that reconciliation, it
 * must be terminal before formalization can advance. */
export function currentManagedRuleUpdateReviewCompleteOnDb(
  db: DatabaseType
): boolean {
  const current = db
    .prepare(
      `SELECT json_extract(payload, '$.reconciliation_id') AS reconciliation_id
       FROM events WHERE type = 'consolidate_review_started'
       ORDER BY id DESC LIMIT 1`
    )
    .get() as { reconciliation_id: string | null } | undefined;
  if (!current?.reconciliation_id) return true;
  const review = db
    .prepare(
      `SELECT status FROM rule_update_reviews
       WHERE reconciliation_id = ? AND context <> 'Legacy Rule Update'
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(current.reconciliation_id) as { status: string } | undefined;
  return review === undefined || review.status === "completed";
}

/**
 * Advance seed → draft_design_system after successful Initial Design System
 * extraction. No-op when already past seed. Used inside finalize transactions.
 */
export function advanceToDraftDesignSystemOnDb(db: DatabaseType): void {
  ensureProjectPhaseRow(db);
  const current = readProjectPhaseOnDb(db);
  if (current !== "seed") return;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE project_phase SET phase = ?, updated_at = ? WHERE singleton = 1`
  ).run("draft_design_system", now);
  logEventOnDb(db, "project_phase_confirmed", {
    from_phase: "seed",
    phase: "draft_design_system",
    command: "initial_design_system_preparation_completed"
  });
}

function transitionPhase(
  projectPath: string,
  from: ProjectPhase | readonly ProjectPhase[],
  to: ProjectPhase,
  eventType: "project_phase_confirmed" | "design_system_formalized" | "project_phase_abandoned",
  command: string,
  additionalEventPayload?: (
    db: DatabaseType,
    current: ProjectPhase
  ) => Record<string, unknown>
): PhaseCommandResult {
  const allowedFrom = Array.isArray(from) ? from : [from];
  try {
    const transaction = withProjectTransaction(projectPath, (db) => {
      const current = readProjectPhaseOnDb(db);
      if (!allowedFrom.includes(current)) {
        return {
          ok: false as const,
          reason: "phase_gate" as const,
          phase: current
        };
      }
      const now = new Date().toISOString();
      db.prepare(
        `UPDATE project_phase SET phase = ?, updated_at = ? WHERE singleton = 1`
      ).run(to, now);
      const event = buildLoggedEvent(eventType, {
        ...(additionalEventPayload?.(db, current) ?? {}),
        from_phase: current,
        phase: to,
        command
      });
      insertEvent(db, event);
      return { ok: true as const, event, from_phase: current };
    });
    if (!transaction.ok) return transaction;
    emitRecordEvent({
      kind: "phase",
      action: "updated",
      id: "project-phase",
      projectPath: path.resolve(projectPath)
    });
    return {
      ok: true,
      phase: to,
      from_phase: transaction.from_phase,
      event_id: transaction.event.event_id
    };
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

export function confirmDraftDesignSystem(
  projectPath: string
): PhaseCommandResult {
  return transitionPhase(
    projectPath,
    "draft_design_system",
    "prototype_validation",
    "project_phase_confirmed",
    "confirm_draft_design_system"
  );
}

export function confirmPrototype(projectPath: string): PhaseCommandResult {
  // From prototype_validation: first prototype confirmed after draft audit.
  // From ready_for_new_design: a new-design-run prototype confirmed so the
  // Design System can be formalized again (v2, v3, …) — Issue 15's
  // success-recursion re-entry into design_system_formal.
  return transitionPhase(
    projectPath,
    ["prototype_validation", "ready_for_new_design"],
    "design_system_formal",
    "project_phase_confirmed",
    "confirm_prototype",
    (db, current) => {
      // Canonical preview declarations carry the design run represented by
      // the host conversation. Bind only a preview created inside this phase
      // cycle; legacy/manual phase fixtures without a durable boundary remain
      // compatible but do not gain a fabricated run binding.
      const boundary =
        current === "prototype_validation"
          ? (db
              .prepare(
                `SELECT id FROM events
                 WHERE type = 'project_phase_confirmed'
                   AND json_extract(payload, '$.command') = 'confirm_draft_design_system'
                   AND json_extract(payload, '$.phase') = 'prototype_validation'
                 ORDER BY id DESC LIMIT 1`
              )
              .get() as { id: number } | undefined)
          : (db
              .prepare(
                `SELECT id FROM events
                 WHERE type = 'design_system_formalized'
                   AND json_extract(payload, '$.phase') = 'ready_for_new_design'
                 ORDER BY id DESC LIMIT 1`
              )
              .get() as { id: number } | undefined);
      if (boundary === undefined) return {};

      const preview = db
        .prepare(
          `SELECT
             json_extract(payload, '$.run_id') AS run_id,
             json_extract(payload, '$.prototype_run_id') AS prototype_run_id
           FROM events
           WHERE type = 'prototype_preview_declared'
             AND id > ?
           ORDER BY id DESC LIMIT 1`
        )
        .get(boundary.id) as
        | { run_id: unknown; prototype_run_id: unknown }
        | undefined;
      if (
        typeof preview?.run_id !== "string" ||
        preview.run_id.length === 0 ||
        typeof preview.prototype_run_id !== "string" ||
        preview.prototype_run_id.length === 0
      ) {
        return {};
      }
      return {
        run_id: preview.run_id,
        prototype_run_id: preview.prototype_run_id
      };
    }
  );
}

type PromotedEntryRow = {
  id: string;
  entry_id: string;
  source_artifact_path: string;
  file_kind: string;
  status: string;
  links_json: string;
  name: string | null;
  value_json: string;
  source_captures_json: string;
};

/**
 * Issue 31 soft hint (never a gate): one entry per promoted component spec
 * whose codeLinks are still empty while sourceCaptures remain its only
 * provenance — the gap backfill_component_code_links exists to close.
 */
export type CodeBackfillHint = {
  entry_id: string;
  title: string;
};

export type FormalizeSuccess = PhaseCommandSuccess & {
  code_backfill_hints: CodeBackfillHint[];
};

export interface FormalizeDesignSystemHooks {
  /** Deterministic concurrency seam used by source-snapshot regression tests. */
  afterSourceSnapshot?: () => void;
  /** Runs immediately before the promotion write's compare-and-swap check. */
  beforePromotionWrite?: (sourcePath: string) => void;
  /** Runs after Runtime-owned promotion writes, just before digest verification. */
  beforeSourceDigestVerification?: () => void;
}

function codeBackfillHintsFor(
  rows: readonly PromotedEntryRow[]
): CodeBackfillHint[] {
  const hints: CodeBackfillHint[] = [];
  for (const row of rows) {
    if (row.file_kind !== "component-spec") continue;
    try {
      const value = JSON.parse(row.value_json) as unknown;
      const codeLinks = isPlainObject(value) ? value.codeLinks : undefined;
      if (Array.isArray(codeLinks) && codeLinks.length > 0) continue;
      const captures = JSON.parse(row.source_captures_json) as unknown;
      if (!Array.isArray(captures) || captures.length === 0) continue;
      hints.push({ entry_id: row.entry_id, title: row.name ?? row.entry_id });
    } catch {
      // Unparseable row payloads grant no hint.
    }
  }
  return hints;
}

/**
 * Formalize gate (Issue 28): design_system_formal → ready_for_new_design,
 * flipping the designer-adjudicated candidates to formalized. Promotions are
 * a designer status decision like the Browser approval flow, so they write
 * BOTH sides of the 09A d.2 split: the source file status is flipped (and
 * the file re-serialized canonically) and each promoted entry gets an
 * approval-grade `design_system_entry_approved` event carrying the written
 * content digest — otherwise the next ingest's status gate would reject the
 * formalized claims the Runtime itself just wrote. Files are written first
 * and restored if the transaction fails (same ordering as
 * approveDesignSystemEntry); the digest ledger is only updated when the
 * written file matches the DB rows, so pre-existing drift stays visible to
 * the lazy sync.
 *
 * `modificationReview` is the mandatory modification-review attestation: one
 * free-text sentence in which the Agent declares it inspected the phase's
 * prototype modifications for reusable-rule candidates (and where any
 * identified candidates went). The Runtime only enforces presence — the
 * judgment itself is the Agent's; the point is that skipping the review
 * silently is no longer possible. It is persisted on the
 * `design_system_formalized` event payload.
 *
 * The success result also carries `code_backfill_hints` (Issue 31): promoted
 * component specs whose codeLinks are still empty while sourceCaptures remain
 * their only provenance. Advisory only — never a rejection path.
 */
export function formalizeDesignSystem(
  projectPath: string,
  promoteEntryIds: readonly string[] = [],
  modificationReview: string,
  hooks: FormalizeDesignSystemHooks = {}
): FormalizeSuccess | FormalizeFailure {
  const review = modificationReview.trim();
  if (review.length === 0) {
    return { ok: false, reason: "empty_modification_review" };
  }
  const promoteIds = [
    ...new Set(
      promoteEntryIds.map((id) => id.trim()).filter((id) => id.length > 0)
    )
  ];

  // -- Phase 1 (read-only): phase gate, feedback gate, candidate lookup.
  let promotedRows: PromotedEntryRow[] = [];
  {
    let db: DatabaseType;
    try {
      db = openProjectDb(projectPath);
    } catch {
      return { ok: false, reason: "db_error" };
    }
    try {
      const current = readProjectPhaseOnDb(db);
      if (current !== "design_system_formal") {
        return { ok: false, reason: "phase_gate", phase: current };
      }
      if (!hasCurrentRuleUpdateReviewOnDb(db)) {
        return {
          ok: false,
          reason: "rule_update_review_required",
          phase: current
        };
      }
      if (!currentManagedRuleUpdateReviewCompleteOnDb(db)) {
        return {
          ok: false,
          reason: "rule_update_review_incomplete",
          phase: current
        };
      }
      const unreviewed = countUnreviewedDesignerFeedbackOnDb(db);
      if (unreviewed > 0) {
        return {
          ok: false,
          reason: "unreviewed_feedback",
          phase: current,
          unreviewed_feedback_count: unreviewed
        };
      }
      for (const id of promoteIds) {
        const row = db
          .prepare(
            `SELECT id, entry_id, source_artifact_path, file_kind, status,
                    links_json, name, value_json, source_captures_json
             FROM design_system_entries WHERE id = ? OR entry_id = ?`
          )
          .get(id, id) as PromotedEntryRow | undefined;
        if (!row) return { ok: false, reason: "candidate_entry_not_found" };
        if (row.status !== "candidate") {
          return { ok: false, reason: "candidate_entry_not_candidate" };
        }
        promotedRows.push(row);
      }
    } catch {
      return { ok: false, reason: "db_error" };
    } finally {
      closeProjectDb(db);
    }
  }

  let sourceSync: ReturnType<typeof syncDesignSystemSources>;
  try {
    sourceSync = syncDesignSystemSources(projectPath);
  } catch {
    return { ok: false, reason: "db_error" };
  }
  const unauthorizedSourceChanges = sourceSync.warnings
    .filter((warning) => warning.reason === "rule_update_proposal_required")
    .map((warning) => warning.path);
  if (unauthorizedSourceChanges.length > 0) {
    return {
      ok: false,
      reason: "rule_update_proposal_required",
      phase: "design_system_formal",
      changed_artifact_paths: unauthorizedSourceChanges
    };
  }
  if (sourceSync.warnings.length > 0) {
    return {
      ok: false,
      reason: "design_system_source_not_ready",
      phase: "design_system_formal",
      source_warnings: sourceSync.warnings
    };
  }
  let sourceDigestSnapshot: ReturnType<
    typeof captureDesignSystemSourceDigestSnapshot
  >;
  try {
    sourceDigestSnapshot = captureDesignSystemSourceDigestSnapshot(projectPath);
  } catch {
    return { ok: false, reason: "db_error" };
  }
  hooks.afterSourceSnapshot?.();
  const sourceDigestByPath = new Map(
    sourceDigestSnapshot.sources.map((source) => [source.path, source.digest])
  );

  // -- Phase 2: flip the promoted statuses in the source files. Original
  //    bytes stay in memory for the restore path; a file the Runtime cannot
  //    flip fails the whole promotion before any DB write.
  const writtenFiles: Array<{
    absolutePath: string;
    relativePath: string;
    fileKind: DesignSystemFileKind;
    originalContent: string;
    newContent: string;
    parsed: Record<string, unknown>;
  }> = [];
  const approvedDigestByRow = new Map<string, string>();
  const promotedSourceDigestOverrides: Record<string, string> = {};
  const restoreWrittenFiles = () => {
    for (const file of writtenFiles) {
      try {
        // Restore only bytes this formalize call still owns. If another host
        // writer changed the file after our promotion write, preserving that
        // newer content is safer than clobbering it with the old snapshot.
        if (readFileSync(file.absolutePath, "utf-8") === file.newContent) {
          writeFileSync(file.absolutePath, file.originalContent, "utf-8");
        }
      } catch {
        // Best-effort restore; the reported failure reason stands.
      }
    }
  };
  {
    const rowsByPath = new Map<string, PromotedEntryRow[]>();
    for (const row of promotedRows) {
      const list = rowsByPath.get(row.source_artifact_path) ?? [];
      list.push(row);
      rowsByPath.set(row.source_artifact_path, list);
    }
    for (const [sourcePath, rows] of rowsByPath) {
      const absolutePath = resolveProjectArtifactPath(projectPath, sourcePath);
      if (absolutePath === null) {
        restoreWrittenFiles();
        return { ok: false, reason: "artifact_path_escape" };
      }
      const fileKind = rows[0].file_kind as DesignSystemFileKind;
      let originalContent: string;
      try {
        originalContent = readFileSync(absolutePath, "utf-8");
      } catch {
        restoreWrittenFiles();
        return { ok: false, reason: "artifact_file_missing" };
      }
      const expectedOriginalDigest = sourceDigestByPath.get(sourcePath);
      if (expectedOriginalDigest === undefined || expectedOriginalDigest === null) {
        restoreWrittenFiles();
        return {
          ok: false,
          reason: "design_system_source_changed_during_formalize",
          phase: "design_system_formal",
          source_issues: [
            { path: sourcePath, reason: "source_digest_missing" }
          ]
        };
      }
      const actualOriginalDigest = sourceContentDigestOf(originalContent);
      if (actualOriginalDigest !== expectedOriginalDigest) {
        restoreWrittenFiles();
        return {
          ok: false,
          reason: "design_system_source_changed_during_formalize",
          phase: "design_system_formal",
          source_issues: [
            {
              path: sourcePath,
              reason: "source_content_changed",
              expectedDigest: expectedOriginalDigest,
              actualDigest: actualOriginalDigest
            }
          ]
        };
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
      for (const row of rows) {
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
        entryObject.status = "formalized";
        // DB links are the evidence-authoritative envelope (same convention
        // as the edit flow).
        entryObject.links = JSON.parse(row.links_json) as string[];
        approvedDigestByRow.set(
          row.id,
          designSystemEntryContentDigest(entryObject)
        );
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
      promotedSourceDigestOverrides[sourcePath] =
        sourceContentDigestOf(newContent);
      // The source may change while promotion parsing/validation is in
      // progress. Re-read immediately before writing and treat the original
      // bytes as a compare-and-swap token so Runtime never overwrites a newer
      // host write with a promotion derived from stale content.
      hooks.beforePromotionWrite?.(sourcePath);
      let contentImmediatelyBeforeWrite: string;
      try {
        contentImmediatelyBeforeWrite = readFileSync(absolutePath, "utf-8");
      } catch {
        restoreWrittenFiles();
        return {
          ok: false,
          reason: "design_system_source_changed_during_formalize",
          phase: "design_system_formal",
          source_issues: [
            { path: sourcePath, reason: "source_file_missing" }
          ]
        };
      }
      if (contentImmediatelyBeforeWrite !== originalContent) {
        restoreWrittenFiles();
        return {
          ok: false,
          reason: "design_system_source_changed_during_formalize",
          phase: "design_system_formal",
          source_issues: [
            {
              path: sourcePath,
              reason: "source_content_changed",
              expectedDigest: expectedOriginalDigest,
              actualDigest: sourceContentDigestOf(contentImmediatelyBeforeWrite)
            }
          ]
        };
      }
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

  // -- Phase 3: transaction (row updates + phase + events in one commit),
  //    re-checking every gate so a concurrent change fails without keeping
  //    the file writes.
  try {
    const transaction = withProjectTransaction(projectPath, (db) => {
      const current = readProjectPhaseOnDb(db);
      if (current !== "design_system_formal") {
        return {
          ok: false as const,
          reason: "phase_gate" as const,
          phase: current
        };
      }
      if (!hasCurrentRuleUpdateReviewOnDb(db)) {
        return {
          ok: false as const,
          reason: "rule_update_review_required" as const,
          phase: current
        };
      }
      if (!currentManagedRuleUpdateReviewCompleteOnDb(db)) {
        return {
          ok: false as const,
          reason: "rule_update_review_incomplete" as const,
          phase: current
        };
      }
      const unreviewed = countUnreviewedDesignerFeedbackOnDb(db);
      if (unreviewed > 0) {
        return {
          ok: false as const,
          reason: "unreviewed_feedback" as const,
          phase: current,
          unreviewed_feedback_count: unreviewed
        };
      }
      const now = new Date().toISOString();
      for (const row of promotedRows) {
        const status = (
          db
            .prepare(`SELECT status FROM design_system_entries WHERE id = ?`)
            .get(row.id) as { status: string } | undefined
        )?.status;
        if (status === undefined) {
          return { ok: false as const, reason: "candidate_entry_not_found" as const };
        }
        if (status !== "candidate") {
          return {
            ok: false as const,
            reason: "candidate_entry_not_candidate" as const
          };
        }
      }
      // Last possible filesystem check before the DB transition. SQLite and
      // the host filesystem cannot share one atomic lock, so pin every source
      // to the post-sync digest (plus exact Runtime-owned promotion bytes) at
      // the narrowest commit boundary available.
      hooks.beforeSourceDigestVerification?.();
      const sourceVerification = verifyDesignSystemSourceDigestSnapshot(
        projectPath,
        sourceDigestSnapshot,
        promotedSourceDigestOverrides
      );
      if (!sourceVerification.ok) {
        return {
          ok: false as const,
          reason: "design_system_source_changed_during_formalize" as const,
          phase: current,
          source_issues: sourceVerification.issues
        };
      }
      for (const row of promotedRows) {
        db.prepare(
          `UPDATE design_system_entries
           SET status = 'formalized', updated_at = ?
           WHERE id = ?`
        ).run(now, row.id);
      }
      db.prepare(
        `UPDATE project_phase SET phase = ?, updated_at = ? WHERE singleton = 1`
      ).run("ready_for_new_design", now);
      const event = buildLoggedEvent("design_system_formalized", {
        from_phase: "design_system_formal",
        phase: "ready_for_new_design",
        command: "formalize_design_system",
        promoted_entry_ids: promoteIds,
        modification_review: review
      });
      insertEvent(db, event);
      // Approval-grade provenance per promoted entry: the status gate checks
      // source path + entry id + content digest when this file is re-ingested.
      for (const row of promotedRows) {
        logEventOnDb(db, "design_system_entry_approved", {
          source_artifact_path: row.source_artifact_path,
          entry_id: row.entry_id,
          content_digest: approvedDigestByRow.get(row.id),
          from: "candidate",
          to: "formalized",
          via: "formalize_design_system"
        });
      }
      return { ok: true as const, event, promotedCount: promoteIds.length };
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
    }
    emitRecordEvent({
      kind: "phase",
      action: "updated",
      id: "project-phase",
      projectPath: path.resolve(projectPath)
    });
    if (transaction.promotedCount > 0) {
      // Candidate → formalized flips change Design System Browser data.
      emitRecordEvent({
        kind: "design-system",
        action: "updated",
        id: "design-system-entries",
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
    }
    return {
      ok: true,
      phase: "ready_for_new_design",
      from_phase: "design_system_formal",
      event_id: transaction.event.event_id,
      code_backfill_hints: codeBackfillHintsFor(promotedRows)
    };
  } catch {
    restoreWrittenFiles();
    return { ok: false, reason: "db_error" };
  }
}

export function abandonProjectPhase(
  projectPath: string
): PhaseCommandResult {
  return transitionPhase(
    projectPath,
    [...ABANDONABLE],
    "seed",
    "project_phase_abandoned",
    "abandon_project_phase"
  );
}
