import { randomUUID } from "node:crypto";
import path from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";
import { closeProjectDb, openProjectDb, withProjectTransaction } from "./db";
import { logEventOnDb } from "./events";
import { emitRecordEvent } from "./record-bus";
import { getAlignmentPreparationOnDb } from "./alignment-preparation";
import {
  asEvidenceBounds,
  parsePositionalNodes
} from "./figma-positional-evidence";

export const ALIGNMENT_SECTIONS = [
  "design-principle",
  "visual-language",
  "token",
  "layout",
  "component",
  "interaction"
] as const;

export const ALIGNMENT_QUESTION_TITLE_MAX_LENGTH = 48;

function questionTitleWordCount(value: string): number {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
  return Array.from(segmenter.segment(value)).filter(
    (segment) => segment.isWordLike
  ).length;
}

function normalizedQuestionText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function questionTitleIsValid(value: string, question?: string): boolean {
  const words = questionTitleWordCount(value);
  if (words < 2 || words > 5) return false;
  if (/[.!?。！？]\s*$/u.test(value)) return false;
  return !question || normalizedQuestionText(value) !== normalizedQuestionText(question);
}

export type AlignmentSection = (typeof ALIGNMENT_SECTIONS)[number];
export type AnswerSource =
  | "designer-edited"
  | "agent-proposed-designer-accepted";

export type NormalizedMaskRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type EvidenceLink = {
  seedReferenceId: string;
  evidenceSurfaceId: string;
  evidenceVersionId: string;
};

export type EvidenceTarget =
  | (EvidenceLink & {
      kind: "surface";
      resolvedRect: NormalizedMaskRect;
    })
  | (EvidenceLink & {
      kind: "node";
      nodeId: string;
      resolvedRect: NormalizedMaskRect;
    })
  | (EvidenceLink & {
      kind: "region";
      rect: NormalizedMaskRect;
      resolvedRect: NormalizedMaskRect;
    });

export type AlignmentAnchor =
  | { kind: "single"; target: EvidenceTarget }
  | { kind: "focus-target-set"; targets: EvidenceTarget[] };

export type AgentAnnotationRecord = {
  id: string;
  alignment_attempt_id: string | null;
  section: AlignmentSection | null;
  card_kind: "agent-annotation";
  inference: "confirmed" | "reasonable";
  title: string;
  body: string;
  additional_information: string[];
  anchor: AlignmentAnchor;
  created_at: string;
  updated_at: string;
};

export type QuestionCardRecord = {
  id: string;
  alignment_attempt_id: string | null;
  section: AlignmentSection;
  observation: string;
  question: string;
  proposed_answer: string | null;
  final_answer: string | null;
  answer_source: AnswerSource | null;
  status: "unanswered" | "answered";
  anchor: AlignmentAnchor;
  created_at: string;
  updated_at: string;
};

type FailureReason =
  | "design_language_description_required"
  | "invalid_section"
  | "empty_observation"
  | "invalid_question_title"
  | "question_title_too_long"
  | "whole_surface_requires_surface_anchor"
  | "empty_question"
  | "empty_body"
  | "empty_title"
  | "invalid_inference"
  | "invalid_anchor"
  | "invalid_anchor_linkage"
  | "invalid_anchor_target"
  | "invalid_focus_target_set"
  | "section_card_limit"
  | "section_annotation_required"
  | "section_questions_already_started"
  | "empty_final_answer"
  | "not_found"
  | "coverage_incomplete"
  | "alignment_attempt_required"
  | "alignment_command_not_claimed"
  | "stale_alignment_attempt"
  | "alignment_not_answering"
  | "alignment_completed"
  | "db_error";

type Failure = { ok: false; reason: FailureReason };

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isSection(value: unknown): value is AlignmentSection {
  return typeof value === "string" &&
    (ALIGNMENT_SECTIONS as readonly string[]).includes(value);
}

function alignmentIsCompleted(db: DatabaseType): boolean {
  const row = db
    .prepare("SELECT status FROM design_intent_alignment WHERE singleton = 1")
    .get() as { status: string } | undefined;
  return row?.status === "completed";
}

function descriptionExists(db: DatabaseType): boolean {
  const row = db
    .prepare("SELECT design_language_description AS value FROM project_meta WHERE singleton = 1")
    .get() as { value: string } | undefined;
  return typeof row?.value === "string" && row.value.trim().length > 0;
}

function targetsFromAnchor(anchor: unknown):
  | { ok: true; kind: AlignmentAnchor["kind"]; targets: Array<Record<string, unknown>> }
  | Failure {
  if (!anchor || typeof anchor !== "object" || Array.isArray(anchor)) {
    return { ok: false, reason: "invalid_anchor" };
  }
  const raw = anchor as Record<string, unknown>;
  if (raw.kind === "single") {
    if (!raw.target || typeof raw.target !== "object" || Array.isArray(raw.target)) {
      return { ok: false, reason: "invalid_anchor" };
    }
    return { ok: true, kind: "single", targets: [raw.target as Record<string, unknown>] };
  }
  if (raw.kind === "focus-target-set") {
    if (!Array.isArray(raw.targets) || raw.targets.length < 2) {
      return { ok: false, reason: "invalid_focus_target_set" };
    }
    return {
      ok: true,
      kind: "focus-target-set",
      targets: raw.targets as Array<Record<string, unknown>>
    };
  }
  return { ok: false, reason: "invalid_anchor" };
}

