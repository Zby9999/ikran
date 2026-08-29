import { createHash } from "node:crypto";
import path from "node:path";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import { semanticDraftValidationIssues } from "./initial-design-system-semantic-schema";

import { closeProjectDb, openProjectDb } from "./db";
import {
  applyPresenceToLease,
  subscribeWorkbenchPresence,
  waitLeaseDecision,
  type WaitLease
} from "./adaptive-agent-wait";
import { subscribeRecordEvents } from "./record-bus";

const SECTION_ORDER = [
  "design-concept",
  "visual-language",
  "token",
  "layout",
  "component",
  "interaction"
] as const;

type AlignmentSection = (typeof SECTION_ORDER)[number];
type SemanticSourceKind =
  | "question"
  | "agent-annotation"
  | "designer-annotation";

export type AlignmentSemanticSource = {
  sourceId: string;
  kind: SemanticSourceKind;
  section: AlignmentSection;
  digest: string;
  title?: string;
  question?: string;
  answer?: string;
  answerSource?: string;
  selectedOptionId?: string | null;
  statement?: string;
  confidence?: string;
  additionalInformation?: string[];
};

export type AlignmentSemanticDelta = {
  section: AlignmentSection;
  revision: number;
  fromRevision: number;
  toRevision: number;
  sectionDigest: string;
  sources: AlignmentSemanticSource[];
  changes: Array<{
    revision: number;
    sourceKind: SemanticSourceKind;
    sourceId: string;
    digest: string;
    operation: "upsert" | "delete";
  }>;
};

type SemanticStateRow = {
  alignment_attempt_id: string;
  current_revision: number;
  frozen_revision: number | null;
  frozen_digest: string | null;
  monitoring_status: "active" | "paused" | "completed";
};

export type IncrementalPlanSourceRef = {
  sourceId: string;
  digest: string;
};

export type IncrementalPlanDecision = {
  decisionId: string;
  outputConcern: string;
  statement: string;
  sourceRefs: IncrementalPlanSourceRef[];
};

export type IncrementalPlanDraftBinding = {
  path: string;
  decisionId: string;
};

const DRAFT_COLLECTION_TARGETS = [
  "concepts",
  "tokens.primitive",
  "tokens.semantic",
  "tokens.component",
  "foundationRules",
  "layoutRules",
  "interactionRules",
  "components",
  "categoryOmissions",
  "sourceOmissions"
] as const;

export type IncrementalPlanDraftCollectionTarget =
  (typeof DRAFT_COLLECTION_TARGETS)[number];

export type IncrementalPlanDraftPatch = {
  name?: string;
  visualLanguage?: {
    value: Record<string, unknown>;
    decisionId: string;
  };
  upserts: Array<{
    target: IncrementalPlanDraftCollectionTarget;
    entryKey: string;
    value: Record<string, unknown>;
    decisionId: string;
  }>;
  retireEntryKeys?: Array<{
    target: IncrementalPlanDraftCollectionTarget;
    entryKey: string;
  }>;
};

type StoredPlanDecision = IncrementalPlanDecision & {
  section: AlignmentSection;
};

type PlanRow = {
  alignment_attempt_id: string;
  plan_version: number;
  processed_revision: number;
  section_digests_json: string;
  decisions_json: string;
  design_system_json: string;
};

type StoredDraftEntry = {
  entryKey: string;
  decisionId: string;
};

type StoredDraftEnvelope = {
  __ikranIncrementalPlan: 1 | 2;
  draft: unknown;
  bindings: IncrementalPlanDraftBinding[];
  visualLanguageDecisionId?: string;
  entries?: Partial<Record<
    IncrementalPlanDraftCollectionTarget,
    StoredDraftEntry[]
  >>;
};

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function isSection(value: unknown): value is AlignmentSection {
  return typeof value === "string" &&
    (SECTION_ORDER as readonly string[]).includes(value);
}

function stateOnDb(
  db: DatabaseType,
  alignmentAttemptId: string
): SemanticStateRow | null {
  return (db.prepare(
    `SELECT alignment_attempt_id, current_revision, frozen_revision,
            frozen_digest, monitoring_status
     FROM alignment_semantic_state
     WHERE alignment_attempt_id = ?`
  ).get(alignmentAttemptId) as SemanticStateRow | undefined) ?? null;
}

function sourceDigest(value: Omit<AlignmentSemanticSource, "digest">): string {
  return digest(value);
}

function planOnDb(
  db: DatabaseType,
  alignmentAttemptId: string
): PlanRow | null {
  return (db.prepare(
    `SELECT alignment_attempt_id, plan_version, processed_revision,
            section_digests_json, decisions_json, design_system_json
     FROM alignment_incremental_plans
     WHERE alignment_attempt_id = ?`
  ).get(alignmentAttemptId) as PlanRow | undefined) ?? null;
}

function sectionCursorsOnDb(
  db: DatabaseType,
  alignmentAttemptId: string
): Partial<Record<AlignmentSection, number>> {
  const cursors: Partial<Record<AlignmentSection, number>> = {};
  const rows = db.prepare(
    `SELECT response_json
     FROM alignment_incremental_plan_requests
     WHERE alignment_attempt_id = ?
     ORDER BY created_at ASC, idempotency_key ASC`
  ).all(alignmentAttemptId) as Array<{ response_json: string }>;
  for (const row of rows) {
    const response = JSON.parse(row.response_json) as Record<string, unknown>;
    if (
      isSection(response.section) &&
      Number.isInteger(response.acknowledgedRevision)
    ) {
      cursors[response.section] = Math.max(
        cursors[response.section] ?? 0,
        response.acknowledgedRevision as number
      );
    }
  }
  return cursors;
}

function draftCollection(
  draft: Record<string, unknown>,
  target: IncrementalPlanDraftCollectionTarget
): unknown[] {
  if (target.startsWith("tokens.")) {
    const layer = target.slice("tokens.".length);
    const tokens = draft.tokens && typeof draft.tokens === "object" &&
      !Array.isArray(draft.tokens)
      ? draft.tokens as Record<string, unknown>
      : {};
    const collection = tokens[layer];
    return Array.isArray(collection) ? collection : [];
  }
  const collection = draft[target];
  return Array.isArray(collection) ? collection : [];
}

function setDraftCollection(
  draft: Record<string, unknown>,
  target: IncrementalPlanDraftCollectionTarget,
  collection: unknown[]
): void {
  if (target.startsWith("tokens.")) {
    const layer = target.slice("tokens.".length);
    const tokens = draft.tokens && typeof draft.tokens === "object" &&
      !Array.isArray(draft.tokens)
      ? { ...draft.tokens as Record<string, unknown> }
      : {};
    tokens[layer] = collection;
    draft.tokens = tokens;
    return;
  }
  draft[target] = collection;
}

function bindingDecisionId(
  bindings: IncrementalPlanDraftBinding[],
  path: string
): string {
  return bindings.find((binding) => binding.path === path)?.decisionId ?? "";
}

function targetPointer(target: IncrementalPlanDraftCollectionTarget): string {
  return `/${target.replace(".", "/")}`;
}

function hydrateStoredDraftEnvelope(
  envelope: StoredDraftEnvelope
): StoredDraftEnvelope {
  const draft = envelope.draft && typeof envelope.draft === "object" &&
    !Array.isArray(envelope.draft)
    ? envelope.draft as Record<string, unknown>
    : {};
  const entries = { ...(envelope.entries ?? {}) };
  for (const target of DRAFT_COLLECTION_TARGETS) {
    const collection = draftCollection(draft, target);
    const existingEntries = entries[target] ?? [];
    entries[target] = collection.map((_, index) => existingEntries[index] ?? ({
      entryKey: `legacy:${target}:${index}`,
      decisionId: bindingDecisionId(
        envelope.bindings,
        `${targetPointer(target)}/${index}`
      )
    }));
  }
  return {
    ...envelope,
    visualLanguageDecisionId: envelope.visualLanguageDecisionId ??
      (bindingDecisionId(envelope.bindings, "/visualLanguage") || undefined),
    entries
  };
}

