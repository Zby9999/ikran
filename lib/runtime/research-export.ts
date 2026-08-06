// Issue 15 — research event export + undeclared-artifact guard.
//
// Eligibility (canonical SQLite events only — never a folder scan):
//   design_system_formalized (DS v1)
//   → new_prototype_run_created kind=new_design
//   → designer_feedback_recorded | rule_update_confirmed
//   → design_system_formalized (DS v2)
//   → new_prototype_run_created kind=new_design (second)
//
// Once eligible, export the whole successful semantic chain (including
// pre-closure stages) into `.ikran/export/`. Failures, drafts, cancels,
// Open Gap, and undeclared source files stay out of research facts.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { withProjectTransaction } from "./db";
import {
  buildLoggedEvent,
  insertEvent,
  listEvents,
  listResearchEligibleEvents,
  type EventType,
  type LoggedEvent
} from "./events";
import { NEW_DESIGN_RUN_KIND } from "./new-design-run";
import { getExportDir, getProjectConfigPath } from "./paths";
import { mapSeedRow } from "./seed-row-map";

export const RESEARCH_EXPORT_FILES = [
  "events.jsonl",
  "project-summary.json",
  "alignment-questions.json",
  "designer-answers.json",
  "prototype-runs.json",
  "rule-update-proposals.json",
  "designer-feedback.json",
  "artifacts-index.json"
] as const;

export type ResearchExportFile = (typeof RESEARCH_EXPORT_FILES)[number];

/** Event types that are never research facts. */
const RESEARCH_EXCLUDED_EVENT_TYPES = new Set<EventType>([
  "agent_task_failed",
  "preview_failed",
  "invalid_output",
  "invalid_artifact",
  "rule_update_canceled",
  "alignment_attempt_abandoned",
  "project_phase_abandoned",
  "design_system_extraction_coverage_rejected",
  "initial_design_system_preparation_failed",
  "annotation_deleted"
]);

export type ResearchExportEligibility = {
  eligible: boolean;
  /** Ordered milestone event ids when eligible; empty when not. */
  milestones: {
    design_system_v1_event_id: string | null;
    first_new_design_run_event_id: string | null;
    feedback_or_confirmed_update_event_id: string | null;
    design_system_v2_event_id: string | null;
    second_new_design_run_event_id: string | null;
  };
  missing: string[];
};

export type ResearchExportResult =
  | {
      ok: true;
      export_dir: string;
      files: ResearchExportFile[];
      event_id: string;
      eligibility: ResearchExportEligibility;
    }
  | {
      ok: false;
      reason: "research_export_ineligible" | "db_error" | "write_failed";
      eligibility?: ResearchExportEligibility;
    };

function isNewDesignRunEvent(event: LoggedEvent): boolean {
  if (event.type !== "new_prototype_run_created") return false;
  return event.payload.kind === NEW_DESIGN_RUN_KIND;
}

function isFeedbackOrConfirmedUpdate(event: LoggedEvent): boolean {
  return (
    event.type === "designer_feedback_recorded" ||
    event.type === "rule_update_confirmed"
  );
}

/**
 * Scan canonical events for the successful-recursion eligibility sequence.
 * Does not scan the project folder.
 */
export function evaluateResearchExportEligibility(
  projectPath: string
): ResearchExportEligibility {
  const events = listEvents(projectPath);
  return evaluateResearchExportEligibilityFromEvents(events);
}