function validNormalizedRect(value: unknown): NormalizedMaskRect | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rect = value as Partial<NormalizedMaskRect>;
  if (
    typeof rect.x !== "number" ||
    typeof rect.y !== "number" ||
    typeof rect.width !== "number" ||
    typeof rect.height !== "number" ||
    ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
    rect.x < 0 ||
    rect.y < 0 ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.x + rect.width > 1 ||
    rect.y + rect.height > 1
  ) {
    return null;
  }
  return rect as NormalizedMaskRect;
}

function coversWholeSurface(rect: NormalizedMaskRect): boolean {
  const edgeTolerance = 0.025;
  return (
    rect.x <= edgeTolerance &&
    rect.y <= edgeTolerance &&
    rect.x + rect.width >= 1 - edgeTolerance &&
    rect.y + rect.height >= 1 - edgeTolerance
  );
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function stableNormalized(value: number): number {
  return Number(value.toFixed(12));
}

function resolveAnchorOnDb(
  db: DatabaseType,
  anchor: unknown,
  requireCurrent: boolean
): { ok: true; anchor: AlignmentAnchor } | Failure {
  const parsed = targetsFromAnchor(anchor);
  if (!parsed.ok) return parsed;

  const seen = new Set<string>();
  const resolvedTargets: EvidenceTarget[] = [];
  for (const target of parsed.targets) {
    const seedReferenceId = text(target?.seedReferenceId);
    const evidenceSurfaceId = text(target?.evidenceSurfaceId);
    const evidenceVersionId = text(target?.evidenceVersionId);
    if (!seedReferenceId || !evidenceSurfaceId || !evidenceVersionId) {
      return { ok: false, reason: "invalid_anchor_linkage" };
    }
    const row = db
      .prepare(
        `SELECT s.id AS seed_id, s.current_surface_id, e.id AS surface_id,
                e.seed_reference_id, e.frame_bounds_json, e.positional_nodes_json
         FROM seed_references s
         JOIN figma_evidence_surfaces e ON e.id = ?
         WHERE s.id = ?`
      )
      .get(evidenceSurfaceId, seedReferenceId) as
      | {
          seed_id: string;
          current_surface_id: string | null;
          surface_id: string;
          seed_reference_id: string;
          frame_bounds_json: string | null;
          positional_nodes_json: string | null;
        }
      | undefined;
    if (
      !row ||
      row.seed_reference_id !== seedReferenceId ||
      (requireCurrent && row.current_surface_id !== evidenceSurfaceId) ||
      evidenceVersionId !== evidenceSurfaceId
    ) {
      return { ok: false, reason: "invalid_anchor_linkage" };
    }
    const rawKind = target.kind;
    const kind = rawKind === "surface" || rawKind === "node" || rawKind === "region"
      ? rawKind
      : text(target.nodeId)
        ? "node"
        : null;
    if (parsed.kind === "focus-target-set" && kind === "surface") {
      return { ok: false, reason: "invalid_focus_target_set" };
    }
    let resolved: EvidenceTarget;
    if (kind === "surface") {
      resolved = {
        kind,
        seedReferenceId,
        evidenceSurfaceId,
        evidenceVersionId,
        resolvedRect: { x: 0, y: 0, width: 1, height: 1 }
      };
    } else if (kind === "region") {
      const rect = validNormalizedRect(target.rect);
      if (!rect) return { ok: false, reason: "invalid_anchor_target" };
      if (parsed.kind === "single" && coversWholeSurface(rect)) {
        return { ok: false, reason: "whole_surface_requires_surface_anchor" };
      }
      resolved = {
        kind,
        seedReferenceId,
        evidenceSurfaceId,
        evidenceVersionId,
        rect,
        resolvedRect: rect
      };
    } else if (kind === "node") {
      const nodeId = text(target.nodeId);
      const frameBounds = row.frame_bounds_json
        ? asEvidenceBounds(JSON.parse(row.frame_bounds_json))
        : null;
      const node = nodeId
        ? parsePositionalNodes(row.positional_nodes_json).find(
            (candidate) => candidate.id === nodeId && candidate.bounds
          )
        : undefined;
      if (!nodeId || !frameBounds || !node?.bounds) {
        return { ok: false, reason: "invalid_anchor_target" };
      }
      const sourceBounds = node.clipRenderBounds ?? node.bounds;
      const x1 = clamp((sourceBounds.x - frameBounds.x) / frameBounds.width);
      const y1 = clamp((sourceBounds.y - frameBounds.y) / frameBounds.height);
      const x2 = clamp((sourceBounds.x + sourceBounds.width - frameBounds.x) / frameBounds.width);
      const y2 = clamp((sourceBounds.y + sourceBounds.height - frameBounds.y) / frameBounds.height);
      const resolvedRect = validNormalizedRect({
        x: stableNormalized(x1),
        y: stableNormalized(y1),
        width: stableNormalized(x2 - x1),
        height: stableNormalized(y2 - y1)
      });
      if (!resolvedRect) return { ok: false, reason: "invalid_anchor_target" };
      resolved = {
        kind,
        seedReferenceId,
        evidenceSurfaceId,
        evidenceVersionId,
        nodeId,
        resolvedRect
      };
    } else {
      return { ok: false, reason: "invalid_anchor_target" };
    }
    const identity = `${seedReferenceId}:${evidenceVersionId}:${resolved.kind}:${
      resolved.kind === "node"
        ? resolved.nodeId
        : JSON.stringify(resolved.resolvedRect)
    }`;
    if (seen.has(identity)) return { ok: false, reason: "invalid_focus_target_set" };
    seen.add(identity);
    resolvedTargets.push(resolved);
  }
  return {
    ok: true,
    anchor: parsed.kind === "single"
      ? { kind: "single", target: resolvedTargets[0] }
      : { kind: "focus-target-set", targets: resolvedTargets }
  };
}

function mapQuestion(db: DatabaseType, row: Record<string, unknown>): QuestionCardRecord {
  const finalAnswer = typeof row.final_answer === "string" ? row.final_answer : null;
  const resolved = resolveAnchorOnDb(db, JSON.parse(String(row.anchor_json)), false);
  if (!resolved.ok) throw new Error(`invalid persisted alignment anchor: ${resolved.reason}`);
  return {
    id: String(row.id),
    alignment_attempt_id:
      typeof row.alignment_attempt_id === "string"
        ? row.alignment_attempt_id
        : null,
    section: String(row.section) as AlignmentSection,
    observation: String(row.observation),
    question: String(row.question),
    proposed_answer: typeof row.proposed_answer === "string" ? row.proposed_answer : null,
    final_answer: finalAnswer,
    answer_source: typeof row.answer_source === "string" ? row.answer_source as AnswerSource : null,
    status: finalAnswer ? "answered" : "unanswered",
    anchor: resolved.anchor,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}

function listQuestionsOnDb(
  db: DatabaseType,
  alignmentAttemptId: string | null
): QuestionCardRecord[] {
  if (!alignmentAttemptId) return [];
  return (
    db.prepare(
      `SELECT * FROM alignment_question_cards
       WHERE alignment_attempt_id = ?
       ORDER BY created_at ASC, id ASC`
    ).all(alignmentAttemptId) as Record<string, unknown>[]
  ).map((row) => mapQuestion(db, row));
}

function coverageFor(cards: QuestionCardRecord[]) {
  const sections = ALIGNMENT_SECTIONS.map((section) => {
    const sectionCards = cards.filter((card) => card.section === section);
    const covered = sectionCards.filter(
      (card) => text(card.final_answer) !== null
    ).length;
    return {
      section,
      question_count: sectionCards.length,
      covered_count: covered,
      complete:
        sectionCards.length >= 2 &&
        sectionCards.length <= 5 &&
        covered === sectionCards.length
    };
  });
  return {
    sections,
    total_questions: cards.length,
    can_complete: sections.every((section) => section.complete)
  };
}

export function createQuestionCard(
  projectPath: string,
  input: {
    alignmentAttemptId?: unknown;
    idempotencyKey?: unknown;
    section?: unknown;
    observation?: unknown;
    question?: unknown;
    proposedAnswer?: unknown;
    anchor?: unknown;
  }
):
  | {
      ok: true;
      reused: boolean;
      record: QuestionCardRecord;
      event_id: string | null;
    }
  | Failure {
  if (!isSection(input?.section)) return { ok: false, reason: "invalid_section" };
  const section = input.section;
  const observation = text(input.observation);
  if (!observation) return { ok: false, reason: "empty_observation" };
  if (Array.from(observation).length > ALIGNMENT_QUESTION_TITLE_MAX_LENGTH) {
    return { ok: false, reason: "question_title_too_long" };
  }
  const question = text(input.question);
  if (!question) return { ok: false, reason: "empty_question" };
  if (!questionTitleIsValid(observation, question)) {
    return { ok: false, reason: "invalid_question_title" };
  }
  const alignmentAttemptId = text(input.alignmentAttemptId);
  const idempotencyKey = text(input.idempotencyKey);
  const proposedAnswer = input.proposedAnswer === undefined ? null : text(input.proposedAnswer);
  const id = randomUUID();
  const now = new Date().toISOString();
  try {
    const result = withProjectTransaction(projectPath, (db) => {
      if (!descriptionExists(db)) {
        return { ok: false, reason: "design_language_description_required" } as Failure;
      }
      if (!alignmentAttemptId || !idempotencyKey) {
        return { ok: false, reason: "alignment_attempt_required" } as Failure;
      }
      if (alignmentIsCompleted(db)) {
        return { ok: false, reason: "alignment_completed" } as Failure;
      }
      const preparation = getAlignmentPreparationOnDb(db);
      if (
        preparation.current_attempt?.id !== alignmentAttemptId ||
        !preparation.input_snapshot
      ) {
        return { ok: false, reason: "stale_alignment_attempt" } as Failure;
      }
      const duplicate = db
        .prepare(
          `SELECT * FROM alignment_question_cards
           WHERE alignment_attempt_id = ? AND agent_idempotency_key = ?`
        )
        .get(alignmentAttemptId, idempotencyKey) as
        | Record<string, unknown>
        | undefined;
      if (duplicate) {
        return {
          ok: true as const,
          reused: true,
          record: mapQuestion(db, duplicate),
          event_id: null
        };
      }
      if (
        preparation.current_attempt.status !== "preparing" ||
        preparation.workflow.stage !== "alignment-preparing"
      ) {
        return { ok: false, reason: "stale_alignment_attempt" } as Failure;
      }
      const command = preparation.commands.find(
        (candidate) =>
          candidate.command_type === "prepare_design_intent_alignment"
      );
      if (command?.status !== "claimed") {
        return { ok: false, reason: "alignment_command_not_claimed" } as Failure;
      }
      const sectionAnnotation = db
        .prepare(
          `SELECT 1 FROM agent_alignment_annotations
           WHERE alignment_attempt_id = ? AND section = ?
           LIMIT 1`
        )
        .get(alignmentAttemptId, section);
      if (!sectionAnnotation) {
        return {
          ok: false,
          reason: "section_annotation_required"
        } as Failure;
      }
      const anchor = resolveAnchorOnDb(db, input.anchor, false);
      if (!anchor.ok) return anchor;
      const snapshotEvidence = new Set(
        preparation.input_snapshot.data.seed_references.map(
          (seed) => `${seed.id}:${seed.evidence_version.id}`
        )
      );
      const anchorTargets =
        anchor.anchor.kind === "single"
          ? [anchor.anchor.target]
          : anchor.anchor.targets;
      if (
        anchorTargets.some(
          (target) =>
            !snapshotEvidence.has(
              `${target.seedReferenceId}:${target.evidenceVersionId}`
            )
        )
      ) {
        return { ok: false, reason: "invalid_anchor_linkage" } as Failure;
      }
      const count = db
        .prepare(
          `SELECT COUNT(*) AS count FROM alignment_question_cards
           WHERE section = ? AND alignment_attempt_id = ?`
        )
        .get(section, alignmentAttemptId) as { count: number };
      if (count.count >= 5) return { ok: false, reason: "section_card_limit" } as Failure;
      db.prepare(
        `INSERT INTO alignment_question_cards
         (id, section, observation, question, proposed_answer, final_answer,
          answer_source, anchor_json, created_at, updated_at,
          alignment_attempt_id, agent_idempotency_key)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)`
      ).run(id, section, observation, question, proposedAnswer, JSON.stringify(anchor.anchor), now, now, alignmentAttemptId, idempotencyKey);
      const event = logEventOnDb(db, "question_card_created", {
        question_card_id: id,
        alignment_attempt_id: alignmentAttemptId,
        section
      });
      const row = db.prepare("SELECT * FROM alignment_question_cards WHERE id = ?").get(id) as Record<string, unknown>;
      return { ok: true as const, reused: false, record: mapQuestion(db, row), event_id: event.event_id };
    });
    if (result.ok && !result.reused) {
      emitRecordEvent({
        kind: "alignment",
        action: "created",
        id: result.record.id,
        projectPath: path.resolve(projectPath)
      });
    }
    return result;
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

function mapAnnotation(db: DatabaseType, row: Record<string, unknown>): AgentAnnotationRecord {
  const resolved = resolveAnchorOnDb(db, JSON.parse(String(row.anchor_json)), false);
  if (!resolved.ok) throw new Error(`invalid persisted alignment anchor: ${resolved.reason}`);
  return {
    id: String(row.id),
    alignment_attempt_id:
      typeof row.alignment_attempt_id === "string"
        ? row.alignment_attempt_id
        : null,
    section: isSection(row.section) ? row.section : null,
    card_kind: "agent-annotation",
    inference: String(row.inference) as "confirmed" | "reasonable",
    title: String(row.title),
    body: String(row.body),
    additional_information: JSON.parse(String(row.additional_information_json)) as string[],
    anchor: resolved.anchor,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}

export function createAgentAnnotation(
  projectPath: string,
  input: {
    alignmentAttemptId?: unknown;
    idempotencyKey?: unknown;
    section?: unknown;
    inference?: unknown;
    title?: unknown;
    body?: unknown;
    anchor?: unknown;
  }
):
  | {
      ok: true;
      reused: boolean;
      record: AgentAnnotationRecord;
      event_id: string | null;
    }
  | Failure {
  if (input?.inference !== "confirmed" && input?.inference !== "reasonable") {
    return { ok: false, reason: "invalid_inference" };
  }
  const inference = input.inference;
  if (!isSection(input.section)) {
    return { ok: false, reason: "invalid_section" };
  }
  const section = input.section;
  const title = text(input.title);
  if (!title) return { ok: false, reason: "empty_title" };
  const body = text(input.body);
  if (!body) return { ok: false, reason: "empty_body" };
  const alignmentAttemptId = text(input.alignmentAttemptId);
  const idempotencyKey = text(input.idempotencyKey);
  const id = randomUUID();
  const now = new Date().toISOString();
  try {
    const result = withProjectTransaction(projectPath, (db) => {
      if (!descriptionExists(db)) {
        return { ok: false, reason: "design_language_description_required" } as Failure;
      }
      if (!alignmentAttemptId || !idempotencyKey) {
        return { ok: false, reason: "alignment_attempt_required" } as Failure;
      }
      if (alignmentIsCompleted(db)) {
        return { ok: false, reason: "alignment_completed" } as Failure;
      }
      const preparation = getAlignmentPreparationOnDb(db);
      if (
        preparation.current_attempt?.id !== alignmentAttemptId ||
        !preparation.input_snapshot
      ) {
        return { ok: false, reason: "stale_alignment_attempt" } as Failure;
      }
      const duplicate = db.prepare(
        `SELECT * FROM agent_alignment_annotations
         WHERE alignment_attempt_id = ? AND agent_idempotency_key = ?`
      ).get(alignmentAttemptId, idempotencyKey) as
        | Record<string, unknown>
        | undefined;
      if (duplicate) {
        return {
          ok: true as const,
          reused: true,
          record: mapAnnotation(db, duplicate),
          event_id: null
        };
      }
      if (
        preparation.current_attempt.status !== "preparing" ||
        preparation.workflow.stage !== "alignment-preparing"
      ) {
        return { ok: false, reason: "stale_alignment_attempt" } as Failure;
      }
      const command = preparation.commands.find(
        (candidate) =>
          candidate.command_type === "prepare_design_intent_alignment"
      );
      if (command?.status !== "claimed") {
        return { ok: false, reason: "alignment_command_not_claimed" } as Failure;
      }
      const sectionQuestion = db
        .prepare(
          `SELECT 1 FROM alignment_question_cards
           WHERE alignment_attempt_id = ? AND section = ?
           LIMIT 1`
        )
        .get(alignmentAttemptId, section);
      if (sectionQuestion) {
        return {
          ok: false,
          reason: "section_questions_already_started"
        } as Failure;
      }
      const anchor = resolveAnchorOnDb(db, input.anchor, false);
      if (!anchor.ok) return anchor;
      const snapshotEvidence = new Set(
        preparation.input_snapshot.data.seed_references.map(
          (seed) => `${seed.id}:${seed.evidence_version.id}`
        )
      );
      const anchorTargets =
        anchor.anchor.kind === "single"
          ? [anchor.anchor.target]
          : anchor.anchor.targets;
      if (
        anchorTargets.some(
          (target) =>
            !snapshotEvidence.has(
              `${target.seedReferenceId}:${target.evidenceVersionId}`
            )
        )
      ) {
        return { ok: false, reason: "invalid_anchor_linkage" } as Failure;
      }
      db.prepare(
        `INSERT INTO agent_alignment_annotations
         (id, inference, title, body, additional_information_json, anchor_json,
          created_at, updated_at, alignment_attempt_id, agent_idempotency_key,
          section)
         VALUES (?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        inference,
        title,
        body,
        JSON.stringify(anchor.anchor),
        now,
        now,
        alignmentAttemptId,
        idempotencyKey,
        section
      );
      const event = logEventOnDb(db, "annotation_created", {
        annotation_id: id,
        annotation_kind: "agent-annotation",
        alignment_attempt_id: alignmentAttemptId,
        inference,
        section
      });
      const row = db.prepare("SELECT * FROM agent_alignment_annotations WHERE id = ?").get(id) as Record<string, unknown>;
      return {
        ok: true as const,
        reused: false,
        record: mapAnnotation(db, row),
        event_id: event.event_id
      };
    });
    if (result.ok && !result.reused) {
      emitRecordEvent({
        kind: "alignment",
        action: "created",
        id,
        projectPath: path.resolve(projectPath)
      });
    }
    return result;
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

export function appendAgentAnnotationInformation(
  projectPath: string,
  annotationId: string,
  information: unknown
): { ok: true; record: AgentAnnotationRecord; event_id: string } | Failure {
  const normalized = text(information);
  if (!normalized) return { ok: false, reason: "empty_body" };
  try {
    const result = withProjectTransaction(projectPath, (db) => {
      const row = db.prepare("SELECT * FROM agent_alignment_annotations WHERE id = ?").get(annotationId) as Record<string, unknown> | undefined;
      if (!row) return { ok: false, reason: "not_found" } as Failure;
      const informationList = JSON.parse(String(row.additional_information_json)) as string[];
      informationList.push(normalized);
      const now = new Date().toISOString();
      db.prepare(
        "UPDATE agent_alignment_annotations SET additional_information_json = ?, updated_at = ? WHERE id = ?"
      ).run(JSON.stringify(informationList), now, annotationId);
      const event = logEventOnDb(db, "agent_annotation_updated", { annotation_id: annotationId });
      const updated = db.prepare("SELECT * FROM agent_alignment_annotations WHERE id = ?").get(annotationId) as Record<string, unknown>;
      return { ok: true as const, record: mapAnnotation(db, updated), event_id: event.event_id };
    });
    if (result.ok) emitRecordEvent({ kind: "alignment", action: "updated", id: annotationId, projectPath: path.resolve(projectPath) });
    return result;
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

export function recordDesignerAnswer(
  projectPath: string,
  input: { questionCardId?: unknown; finalAnswer?: unknown }
): { ok: true; record: QuestionCardRecord; event_id: string } | Failure {
  const questionCardId = text(input?.questionCardId);
  if (!questionCardId) return { ok: false, reason: "not_found" };
  const finalAnswer = text(input.finalAnswer);
  if (!finalAnswer) return { ok: false, reason: "empty_final_answer" };
  try {
    const result = withProjectTransaction(projectPath, (db) => {
      if (alignmentIsCompleted(db)) return { ok: false, reason: "alignment_completed" } as Failure;
      const preparation = getAlignmentPreparationOnDb(db);
      if (!preparation.current_attempt) {
        return { ok: false, reason: "stale_alignment_attempt" } as Failure;
      }
      if (preparation.workflow.stage !== "alignment-answering") {
        return { ok: false, reason: "alignment_not_answering" } as Failure;
      }
      const existing = db.prepare(
        "SELECT alignment_attempt_id, proposed_answer FROM alignment_question_cards WHERE id = ?"
      ).get(questionCardId) as {
        alignment_attempt_id: string | null;
        proposed_answer: string | null;
      } | undefined;
      if (!existing) return { ok: false, reason: "not_found" } as Failure;
      if (existing.alignment_attempt_id !== preparation.current_attempt.id) {
        return { ok: false, reason: "stale_alignment_attempt" } as Failure;
      }
      const answerSource: AnswerSource =
        text(existing.proposed_answer) === finalAnswer
          ? "agent-proposed-designer-accepted"
          : "designer-edited";
      const now = new Date().toISOString();
      db.prepare(
        `UPDATE alignment_question_cards
         SET final_answer = ?, answer_source = ?, updated_at = ?
         WHERE id = ?`
      ).run(finalAnswer, answerSource, now, questionCardId);
      const event = logEventOnDb(db, "designer_answer_submitted", {
        question_card_id: questionCardId,
        alignment_attempt_id: preparation.current_attempt.id,
        answer_source: answerSource
      });
      const row = db.prepare("SELECT * FROM alignment_question_cards WHERE id = ?").get(questionCardId) as Record<string, unknown>;
      return { ok: true as const, record: mapQuestion(db, row), event_id: event.event_id };
    });
    if (result.ok) emitRecordEvent({ kind: "alignment", action: "updated", id: questionCardId, projectPath: path.resolve(projectPath) });
    return result;
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

export function updateQuestionCardTitle(
  projectPath: string,
  input: { questionCardId?: unknown; title?: unknown }
): { ok: true; record: QuestionCardRecord; event_id: string } | Failure {
  const questionCardId = text(input?.questionCardId);
  if (!questionCardId) return { ok: false, reason: "not_found" };
  const title = text(input.title);
  if (!title) return { ok: false, reason: "empty_observation" };
  if (Array.from(title).length > ALIGNMENT_QUESTION_TITLE_MAX_LENGTH) {
    return { ok: false, reason: "question_title_too_long" };
  }
  if (!questionTitleIsValid(title)) {
    return { ok: false, reason: "invalid_question_title" };
  }
  try {
    const result = withProjectTransaction(projectPath, (db) => {
      if (alignmentIsCompleted(db)) {
        return { ok: false, reason: "alignment_completed" } as Failure;
      }
      const preparation = getAlignmentPreparationOnDb(db);
      if (
        !preparation.current_attempt ||
        preparation.current_attempt.status !== "preparing" ||
        preparation.workflow.stage !== "alignment-preparing"
      ) {
        return { ok: false, reason: "stale_alignment_attempt" } as Failure;
      }
      const existing = db
        .prepare(
          "SELECT observation, question, alignment_attempt_id FROM alignment_question_cards WHERE id = ?"
        )
        .get(questionCardId) as
        | { observation: string; question: string; alignment_attempt_id: string | null }
        | undefined;
      if (!existing) return { ok: false, reason: "not_found" } as Failure;
      if (existing.alignment_attempt_id !== preparation.current_attempt.id) {
        return { ok: false, reason: "stale_alignment_attempt" } as Failure;
      }
      if (!questionTitleIsValid(title, existing.question)) {
        return { ok: false, reason: "invalid_question_title" } as Failure;
      }
      const now = new Date().toISOString();
      db.prepare(
        "UPDATE alignment_question_cards SET observation = ?, updated_at = ? WHERE id = ?"
      ).run(title, now, questionCardId);
      const event = logEventOnDb(db, "question_card_title_updated", {
        question_card_id: questionCardId,
        alignment_attempt_id: preparation.current_attempt.id,
        previous_title: existing.observation,
        new_title: title
      });
      const row = db
        .prepare("SELECT * FROM alignment_question_cards WHERE id = ?")
        .get(questionCardId) as Record<string, unknown>;
      return {
        ok: true as const,
        record: mapQuestion(db, row),
        event_id: event.event_id
      };
    });
    if (result.ok) {
      emitRecordEvent({
        kind: "alignment",
        action: "updated",
        id: questionCardId,
        projectPath: path.resolve(projectPath)
      });
    }
    return result;
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

export function updateQuestionCardAnchor(
  projectPath: string,
  input: { questionCardId?: unknown; anchor?: unknown }
): { ok: true; record: QuestionCardRecord; event_id: string } | Failure {
  const questionCardId = text(input?.questionCardId);
  if (!questionCardId) return { ok: false, reason: "not_found" };
  try {
    const result = withProjectTransaction(projectPath, (db) => {
      if (alignmentIsCompleted(db)) {
        return { ok: false, reason: "alignment_completed" } as Failure;
      }
      const preparation = getAlignmentPreparationOnDb(db);
      if (
        !preparation.current_attempt ||
        !preparation.input_snapshot ||
        preparation.current_attempt.status !== "preparing" ||
        preparation.workflow.stage !== "alignment-preparing"
      ) {
        return { ok: false, reason: "stale_alignment_attempt" } as Failure;
      }
      const existing = db
        .prepare(
          "SELECT anchor_json, alignment_attempt_id FROM alignment_question_cards WHERE id = ?"
        )
        .get(questionCardId) as
        | { anchor_json: string; alignment_attempt_id: string | null }
        | undefined;
      if (!existing) return { ok: false, reason: "not_found" } as Failure;
      if (existing.alignment_attempt_id !== preparation.current_attempt.id) {
        return { ok: false, reason: "stale_alignment_attempt" } as Failure;
      }
      const anchor = resolveAnchorOnDb(db, input.anchor, false);
      if (!anchor.ok) return anchor;
      const snapshotEvidence = new Set(
        preparation.input_snapshot.data.seed_references.map(
          (seed) => `${seed.id}:${seed.evidence_version.id}`
        )
      );
      const anchorTargets =
        anchor.anchor.kind === "single"
          ? [anchor.anchor.target]
          : anchor.anchor.targets;
      if (
        anchorTargets.some(
          (target) =>
            !snapshotEvidence.has(
              `${target.seedReferenceId}:${target.evidenceVersionId}`
            )
        )
      ) {
        return { ok: false, reason: "invalid_anchor_linkage" } as Failure;
      }
      const now = new Date().toISOString();
      db.prepare(
        "UPDATE alignment_question_cards SET anchor_json = ?, updated_at = ? WHERE id = ?"
      ).run(JSON.stringify(anchor.anchor), now, questionCardId);
      const event = logEventOnDb(db, "question_card_anchor_updated", {
        question_card_id: questionCardId,
        alignment_attempt_id: preparation.current_attempt.id,
        previous_anchor: JSON.parse(existing.anchor_json),
        new_anchor: anchor.anchor
      });
      const row = db
        .prepare("SELECT * FROM alignment_question_cards WHERE id = ?")
        .get(questionCardId) as Record<string, unknown>;
      return {
        ok: true as const,
        record: mapQuestion(db, row),
        event_id: event.event_id
      };
    });
    if (result.ok) {
      emitRecordEvent({
        kind: "alignment",
        action: "updated",
        id: questionCardId,
        projectPath: path.resolve(projectPath)
      });
    }
    return result;
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

export function getDesignIntentAlignment(projectPath: string) {
  const db = openProjectDb(projectPath);
  try {
    const preparation = getAlignmentPreparationOnDb(db);
    const questionCards = listQuestionsOnDb(
      db,
      preparation.current_attempt?.id ?? null
    );
    const annotationRows = preparation.current_attempt
      ? db
          .prepare(
            `SELECT * FROM agent_alignment_annotations
             WHERE alignment_attempt_id = ?
             ORDER BY created_at ASC, id ASC`
          )
          .all(preparation.current_attempt.id)
      : db
          .prepare(
            `SELECT * FROM agent_alignment_annotations
             WHERE alignment_attempt_id IS NULL
             ORDER BY created_at ASC, id ASC`
          )
          .all();
    const annotations = (annotationRows as Record<string, unknown>[]).map(
      (row) => mapAnnotation(db, row)
    );
    const state = db.prepare("SELECT status, completed_at FROM design_intent_alignment WHERE singleton = 1").get() as { status: "draft" | "completed"; completed_at: string | null };
    const coverage = coverageFor(questionCards);
    return {
      sections: ALIGNMENT_SECTIONS,
      alignment: state,
      preparation,
      annotations,
      question_cards: questionCards,
      coverage: {
        ...coverage,
        can_complete:
          state.status !== "completed" &&
          preparation.workflow.stage === "alignment-answering" &&
          coverage.can_complete
      }
    };
  } finally {
    closeProjectDb(db);
  }
}

export type DesignIntentAlignmentSnapshot = ReturnType<
  typeof getDesignIntentAlignment
>;

export function completeDesignIntentAlignment(
  projectPath: string
):
  | {
      ok: true;
      reused: false;
      alignment: { status: "completed"; completed_at: string };
      question_cards: QuestionCardRecord[];
      workflow: ReturnType<typeof getAlignmentPreparationOnDb>["workflow"];
      attempt: NonNullable<
        ReturnType<typeof getAlignmentPreparationOnDb>["current_attempt"]
      >;
      command: ReturnType<typeof getAlignmentPreparationOnDb>["commands"][number];
      event_id: string;
    }
  | Failure {
  try {
    const result = withProjectTransaction(projectPath, (db) => {
      if (!descriptionExists(db)) return { ok: false, reason: "design_language_description_required" } as Failure;
      if (alignmentIsCompleted(db)) return { ok: false, reason: "alignment_completed" } as Failure;
      const preparation = getAlignmentPreparationOnDb(db);
      if (
        !preparation.current_attempt ||
        preparation.current_attempt.status !== "answering" ||
        preparation.workflow.stage !== "alignment-answering"
      ) {
        return { ok: false, reason: "alignment_not_answering" } as Failure;
      }
      const attempt = preparation.current_attempt;
      const cards = listQuestionsOnDb(
        db,
        attempt.id
      );
      if (!coverageFor(cards).can_complete) return { ok: false, reason: "coverage_incomplete" } as Failure;
      const now = new Date().toISOString();
      db.prepare(
        "UPDATE design_intent_alignment SET status = 'completed', completed_at = ? WHERE singleton = 1"
      ).run(now);
      db.prepare(
        `UPDATE alignment_attempts
         SET status = 'completed', completed_at = ?, updated_at = ?
         WHERE id = ? AND status = 'answering'`
      ).run(now, now, attempt.id);
      db.prepare(
        `UPDATE project_workflow
         SET stage = 'initial-design-system-preparing', updated_at = ?
         WHERE singleton = 1`
      ).run(now);

      const completedCards = listQuestionsOnDb(db, attempt.id);
      const commandId = randomUUID();
      const commandPayload = {
        alignment_attempt_id: attempt.id,
        input_snapshot_id: attempt.input_snapshot_id,
        alignment_completed_at: now,
        question_cards: completedCards
      };
      db.prepare(
        `INSERT INTO agent_commands
         (id, command_type, status, alignment_attempt_id, payload_json,
          idempotency_key, created_at, updated_at, claimed_at, completed_at,
          cancelled_at)
         VALUES (?, 'prepare_initial_design_system', 'pending', ?, ?, ?, ?, ?,
                 NULL, NULL, NULL)`
      ).run(
        commandId,
        attempt.id,
        JSON.stringify(commandPayload),
        `prepare-initial-design-system:${attempt.id}`,
        now,
        now
      );
      const event = logEventOnDb(db, "design_intent_alignment_completed", {
        alignment_attempt_id: attempt.id,
        input_snapshot_id: attempt.input_snapshot_id,
        agent_command_id: commandId,
        accepted_proposal_count: cards.filter(
          (card) =>
            card.answer_source === "agent-proposed-designer-accepted"
        ).length,
        question_count: cards.length
      });
      const completed = getAlignmentPreparationOnDb(db);
      return {
        ok: true as const,
        reused: false as const,
        alignment: { status: "completed" as const, completed_at: now },
        question_cards: completedCards,
        workflow: completed.workflow,
        attempt: completed.current_attempt!,
        command: completed.commands.find(
          (candidate) => candidate.id === commandId
        )!,
        event_id: event.event_id
      };
    });
    if (result.ok) emitRecordEvent({ kind: "alignment", action: "updated", id: "design-intent-alignment", projectPath: path.resolve(projectPath) });
    return result;
  } catch {
    return { ok: false, reason: "db_error" };
  }
}
