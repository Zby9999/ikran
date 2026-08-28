import { randomUUID } from "node:crypto";
import path from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";
import { closeProjectDb, openProjectDb, withProjectTransaction } from "./db";
import { publishAgentCommandOnDb } from "./agent-command";
import { logEventOnDb } from "./events";
import { emitRecordEvent } from "./record-bus";
import { getAlignmentPreparationOnDb } from "./alignment-preparation";
import { listRegionAnnotationsOnDb } from "./region-annotation";
import {
  asEvidenceBounds,
  parsePositionalNodes
} from "./figma-positional-evidence";
import {
  DRAFT_FOUNDATION_OWNERS,
  DRAFT_FOUNDATION_TOKEN_DOMAINS,
  NON_FOUNDATION_TOKEN_DOMAIN_ROUTES
} from "./draft-foundation-ownership";
import {
  alignmentSemanticSourceDigest,
  freezeAlignmentSemanticRevisionOnDb,
  recordAlignmentSemanticChangeOnDb
} from "./alignment-incremental-planning";

export const ALIGNMENT_SECTIONS = [
  "design-concept",
  "visual-language",
  "token",
  "layout",
  "component",
  "interaction"
] as const;

export const ALIGNMENT_QUESTION_TITLE_MAX_LENGTH = 48;

/** Question title word bounds for non-Han titles — enforced by
 * questionTitleIsValid and published via ALIGNMENT_SECTION_CONTRACT.question_title. */
export const ALIGNMENT_QUESTION_TITLE_MIN_WORDS = 2;
export const ALIGNMENT_QUESTION_TITLE_MAX_WORDS = 5;

/** Question title character bounds for titles that contain Han script.
 * Counts letters and numbers, not spaces or punctuation. */
export const ALIGNMENT_QUESTION_TITLE_MIN_HAN_CHARACTERS = 2;
export const ALIGNMENT_QUESTION_TITLE_MAX_HAN_CHARACTERS = 12;

/** Per-section Question card bounds — enforced at coverage checks
 * (finalize + read surface) and published via ALIGNMENT_SECTION_CONTRACT. */
export const ALIGNMENT_SECTION_QUESTION_MIN = 2;
export const ALIGNMENT_SECTION_QUESTION_MAX = 5;

/**
 * Alignment section contract (Issue 18): the on-demand flow contract returned
 * by claim_alignment_preparation. Normative content lives here next to the
 * validators that enforce it — MCP instructions only point at this payload,
 * never restate it.
 */