function parseStoredDraft(value: string): StoredDraftEnvelope {
  const parsed = JSON.parse(value) as unknown;
  if (
    parsed && typeof parsed === "object" &&
    ((parsed as Record<string, unknown>).__ikranIncrementalPlan === 1 ||
      (parsed as Record<string, unknown>).__ikranIncrementalPlan === 2) &&
    Array.isArray((parsed as Record<string, unknown>).bindings)
  ) {
    return hydrateStoredDraftEnvelope(parsed as StoredDraftEnvelope);
  }
  return hydrateStoredDraftEnvelope({
    __ikranIncrementalPlan: 1,
    draft: parsed,
    bindings: []
  });
}

function materializeDraftPatch(
  existing: StoredDraftEnvelope | null,
  patch: IncrementalPlanDraftPatch,
  retireDecisionIds: Set<string>
): StoredDraftEnvelope {
  const base = hydrateStoredDraftEnvelope(existing ?? {
    __ikranIncrementalPlan: 2,
    draft: {},
    bindings: []
  });
  const draft = base.draft && typeof base.draft === "object" &&
    !Array.isArray(base.draft)
    ? structuredClone(base.draft) as Record<string, unknown>
    : {};
  const entries = structuredClone(base.entries ?? {});

  if (patch.name !== undefined) draft.name = patch.name;
  let visualLanguageDecisionId = base.visualLanguageDecisionId;
  if (
    visualLanguageDecisionId &&
    retireDecisionIds.has(visualLanguageDecisionId)
  ) {
    delete draft.visualLanguage;
    visualLanguageDecisionId = undefined;
  }
  if (patch.visualLanguage) {
    draft.visualLanguage = structuredClone(patch.visualLanguage.value);
    visualLanguageDecisionId = patch.visualLanguage.decisionId;
  }

  const retiredEntryKeys = new Set(
    (patch.retireEntryKeys ?? []).map(({ target, entryKey }) =>
      `${target}\u0000${entryKey}`
    )
  );
  for (const target of DRAFT_COLLECTION_TARGETS) {
    const collection = draftCollection(draft, target);
    const targetEntries = entries[target] ?? [];
    const kept = targetEntries.map((entry, index) => ({
      entry,
      value: collection[index]
    })).filter(({ entry }) =>
      !retireDecisionIds.has(entry.decisionId) &&
      !retiredEntryKeys.has(`${target}\u0000${entry.entryKey}`)
    );
    entries[target] = kept.map(({ entry }) => entry);
    setDraftCollection(draft, target, kept.map(({ value }) => value));
  }

  for (const upsert of patch.upserts) {
    const collection = draftCollection(draft, upsert.target);
    const targetEntries = entries[upsert.target] ?? [];
    const existingIndex = targetEntries.findIndex(
      (entry) => entry.entryKey === upsert.entryKey
    );
    const storedEntry = {
      entryKey: upsert.entryKey,
      decisionId: upsert.decisionId
    };
    if (existingIndex >= 0) {
      collection[existingIndex] = structuredClone(upsert.value);
      targetEntries[existingIndex] = storedEntry;
    } else {
      collection.push(structuredClone(upsert.value));
      targetEntries.push(storedEntry);
    }
    entries[upsert.target] = targetEntries;
    setDraftCollection(draft, upsert.target, collection);
  }

  const bindings: IncrementalPlanDraftBinding[] = [];
  if (draft.visualLanguage && visualLanguageDecisionId) {
    bindings.push({
      path: "/visualLanguage",
      decisionId: visualLanguageDecisionId
    });
  }
  for (const target of DRAFT_COLLECTION_TARGETS) {
    for (const [index, entry] of (entries[target] ?? []).entries()) {
      if (!entry.decisionId) continue;
      bindings.push({
        path: `${targetPointer(target)}/${index}`,
        decisionId: entry.decisionId
      });
    }
  }
  return {
    __ikranIncrementalPlan: 2,
    draft,
    bindings,
    visualLanguageDecisionId,
    entries
  };
}

function draftUnits(value: unknown): Array<{ path: string; sourceIds: string[] }> {
  if (!value || typeof value !== "object") return [];
  const root = value as Record<string, unknown>;
  const units: Array<{ path: string; sourceIds: string[] }> = [];
  const add = (unitPath: string, candidate: unknown): void => {
    if (!candidate || typeof candidate !== "object") return;
    const sourceRefs = (candidate as Record<string, unknown>).sourceRefs;
    if (!Array.isArray(sourceRefs)) return;
    units.push({
      path: unitPath,
      sourceIds: [...new Set(sourceRefs.filter(
        (sourceId): sourceId is string => typeof sourceId === "string"
      ))]
    });
  };
  const addArray = (prefix: string, candidate: unknown): void => {
    if (!Array.isArray(candidate)) return;
    candidate.forEach((unit, index) => add(`${prefix}/${index}`, unit));
  };
  add("/visualLanguage", root.visualLanguage);
  addArray("/concepts", root.concepts);
  if (root.tokens && typeof root.tokens === "object") {
    const tokens = root.tokens as Record<string, unknown>;
    addArray("/tokens/primitive", tokens.primitive);
    addArray("/tokens/semantic", tokens.semantic);
    addArray("/tokens/component", tokens.component);
  }
  addArray("/layoutRules", root.layoutRules);
  addArray("/interactionRules", root.interactionRules);
  addArray("/components", root.components);
  addArray("/foundationRules", root.foundationRules);
  addArray("/categoryOmissions", root.categoryOmissions);
  if (Array.isArray(root.sourceOmissions)) {
    root.sourceOmissions.forEach((candidate, index) => {
      if (!candidate || typeof candidate !== "object") return;
      const sourceRef = (candidate as Record<string, unknown>).sourceRef;
      if (typeof sourceRef !== "string") return;
      units.push({ path: `/sourceOmissions/${index}`, sourceIds: [sourceRef] });
    });
  }
  return units;
}