export function evaluateResearchExportEligibilityFromEvents(
  events: readonly LoggedEvent[]
): ResearchExportEligibility {
  const milestones = {
    design_system_v1_event_id: null as string | null,
    first_new_design_run_event_id: null as string | null,
    feedback_or_confirmed_update_event_id: null as string | null,
    design_system_v2_event_id: null as string | null,
    second_new_design_run_event_id: null as string | null
  };
  const missing: string[] = [];

  let stage:
    | "need_v1"
    | "need_first_run"
    | "need_feedback"
    | "need_v2"
    | "need_second_run"
    | "done" = "need_v1";

  for (const event of events) {
    if (stage === "need_v1") {
      if (event.type === "design_system_formalized") {
        milestones.design_system_v1_event_id = event.event_id;
        stage = "need_first_run";
      }
      continue;
    }
    if (stage === "need_first_run") {
      if (isNewDesignRunEvent(event)) {
        milestones.first_new_design_run_event_id = event.event_id;
        stage = "need_feedback";
      }
      continue;
    }
    if (stage === "need_feedback") {
      if (isFeedbackOrConfirmedUpdate(event)) {
        milestones.feedback_or_confirmed_update_event_id = event.event_id;
        stage = "need_v2";
      }
      continue;
    }
    if (stage === "need_v2") {
      if (event.type === "design_system_formalized") {
        milestones.design_system_v2_event_id = event.event_id;
        stage = "need_second_run";
      }
      continue;
    }
    if (stage === "need_second_run") {
      if (isNewDesignRunEvent(event)) {
        milestones.second_new_design_run_event_id = event.event_id;
        stage = "done";
      }
    }
  }

  if (stage !== "done") {
    const remaining: Record<
      Exclude<typeof stage, "done">,
      string[]
    > = {
      need_v1: [
        "design_system_v1",
        "first_new_design_run",
        "feedback_or_confirmed_rule_update",
        "design_system_v2",
        "second_new_design_run"
      ],
      need_first_run: [
        "first_new_design_run",
        "feedback_or_confirmed_rule_update",
        "design_system_v2",
        "second_new_design_run"
      ],
      need_feedback: [
        "feedback_or_confirmed_rule_update",
        "design_system_v2",
        "second_new_design_run"
      ],
      need_v2: ["design_system_v2", "second_new_design_run"],
      need_second_run: ["second_new_design_run"]
    };
    missing.push(...remaining[stage]);
  }

  return {
    eligible: stage === "done",
    milestones,
    missing
  };
}

function parseJsonArray(raw: string | null | undefined): string[] {
  if (typeof raw !== "string" || raw.trim().length === 0) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
  } catch {
    return [];
  }
}

function parseOpaque(raw: string | null | undefined): unknown {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function loadExcludedProposalIds(db: DatabaseType): Set<string> {
  const rows = db
    .prepare(
      `SELECT id, status, classification FROM rule_update_proposals`
    )
    .all() as Array<{ id: string; status: string; classification: string }>;
  const excludedProposalIds = new Set<string>();
  for (const row of rows) {
    if (row.classification === "open_gap") {
      excludedProposalIds.add(row.id);
    }
    if (row.status === "canceled" || row.status === "awaiting_confirmation") {
      excludedProposalIds.add(row.id);
    }
  }
  return excludedProposalIds;
}

/**
 * Derived research-event filter on top of listResearchEligibleEvents.
 * Drops failure / draft / cancel / Open Gap payloads; never invents facts.
 */
export function filterResearchFactEvents(
  events: readonly LoggedEvent[],
  excludedProposalIds: ReadonlySet<string>
): LoggedEvent[] {
  return events.filter((event) => {
    if (RESEARCH_EXCLUDED_EVENT_TYPES.has(event.type)) return false;

    const proposalId = event.payload.proposal_id;
    if (
      typeof proposalId === "string" &&
      excludedProposalIds.has(proposalId)
    ) {
      return false;
    }

    if (
      event.type === "rule_update_proposal_created" ||
      event.type === "rule_update_confirmed"
    ) {
      if (event.payload.classification === "open_gap") return false;
      if (event.payload.status === "canceled") return false;
      if (event.payload.status === "awaiting_confirmation") return false;
    }

    return true;
  });
}

function loadDeclaredArtifactsOnDb(
  db: DatabaseType
): Record<string, unknown>[] {
  const rows = db
    .prepare(
      `SELECT id, path, artifact_type, semantic_purpose, related_record_ids_json,
              readiness, declaration_version, status, created_at, updated_at
       FROM source_artifacts
       ORDER BY created_at ASC, id ASC`
    )
    .all() as Array<{
    id: string;
    path: string;
    artifact_type: string;
    semantic_purpose: string;
    related_record_ids_json: string;
    readiness: string | null;
    declaration_version: number;
    status: string;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    path: row.path,
    artifact_type: row.artifact_type,
    semantic_purpose: row.semantic_purpose,
    related_record_ids: parseJsonArray(row.related_record_ids_json),
    readiness: row.readiness,
    declaration_version: row.declaration_version,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at
  }));
}