export const ALIGNMENT_SECTION_CONTRACT = {
  sections: ALIGNMENT_SECTIONS,
  ordering:
    "Prepare the six sections in order. Within EACH section, create at least one gray Agent Annotation first, then its colored Question cards, before moving to the next section. Runtime rejects a Question until its same-section Annotation exists and rejects finalize unless all six sections contain both card kinds.",
  per_section: {
    agent_annotations_min: 1,
    question_cards_min: ALIGNMENT_SECTION_QUESTION_MIN,
    question_cards_max: ALIGNMENT_SECTION_QUESTION_MAX,
    answer_options_min_per_question: 2,
    answer_options_max_per_question: null,
    answer_options:
      "Prepare at least two concise, meaningful, mutually distinguishable choices for every Question. Add more whenever they improve the decision; Runtime imposes no fixed maximum. Do not add an Other choice because Workbench owns custom-answer entry."
  },
  token_foundations: {
    owners: DRAFT_FOUNDATION_OWNERS,
    token_domains: DRAFT_FOUNDATION_TOKEN_DOMAINS,
    reroute: NON_FOUNDATION_TOKEN_DOMAIN_ROUTES,
    guidance:
      "Treat Token as an Alignment lens only. Resolve its decisions into Color, Typography, and Material independently; route motion to Interaction and breakpoints to Layout. Component-local decisions belong to Component. Never use an ambiguous Token bucket or the other domain as a Draft foundation owner."
  },
  question_title: {
    max_characters: ALIGNMENT_QUESTION_TITLE_MAX_LENGTH,
    min_words: ALIGNMENT_QUESTION_TITLE_MIN_WORDS,
    max_words: ALIGNMENT_QUESTION_TITLE_MAX_WORDS,
    min_han_characters: ALIGNMENT_QUESTION_TITLE_MIN_HAN_CHARACTERS,
    max_han_characters: ALIGNMENT_QUESTION_TITLE_MAX_HAN_CHARACTERS,
    style:
      "The observation field is the card title: a concise noun phrase, never a sentence or a repeat of the question. English titles are 2–5 words (e.g. Alternating split rows). Titles that contain Han characters are 2–12 letters/numbers (e.g. 交替分栏).",
    examples: {
      en: "Alternating split rows",
      zh: "交替分栏"
    }
  },
  output_language:
    "Write Question titles, questions, answer choices, and Agent Annotation titles and bodies in the language of the designer's source text. If the designer writes Chinese in chat, Design Language Description, Reference Notes, or Designer Annotations, write Chinese. Do not follow Figma canvas copy or this contract's English. Proper nouns and node labels may stay in their original script.",
  evidence_target_modes: {
    "node/region":
      "One specific element or component — prefer the exact positional node when available; use a free region only when no exact node represents the target. Rendered with an Annotation and horizontal connector.",
    "focus-target-set":
      "Repeated/shared elements such as color or typography across components or Frames. Rendered with Focus Mode on card hover or click, without Annotation, connector, or camera movement.",
    surface:
      "Whole-Frame statements or questions. Rendered as only its card beside the Frame, without target chrome or Focus Mode. Never approximate a whole Frame or an available node with a guessed region."
  },
  designer_annotations:
    "designer_annotations are the designer's own section-bound intent input and part of this Alignment: read them before writing answers or summaries for a section, treat them as designer direction, and never contradict them, restate them as your own, or count them as Agent cards or coverage.",
  answering:
    "Agent answer choices are preparation input, never answers or coverage. The designer must explicitly submit either one stable option id or custom text for every Question card.",
  judgment: [
    "State a meaningful confirmed observation or reasonable assumption openly in the Agent Annotation; do not hide assumptions inside questions.",
    "Do not turn genuine uncertainty into an asserted annotation.",
    "Never reuse one Annotation across sections."
  ],
  scope_note: "Content style is not a gate section."
} as const;

function questionTitleWordCount(value: string): number {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
  return Array.from(segmenter.segment(value)).filter(
    (segment) => segment.isWordLike
  ).length;
}

function titleContainsHan(value: string): boolean {
  return /\p{Script=Han}/u.test(value);
}

function questionTitleCharacterCount(value: string): number {
  return Array.from(value.normalize("NFKC")).filter((character) =>
    /\p{Letter}|\p{Number}/u.test(character)
  ).length;
}

function normalizedQuestionText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function questionTitleIsValid(value: string, question?: string): boolean {
  if (titleContainsHan(value)) {
    const characters = questionTitleCharacterCount(value);
    if (
      characters < ALIGNMENT_QUESTION_TITLE_MIN_HAN_CHARACTERS ||
      characters > ALIGNMENT_QUESTION_TITLE_MAX_HAN_CHARACTERS
    )
      return false;
  } else {
    const words = questionTitleWordCount(value);
    if (
      words < ALIGNMENT_QUESTION_TITLE_MIN_WORDS ||
      words > ALIGNMENT_QUESTION_TITLE_MAX_WORDS
    )
      return false;
  }
  if (/[.!?。！？]\s*$/u.test(value)) return false;
  return !question || normalizedQuestionText(value) !== normalizedQuestionText(question);
}

export type AlignmentSection = (typeof ALIGNMENT_SECTIONS)[number];
export type AnswerSource =
  | "designer-edited"
  | "agent-proposed-designer-accepted";

export type AnswerOptionRecord = {
  id: string;
  text: string;
};