function draftDependencyState(
  draft: unknown,
  bindings: IncrementalPlanDraftBinding[],
  decisions: StoredPlanDecision[],
  currentSources: Map<string, AlignmentSemanticSource>
) {
  const units = draftUnits(draft);
  const accountedSourceIds = new Set(
    units.flatMap((unit) => unit.sourceIds)
  );
  const unitsByPath = new Map(units.map((unit) => [unit.path, unit]));
  const bindingsByPath = new Map<string, IncrementalPlanDraftBinding[]>();
  for (const binding of bindings) {
    bindingsByPath.set(binding.path, [
      ...(bindingsByPath.get(binding.path) ?? []),
      binding
    ]);
  }
  const validDecisions = new Map(decisions.filter((decision) =>
    decision.sourceRefs.every((source) =>
      currentSources.get(source.sourceId)?.digest === source.digest
    )
  ).map((decision) => [decision.decisionId, decision]));
  const unboundDraftPaths: string[] = [];
  const invalidDraftBindingPaths: string[] = [];
  const unboundDraftSourceIds = new Set<string>();
  for (const unit of units) {
    const unitBindings = bindingsByPath.get(unit.path) ?? [];
    if (unitBindings.length === 0) {
      unboundDraftPaths.push(unit.path);
      unit.sourceIds.forEach((sourceId) => unboundDraftSourceIds.add(sourceId));
      continue;
    }
    const decision = unitBindings.length === 1
      ? validDecisions.get(unitBindings[0].decisionId)
      : undefined;
    const decisionSourceIds = new Set(
      decision?.sourceRefs.map((source) => source.sourceId) ?? []
    );
    if (
      !decision ||
      unit.sourceIds.some((sourceId) =>
        !currentSources.has(sourceId) || !decisionSourceIds.has(sourceId)
      )
    ) {
      invalidDraftBindingPaths.push(unit.path);
      unit.sourceIds.filter((sourceId) => !decisionSourceIds.has(sourceId))
        .forEach((sourceId) => unboundDraftSourceIds.add(sourceId));
    }
  }
  for (const bindingPath of bindingsByPath.keys()) {
    if (!unitsByPath.has(bindingPath)) invalidDraftBindingPaths.push(bindingPath);
  }
  return {
    unboundDraftPaths: [...new Set(unboundDraftPaths)].sort(),
    invalidDraftBindingPaths: [...new Set(invalidDraftBindingPaths)].sort(),
    unboundDraftSourceIds: [...unboundDraftSourceIds].sort(),
    unaccountedDraftSourceIds: [...currentSources.keys()]
      .filter((sourceId) => !accountedSourceIds.has(sourceId))
      .sort()
  };
}

function currentSectionSourcesOnDb(
  db: DatabaseType,
  alignmentAttemptId: string,
  section: AlignmentSection
): AlignmentSemanticSource[] {
  const questions = (db.prepare(
    `SELECT id, section, observation, question, final_answer, answer_source,
            selected_option_id
     FROM alignment_question_cards
     WHERE alignment_attempt_id = ? AND section = ?
       AND final_answer IS NOT NULL AND TRIM(final_answer) <> ''
     ORDER BY created_at ASC, id ASC`
  ).all(alignmentAttemptId, section) as Array<{
    id: string;
    section: string;
    observation: string;
    question: string;
    final_answer: string;
    answer_source: string;
    selected_option_id: string | null;
  }>).map((row) => {
    const value = {
      sourceId: row.id,
      kind: "question" as const,
      section,
      title: row.observation,
      question: row.question,
      answer: row.final_answer,
      answerSource: row.answer_source,
      selectedOptionId: row.selected_option_id
    };
    return { ...value, digest: sourceDigest(value) };
  });
  const agentAnnotations = (db.prepare(
    `SELECT id, section, title, body, inference, additional_information_json
     FROM agent_alignment_annotations
     WHERE alignment_attempt_id = ? AND section = ?
     ORDER BY created_at ASC, id ASC`
  ).all(alignmentAttemptId, section) as Array<{
    id: string;
    section: string;
    title: string;
    body: string;
    inference: string;
    additional_information_json: string;
  }>).map((row) => {
    const value = {
      sourceId: row.id,
      kind: "agent-annotation" as const,
      section,
      title: row.title,
      statement: row.body,
      confidence: row.inference,
      additionalInformation: JSON.parse(row.additional_information_json) as string[]
    };
    return { ...value, digest: sourceDigest(value) };
  });
  const designerAnnotations = (db.prepare(
    `SELECT id, section, body
     FROM region_annotations
     WHERE author = 'designer' AND section = ?
     ORDER BY created_at ASC, id ASC`
  ).all(section) as Array<{
    id: string;
    section: string;
    body: string;
  }>).map((row) => {
    const value = {
      sourceId: row.id,
      kind: "designer-annotation" as const,
      section,
      statement: row.body
    };
    return { ...value, digest: sourceDigest(value) };
  });
  return [...questions, ...agentAnnotations, ...designerAnnotations];
}

function sectionIsReadyOnDb(
  db: DatabaseType,
  alignmentAttemptId: string,
  section: AlignmentSection
): boolean {
  const row = db.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN final_answer IS NOT NULL
                      AND TRIM(final_answer) <> '' THEN 1 ELSE 0 END) AS answered
     FROM alignment_question_cards
     WHERE alignment_attempt_id = ? AND section = ?`
  ).get(alignmentAttemptId, section) as { total: number; answered: number };
  return row.total >= 2 && row.total <= 5 && row.answered === row.total;
}

function currentSectionDigestOnDb(
  db: DatabaseType,
  alignmentAttemptId: string,
  section: AlignmentSection
): string {
  const sources = currentSectionSourcesOnDb(db, alignmentAttemptId, section);
  return digest(sources.map((source) => ({
    sourceId: source.sourceId,
    digest: source.digest
  })));
}

function currentSourcesByIdOnDb(
  db: DatabaseType,
  alignmentAttemptId: string
): Map<string, AlignmentSemanticSource> {
  return new Map(
    SECTION_ORDER.flatMap((section) =>
      currentSectionSourcesOnDb(db, alignmentAttemptId, section)
    ).map((source) => [source.sourceId, source])
  );
}

function latestSourceSectionOnDb(
  db: DatabaseType,
  alignmentAttemptId: string,
  sourceId: string
): AlignmentSection | null {
  const row = db.prepare(
    `SELECT section
     FROM alignment_semantic_changes
     WHERE alignment_attempt_id = ? AND source_id = ?
     ORDER BY revision DESC LIMIT 1`
  ).get(alignmentAttemptId, sourceId) as { section: string } | undefined;
  return isSection(row?.section) ? row.section : null;
}

export function initializeAlignmentSemanticStateOnDb(
  db: DatabaseType,
  alignmentAttemptId: string,
  now = new Date().toISOString()
): SemanticStateRow {
  const existing = stateOnDb(db, alignmentAttemptId);
  if (existing) return existing;
  db.prepare(
    `INSERT INTO alignment_semantic_state
       (alignment_attempt_id, current_revision, frozen_revision,
        frozen_digest, monitoring_status, created_at, updated_at)
     VALUES (?, 1, NULL, NULL, 'paused', ?, ?)`
  ).run(alignmentAttemptId, now, now);

  const insert = db.prepare(
    `INSERT INTO alignment_semantic_changes
       (alignment_attempt_id, revision, source_kind, source_id, section,
        source_digest, operation, created_at)
     VALUES (?, 1, ?, ?, ?, ?, 'upsert', ?)`
  );
  for (const section of SECTION_ORDER) {
    for (const source of currentSectionSourcesOnDb(
      db,
      alignmentAttemptId,
      section
    ).filter((candidate) => candidate.kind !== "question")) {
      insert.run(
        alignmentAttemptId,
        source.kind,
        source.sourceId,
        section,
        source.digest,
        now
      );
    }
  }
  return stateOnDb(db, alignmentAttemptId)!;
}

export function recordAlignmentSemanticChangeOnDb(
  db: DatabaseType,
  input: {
    alignmentAttemptId: string;
    sourceKind: SemanticSourceKind;
    sourceId: string;
    section: string;
    sourceDigest: string;
    operation?: "upsert" | "delete";
    now?: string;
  }
): number | null {
  if (!isSection(input.section)) return null;
  const state = stateOnDb(db, input.alignmentAttemptId);
  if (!state || state.frozen_revision !== null) return null;
  const previous = db.prepare(
    `SELECT source_digest, operation
     FROM alignment_semantic_changes
     WHERE alignment_attempt_id = ? AND source_kind = ? AND source_id = ?
     ORDER BY revision DESC LIMIT 1`
  ).get(
    input.alignmentAttemptId,
    input.sourceKind,
    input.sourceId
  ) as { source_digest: string; operation: string } | undefined;
  const operation = input.operation ?? "upsert";
  if (
    previous?.source_digest === input.sourceDigest &&
    previous.operation === operation
  ) {
    return state.current_revision;
  }
  const revision = state.current_revision + 1;
  const now = input.now ?? new Date().toISOString();
  db.prepare(
    `INSERT INTO alignment_semantic_changes
       (alignment_attempt_id, revision, source_kind, source_id, section,
        source_digest, operation, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.alignmentAttemptId,
    revision,
    input.sourceKind,
    input.sourceId,
    input.section,
    input.sourceDigest,
    operation,
    now
  );
  db.prepare(
    `UPDATE alignment_semantic_state
     SET current_revision = ?, updated_at = ?
     WHERE alignment_attempt_id = ?`
  ).run(revision, now, input.alignmentAttemptId);
  return revision;
}