function loadProjectSummary(
  projectPath: string,
  db: DatabaseType,
  eligibility: ResearchExportEligibility,
  counts: Record<string, number>
): Record<string, unknown> {
  let config: Record<string, unknown> | null = null;
  try {
    const configPath = getProjectConfigPath(projectPath);
    if (existsSync(configPath)) {
      config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<
        string,
        unknown
      >;
    }
  } catch {
    config = null;
  }

  const seedRows = db
    .prepare(`SELECT * FROM seed_references ORDER BY created_at ASC`)
    .all() as Array<Record<string, unknown>>;
  const seeds = seedRows.map((row) => {
    const seed = mapSeedRow(row);
    return {
      id: seed.id,
      file_key: seed.file_key,
      node_id: seed.node_id,
      registered_via: seed.registered_via,
      figma_seed_reference: seed.figma_seed_reference,
      reference_note: seed.original_design_intent,
      current_surface_id: seed.current_surface_id,
      created_at: seed.created_at
    };
  });

  const phaseRow = db
    .prepare(`SELECT phase FROM project_phase WHERE singleton = 1`)
    .get() as { phase: string } | undefined;
  const phase = phaseRow?.phase ?? "seed";
  const formalizeCount = (
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM events WHERE type = 'design_system_formalized'`
      )
      .get() as { count: number }
  ).count;

  return {
    project: {
      path: typeof config?.path === "string" ? config.path : path.resolve(projectPath),
      name:
        typeof config?.name === "string"
          ? config.name
          : path.basename(projectPath),
      created_at:
        typeof config?.created_at === "string" ? config.created_at : null,
      updated_at:
        typeof config?.updated_at === "string" ? config.updated_at : null
    },
    phase,
    design_system_formalize_count: formalizeCount,
    eligibility: {
      eligible: eligibility.eligible,
      milestones: eligibility.milestones
    },
    seed_references: seeds,
    counts
  };
}

function loadAlignmentExports(db: DatabaseType): {
  questions: Record<string, unknown>[];
  answers: Record<string, unknown>[];
} {
  const abandonedAttemptIds = new Set(
    (
      db
        .prepare(
          `SELECT id FROM alignment_attempts WHERE status = 'abandoned'`
        )
        .all() as Array<{ id: string }>
    ).map((row) => row.id)
  );

  const rows = db
    .prepare(
      `SELECT id, section, observation, question, proposed_answer, final_answer,
              answer_source, anchor_json, created_at, updated_at,
              alignment_attempt_id
       FROM alignment_question_cards
       ORDER BY created_at ASC, id ASC`
    )
    .all() as Array<{
    id: string;
    section: string;
    observation: string;
    question: string;
    proposed_answer: string | null;
    final_answer: string | null;
    answer_source: string | null;
    anchor_json: string;
    created_at: string;
    updated_at: string;
    alignment_attempt_id: string | null;
  }>;

  const questions: Record<string, unknown>[] = [];
  const answers: Record<string, unknown>[] = [];

  for (const row of rows) {
    if (
      row.alignment_attempt_id &&
      abandonedAttemptIds.has(row.alignment_attempt_id)
    ) {
      continue;
    }
    const finalAnswer =
      typeof row.final_answer === "string" ? row.final_answer.trim() : "";
    // Draft / unanswered cards are not research facts.
    if (finalAnswer.length === 0) continue;

    let anchor: unknown = row.anchor_json;
    try {
      anchor = JSON.parse(row.anchor_json);
    } catch {
      // Keep raw.
    }

    questions.push({
      id: row.id,
      section: row.section,
      observation: row.observation,
      question: row.question,
      proposed_answer: row.proposed_answer,
      final_answer: row.final_answer,
      answer_source: row.answer_source,
      anchor,
      alignment_attempt_id: row.alignment_attempt_id,
      created_at: row.created_at,
      updated_at: row.updated_at
    });
    answers.push({
      question_card_id: row.id,
      section: row.section,
      final_answer: row.final_answer,
      answer_source: row.answer_source,
      alignment_attempt_id: row.alignment_attempt_id,
      updated_at: row.updated_at
    });
  }

  return { questions, answers };
}

function loadPrototypeRuns(db: DatabaseType): Record<string, unknown>[] {
  const runs = db
    .prepare(
      `SELECT id, run_id, source_artifact_path, prototype_root, dev_command,
              seed_reference_ids_json, evidence_version_ids_json,
              design_system_version, created_at, updated_at,
              kind, intent, used_candidate_ids_json
       FROM prototype_runs
       ORDER BY created_at ASC, id ASC`
    )
    .all() as Array<Record<string, unknown>>;

  return runs.map((row) => ({
    id: String(row.id),
    run_id: String(row.run_id),
    kind: typeof row.kind === "string" ? row.kind : "seed_reconstruction",
    intent: typeof row.intent === "string" ? row.intent : null,
    source_artifact_path: String(row.source_artifact_path),
    prototype_root: String(row.prototype_root),
    dev_command: String(row.dev_command),
    seed_reference_ids: parseJsonArray(
      typeof row.seed_reference_ids_json === "string"
        ? row.seed_reference_ids_json
        : null
    ),
    evidence_version_ids: parseJsonArray(
      typeof row.evidence_version_ids_json === "string"
        ? row.evidence_version_ids_json
        : null
    ),
    design_system_version: String(row.design_system_version),
    used_candidate_ids: parseJsonArray(
      typeof row.used_candidate_ids_json === "string"
        ? row.used_candidate_ids_json
        : null
    ),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  }));
}

function loadConfirmedRuleProposals(
  db: DatabaseType
): Record<string, unknown>[] {
  const rows = db
    .prepare(
      `SELECT * FROM rule_update_proposals
       WHERE status = 'confirmed' AND classification <> 'open_gap'
       ORDER BY created_at ASC, id ASC`
    )
    .all() as Array<{
    id: string;
    kind: string;
    classification: string;
    title: string;
    change_description: string;
    reason: string;
    affected_items_json: string;
    evidence_record_ids_json: string;
    status: string;
    source_artifact_path: string | null;
    entry_id: string | null;
    proposed_target_path: string | null;
    created_at: string;
    decided_at: string | null;
  }>;

  return rows.map((row) => ({
    proposal_id: row.id,
    kind: row.kind,
    classification: row.classification,
    title: row.title,
    change_description: row.change_description,
    reason: row.reason,
    affected_items: parseJsonArray(row.affected_items_json),
    // Designer-feedback evidence ids are a subset of this list; keep linkage.
    evidence_record_ids: parseJsonArray(row.evidence_record_ids_json),
    status: row.status,
    source_artifact_path: row.source_artifact_path,
    entry_id: row.entry_id,
    proposed_target_path: row.proposed_target_path,
    created_at: row.created_at,
    decided_at: row.decided_at
  }));
}

function loadDesignerFeedback(db: DatabaseType): Record<string, unknown>[] {
  // Full raw feedback log — includes records never promoted by review.
  const rows = db
    .prepare(
      `SELECT * FROM designer_feedback ORDER BY created_at ASC, id ASC`
    )
    .all() as Array<{
    id: string;
    summary: string;
    run_id: string;
    session_id: string;
    evidence_surface_id: string | null;
    prototype_surface_id: string | null;
    region_annotation_id: string | null;
    seed_reference_id: string | null;
    opaque_context_json: string | null;
    created_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    summary: row.summary,
    run_id: row.run_id,
    session_id: row.session_id,
    evidence_surface_id: row.evidence_surface_id,
    prototype_surface_id: row.prototype_surface_id,
    region_annotation_id: row.region_annotation_id,
    seed_reference_id: row.seed_reference_id,
    opaque_context: parseOpaque(row.opaque_context_json),
    created_at: row.created_at
  }));
}

function writeJsonFile(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function writeJsonl(filePath: string, events: readonly LoggedEvent[]): void {
  const body =
    events.length === 0
      ? ""
      : `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;
  writeFileSync(filePath, body, "utf-8");
}

/**
 * Generate the research export package when the project meets the recursive
 * eligibility gate. Writes under `.ikran/export/` and records export_generated.
 */
export function exportResearchPackage(
  projectPath: string
): ResearchExportResult {
  const eligibility = evaluateResearchExportEligibility(projectPath);
  if (!eligibility.eligible) {
    return {
      ok: false,
      reason: "research_export_ineligible",
      eligibility
    };
  }

  try {
    const exportDir = getExportDir(projectPath);
    mkdirSync(exportDir, { recursive: true });

    const transaction = withProjectTransaction(projectPath, (db) => {
      const excludedProposalIds = loadExcludedProposalIds(db);
      const { questions, answers } = loadAlignmentExports(db);
      const prototypeRuns = loadPrototypeRuns(db);
      const proposals = loadConfirmedRuleProposals(db);
      const feedback = loadDesignerFeedback(db);
      // Undeclared-file guard: index is declaration-only; never folder-scan.
      const artifacts = loadDeclaredArtifactsOnDb(db);

      const counts = {
        alignment_questions: questions.length,
        designer_answers: answers.length,
        prototype_runs: prototypeRuns.length,
        rule_update_proposals: proposals.length,
        designer_feedback: feedback.length,
        artifacts: artifacts.length
      };

      const summary = loadProjectSummary(
        projectPath,
        db,
        eligibility,
        counts
      );

      const exportEvent = buildLoggedEvent("export_generated", {
        export_dir: exportDir,
        files: [...RESEARCH_EXPORT_FILES],
        eligibility_milestones: eligibility.milestones,
        counts
      });
      insertEvent(db, exportEvent);

      return {
        exportEvent,
        summary,
        questions,
        answers,
        prototypeRuns,
        proposals,
        feedback,
        artifacts,
        excludedProposalIds
      };
    });

    const researchEvents = filterResearchFactEvents(
      listResearchEligibleEvents(projectPath),
      transaction.excludedProposalIds
    );

    writeJsonl(path.join(exportDir, "events.jsonl"), researchEvents);
    writeJsonFile(
      path.join(exportDir, "project-summary.json"),
      transaction.summary
    );
    writeJsonFile(
      path.join(exportDir, "alignment-questions.json"),
      transaction.questions
    );
    writeJsonFile(
      path.join(exportDir, "designer-answers.json"),
      transaction.answers
    );
    writeJsonFile(
      path.join(exportDir, "prototype-runs.json"),
      transaction.prototypeRuns
    );
    writeJsonFile(
      path.join(exportDir, "rule-update-proposals.json"),
      transaction.proposals
    );
    writeJsonFile(
      path.join(exportDir, "designer-feedback.json"),
      transaction.feedback
    );
    writeJsonFile(
      path.join(exportDir, "artifacts-index.json"),
      transaction.artifacts
    );

    return {
      ok: true,
      export_dir: exportDir,
      files: [...RESEARCH_EXPORT_FILES],
      event_id: transaction.exportEvent.event_id,
      eligibility
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("EACCES") || message.includes("ENOENT")) {
      return { ok: false, reason: "write_failed" };
    }
    return { ok: false, reason: "db_error" };
  }
}