export type DesignerAnswerIntent =
  | { kind: "option"; optionId: string }
  | { kind: "custom"; text: string };

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
  answer_options: AnswerOptionRecord[] | null;
  final_answer: string | null;
  answer_source: AnswerSource | null;
  selected_option_id: string | null;
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
  | "invalid_answer_options"
  | "invalid_answer_payload"
  | "invalid_answer_option"
  | "legacy_final_answer_not_allowed"
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

function normalizeAnswerOptionTexts(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    const option = text(candidate);
    if (!option || seen.has(option)) return null;
    seen.add(option);
    normalized.push(option);
  }
  return normalized;
}

function answerOptionsForCard(
  cardId: string,
  optionTexts: readonly string[]
): AnswerOptionRecord[] {
  return optionTexts.map((optionText, index) => ({
    id: `${cardId}:option:${index + 1}`,
    text: optionText
  }));
}

function parsePersistedAnswerOptions(value: unknown): AnswerOptionRecord[] | null {
  if (typeof value !== "string") return null;
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("invalid persisted answer options");
  }
  return parsed.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("invalid persisted answer option");
    }
    const row = candidate as Record<string, unknown>;
    const id = text(row.id);
    const optionText = text(row.text);
    if (!id || !optionText) throw new Error("invalid persisted answer option");
    return { id, text: optionText };
  });
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