export function alignmentSemanticSourceDigest(
  value: Omit<AlignmentSemanticSource, "digest">
): string {
  return sourceDigest(value);
}

export function recordCurrentDesignerAnnotationSemanticChangeOnDb(
  db: DatabaseType,
  input: {
    sourceId: string;
    section: string | null;
    statement: string;
    operation?: "upsert" | "delete";
    now?: string;
  }
): number | null {
  if (!isSection(input.section)) return null;
  const workflow = db.prepare(
    `SELECT stage, current_alignment_attempt_id
     FROM project_workflow WHERE singleton = 1`
  ).get() as {
    stage: string;
    current_alignment_attempt_id: string | null;
  } | undefined;
  if (
    workflow?.stage !== "alignment-answering" ||
    !workflow.current_alignment_attempt_id
  ) {
    return null;
  }
  const value = {
    sourceId: input.sourceId,
    kind: "designer-annotation" as const,
    section: input.section,
    statement: input.statement
  };
  return recordAlignmentSemanticChangeOnDb(db, {
    alignmentAttemptId: workflow.current_alignment_attempt_id,
    sourceKind: "designer-annotation",
    sourceId: input.sourceId,
    section: input.section,
    sourceDigest: sourceDigest(value),
    operation: input.operation,
    now: input.now
  });
}

export function freezeAlignmentSemanticRevisionOnDb(
  db: DatabaseType,
  alignmentAttemptId: string,
  now = new Date().toISOString()
): { revision: number; digest: string } | null {
  const state = stateOnDb(db, alignmentAttemptId);
  if (!state) return null;
  if (state.frozen_revision !== null && state.frozen_digest) {
    return { revision: state.frozen_revision, digest: state.frozen_digest };
  }
  const sources = SECTION_ORDER.flatMap((section) =>
    currentSectionSourcesOnDb(db, alignmentAttemptId, section)
  ).sort((left, right) =>
    `${left.kind}:${left.sourceId}`.localeCompare(`${right.kind}:${right.sourceId}`)
  );
  const frozenDigest = digest(sources.map((source) => ({
    sourceId: source.sourceId,
    digest: source.digest
  })));
  db.prepare(
    `UPDATE alignment_semantic_state
     SET frozen_revision = current_revision,
         frozen_digest = ?, monitoring_status = 'completed', updated_at = ?
     WHERE alignment_attempt_id = ?`
  ).run(frozenDigest, now, alignmentAttemptId);
  return { revision: state.current_revision, digest: frozenDigest };
}

export function readAlignmentSemanticDelta(
  projectPath: string,
  input: { alignmentAttemptId: string; afterRevision?: number }
):
  | {
      ok: true;
      currentRevision: number;
      planVersion: number;
      frozenRevision: number | null;
      frozenDigest: string | null;
      delta: AlignmentSemanticDelta | null;
    }
  | { ok: false; reason: "stale_alignment_attempt" | "planning_not_initialized" | "db_error" } {
  const db = openProjectDb(projectPath);
  try {
    const workflow = db.prepare(
      `SELECT current_alignment_attempt_id
       FROM project_workflow WHERE singleton = 1`
    ).get() as { current_alignment_attempt_id: string | null } | undefined;
    if (workflow?.current_alignment_attempt_id !== input.alignmentAttemptId) {
      return { ok: false, reason: "stale_alignment_attempt" };
    }
    const state = stateOnDb(db, input.alignmentAttemptId);
    if (!state) return { ok: false, reason: "planning_not_initialized" };
    const afterRevision = Math.max(0, Math.floor(input.afterRevision ?? 0));
    const changedSections = new Set(
      (db.prepare(
        `SELECT DISTINCT section
         FROM alignment_semantic_changes
         WHERE alignment_attempt_id = ? AND revision > ?`
      ).all(input.alignmentAttemptId, afterRevision) as Array<{ section: string }>)
        .flatMap((row) => isSection(row.section) ? [row.section] : [])
    );
    const plan = planOnDb(db, input.alignmentAttemptId);
    const sectionCursors = plan
      ? sectionCursorsOnDb(db, input.alignmentAttemptId)
      : {};
    const acknowledgedSectionDigests = plan
      ? JSON.parse(plan.section_digests_json) as Partial<Record<AlignmentSection, string>>
      : {};
    const section = SECTION_ORDER.find(
      (candidate) => {
        if (!sectionIsReadyOnDb(db, input.alignmentAttemptId, candidate)) {
          return false;
        }
        const currentDigest = currentSectionDigestOnDb(
          db,
          input.alignmentAttemptId,
          candidate
        );
        return plan
          ? acknowledgedSectionDigests[candidate] !== currentDigest
          : changedSections.has(candidate);
      }
    );
    if (!section) {
      return {
        ok: true,
        currentRevision: state.current_revision,
        planVersion: plan?.plan_version ?? 0,
        frozenRevision: state.frozen_revision,
        frozenDigest: state.frozen_digest,
        delta: null
      };
    }
    const sources = currentSectionSourcesOnDb(
      db,
      input.alignmentAttemptId,
      section
    );
    const sectionRevision = (db.prepare(
      `SELECT MAX(revision) AS revision
       FROM alignment_semantic_changes
       WHERE alignment_attempt_id = ? AND section = ?`
    ).get(input.alignmentAttemptId, section) as { revision: number }).revision;
    const sectionAfterRevision = plan
      ? sectionCursors[section] ?? 0
      : afterRevision;
    let changes = db.prepare(
      `SELECT revision, source_kind, source_id, source_digest, operation
       FROM alignment_semantic_changes
       WHERE alignment_attempt_id = ? AND section = ? AND revision > ?
       ORDER BY revision ASC, source_kind ASC, source_id ASC`
    ).all(input.alignmentAttemptId, section, sectionAfterRevision) as Array<{
      revision: number;
      source_kind: SemanticSourceKind;
      source_id: string;
      source_digest: string;
      operation: "upsert" | "delete";
    }>;
    // Compatibility for a plan written before per-section cursor metadata was
    // introduced: redeliver the bounded section history rather than lose a
    // digest mismatch behind a newer global cursor.
    if (changes.length === 0 && acknowledgedSectionDigests[section]) {
      changes = db.prepare(
        `SELECT revision, source_kind, source_id, source_digest, operation
         FROM alignment_semantic_changes
         WHERE alignment_attempt_id = ? AND section = ?
         ORDER BY revision ASC, source_kind ASC, source_id ASC`
      ).all(input.alignmentAttemptId, section) as typeof changes;
    }
    const fromRevision = changes[0]?.revision ?? sectionRevision;
    return {
      ok: true,
      currentRevision: state.current_revision,
      planVersion: plan?.plan_version ?? 0,
      frozenRevision: state.frozen_revision,
      frozenDigest: state.frozen_digest,
      delta: {
        section,
        revision: sectionRevision,
        fromRevision,
        toRevision: sectionRevision,
        sectionDigest: currentSectionDigestOnDb(
          db,
          input.alignmentAttemptId,
          section
        ),
        sources,
        changes: changes.map((change) => ({
          revision: change.revision,
          sourceKind: change.source_kind,
          sourceId: change.source_id,
          digest: change.source_digest,
          operation: change.operation
        }))
      }
    };
  } catch {
    return { ok: false, reason: "db_error" };
  } finally {
    closeProjectDb(db);
  }
}

function validDecisionInput(value: unknown): value is IncrementalPlanDecision {
  if (!value || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  return typeof raw.decisionId === "string" && raw.decisionId.trim().length > 0 &&
    typeof raw.outputConcern === "string" && raw.outputConcern.trim().length > 0 &&
    typeof raw.statement === "string" && raw.statement.trim().length > 0 &&
    Array.isArray(raw.sourceRefs) && raw.sourceRefs.length > 0 &&
    raw.sourceRefs.every((source) => {
      if (!source || typeof source !== "object") return false;
      const ref = source as Record<string, unknown>;
      return typeof ref.sourceId === "string" && ref.sourceId.length > 0 &&
        typeof ref.digest === "string" && /^[a-f0-9]{64}$/.test(ref.digest);
    });
}

function validDraftBindingInput(
  value: unknown
): value is IncrementalPlanDraftBinding {
  if (!value || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  return typeof raw.path === "string" && raw.path.startsWith("/") &&
    typeof raw.decisionId === "string" && raw.decisionId.trim().length > 0;
}

function validDraftPatchInput(
  value: unknown
): value is IncrementalPlanDraftPatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  if (
    raw.name !== undefined &&
    (typeof raw.name !== "string" || raw.name.trim().length === 0)
  ) return false;
  if (raw.visualLanguage !== undefined) {
    if (
      !raw.visualLanguage || typeof raw.visualLanguage !== "object" ||
      Array.isArray(raw.visualLanguage)
    ) return false;
    const visualLanguage = raw.visualLanguage as Record<string, unknown>;
    if (
      !visualLanguage.value || typeof visualLanguage.value !== "object" ||
      Array.isArray(visualLanguage.value) ||
      typeof visualLanguage.decisionId !== "string" ||
      visualLanguage.decisionId.trim().length === 0
    ) return false;
  }
  if (!Array.isArray(raw.upserts)) return false;
  const upsertKeys = new Set<string>();
  for (const candidate of raw.upserts) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return false;
    }
    const upsert = candidate as Record<string, unknown>;
    if (
      !DRAFT_COLLECTION_TARGETS.includes(
        upsert.target as IncrementalPlanDraftCollectionTarget
      ) ||
      typeof upsert.entryKey !== "string" || !upsert.entryKey.trim() ||
      typeof upsert.decisionId !== "string" || !upsert.decisionId.trim() ||
      !upsert.value || typeof upsert.value !== "object" ||
      Array.isArray(upsert.value)
    ) return false;
    const key = `${upsert.target}\u0000${upsert.entryKey}`;
    if (upsertKeys.has(key)) return false;
    upsertKeys.add(key);
  }
  if (raw.retireEntryKeys !== undefined) {
    if (!Array.isArray(raw.retireEntryKeys)) return false;
    const retiredKeys = new Set<string>();
    for (const candidate of raw.retireEntryKeys) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        return false;
      }
      const retired = candidate as Record<string, unknown>;
      if (
        !DRAFT_COLLECTION_TARGETS.includes(
          retired.target as IncrementalPlanDraftCollectionTarget
        ) ||
        typeof retired.entryKey !== "string" || !retired.entryKey.trim()
      ) return false;
      const key = `${retired.target}\u0000${retired.entryKey}`;
      if (retiredKeys.has(key) || upsertKeys.has(key)) return false;
      retiredKeys.add(key);
    }
  }
  return true;
}