export function targetsFromAnchor(anchor: unknown):
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
    answer_options: parsePersistedAnswerOptions(row.answer_options_json),
    final_answer: finalAnswer,
    answer_source: typeof row.answer_source === "string" ? row.answer_source as AnswerSource : null,
    selected_option_id:
      typeof row.selected_option_id === "string"
        ? row.selected_option_id
        : null,
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
        sectionCards.length >= ALIGNMENT_SECTION_QUESTION_MIN &&
        sectionCards.length <= ALIGNMENT_SECTION_QUESTION_MAX &&
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
    answerOptions?: unknown;
    /** Deprecated input retained for source compatibility; new cards require answerOptions. */
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
  const answerOptionTexts = normalizeAnswerOptionTexts(input.answerOptions);
  if (!answerOptionTexts) {
    return { ok: false, reason: "invalid_answer_options" };
  }
  const id = randomUUID();
  const answerOptions = answerOptionsForCard(id, answerOptionTexts);
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
          alignment_attempt_id, agent_idempotency_key, answer_options_json,
          selected_option_id)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, NULL)`
      ).run(
        id,
        section,
        observation,
        question,
        null,
        JSON.stringify(anchor.anchor),
        now,
        now,
        alignmentAttemptId,
        idempotencyKey,
        JSON.stringify(answerOptions)
      );
      const event = logEventOnDb(db, "question_card_created", {
        question_card_id: id,
        alignment_attempt_id: alignmentAttemptId,
        section,
        answer_option_count: answerOptions.length
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
      const mapped = mapAnnotation(db, updated);
      if (mapped.alignment_attempt_id && mapped.section) {
        const semanticSource = {
          sourceId: mapped.id,
          kind: "agent-annotation" as const,
          section: mapped.section,
          title: mapped.title,
          statement: mapped.body,
          confidence: mapped.inference,
          additionalInformation: mapped.additional_information
        };
        recordAlignmentSemanticChangeOnDb(db, {
          alignmentAttemptId: mapped.alignment_attempt_id,
          sourceKind: "agent-annotation",
          sourceId: mapped.id,
          section: mapped.section,
          sourceDigest: alignmentSemanticSourceDigest(semanticSource),
          now
        });
      }
      return { ok: true as const, record: mapped, event_id: event.event_id };
    });
    if (result.ok) emitRecordEvent({ kind: "alignment", action: "updated", id: annotationId, projectPath: path.resolve(projectPath) });
    return result;
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

export function recordDesignerAnswer(
  projectPath: string,
  input: {
    questionCardId?: unknown;
    answer?: unknown;
    /** Deprecated compatibility payload for persisted legacy cards only. */
    finalAnswer?: unknown;
  }
): { ok: true; record: QuestionCardRecord; event_id: string } | Failure {
  const questionCardId = text(input?.questionCardId);
  if (!questionCardId) return { ok: false, reason: "not_found" };
  const hasExplicitAnswer = input.answer !== undefined;
  const hasLegacyFinalAnswer = input.finalAnswer !== undefined;
  if (hasExplicitAnswer === hasLegacyFinalAnswer) {
    return { ok: false, reason: "invalid_answer_payload" };
  }
  let answerIntent: DesignerAnswerIntent | null = null;
  let legacyFinalAnswer: string | null = null;
  if (hasExplicitAnswer) {
    if (!input.answer || typeof input.answer !== "object" || Array.isArray(input.answer)) {
      return { ok: false, reason: "invalid_answer_payload" };
    }
    const answer = input.answer as Record<string, unknown>;
    if (answer.kind === "option") {
      const optionId = text(answer.optionId);
      if (!optionId) return { ok: false, reason: "invalid_answer_option" };
      answerIntent = { kind: "option", optionId };
    } else if (answer.kind === "custom") {
      const customText = text(answer.text);
      if (!customText) return { ok: false, reason: "empty_final_answer" };
      answerIntent = { kind: "custom", text: customText };
    } else {
      return { ok: false, reason: "invalid_answer_payload" };
    }
  } else {
    legacyFinalAnswer = text(input.finalAnswer);
    if (!legacyFinalAnswer) {
      return { ok: false, reason: "empty_final_answer" };
    }
  }
  const answerKind: "option" | "custom" | "legacy" =
    legacyFinalAnswer !== null ? "legacy" : answerIntent?.kind ?? "custom";
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
        `SELECT alignment_attempt_id, proposed_answer, answer_options_json
         FROM alignment_question_cards WHERE id = ?`
      ).get(questionCardId) as {
        alignment_attempt_id: string | null;
        proposed_answer: string | null;
        answer_options_json: string | null;
      } | undefined;
      if (!existing) return { ok: false, reason: "not_found" } as Failure;
      if (existing.alignment_attempt_id !== preparation.current_attempt.id) {
        return { ok: false, reason: "stale_alignment_attempt" } as Failure;
      }
      const answerOptions = parsePersistedAnswerOptions(
        existing.answer_options_json
      );
      let finalAnswer: string;
      let answerSource: AnswerSource;
      let selectedOptionId: string | null = null;
      if (answerOptions) {
        if (legacyFinalAnswer !== null) {
          return {
            ok: false,
            reason: "legacy_final_answer_not_allowed"
          } as Failure;
        }
        if (answerIntent?.kind === "option") {
          const option = answerOptions.find(
            (candidate) => candidate.id === answerIntent.optionId
          );
          if (!option) {
            return { ok: false, reason: "invalid_answer_option" } as Failure;
          }
          finalAnswer = option.text;
          answerSource = "agent-proposed-designer-accepted";
          selectedOptionId = option.id;
        } else if (answerIntent?.kind === "custom") {
          finalAnswer = answerIntent.text;
          answerSource = "designer-edited";
        } else {
          return { ok: false, reason: "invalid_answer_payload" } as Failure;
        }
      } else if (answerIntent?.kind === "option") {
        return { ok: false, reason: "invalid_answer_option" } as Failure;
      } else if (answerIntent?.kind === "custom") {
        finalAnswer = answerIntent.text;
        answerSource = "designer-edited";
      } else {
        finalAnswer = legacyFinalAnswer!;
        answerSource =
          text(existing.proposed_answer) === finalAnswer
            ? "agent-proposed-designer-accepted"
            : "designer-edited";
      }
      const now = new Date().toISOString();
      db.prepare(
        `UPDATE alignment_question_cards
         SET final_answer = ?, answer_source = ?, selected_option_id = ?,
             updated_at = ?
         WHERE id = ?`
      ).run(finalAnswer, answerSource, selectedOptionId, now, questionCardId);
      const row = db.prepare(
        "SELECT * FROM alignment_question_cards WHERE id = ?"
      ).get(questionCardId) as Record<string, unknown>;
      const updatedQuestion = mapQuestion(db, row);
      const semanticSource = {
        sourceId: questionCardId,
        kind: "question" as const,
        section: updatedQuestion.section,
        title: updatedQuestion.observation,
        question: updatedQuestion.question,
        answer: finalAnswer,
        answerSource,
        selectedOptionId
      };
      recordAlignmentSemanticChangeOnDb(db, {
        alignmentAttemptId: preparation.current_attempt.id,
        sourceKind: "question",
        sourceId: questionCardId,
        section: semanticSource.section,
        sourceDigest: alignmentSemanticSourceDigest(semanticSource),
        now
      });
      const event = logEventOnDb(db, "designer_answer_submitted", {
        question_card_id: questionCardId,
        alignment_attempt_id: preparation.current_attempt.id,
        final_answer: finalAnswer,
        answer_source: answerSource,
        answer_kind: answerKind,
        selected_option_id: selectedOptionId
      });
      return { ok: true as const, record: updatedQuestion, event_id: event.event_id };
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

export function getDesignIntentAlignmentOnDb(db: DatabaseType) {
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
  const state = db
    .prepare(
      "SELECT status, completed_at FROM design_intent_alignment WHERE singleton = 1"
    )
    .get() as {
    status: "draft" | "completed";
    completed_at: string | null;
  };
  const coverage = coverageFor(questionCards);
  // Issue 08A: Designer Annotations (author=designer, section-bound) are the
  // designer's own intent input and part of the same Alignment — they ship
  // in the snapshot alongside Agent cards so the semantic read surface
  // (MCP read_design_intent_alignment) never needs a second channel. They
  // are input, not a gate: coverage / can_complete never count them.
  const designerAnnotations = listRegionAnnotationsOnDb(db, {
    author: "designer"
  }).filter((annotation) => annotation.section !== null);
  return {
    sections: ALIGNMENT_SECTIONS,
    alignment: state,
    preparation,
    annotations,
    question_cards: questionCards,
    designer_annotations: designerAnnotations,
    coverage: {
      ...coverage,
      can_complete:
        state.status !== "completed" &&
        preparation.workflow.stage === "alignment-answering" &&
        coverage.can_complete
    }
  };
}

export function getDesignIntentAlignment(projectPath: string) {
  const db = openProjectDb(projectPath);
  try {
    return getDesignIntentAlignmentOnDb(db);
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
      const frozenSemanticInput = freezeAlignmentSemanticRevisionOnDb(
        db,
        attempt.id,
        now
      );
      if (!frozenSemanticInput) {
        throw new Error("alignment_semantic_state_missing");
      }
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
      const completedAlignment = getDesignIntentAlignmentOnDb(db);
      const commandId = randomUUID();
      const commandPayload = {
        alignment_attempt_id: attempt.id,
        input_snapshot_id: attempt.input_snapshot_id,
        alignment_completed_at: now,
        semantic_revision: frozenSemanticInput.revision,
        semantic_digest: frozenSemanticInput.digest,
        question_cards: completedCards,
        initial_design_system_input: {
          input_snapshot: preparation.input_snapshot,
          annotations: completedAlignment.annotations,
          question_cards: completedAlignment.question_cards,
          designer_annotations: completedAlignment.designer_annotations
        }
      };
      const published = publishAgentCommandOnDb(
        db,
        {
          id: commandId,
          commandType: "prepare_initial_design_system",
          scope: { kind: "alignment_attempt", id: attempt.id },
          payload: commandPayload,
          idempotencyKey: `prepare-initial-design-system:${attempt.id}`
        },
        now
      );
      if (!published.ok) {
        throw new Error(`agent_command_publish_failed:${published.reason}`);
      }
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