export function recordIncrementalDesignSystemPlan(
  projectPath: string,
  input: {
    alignmentAttemptId: string;
    idempotencyKey: string;
    basePlanVersion: number;
    baseRevision: number;
    section: string;
    sectionDigest: string;
    decisions: IncrementalPlanDecision[];
    retireDecisionIds?: string[];
    draftBindings?: IncrementalPlanDraftBinding[];
    designSystemDraft?: unknown;
    draftPatch?: IncrementalPlanDraftPatch;
  }
):
  | {
      ok: true;
      reused: boolean;
      planVersion: number;
      processedRevision: number;
      acknowledgedSections: AlignmentSection[];
      decisions: IncrementalPlanDecision[];
    }
  | { ok: false; reason: string; details?: unknown } {
  if (
    typeof input.alignmentAttemptId !== "string" ||
    typeof input.idempotencyKey !== "string" ||
    !Number.isInteger(input.basePlanVersion) || input.basePlanVersion < 0 ||
    !Number.isInteger(input.baseRevision) ||
    !isSection(input.section) ||
    !/^[a-f0-9]{64}$/.test(input.sectionDigest) ||
    !Array.isArray(input.decisions) ||
    !input.decisions.every(validDecisionInput) ||
    (input.draftBindings !== undefined && (
      !Array.isArray(input.draftBindings) ||
      !input.draftBindings.every(validDraftBindingInput)
    )) ||
    (input.retireDecisionIds !== undefined && (
      !Array.isArray(input.retireDecisionIds) ||
      !input.retireDecisionIds.every((id) =>
        typeof id === "string" && id.trim().length > 0
      )
    )) ||
    ((input.designSystemDraft === undefined) === (input.draftPatch === undefined)) ||
    (input.designSystemDraft !== undefined && (
      !input.designSystemDraft || typeof input.designSystemDraft !== "object"
    )) ||
    (input.draftPatch !== undefined && !validDraftPatchInput(input.draftPatch))
  ) {
    return { ok: false, reason: "invalid_incremental_plan" };
  }
  const requestDigest = digest(input);
  const db = openProjectDb(projectPath);
  try {
    db.exec("BEGIN IMMEDIATE");
    const duplicate = db.prepare(
      `SELECT input_digest, response_json
       FROM alignment_incremental_plan_requests
       WHERE alignment_attempt_id = ? AND idempotency_key = ?`
    ).get(input.alignmentAttemptId, input.idempotencyKey) as
      | { input_digest: string; response_json: string }
      | undefined;
    if (duplicate) {
      db.exec("COMMIT");
      if (duplicate.input_digest !== requestDigest) {
        return { ok: false, reason: "idempotency_conflict" };
      }
      const response = JSON.parse(duplicate.response_json) as Record<string, unknown>;
      return { ...response, ok: true, reused: true } as never;
    }
    const workflow = db.prepare(
      `SELECT current_alignment_attempt_id
       FROM project_workflow WHERE singleton = 1`
    ).get() as { current_alignment_attempt_id: string | null };
    if (workflow.current_alignment_attempt_id !== input.alignmentAttemptId) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "stale_alignment_attempt" };
    }
    const state = stateOnDb(db, input.alignmentAttemptId);
    if (!state) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "planning_not_initialized" };
    }
    if (input.baseRevision > state.current_revision) {
      db.exec("ROLLBACK");
      return {
        ok: false,
        reason: "future_semantic_revision",
        details: { current: state.current_revision, received: input.baseRevision }
      };
    }
    if (!sectionIsReadyOnDb(db, input.alignmentAttemptId, input.section)) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "section_not_ready" };
    }
    const actualSectionDigest = currentSectionDigestOnDb(
      db,
      input.alignmentAttemptId,
      input.section
    );
    if (actualSectionDigest !== input.sectionDigest) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "stale_section_digest" };
    }
    const existing = planOnDb(db, input.alignmentAttemptId);
    const expectedPlanVersion = existing?.plan_version ?? 0;
    if (input.basePlanVersion !== expectedPlanVersion) {
      db.exec("ROLLBACK");
      return {
        ok: false,
        reason: "stale_incremental_plan_version",
        details: {
          expected: expectedPlanVersion,
          received: input.basePlanVersion
        }
      };
    }
    const currentSources = currentSourcesByIdOnDb(db, input.alignmentAttemptId);
    const invalidSources = input.decisions.flatMap((decision) =>
      decision.sourceRefs.filter((source) =>
        currentSources.get(source.sourceId)?.digest !== source.digest
      ).map((source) => ({ decisionId: decision.decisionId, sourceId: source.sourceId }))
    );
    if (invalidSources.length > 0) {
      db.exec("ROLLBACK");
      return {
        ok: false,
        reason: "stale_plan_dependency",
        details: { sources: invalidSources }
      };
    }
    const existingDecisions = existing
      ? JSON.parse(existing.decisions_json) as StoredPlanDecision[]
      : [];
    const inputDecisionIds = input.decisions.map((decision) => decision.decisionId);
    const retireDecisionIds = new Set(input.retireDecisionIds ?? []);
    if (
      new Set(inputDecisionIds).size !== inputDecisionIds.length ||
      inputDecisionIds.some((id) => retireDecisionIds.has(id))
    ) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "conflicting_plan_decision_operation" };
    }
    const upsertDecisionIds = new Set(inputDecisionIds);
    const decisionIds = new Set<string>();
    const storedDecisions = [
      ...existingDecisions.filter((decision) =>
        !upsertDecisionIds.has(decision.decisionId) &&
        !retireDecisionIds.has(decision.decisionId)
      ),
      ...input.decisions.map((decision) => ({ ...decision, section: input.section }))
    ];
    for (const decision of storedDecisions) {
      if (decisionIds.has(decision.decisionId)) {
        db.exec("ROLLBACK");
        return {
          ok: false,
          reason: "duplicate_plan_decision",
          details: { decisionId: decision.decisionId }
        };
      }
      decisionIds.add(decision.decisionId);
    }
    const patchDecisionIds = input.draftPatch
      ? [
          ...(input.draftPatch.visualLanguage
            ? [input.draftPatch.visualLanguage.decisionId]
            : []),
          ...input.draftPatch.upserts.map((upsert) => upsert.decisionId)
        ]
      : [];
    const unknownPatchDecisionIds = [...new Set(patchDecisionIds)].filter(
      (decisionId) => !decisionIds.has(decisionId)
    );
    if (unknownPatchDecisionIds.length > 0) {
      db.exec("ROLLBACK");
      return {
        ok: false,
        reason: "unknown_draft_patch_decision",
        details: { decisionIds: unknownPatchDecisionIds }
      };
    }
    const unresolvedStaleDecisionIds = storedDecisions.filter((decision) =>
      decision.sourceRefs.some((source) =>
        currentSources.get(source.sourceId)?.digest !== source.digest &&
        latestSourceSectionOnDb(
          db,
          input.alignmentAttemptId,
          source.sourceId
        ) === input.section
      )
    ).map((decision) => decision.decisionId);
    if (unresolvedStaleDecisionIds.length > 0) {
      db.exec("ROLLBACK");
      return {
        ok: false,
        reason: "unresolved_stale_plan_decision",
        details: { decisionIds: unresolvedStaleDecisionIds }
      };
    }
    const sectionDigests = existing
      ? JSON.parse(existing.section_digests_json) as Partial<Record<AlignmentSection, string>>
      : {};
    sectionDigests[input.section] = input.sectionDigest;
    const now = new Date().toISOString();
    const planVersion = (existing?.plan_version ?? 0) + 1;
    const processedRevision = Math.max(
      existing?.processed_revision ?? 0,
      input.baseRevision
    );
    const existingDraft = existing
      ? parseStoredDraft(existing.design_system_json)
      : null;
    const storedDraft = input.draftPatch
      ? materializeDraftPatch(existingDraft, input.draftPatch, retireDecisionIds)
      : {
          __ikranIncrementalPlan: 1 as const,
          draft: input.designSystemDraft,
          bindings: input.draftBindings ?? existingDraft?.bindings ?? []
        };
    db.prepare(
      `INSERT INTO alignment_incremental_plans
         (alignment_attempt_id, plan_version, processed_revision,
          section_digests_json, decisions_json, design_system_json,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(alignment_attempt_id) DO UPDATE SET
         plan_version = excluded.plan_version,
         processed_revision = excluded.processed_revision,
         section_digests_json = excluded.section_digests_json,
         decisions_json = excluded.decisions_json,
         design_system_json = excluded.design_system_json,
         updated_at = excluded.updated_at`
    ).run(
      input.alignmentAttemptId,
      planVersion,
      processedRevision,
      JSON.stringify(sectionDigests),
      JSON.stringify(storedDecisions),
      JSON.stringify(storedDraft satisfies StoredDraftEnvelope),
      now,
      now
    );
    const sectionCursors = sectionCursorsOnDb(db, input.alignmentAttemptId);
    sectionCursors[input.section] = input.baseRevision;
    const response = {
      planVersion,
      processedRevision,
      section: input.section,
      acknowledgedRevision: input.baseRevision,
      sectionCursors,
      acknowledgedSections: SECTION_ORDER.filter((section) => sectionDigests[section]),
      decisions: input.decisions
    };
    db.prepare(
      `INSERT INTO alignment_incremental_plan_requests
         (alignment_attempt_id, idempotency_key, input_digest, response_json, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      input.alignmentAttemptId,
      input.idempotencyKey,
      requestDigest,
      JSON.stringify(response),
      now
    );
    db.exec("COMMIT");
    return { ok: true, reused: false, ...response };
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Transaction may already be closed by the failure path.
    }
    return {
      ok: false,
      reason: "db_error",
      details: { message: error instanceof Error ? error.message : String(error) }
    };
  } finally {
    closeProjectDb(db);
  }
}

export function readIncrementalPlanningStatus(
  projectPath: string,
  alignmentAttemptId: string
):
  | {
      ok: true;
      alignmentAttemptId: string;
      currentRevision: number;
      processedRevision: number;
      frozenRevision: number | null;
      planVersion: number;
      status: "active" | "paused" | "completed";
      sectionCursors: Partial<Record<AlignmentSection, number>>;
      acknowledgedSections: AlignmentSection[];
      remainingReadySections: AlignmentSection[];
      staleDecisionIds: string[];
      validDecisionIds: string[];
      decisions: StoredPlanDecision[];
      designSystemDraft: unknown;
      draftBindings: IncrementalPlanDraftBinding[];
      unboundDraftPaths: string[];
      invalidDraftBindingPaths: string[];
      unboundDraftSourceIds: string[];
      unaccountedDraftSourceIds: string[];
      invalidSemanticDraft: Array<{ path: string; message: string }>;
      draftInventory: {
        hasName: boolean;
        visualLanguageDecisionId?: string;
        entries: Array<{
          target: IncrementalPlanDraftCollectionTarget;
          entryKey: string;
          decisionId: string;
        }>;
      };
      nextAction: {
        tool: string;
        reconciliation?: {
          baseRevision: number;
          section: AlignmentSection;
          sectionDigest: string;
        };
      };
    }
  | { ok: false; reason: string } {
  const db = openProjectDb(projectPath);
  try {
    const state = stateOnDb(db, alignmentAttemptId);
    if (!state) return { ok: false, reason: "planning_not_initialized" };
    const plan = planOnDb(db, alignmentAttemptId);
    const decisions = plan
      ? JSON.parse(plan.decisions_json) as StoredPlanDecision[]
      : [];
    const sectionDigests = plan
      ? JSON.parse(plan.section_digests_json) as Partial<Record<AlignmentSection, string>>
      : {};
    const sectionCursors = plan
      ? sectionCursorsOnDb(db, alignmentAttemptId)
      : {};
    const currentSources = currentSourcesByIdOnDb(db, alignmentAttemptId);
    const staleDecisionIds = decisions.filter((decision) =>
      decision.sourceRefs.some((source) =>
        currentSources.get(source.sourceId)?.digest !== source.digest
      )
    ).map((decision) => decision.decisionId);
    const stale = new Set(staleDecisionIds);
    const remainingReadySections = SECTION_ORDER.filter((section) =>
      sectionIsReadyOnDb(db, alignmentAttemptId, section) &&
      sectionDigests[section] !== currentSectionDigestOnDb(
        db,
        alignmentAttemptId,
        section
      )
    );
    const storedDraft = plan
      ? parseStoredDraft(plan.design_system_json)
      : { __ikranIncrementalPlan: 1 as const, draft: {}, bindings: [] };
    const dependencyState = draftDependencyState(
      storedDraft.draft,
      storedDraft.bindings,
      decisions,
      currentSources
    );
    const allSectionsAcknowledged = SECTION_ORDER.every((section) =>
      sectionDigests[section] === currentSectionDigestOnDb(
        db,
        alignmentAttemptId,
        section
      )
    );
    const invalidSemanticDraft = allSectionsAcknowledged
      ? semanticDraftValidationIssues(storedDraft.draft)
      : [];
    const hasDraftDependencyGap =
      dependencyState.unboundDraftPaths.length > 0 ||
      dependencyState.invalidDraftBindingPaths.length > 0 ||
      dependencyState.unaccountedDraftSourceIds.length > 0 ||
      invalidSemanticDraft.length > 0;
    const needsFrozenDraftReconciliation = state.frozen_revision !== null &&
      allSectionsAcknowledged && hasDraftDependencyGap;
    const nextTool = remainingReadySections.length > 0 ||
      staleDecisionIds.length > 0 || needsFrozenDraftReconciliation
      ? "record_incremental_initial_design_system_plan"
      : state.frozen_revision !== null && allSectionsAcknowledged
        ? "commit_incremental_initial_design_system_plan"
        : "resume_initial_design_system_planning";
    const reconciliationSection = needsFrozenDraftReconciliation
      ? SECTION_ORDER.find((section) =>
          sectionIsReadyOnDb(db, alignmentAttemptId, section)
        )
      : undefined;
    return {
      ok: true,
      alignmentAttemptId,
      currentRevision: state.current_revision,
      processedRevision: plan?.processed_revision ?? 0,
      frozenRevision: state.frozen_revision,
      planVersion: plan?.plan_version ?? 0,
      status: state.monitoring_status,
      sectionCursors,
      remainingReadySections,
      acknowledgedSections: SECTION_ORDER.filter((section) =>
        sectionDigests[section] === currentSectionDigestOnDb(
          db,
          alignmentAttemptId,
          section
        )
      ),
      staleDecisionIds,
      validDecisionIds: decisions
        .filter((decision) => !stale.has(decision.decisionId))
        .map((decision) => decision.decisionId),
      decisions,
      designSystemDraft: storedDraft.draft,
      draftBindings: storedDraft.bindings,
      ...dependencyState,
      invalidSemanticDraft,
      draftInventory: {
        hasName: Boolean(
          storedDraft.draft && typeof storedDraft.draft === "object" &&
          !Array.isArray(storedDraft.draft) &&
          typeof (storedDraft.draft as Record<string, unknown>).name === "string"
        ),
        ...(storedDraft.visualLanguageDecisionId
          ? { visualLanguageDecisionId: storedDraft.visualLanguageDecisionId }
          : {}),
        entries: DRAFT_COLLECTION_TARGETS.flatMap((target) =>
          (storedDraft.entries?.[target] ?? []).map((entry) => ({
            target,
            ...entry
          }))
        )
      },
      nextAction: {
        tool: nextTool,
        ...(reconciliationSection
          ? {
              reconciliation: {
                baseRevision: state.current_revision,
                section: reconciliationSection,
                sectionDigest: currentSectionDigestOnDb(
                  db,
                  alignmentAttemptId,
                  reconciliationSection
                )
              }
            }
          : {})
      }
    };
  } catch {
    return { ok: false, reason: "db_error" };
  } finally {
    closeProjectDb(db);
  }
}

export function readCurrentIncrementalPlanningStatus(projectPath: string) {
  const db = openProjectDb(projectPath);
  let alignmentAttemptId: string | null = null;
  let preparationCommandStatus: string | null = null;
  try {
    const workflow = db.prepare(
      `SELECT w.current_alignment_attempt_id,
              (SELECT status
               FROM agent_commands c
               WHERE c.command_type = 'prepare_initial_design_system'
                 AND c.alignment_attempt_id = w.current_alignment_attempt_id
               ORDER BY c.created_at DESC, c.id DESC
               LIMIT 1) AS preparation_command_status
       FROM project_workflow w WHERE w.singleton = 1`
    ).get() as {
      current_alignment_attempt_id: string | null;
      preparation_command_status: string | null;
    } | undefined;
    alignmentAttemptId = workflow?.current_alignment_attempt_id ?? null;
    preparationCommandStatus = workflow?.preparation_command_status ?? null;
  } finally {
    closeProjectDb(db);
  }
  if (preparationCommandStatus === "completed") {
    return { ok: false as const, reason: "planning_not_active" as const };
  }
  return alignmentAttemptId
    ? readIncrementalPlanningStatus(projectPath, alignmentAttemptId)
    : { ok: false as const, reason: "planning_not_initialized" as const };
}

export function claimIncrementalPlanCommitInput(
  projectPath: string,
  input: { alignmentAttemptId: string; planVersion: number }
):
  | {
      ok: true;
      frozenRevision: number;
      planVersion: number;
      designSystem: unknown;
    }
  | {
      ok: false;
      reason:
        | "incremental_plan_unavailable"
        | "incremental_plan_version_mismatch"
        | "alignment_not_completed"
        | "incremental_plan_stale"
        | "db_error";
      details?: unknown;
      fallback?: { tool: "claim_initial_design_system_preparation" };
      repair?: { tool: "resume_initial_design_system_planning" };
    } {
  const fallback = { tool: "claim_initial_design_system_preparation" } as const;
  const db = openProjectDb(projectPath);
  try {
    const state = stateOnDb(db, input.alignmentAttemptId);
    if (!state || state.frozen_revision === null) {
      return { ok: false, reason: "alignment_not_completed" };
    }
    const plan = planOnDb(db, input.alignmentAttemptId);
    if (!plan) {
      return { ok: false, reason: "incremental_plan_unavailable", fallback };
    }
    if (plan.plan_version !== input.planVersion) {
      return {
        ok: false,
        reason: "incremental_plan_version_mismatch",
        details: { expected: plan.plan_version, received: input.planVersion }
      };
    }
    const sectionDigests = JSON.parse(
      plan.section_digests_json
    ) as Partial<Record<AlignmentSection, string>>;
    const staleSections = SECTION_ORDER.filter((section) =>
      sectionDigests[section] !== currentSectionDigestOnDb(
        db,
        input.alignmentAttemptId,
        section
      )
    );
    const currentSources = currentSourcesByIdOnDb(db, input.alignmentAttemptId);
    const decisions = JSON.parse(plan.decisions_json) as StoredPlanDecision[];
    const staleDecisionIds = decisions.filter((decision) =>
      decision.sourceRefs.some((source) =>
        currentSources.get(source.sourceId)?.digest !== source.digest
      )
    ).map((decision) => decision.decisionId);
    const storedDraft = parseStoredDraft(plan.design_system_json);
    const dependencyState = draftDependencyState(
      storedDraft.draft,
      storedDraft.bindings,
      decisions,
      currentSources
    );
    const invalidSemanticDraft = semanticDraftValidationIssues(storedDraft.draft);
    if (
      staleSections.length > 0 ||
      staleDecisionIds.length > 0 ||
      dependencyState.unboundDraftPaths.length > 0 ||
      dependencyState.invalidDraftBindingPaths.length > 0 ||
      dependencyState.unaccountedDraftSourceIds.length > 0 ||
      invalidSemanticDraft.length > 0
    ) {
      return {
        ok: false,
        reason: "incremental_plan_stale",
        details: {
          staleSections,
          staleDecisionIds,
          ...dependencyState,
          invalidSemanticDraft
        },
        repair: { tool: "resume_initial_design_system_planning" }
      };
    }
    return {
      ok: true,
      frozenRevision: state.frozen_revision,
      planVersion: plan.plan_version,
      designSystem: storedDraft.draft
    };
  } catch {
    return { ok: false, reason: "db_error" };
  } finally {
    closeProjectDb(db);
  }
}

function setMonitoringStatus(
  projectPath: string,
  alignmentAttemptId: string,
  status: "active" | "paused"
): void {
  const db = openProjectDb(projectPath);
  try {
    db.prepare(
      `UPDATE alignment_semantic_state
       SET monitoring_status = ?, updated_at = ?
       WHERE alignment_attempt_id = ? AND frozen_revision IS NULL`
    ).run(status, new Date().toISOString(), alignmentAttemptId);
  } finally {
    closeProjectDb(db);
  }
}

export type WaitForAlignmentSemanticDeltaResult =
  | {
      ok: true;
      reason: "delta_available";
      currentRevision: number;
      planVersion: number;
      frozenRevision: number | null;
      delta: AlignmentSemanticDelta;
    }
  | {
      ok: true;
      reason: "alignment_completed" | "idle_no_delta" | "page_closed_no_delta" | "cancelled";
      currentRevision: number;
      planVersion: number;
      frozenRevision: number | null;
      delta: null;
    }
  | { ok: false; reason: string; delta: null };

export async function waitForAlignmentSemanticDelta(
  projectPath: string,
  options: {
    alignmentAttemptId: string;
    afterRevision?: number;
    signal?: AbortSignal;
    windowMs?: number;
    recheckMs?: number;
    now?: () => number;
  }
): Promise<WaitForAlignmentSemanticDeltaResult> {
  const read = () => readAlignmentSemanticDelta(projectPath, {
    alignmentAttemptId: options.alignmentAttemptId,
    afterRevision: options.afterRevision
  });
  const initial = read();
  if (!initial.ok) return { ...initial, delta: null };
  if (initial.delta) {
    return {
      ok: true,
      reason: "delta_available",
      currentRevision: initial.currentRevision,
      planVersion: initial.planVersion,
      frozenRevision: initial.frozenRevision,
      delta: initial.delta
    };
  }
  if (initial.frozenRevision !== null) {
    return {
      ok: true,
      reason: "alignment_completed",
      currentRevision: initial.currentRevision,
      planVersion: initial.planVersion,
      frozenRevision: initial.frozenRevision,
      delta: null
    };
  }
  const now = options.now ?? Date.now;
  const windowMs = options.windowMs ?? 3 * 60 * 1000;
  const recheckMs = Math.max(10, options.recheckMs ?? 500);
  if (windowMs <= 0) {
    return {
      ok: true,
      reason: "idle_no_delta",
      currentRevision: initial.currentRevision,
      planVersion: initial.planVersion,
      frozenRevision: null,
      delta: null
    };
  }
  setMonitoringStatus(projectPath, options.alignmentAttemptId, "active");
  let lease: WaitLease = {
    deadlineMs: now() + windowMs,
    closed: false
  };

  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const pause = () => {
      try {
        setMonitoringStatus(projectPath, options.alignmentAttemptId, "paused");
      } catch {
        // A deleted/unavailable project cannot make the already-chosen wait
        // result less truthful.
      }
    };
    const finish = (result: WaitForAlignmentSemanticDeltaResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      unsubscribePresence();
      unsubscribeRecords();
      options.signal?.removeEventListener("abort", onAbort);
      if (result.reason !== "alignment_completed") pause();
      resolve(result);
    };
    const check = (): boolean => {
      const current = read();
      if (!current.ok) {
        finish({ ...current, delta: null });
        return true;
      }
      if (current.delta) {
        finish({
          ok: true,
          reason: "delta_available",
          currentRevision: current.currentRevision,
          planVersion: current.planVersion,
          frozenRevision: current.frozenRevision,
          delta: current.delta
        });
        return true;
      }
      if (current.frozenRevision !== null) {
        finish({
          ok: true,
          reason: "alignment_completed",
          currentRevision: current.currentRevision,
          planVersion: current.planVersion,
          frozenRevision: current.frozenRevision,
          delta: null
        });
        return true;
      }
      return false;
    };
    const schedule = () => {
      if (settled) return;
      if (timer) clearTimeout(timer);
      if (check()) return;
      const decision = waitLeaseDecision(lease, now());
      if (decision.done) {
        const current = read();
        if (!current.ok) finish({ ...current, delta: null });
        else if (current.delta) {
          finish({
            ok: true,
            reason: "delta_available",
            currentRevision: current.currentRevision,
            planVersion: current.planVersion,
            frozenRevision: current.frozenRevision,
            delta: current.delta
          });
        } else if (current.frozenRevision !== null) {
          finish({
            ok: true,
            reason: "alignment_completed",
            currentRevision: current.currentRevision,
            planVersion: current.planVersion,
            frozenRevision: current.frozenRevision,
            delta: null
          });
        }
        else {
          finish({
            ok: true,
            reason: decision.reason === "page_closed_no_command"
              ? "page_closed_no_delta"
              : "idle_no_delta",
            currentRevision: current.currentRevision,
            planVersion: current.planVersion,
            frozenRevision: current.frozenRevision,
            delta: null
          });
        }
        return;
      }
      timer = setTimeout(
        schedule,
        Math.max(1, Math.min(recheckMs, decision.remainingMs))
      );
    };
    const unsubscribePresence = subscribeWorkbenchPresence(
      projectPath,
      (presence) => {
        lease = applyPresenceToLease(lease, presence, now(), windowMs);
        schedule();
      }
    );
    const unsubscribeRecords = subscribeRecordEvents((event) => {
      if (path.resolve(event.projectPath) === path.resolve(projectPath)) {
        schedule();
      }
    });
    const onAbort = () => {
      const current = read();
      finish({
        ok: true,
        reason: "cancelled",
        currentRevision: current.ok ? current.currentRevision : initial.currentRevision,
        planVersion: current.ok ? current.planVersion : initial.planVersion,
        frozenRevision: current.ok ? current.frozenRevision : null,
        delta: null
      });
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    else schedule();
  });
}
