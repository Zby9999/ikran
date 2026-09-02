import { randomUUID } from "node:crypto";
import type { DatabaseSync as DatabaseType } from "node:sqlite";

import {
  activateRuleUpdateReviewWaitOnDb,
  publishAgentCommandOnDb,
  type DurableAgentCommand
} from "./agent-command";
import { withProjectTransaction, openProjectDb, closeProjectDb } from "./db";
import { buildLoggedEvent, insertEvent } from "./events";
import { specPathMatchesSourceArtifact } from "./design-system-spec-path";
import { validateDesignSystemJson } from "./design-system-schema";
import { canonicalizeArtifactPath } from "./source-artifact";
import { settleOrRewaitReviewOnDb } from "./rule-update-apply";
import {
  RULE_UPDATE_CLASSIFICATIONS,
  RULE_UPDATE_PROPOSAL_KINDS,
  type RuleUpdateClassification,
  type RuleUpdateProposalKind
} from "./rule-update-proposal";
import {
  isRuleUpdateCategory,
  ruleUpdateFoundationArtifact,
  type RuleUpdateCategory
} from "./rule-update-category";

export type RuleUpdateReviewStatus = "draft" | "published" | "completed";
export type RuleUpdateProposalReviewStatus =
  | "pending_review"
  | "waiting_agent"
  | "applied"
  | "rejected"
  | "failed"
  | "needs_revision";

export type RuleUpdateTarget = {
  category: RuleUpdateCategory;
  sourceCategory: RuleUpdateCategory | null;
  sourceArtifactPath: string | null;
  entryId: string | null;
  proposedTargetPath: string | null;
};

export type RuleUpdateProposalProjection = {
  id: string;
  review_id: string;
  kind: RuleUpdateProposalKind;
  classification: RuleUpdateClassification;
  title: string;
  change_description: string;
  full_rule_body: string;
  current_rule_body: string | null;
  reason: string;
  affected_items: string[];
  evidence_record_ids: string[];
  status: RuleUpdateProposalReviewStatus;
  target: RuleUpdateTarget;
  revision: number;
  base_digest: string | null;
  base_digests: Record<string, string>;
  revision_author: "agent" | "designer";
  created_at: string;
  revised_at: string;
  decided_at: string | null;
};

export type RuleUpdateReviewProjection = {
  id: string;
  reconciliation_id: string | null;
  status: RuleUpdateReviewStatus;
  context: string;
  created_at: string;
  published_at: string | null;
  completed_at: string | null;
  transcript: Array<{ id: string; role: "designer" | "agent"; content: string }>;
  run_id: string | null;
  session_id: string | null;
  interactions: Array<{
    id: string;
    kind: "proposal" | "revision" | "accepted" | "rejected" | "applied" | "failed";
    proposal_id: string;
    revision: number;
    title: string;
    description: string;
    created_at: string;
    target_category: RuleUpdateCategory;
    terminal: boolean;
  }>;
  proposals: RuleUpdateProposalProjection[];
};

type ReviewRow = Omit<
  RuleUpdateReviewProjection,
  "proposals" | "transcript" | "run_id" | "session_id" | "interactions"
>;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function isKind(value: string): value is RuleUpdateProposalKind {
  return (RULE_UPDATE_PROPOSAL_KINDS as readonly string[]).includes(value);
}

function isClassification(value: string): value is RuleUpdateClassification {
  return (RULE_UPDATE_CLASSIFICATIONS as readonly string[]).includes(value);
}

function reviewOnDb(db: DatabaseType, reviewId: string): ReviewRow | null {
  return (
    (db
      .prepare(
        `SELECT id, reconciliation_id, status, context, created_at,
                published_at, completed_at
         FROM rule_update_reviews WHERE id = ?`
      )
      .get(reviewId) as ReviewRow | undefined) ?? null
  );
}

export function createRuleUpdateReview(
  projectPath: string,
  input: { context: string; reconciliationId?: string }
): { ok: true; review: ReviewRow } | { ok: false; reason: string } {
  const context = text(input.context);
  const reconciliationId = text(input.reconciliationId) || null;
  if (!context) return { ok: false, reason: "review_context_required" };
  try {
    return withProjectTransaction(projectPath, (db) => {
      if (
        reconciliationId &&
        !db
          .prepare("SELECT 1 FROM conversation_reconciliations WHERE id = ?")
          .get(reconciliationId)
      ) {
        return { ok: false as const, reason: "reconciliation_not_found" };
      }
      if (
        reconciliationId &&
        !db
          .prepare(
            `SELECT 1 FROM events
             WHERE type = 'consolidate_review_started'
               AND json_extract(payload, '$.reconciliation_id') = ?
             LIMIT 1`
          )
          .get(reconciliationId)
      ) {
        return { ok: false as const, reason: "consolidate_review_not_claimed" };
      }
      const active = db
        .prepare(
          `SELECT id FROM rule_update_reviews
           WHERE status IN ('draft', 'published') AND context <> 'Legacy Rule Update'
           LIMIT 1`
        )
        .get();
      if (active) return { ok: false as const, reason: "review_already_active" };
      const now = new Date().toISOString();
      const review: ReviewRow = {
        id: randomUUID(),
        reconciliation_id: reconciliationId,
        status: "draft",
        context,
        created_at: now,
        published_at: null,
        completed_at: null
      };
      db.prepare(
        `INSERT INTO rule_update_reviews
           (id, reconciliation_id, status, context, created_at,
            published_at, completed_at)
         VALUES (?, ?, 'draft', ?, ?, NULL, NULL)`
      ).run(review.id, reconciliationId, context, now);
      insertEvent(
        db,
        buildLoggedEvent("rule_update_review_created", {
          review_id: review.id,
          reconciliation_id: reconciliationId,
          context
        })
      );
      return { ok: true as const, review };
    });
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

export type DraftRuleUpdateProposalInput = {
  reviewId: string;
  kind: string;
  classification: string;
  title: string;
  changeDescription?: string;
  fullRuleBody: string;
  reason: string;
  affectedItems: string[];
  evidenceRecordIds: string[];
  target: {
    category: string;
    sourceCategory?: string;
    sourceArtifactPath?: string;
    entryId?: string;
    proposedTargetPath?: string;
  };
};

type RevisionInput = {
  title: string;
  changeDescription?: string;
  fullRuleBody: string;
  author?: "agent" | "designer";
  target: {
    category: string;
    sourceCategory?: string;
    sourceArtifactPath?: string;
    entryId?: string;
    proposedTargetPath?: string;
  };
};

function validateRuleUpdateProposalBody(
  target: RuleUpdateTarget,
  fullRuleBody: string
):
  | { ok: true }
  | {
      ok: false;
      reason: "invalid_proposal_body";
      details: {
        target_category: RuleUpdateCategory;
        schema_reason: string;
        schema_details?: unknown;
      };
    } {
  if (!target.category.startsWith("component:")) return { ok: true };
  let parsed: unknown;
  try {
    parsed = JSON.parse(fullRuleBody) as unknown;
  } catch {
    return {
      ok: false,
      reason: "invalid_proposal_body",
      details: {
        target_category: target.category,
        schema_reason: "invalid_json"
      }
    };
  }
  const validation = validateDesignSystemJson("component-spec", parsed);
  if (validation.ok) return { ok: true };
  return {
    ok: false,
    reason: "invalid_proposal_body",
    details: {
      target_category: target.category,
      schema_reason: validation.reason,
      ...(validation.details === undefined
        ? {}
        : { schema_details: validation.details })
    }
  };
}

function canonicalSourceEvidenceOnDb(
  db: DatabaseType,
  evidenceRecordIds: readonly string[]
): string[] {
  const card = db.prepare(
    `SELECT 1 FROM alignment_question_cards
     WHERE id = ? AND final_answer IS NOT NULL AND TRIM(final_answer) <> ''`
  );
  const annotation = db.prepare(
    "SELECT 1 FROM agent_alignment_annotations WHERE id = ?"
  );
  const feedback = db.prepare("SELECT 1 FROM designer_feedback WHERE id = ?");
  return evidenceRecordIds.filter(
    (id) => card.get(id) || annotation.get(id) || feedback.get(id)
  );
}

function canonicalTarget(
  projectPath: string,
  target: RevisionInput["target"]
):
  | { ok: true; target: RuleUpdateTarget }
  | { ok: false; reason: "invalid_proposal_target" | "artifact_path_escape" } {
  const category = text(target?.category);
  if (!isRuleUpdateCategory(category)) {
    return { ok: false, reason: "invalid_proposal_target" };
  }
  const sourceCategoryValue = text(target.sourceCategory);
  if (sourceCategoryValue && !isRuleUpdateCategory(sourceCategoryValue)) {
    return { ok: false, reason: "invalid_proposal_target" };
  }
  const sourceCategory: RuleUpdateCategory | null = sourceCategoryValue
    ? (sourceCategoryValue as RuleUpdateCategory)
    : null;
  const canonical = (raw: unknown): string | null | undefined => {
    const value = text(raw);
    if (!value) return null;
    return canonicalizeArtifactPath(projectPath, value) ?? undefined;
  };
  const sourceArtifactPath = canonical(target.sourceArtifactPath);
  const proposedTargetPath = canonical(target.proposedTargetPath);
  if (sourceArtifactPath === undefined || proposedTargetPath === undefined) {
    return { ok: false, reason: "artifact_path_escape" };
  }
  const expectedPath = ruleUpdateFoundationArtifact(category);
  const destinationPath = proposedTargetPath ?? sourceArtifactPath;
  if (expectedPath && destinationPath !== expectedPath) {
    return { ok: false, reason: "invalid_proposal_target" };
  }
  return {
    ok: true,
    target: {
      category,
      sourceCategory,
      sourceArtifactPath,
      entryId: text(target.entryId) || null,
      proposedTargetPath
    }
  };
}

type ComponentIdentity = {
  inventoryId: string;
  specId: string | null;
  specPath: string;
};

type ComponentTargetFailure = {
  ok: false;
  reason: "component_target_not_browsable";
  details: {
    received_id: string;
    valid_component_ids: string[];
  };
};

function componentIdentitiesOnDb(db: DatabaseType): ComponentIdentity[] {
  const inventoryRows = db
    .prepare(
      `SELECT entry_id, value_json
       FROM design_system_entries
       WHERE section = 'components.inventory'
       ORDER BY position, entry_id`
    )
    .all() as Array<{ entry_id: string; value_json: string }>;
  const specRows = db
    .prepare(
      `SELECT entry_id, source_artifact_path
       FROM design_system_entries
       WHERE section = 'components.spec'`
    )
    .all() as Array<{ entry_id: string; source_artifact_path: string }>;
  return inventoryRows.flatMap((row) => {
    try {
      const value = JSON.parse(row.value_json) as { specPath?: unknown };
      if (typeof value.specPath !== "string" || !value.specPath.trim()) return [];
      const spec = specRows.find((candidate) =>
        specPathMatchesSourceArtifact(value.specPath as string, candidate.source_artifact_path)
      );
      return [{
        inventoryId: row.entry_id,
        specId: spec?.entry_id ?? null,
        specPath: spec?.source_artifact_path ?? value.specPath
      }];
    } catch {
      return [];
    }
  });
}

function resolveComponentIdentityOnDb(
  db: DatabaseType,
  componentId: string,
  artifactPath: string | null
): ComponentIdentity | null {
  const matches = componentIdentitiesOnDb(db).filter((identity) =>
    (identity.inventoryId === componentId || identity.specId === componentId) &&
    (artifactPath === null ||
      specPathMatchesSourceArtifact(identity.specPath, artifactPath))
  );
  return matches.length === 1 ? matches[0]! : null;
}

function canonicalizeTargetOnDb(
  db: DatabaseType,
  target: RuleUpdateTarget
): { ok: true; target: RuleUpdateTarget } | ComponentTargetFailure {
  const validIds = () => componentIdentitiesOnDb(db).map((item) => item.inventoryId);
  const canonicalizeCategory = (
    category: RuleUpdateCategory,
    artifactPath: string | null
  ): { category: RuleUpdateCategory; identity: ComponentIdentity | null } | ComponentTargetFailure => {
    if (!category.startsWith("component:")) {
      return { category, identity: null };
    }
    const receivedId = category.slice("component:".length);
    const identity = resolveComponentIdentityOnDb(db, receivedId, artifactPath);
    if (!identity) {
      return {
        ok: false,
        reason: "component_target_not_browsable",
        details: {
          received_id: receivedId,
          valid_component_ids: validIds()
        }
      };
    }
    return {
      category: `component:${identity.inventoryId}`,
      identity
    };
  };

  const destinationPath = target.proposedTargetPath ?? target.sourceArtifactPath;
  const destination = canonicalizeCategory(target.category, destinationPath);
  if ("ok" in destination) return destination;
  const source = target.sourceCategory
    ? canonicalizeCategory(target.sourceCategory, target.sourceArtifactPath)
    : null;
  if (source && "ok" in source) return source;
  const identities = [destination.identity, source?.identity ?? null].filter(
    (value): value is ComponentIdentity => value !== null
  );
  const entryId = target.entryId && identities.some(
    (identity) =>
      target.entryId === identity.inventoryId || target.entryId === identity.specId
  )
    ? identities.find(
        (identity) =>
          target.entryId === identity.inventoryId || target.entryId === identity.specId
      )!.inventoryId
    : target.entryId;
  return {
    ok: true,
    target: {
      ...target,
      category: destination.category,
      sourceCategory: source?.category ?? null,
      entryId
    }
  };
}

function baseDigestOnDb(db: DatabaseType, target: RuleUpdateTarget): string | null {
  const targetPath = target.proposedTargetPath ?? target.sourceArtifactPath;
  if (!targetPath) return null;
  const row = db
    .prepare("SELECT content_digest FROM source_artifacts WHERE path = ?")
    .get(targetPath) as { content_digest: string | null } | undefined;
  return row ? row.content_digest ?? "missing-digest" : "missing-source";
}

function categoryMatchesArtifactOnDb(
  db: DatabaseType,
  category: RuleUpdateCategory,
  artifactPath: string
): boolean {
  const foundationPath = ruleUpdateFoundationArtifact(category);
  if (foundationPath !== null) return artifactPath === foundationPath;
  const componentId = category.slice("component:".length);
  return resolveComponentIdentityOnDb(db, componentId, artifactPath) !== null;
}

function targetMatchesCategoriesOnDb(
  db: DatabaseType,
  target: RuleUpdateTarget
): boolean {
  const destination = target.proposedTargetPath ?? target.sourceArtifactPath;
  if (
    destination !== null &&
    !categoryMatchesArtifactOnDb(db, target.category, destination)
  ) {
    return false;
  }
  if (target.sourceCategory !== null) {
    return (
      target.sourceArtifactPath !== null &&
      categoryMatchesArtifactOnDb(
        db,
        target.sourceCategory,
        target.sourceArtifactPath
      )
    );
  }
  return true;
}

function isRetirableRuleTargetOnDb(
  db: DatabaseType,
  target: RuleUpdateTarget
): boolean {
  if (!target.sourceArtifactPath || !target.entryId) return false;
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM design_system_entries
         WHERE source_artifact_path = ? AND entry_id = ?
           AND section IN (
             'foundations.visual-language', 'foundations.concepts',
             'layout', 'interaction'
           )`
      )
      .get(target.sourceArtifactPath, target.entryId)
  );
}

function baseDigestsOnDb(
  db: DatabaseType,
  target: RuleUpdateTarget
): Record<string, string> {
  const paths = [...new Set(
    [target.sourceArtifactPath, target.proposedTargetPath]
      .filter((value): value is string => value !== null)
  )];
  const digests: Record<string, string> = {};
  for (const artifactPath of paths) {
    const row = db
      .prepare("SELECT content_digest FROM source_artifacts WHERE path = ?")
      .get(artifactPath) as { content_digest: string | null } | undefined;
    digests[artifactPath] = row
      ? row.content_digest ?? "missing-digest"
      : "missing-source";
  }
  return digests;
}

export function draftRuleUpdateProposal(
  projectPath: string,
  input: DraftRuleUpdateProposalInput
):
  | { ok: true; proposal: RuleUpdateProposalProjection }
  | { ok: false; reason: string; details?: unknown } {
  const reviewId = text(input.reviewId);
  const kind = text(input.kind);
  const classification = text(input.classification);
  const title = text(input.title);
  const changeDescription = text(input.changeDescription) || text(input.fullRuleBody);
  const fullRuleBody = text(input.fullRuleBody);
  const reason = text(input.reason);
  const affectedItems = (input.affectedItems ?? []).map(text).filter(Boolean);
  const evidenceRecordIds = (input.evidenceRecordIds ?? [])
    .map(text)
    .filter(Boolean);
  if (
    !reviewId ||
    !isKind(kind) ||
    !isClassification(classification) ||
    !title ||
    (kind !== "retire" && !fullRuleBody) ||
    !reason
  ) {
    return { ok: false, reason: "invalid_proposal" };
  }
  const rawTargetResult = canonicalTarget(projectPath, input.target);
  if (!rawTargetResult.ok) return rawTargetResult;
  try {
    return withProjectTransaction(projectPath, (db) => {
      const canonicalized = canonicalizeTargetOnDb(db, rawTargetResult.target);
      if (!canonicalized.ok) return canonicalized;
      const target = canonicalized.target;
      if (
        kind === "move" &&
        (!target.sourceCategory ||
          !target.sourceArtifactPath ||
          !target.proposedTargetPath ||
          !target.entryId)
      ) {
        return { ok: false as const, reason: "invalid_proposal_target" };
      }
      if (
        kind === "retire" &&
        (!target.sourceArtifactPath ||
          !target.entryId ||
          target.sourceCategory ||
          target.proposedTargetPath)
      ) {
        return { ok: false as const, reason: "invalid_proposal_target" };
      }
      const review = reviewOnDb(db, reviewId);
      if (!review) return { ok: false as const, reason: "review_not_found" };
      if (review.status !== "draft") {
        return { ok: false as const, reason: "review_not_draft" };
      }
      if (!targetMatchesCategoriesOnDb(db, target)) {
        return { ok: false as const, reason: "invalid_proposal_target" };
      }
      if (
        kind === "retire" &&
        !isRetirableRuleTargetOnDb(db, target)
      ) {
        return { ok: false as const, reason: "rule_entry_not_found" };
      }
      if (kind !== "retire") {
        const bodyValidation = validateRuleUpdateProposalBody(
          target,
          fullRuleBody
        );
        if (!bodyValidation.ok) return bodyValidation;
      }
      const evidenceTables = [
        "alignment_question_cards",
        "agent_alignment_annotations",
        "region_annotations",
        "figma_evidence_surfaces",
        "seed_references",
        "designer_feedback"
      ];
      for (const id of evidenceRecordIds) {
        if (
          !evidenceTables.some((table) =>
            db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id)
          )
        ) {
          return { ok: false as const, reason: "evidence_record_not_found" };
        }
      }
      const sourceEvidenceRecordIds = canonicalSourceEvidenceOnDb(
        db,
        evidenceRecordIds
      );
      if (
        review.reconciliation_id !== null &&
        kind !== "retire" &&
        sourceEvidenceRecordIds.length === 0
      ) {
        return {
          ok: false as const,
          reason: "proposal_source_evidence_required",
          details: {
            accepted_sources: [
              "answered_alignment_question",
              "agent_alignment_annotation",
              "designer_feedback"
            ]
          }
        };
      }
      const baseDigest = baseDigestOnDb(db, target);
      const baseDigests = baseDigestsOnDb(db, target);
      const now = new Date().toISOString();
      const proposalId = randomUUID();
      db.prepare(
        `INSERT INTO rule_update_proposals
           (id, kind, classification, title, change_description, reason,
            affected_items_json, evidence_record_ids_json, status,
            source_artifact_path, entry_id, proposed_target_path,
            created_at, decided_at, review_id, current_revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_confirmation',
                 ?, ?, ?, ?, NULL, ?, 1)`
      ).run(
        proposalId,
        kind,
        classification,
        title,
        changeDescription,
        reason,
        JSON.stringify(affectedItems),
        JSON.stringify(evidenceRecordIds),
        target.sourceArtifactPath,
        target.entryId,
        target.proposedTargetPath,
        now,
        reviewId
      );
      db.prepare(
        `INSERT INTO rule_update_proposal_revisions
           (proposal_id, revision, title, full_rule_body, target_category,
            source_category, source_artifact_path, entry_id,
            proposed_target_path, base_digest,
            base_digests_json, author, created_at)
         VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'agent', ?)`
      ).run(
        proposalId,
        title,
        fullRuleBody,
        target.category,
        target.sourceCategory,
        target.sourceArtifactPath,
        target.entryId,
        target.proposedTargetPath,
        baseDigest,
        JSON.stringify(baseDigests),
        now
      );
      insertEvent(
        db,
        buildLoggedEvent("rule_update_proposal_created", {
          review_id: reviewId,
          proposal_id: proposalId,
          revision: 1,
          kind,
          classification,
          title,
          change_description: changeDescription,
          full_rule_body: fullRuleBody,
          target_category: target.category,
          status: "pending_review"
        })
      );
      return {
        ok: true as const,
        proposal: proposalProjectionOnDb(db, proposalId)!
      };
    });
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

function proposalProjectionOnDb(
  db: DatabaseType,
  proposalId: string
): RuleUpdateProposalProjection | null {
  const row = db
    .prepare(
      `SELECT p.id, p.review_id, p.kind, p.classification, p.reason,
              p.change_description,
              p.affected_items_json, p.evidence_record_ids_json, p.created_at,
              p.decided_at, p.current_revision,
              r.title, r.full_rule_body, r.target_category,
              r.source_category, r.source_artifact_path, r.entry_id,
              r.proposed_target_path,
              r.base_digest, r.base_digests_json, r.author, r.created_at AS revised_at,
              d.decision, a.status AS apply_status,
              e.value_json AS current_value_json, e.meaning AS current_meaning
       FROM rule_update_proposals p
       JOIN rule_update_proposal_revisions r
         ON r.proposal_id = p.id AND r.revision = p.current_revision
       LEFT JOIN rule_update_designer_decisions d
         ON d.proposal_id = p.id AND d.revision = p.current_revision
       LEFT JOIN rule_update_apply_attempts a
         ON a.proposal_id = p.id AND a.revision = p.current_revision
       LEFT JOIN design_system_entries e
         ON e.source_artifact_path = r.source_artifact_path
        AND e.entry_id = r.entry_id
       WHERE p.id = ?
       ORDER BY a.created_at DESC LIMIT 1`
    )
    .get(proposalId) as
    | {
        id: string;
        review_id: string;
        kind: RuleUpdateProposalKind;
        classification: RuleUpdateClassification;
        change_description: string;
        reason: string;
        affected_items_json: string;
        evidence_record_ids_json: string;
        created_at: string;
        decided_at: string | null;
        current_revision: number;
        title: string;
        full_rule_body: string;
        target_category: RuleUpdateCategory;
        source_category: RuleUpdateCategory | null;
        source_artifact_path: string | null;
        entry_id: string | null;
        proposed_target_path: string | null;
        base_digest: string | null;
        base_digests_json: string;
        author: "agent" | "designer";
        revised_at: string;
        decision: "accepted" | "rejected" | null;
        apply_status: "pending" | "claimed" | "applied" | "failed" | "needs_revision" | null;
        current_value_json: string | null;
        current_meaning: string | null;
      }
    | undefined;
  if (!row) return null;
  let currentRuleBody: string | null = null;
  if (row.current_value_json !== null) {
    try {
      const value = JSON.parse(row.current_value_json) as unknown;
      currentRuleBody = typeof value === "string"
        ? value
        : value && typeof value === "object" && typeof (value as { description?: unknown }).description === "string"
          ? String((value as { description: string }).description)
          : JSON.stringify(value);
    } catch {
      currentRuleBody = row.current_meaning;
    }
  }
  let status: RuleUpdateProposalReviewStatus = "pending_review";
  if (row.decision === "rejected") status = "rejected";
  else if (row.apply_status === "applied") status = "applied";
  else if (row.apply_status === "failed") status = "failed";
  else if (row.apply_status === "needs_revision") status = "needs_revision";
  else if (row.decision === "accepted") status = "waiting_agent";
  const rawTarget: RuleUpdateTarget = {
    category: row.target_category,
    sourceCategory: row.source_category,
    sourceArtifactPath: row.source_artifact_path,
    entryId: row.entry_id,
    proposedTargetPath: row.proposed_target_path
  };
  const canonicalizedTarget = canonicalizeTargetOnDb(db, rawTarget);
  return {
    id: row.id,
    review_id: row.review_id,
    kind: row.kind,
    classification: row.classification,
    title: row.title,
    change_description: row.change_description,
    full_rule_body: row.full_rule_body,
    current_rule_body: currentRuleBody,
    reason: row.reason,
    affected_items: stringArray(row.affected_items_json),
    evidence_record_ids: stringArray(row.evidence_record_ids_json),
    status,
    target: canonicalizedTarget.ok ? canonicalizedTarget.target : rawTarget,
    revision: row.current_revision,
    base_digest: row.apply_status === "needs_revision" ? null : row.base_digest,
    base_digests: row.apply_status === "needs_revision"
      ? {}
      : (() => {
          try {
            return JSON.parse(row.base_digests_json) as Record<string, string>;
          } catch {
            return {};
          }
        })(),
    revision_author: row.author,
    created_at: row.created_at,
    revised_at: row.revised_at,
    decided_at: row.decided_at
  };
}

export function reviseRuleUpdateProposal(
  projectPath: string,
  input: RevisionInput & { proposalId: string }
):
  | { ok: true; proposal: RuleUpdateProposalProjection }
  | { ok: false; reason: string; details?: unknown } {
  const proposalId = text(input.proposalId);
  const title = text(input.title);
  const fullRuleBody = text(input.fullRuleBody);
  const author = input.author ?? "designer";
  if (!proposalId || !title) {
    return { ok: false, reason: "invalid_revision" };
  }
  if (author !== "agent" && author !== "designer") {
    return { ok: false, reason: "invalid_revision_author" };
  }
  const rawTargetResult = canonicalTarget(projectPath, input.target);
  if (!rawTargetResult.ok) return rawTargetResult;
  try {
    return withProjectTransaction(projectPath, (db) => {
      const canonicalized = canonicalizeTargetOnDb(db, rawTargetResult.target);
      if (!canonicalized.ok) return canonicalized;
      const target = canonicalized.target;
      const current = proposalProjectionOnDb(db, proposalId);
      if (!current) return { ok: false as const, reason: "proposal_not_found" };
      if (current.kind !== "retire" && !fullRuleBody) {
        return { ok: false as const, reason: "invalid_revision" };
      }
      if (
        current.kind === "retire" &&
        (!target.sourceArtifactPath ||
          !target.entryId ||
          target.sourceCategory ||
          target.proposedTargetPath)
      ) {
        return { ok: false as const, reason: "invalid_proposal_target" };
      }
      const review = reviewOnDb(db, current.review_id);
      if (review?.context === "Legacy Rule Update") {
        return { ok: false as const, reason: "proposal_not_managed" };
      }
      if (!review || review.status !== "published") {
        return { ok: false as const, reason: "review_not_published" };
      }
      const agentRecovery =
        author === "agent" &&
        (current.status === "failed" || current.status === "needs_revision");
      const designerEdit =
        author === "designer" &&
        (current.status === "pending_review" || current.status === "needs_revision");
      if (!agentRecovery && !designerEdit) {
        return { ok: false as const, reason: "proposal_not_editable" };
      }
      if (!targetMatchesCategoriesOnDb(db, target)) {
        return { ok: false as const, reason: "invalid_proposal_target" };
      }
      if (
        current.kind === "retire" &&
        !isRetirableRuleTargetOnDb(db, target)
      ) {
        return { ok: false as const, reason: "rule_entry_not_found" };
      }
      if (current.kind !== "retire") {
        const bodyValidation = validateRuleUpdateProposalBody(
          target,
          fullRuleBody
        );
        if (!bodyValidation.ok) return bodyValidation;
      }
      const previousNeedsRevision =
        current.status === "needs_revision" ||
        (author === "agent" && current.status === "failed");
      if (
        current.title === title &&
        current.full_rule_body === fullRuleBody &&
        JSON.stringify(current.target) === JSON.stringify(target)
      ) {
        return { ok: false as const, reason: "revision_unchanged" };
      }
      const revision = current.revision + 1;
      const now = new Date().toISOString();
      const baseDigest = baseDigestOnDb(db, target);
      const baseDigests = baseDigestsOnDb(db, target);
      db.prepare(
        `INSERT INTO rule_update_proposal_revisions
           (proposal_id, revision, title, full_rule_body, target_category,
            source_category, source_artifact_path, entry_id,
            proposed_target_path, base_digest,
            base_digests_json, author, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        proposalId,
        revision,
        title,
        fullRuleBody,
        target.category,
        target.sourceCategory,
        target.sourceArtifactPath,
        target.entryId,
        target.proposedTargetPath,
        baseDigest,
        JSON.stringify(baseDigests),
        author,
        now
      );
      if (previousNeedsRevision) {
        db.prepare(
          `UPDATE agent_commands
           SET status = 'cancelled', cancelled_at = ?, updated_at = ?
           WHERE id IN (
             SELECT command_id FROM rule_update_apply_attempts
             WHERE proposal_id = ? AND revision = ?
               AND status IN ('needs_revision', 'failed')
           )`
        ).run(now, now, proposalId, current.revision);
      }
      const nextChangeDescription =
        text(input.changeDescription) ||
        (author === "agent" ? current.change_description : fullRuleBody);
      db.prepare(
        `UPDATE rule_update_proposals
         SET title = ?, change_description = ?, source_artifact_path = ?,
             entry_id = ?, proposed_target_path = ?, current_revision = ?,
             status = 'awaiting_confirmation', decided_at = NULL
         WHERE id = ?`
      ).run(
        title,
        nextChangeDescription,
        target.sourceArtifactPath,
        target.entryId,
        target.proposedTargetPath,
        revision,
        proposalId
      );
      const wait = activateRuleUpdateReviewWaitOnDb(db, current.review_id, now);
      if (!wait.ok) return wait;
      insertEvent(
        db,
        buildLoggedEvent("rule_update_revision_created", {
          review_id: current.review_id,
          proposal_id: proposalId,
          revision,
          author,
          target_category: target.category
        })
      );
      return { ok: true as const, proposal: proposalProjectionOnDb(db, proposalId)! };
    });
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

export function decideRuleUpdateProposal(
  projectPath: string,
  input: { proposalId: string; decision: "accepted" | "rejected" }
):
  | {
      ok: true;
      reused: boolean;
      proposal: RuleUpdateProposalProjection;
      command: DurableAgentCommand;
    }
  | { ok: false; reason: string } {
  const proposalId = text(input.proposalId);
  if (!proposalId || !["accepted", "rejected"].includes(input.decision)) {
    return { ok: false, reason: "invalid_decision" };
  }
  try {
    return withProjectTransaction(projectPath, (db) => {
      const current = proposalProjectionOnDb(db, proposalId);
      if (!current) return { ok: false as const, reason: "proposal_not_found" };
      const review = reviewOnDb(db, current.review_id);
      if (review?.context === "Legacy Rule Update") {
        return { ok: false as const, reason: "proposal_not_managed" };
      }
      if (!review || review.status !== "published") {
        return { ok: false as const, reason: "review_not_published" };
      }
      const existing = db
        .prepare(
          `SELECT id, decision FROM rule_update_designer_decisions
           WHERE proposal_id = ? AND revision = ?`
        )
        .get(proposalId, current.revision) as
        | { id: string; decision: "accepted" | "rejected" }
        | undefined;
      if (existing && existing.decision !== input.decision) {
        return { ok: false as const, reason: "decision_conflict" };
      }
      const decidedAt = current.decided_at ?? new Date().toISOString();
      const payload = {
        review_id: current.review_id,
        proposal_id: proposalId,
        revision: current.revision,
        decision: input.decision,
        kind: current.kind,
        title: current.title,
        full_rule_body: current.full_rule_body,
        reason: current.reason,
        base_digest: current.base_digest,
        base_digests: current.base_digests,
        evidence_record_ids: current.evidence_record_ids,
        source_write_evidence_record_ids: canonicalSourceEvidenceOnDb(
          db,
          current.evidence_record_ids
        ),
        target: current.target
      };
      const published = publishAgentCommandOnDb(db, {
        commandType: "apply_rule_update_decision",
        scope: { kind: "rule_update_review", id: current.review_id },
        payload,
        idempotencyKey: `rule-update-decision:${proposalId}:revision-${current.revision}`
      }, decidedAt);
      if (!published.ok) return published;
      if (!existing) {
        db.prepare(
          `INSERT INTO rule_update_designer_decisions
             (id, review_id, proposal_id, revision, decision, decided_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(
          randomUUID(),
          current.review_id,
          proposalId,
          current.revision,
          input.decision,
          decidedAt
        );
        db.prepare(
          `UPDATE rule_update_proposals SET status = ?, decided_at = ? WHERE id = ?`
        ).run(
          input.decision === "accepted" ? "confirmed" : "canceled",
          decidedAt,
          proposalId
        );
        const isFeedback = db.prepare(
          "SELECT 1 FROM designer_feedback WHERE id = ?"
        );
        const consume = db.prepare(
          `INSERT OR IGNORE INTO designer_feedback_review_consumption
             (feedback_id, proposal_id, consumed_at) VALUES (?, ?, ?)`
        );
        for (const recordId of current.evidence_record_ids) {
          if (isFeedback.get(recordId)) {
            consume.run(recordId, proposalId, decidedAt);
          }
        }
        if (input.decision === "accepted") {
          db.prepare(
            `INSERT INTO rule_update_apply_attempts
               (id, command_id, review_id, proposal_id, revision, status,
                expected_base_digest, observed_digest, error, created_at,
                claimed_at, completed_at)
             VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL, NULL, ?, NULL, NULL)`
          ).run(
            randomUUID(),
            published.command.id,
            current.review_id,
            proposalId,
            current.revision,
            current.base_digest,
            decidedAt
          );
        }
        insertEvent(
          db,
          buildLoggedEvent("rule_update_decision_recorded", {
            review_id: current.review_id,
            proposal_id: proposalId,
            revision: current.revision,
            decision: input.decision,
            command_id: published.command.id,
            decided_at: decidedAt
          })
        );
      }
      return {
        ok: true as const,
        reused: existing !== undefined,
        proposal: proposalProjectionOnDb(db, proposalId)!,
        command: published.command
      };
    });
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

type CommandRow = {
  id: string;
  command_type: string;
  status: "pending" | "claimed" | "completed" | "cancelled" | "failed";
  scope_kind: "rule_update_review";
  scope_id: string;
  alignment_attempt_id: null;
  payload_json: string;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
  claimed_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
};

function commandFromRow(row: CommandRow): DurableAgentCommand {
  return {
    id: row.id,
    command_type: row.command_type,
    status: row.status,
    scope: { kind: row.scope_kind, id: row.scope_id },
    alignment_attempt_id: null,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    idempotency_key: row.idempotency_key,
    created_at: row.created_at,
    updated_at: row.updated_at,
    claimed_at: row.claimed_at,
    completed_at: row.completed_at,
    cancelled_at: row.cancelled_at
  };
}

function observedArtifactDigestsOnDb(
  db: DatabaseType,
  proposal: RuleUpdateProposalProjection
): Record<string, string> {
  const observed: Record<string, string> = {};
  for (const artifactPath of Object.keys(proposal.base_digests)) {
    const row = db
      .prepare("SELECT content_digest FROM source_artifacts WHERE path = ?")
      .get(artifactPath) as { content_digest: string | null } | undefined;
    observed[artifactPath] = row
      ? row.content_digest ?? "missing-digest"
      : "missing-source";
  }
  return observed;
}

function observedDigestCameFromEarlierApplyOnDb(
  db: DatabaseType,
  row: CommandRow,
  artifactPath: string,
  observedDigest: string
): boolean {
  const events = db
    .prepare(
      `SELECT e.payload
       FROM events e
       JOIN agent_commands c
         ON c.id = json_extract(e.payload, '$.command_id')
       WHERE e.type = 'rule_update_applied'
         AND json_extract(e.payload, '$.review_id') = ?
         AND (c.created_at < ? OR (c.created_at = ? AND c.id < ?))
       ORDER BY e.id DESC`
    )
    .all(row.scope_id, row.created_at, row.created_at, row.id) as Array<{
    payload: string;
  }>;
  for (const event of events) {
    try {
      const payload = JSON.parse(event.payload) as {
        artifact_path?: unknown;
        observed_digest?: unknown;
        observed_digests?: unknown;
      };
      const digests =
        payload.observed_digests && typeof payload.observed_digests === "object"
          ? (payload.observed_digests as Record<string, unknown>)
          : {};
      if (digests[artifactPath] === observedDigest) return true;
      if (
        payload.artifact_path === artifactPath &&
        payload.observed_digest === observedDigest
      ) {
        return true;
      }
    } catch {
      // Ignore malformed legacy event payloads; they cannot authorize rebase.
    }
  }
  return false;
}

function proposalAtClaimedDigestsOnDb(
  db: DatabaseType,
  proposal: RuleUpdateProposalProjection,
  commandId: string
): RuleUpdateProposalProjection {
  const row = db
    .prepare(
      `SELECT claimed_base_digests_json FROM rule_update_apply_attempts
       WHERE command_id = ?`
    )
    .get(commandId) as { claimed_base_digests_json: string | null } | undefined;
  if (!row?.claimed_base_digests_json) return proposal;
  try {
    const baseDigests = JSON.parse(row.claimed_base_digests_json) as Record<
      string,
      string
    >;
    const primaryPath =
      proposal.target.proposedTargetPath ?? proposal.target.sourceArtifactPath;
    return {
      ...proposal,
      base_digest: primaryPath ? baseDigests[primaryPath] ?? null : null,
      base_digests: baseDigests
    };
  } catch {
    return proposal;
  }
}

export function claimRuleUpdateDecision(projectPath: string):
  | {
      ok: true;
      reused: boolean;
      completed: boolean;
      command: DurableAgentCommand;
      proposal: RuleUpdateProposalProjection;
    }
  | { ok: false; reason: string; details?: unknown } {
  try {
    return withProjectTransaction(projectPath, (db) => {
      const row = db
        .prepare(
          `SELECT id, command_type, status, scope_kind, scope_id,
                  alignment_attempt_id, payload_json, idempotency_key,
                  created_at, updated_at, claimed_at, completed_at, cancelled_at
           FROM agent_commands
           WHERE scope_kind = 'rule_update_review'
             AND command_type = 'apply_rule_update_decision'
             AND status IN ('pending', 'claimed')
           ORDER BY created_at, id LIMIT 1`
        )
        .get() as CommandRow | undefined;
      if (!row) return { ok: false as const, reason: "no_pending_rule_update_decision" };
      const command = commandFromRow(row);
      const proposalId = text(command.payload.proposal_id);
      const revision = Number(command.payload.revision);
      const decision = command.payload.decision;
      const commandTarget = command.payload.target && typeof command.payload.target === "object"
        ? command.payload.target as Record<string, unknown>
        : {};
      const commandPath = text(commandTarget.proposedTargetPath) || text(commandTarget.sourceArtifactPath);
      const earlierFailed = commandPath
        ? db
            .prepare(
              `SELECT id FROM agent_commands
               WHERE scope_kind = 'rule_update_review'
                 AND command_type = 'apply_rule_update_decision'
                 AND status = 'failed'
                 AND (
                   json_extract(payload_json, '$.target.proposedTargetPath') = ?
                   OR json_extract(payload_json, '$.target.sourceArtifactPath') = ?
                 )
                 AND (created_at < ? OR (created_at = ? AND id < ?))
               ORDER BY created_at, id LIMIT 1`
            )
            .get(commandPath, commandPath, row.created_at, row.created_at, row.id) as
            | { id: string }
            | undefined
        : undefined;
      if (earlierFailed) {
        return {
          ok: false as const,
          reason: "earlier_rule_update_apply_failed",
          details: { blocking_command_id: earlierFailed.id, artifact_path: commandPath }
        };
      }
      const proposal = proposalProjectionOnDb(db, proposalId);
      if (!proposal || proposal.revision !== revision) {
        return { ok: false as const, reason: "stale_rule_update_revision" };
      }
      if (row.status === "claimed") {
        return {
          ok: true as const,
          reused: true,
          completed: false,
          command,
          proposal: proposalAtClaimedDigestsOnDb(db, proposal, row.id)
        };
      }
      const now = new Date().toISOString();
      if (decision === "rejected") {
        db.prepare(
          `UPDATE agent_commands
           SET status = 'completed', claimed_at = ?, completed_at = ?, updated_at = ?
           WHERE id = ? AND status = 'pending'`
        ).run(now, now, now, row.id);
        settleOrRewaitReviewOnDb(db, row.scope_id, now);
        const completed = db
          .prepare(
            `SELECT id, command_type, status, scope_kind, scope_id,
                    alignment_attempt_id, payload_json, idempotency_key,
                    created_at, updated_at, claimed_at, completed_at, cancelled_at
             FROM agent_commands WHERE id = ?`
          )
          .get(row.id) as CommandRow;
        return {
          ok: true as const,
          reused: false,
          completed: true,
          command: commandFromRow(completed),
          proposal
        };
      }
      const observedDigests = observedArtifactDigestsOnDb(db, proposal);
      let conflict: { path: string; expected: string; observed: string } | null = null;
      for (const [artifactPath, expected] of Object.entries(proposal.base_digests)) {
        const observed = observedDigests[artifactPath]!;
        if (
          expected !== observed &&
          !observedDigestCameFromEarlierApplyOnDb(
            db,
            row,
            artifactPath,
            observed
          )
        ) {
          conflict = { path: artifactPath, expected, observed };
          break;
        }
      }
      if (conflict) {
        db.prepare(
          `UPDATE rule_update_apply_attempts
           SET status = 'needs_revision', observed_digest = ?, error = ?, completed_at = ?
           WHERE command_id = ?`
        ).run(conflict.observed, "base_digest_conflict", now, row.id);
        db.prepare(
          `UPDATE agent_commands SET status = 'failed', updated_at = ? WHERE id = ?`
        ).run(now, row.id);
        activateRuleUpdateReviewWaitOnDb(db, row.scope_id, now);
        return {
          ok: false as const,
          reason: "proposal_base_digest_conflict",
          details: conflict
        };
      }
      db.prepare(
        `UPDATE agent_commands
         SET status = 'claimed', claimed_at = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`
      ).run(now, now, row.id);
      db.prepare(
        `UPDATE rule_update_apply_attempts
         SET status = 'claimed', claimed_at = ?, expected_base_digest = ?,
             claimed_base_digests_json = ?
         WHERE command_id = ?`
      ).run(
        now,
        observedDigests[
          proposal.target.proposedTargetPath ??
            proposal.target.sourceArtifactPath ??
            ""
        ] ?? null,
        JSON.stringify(observedDigests),
        row.id
      );
      insertEvent(
        db,
        buildLoggedEvent("rule_update_apply_started", {
          review_id: row.scope_id,
          proposal_id: proposalId,
          revision,
          command_id: row.id,
          base_digest: proposal.base_digest,
          claimed_base_digests: observedDigests
        })
      );
      const claimed = db
        .prepare(
          `SELECT id, command_type, status, scope_kind, scope_id,
                  alignment_attempt_id, payload_json, idempotency_key,
                  created_at, updated_at, claimed_at, completed_at, cancelled_at
           FROM agent_commands WHERE id = ?`
        )
        .get(row.id) as CommandRow;
      return {
        ok: true as const,
        reused: false,
        completed: false,
        command: commandFromRow(claimed),
        proposal: proposalAtClaimedDigestsOnDb(db, proposal, row.id)
      };
    });
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

export function failRuleUpdateApply(
  projectPath: string,
  input: { commandId: string; error: string }
): { ok: true; command_id: string } | { ok: false; reason: string } {
  const commandId = text(input.commandId);
  const error = text(input.error);
  if (!commandId || !error) return { ok: false, reason: "invalid_apply_failure" };
  try {
    return withProjectTransaction(projectPath, (db) => {
      const row = db
        .prepare(
          `SELECT review_id, proposal_id, revision FROM rule_update_apply_attempts
           WHERE command_id = ? AND status = 'claimed'`
        )
        .get(commandId) as
        | { review_id: string; proposal_id: string; revision: number }
        | undefined;
      if (!row) return { ok: false as const, reason: "apply_not_claimed" };
      const now = new Date().toISOString();
      db.prepare(
        `UPDATE rule_update_apply_attempts
         SET status = 'failed', error = ?, completed_at = ? WHERE command_id = ?`
      ).run(error, now, commandId);
      db.prepare(
        `UPDATE agent_commands SET status = 'failed', updated_at = ? WHERE id = ?`
      ).run(now, commandId);
      activateRuleUpdateReviewWaitOnDb(db, row.review_id, now);
      insertEvent(
        db,
        buildLoggedEvent("rule_update_apply_failed", {
          ...row,
          command_id: commandId,
          error,
          failed_at: now
        })
      );
      return { ok: true as const, command_id: commandId };
    });
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

export function retryRuleUpdateApply(
  projectPath: string,
  commandIdInput: string
): { ok: true; command_id: string } | { ok: false; reason: string } {
  const commandId = text(commandIdInput);
  if (!commandId) return { ok: false, reason: "command_id_required" };
  try {
    return withProjectTransaction(projectPath, (db) => {
      const attempt = db
        .prepare(
          `SELECT status FROM rule_update_apply_attempts WHERE command_id = ?`
        )
        .get(commandId) as { status: string } | undefined;
      if (!attempt || attempt.status !== "failed") {
        return { ok: false as const, reason: "apply_not_retryable" };
      }
      const now = new Date().toISOString();
      db.prepare(
        `UPDATE rule_update_apply_attempts
         SET status = 'pending', error = NULL, claimed_at = NULL,
             completed_at = NULL, claimed_base_digests_json = NULL
         WHERE command_id = ?`
      ).run(commandId);
      db.prepare(
        `UPDATE agent_commands
         SET status = 'pending', claimed_at = NULL, completed_at = NULL, updated_at = ?
         WHERE id = ?`
      ).run(now, commandId);
      const command = db
        .prepare(
          `SELECT scope_id FROM agent_commands
           WHERE id = ? AND scope_kind = 'rule_update_review'`
        )
        .get(commandId) as { scope_id: string } | undefined;
      if (command) {
        db.prepare(
          `UPDATE agent_command_wait_scopes
           SET status = 'closed', active_slot = NULL, closed_at = ?
           WHERE scope_kind = 'rule_update_review' AND scope_id = ?`
        ).run(now, command.scope_id);
      }
      return { ok: true as const, command_id: commandId };
    });
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

export function publishRuleUpdateReview(
  projectPath: string,
  reviewIdInput: string
):
  | { ok: true; review: ReviewRow; proposal_count: number }
  | { ok: false; reason: string; details?: unknown } {
  const reviewId = text(reviewIdInput);
  if (!reviewId) return { ok: false, reason: "review_id_required" };
  try {
    return withProjectTransaction(projectPath, (db) => {
      const review = reviewOnDb(db, reviewId);
      if (!review) return { ok: false as const, reason: "review_not_found" };
      if (review.status === "published") {
        const count = (db
          .prepare("SELECT COUNT(*) AS count FROM rule_update_proposals WHERE review_id = ?")
          .get(reviewId) as { count: number }).count;
        return { ok: true as const, review, proposal_count: count };
      }
      if (review.status !== "draft") {
        return { ok: false as const, reason: "review_not_draft" };
      }
      const count = (db
        .prepare("SELECT COUNT(*) AS count FROM rule_update_proposals WHERE review_id = ?")
        .get(reviewId) as { count: number }).count;
      if (review.reconciliation_id) {
        const coverage = db
          .prepare(
            `SELECT rf.feedback_id, rf.decision_disposition,
                    d.disposition AS dismissed_disposition,
                    EXISTS (
                      SELECT 1
                      FROM rule_update_proposals p,
                           json_each(p.evidence_record_ids_json) evidence
                      WHERE p.review_id = ?
                        AND evidence.value = rf.feedback_id
                    ) AS covered_by_proposal
             FROM conversation_reconciliation_feedback rf
             LEFT JOIN designer_feedback_dismissals d
               ON d.feedback_id = rf.feedback_id
             WHERE rf.reconciliation_id = ?
             ORDER BY rf.position ASC, rf.feedback_id ASC`
          )
          .all(reviewId, review.reconciliation_id) as Array<{
            feedback_id: string;
            decision_disposition: string;
            dismissed_disposition: string | null;
            covered_by_proposal: number;
          }>;
        const missing = coverage.filter(
          (row) => row.covered_by_proposal !== 1 && !row.dismissed_disposition
        );
        const invalidFinalDismissals = coverage.filter(
          (row) =>
            row.decision_disposition === "final_decision" &&
            row.covered_by_proposal !== 1 &&
            row.dismissed_disposition !== "covered_by_existing_rule"
        );
        if (missing.length > 0 || invalidFinalDismissals.length > 0) {
          return {
            ok: false as const,
            reason: "rule_update_review_incomplete",
            details: {
              missing_feedback_ids: missing.map((row) => row.feedback_id),
              invalid_final_decision_feedback_ids: invalidFinalDismissals.map(
                (row) => row.feedback_id
              )
            }
          };
        }
      }
      const targets = db
        .prepare(
          `SELECT p.id AS proposal_id, p.kind, r.full_rule_body,
                  r.target_category, r.source_category, r.source_artifact_path,
                  r.entry_id, r.proposed_target_path
           FROM rule_update_proposals p
           JOIN rule_update_proposal_revisions r
             ON r.proposal_id = p.id AND r.revision = p.current_revision
           WHERE p.review_id = ?`
        )
        .all(reviewId) as Array<{
          proposal_id: string;
          kind: RuleUpdateProposalKind;
          full_rule_body: string;
          target_category: RuleUpdateCategory;
          source_category: RuleUpdateCategory | null;
          source_artifact_path: string | null;
          entry_id: string | null;
          proposed_target_path: string | null;
        }>;
      for (const target of targets) {
        const canonicalized = canonicalizeTargetOnDb(db, {
          category: target.target_category,
          sourceCategory: target.source_category,
          sourceArtifactPath: target.source_artifact_path,
          entryId: target.entry_id,
          proposedTargetPath: target.proposed_target_path
        });
        if (!canonicalized.ok) return canonicalized;
        if (target.kind !== "retire") {
          const bodyValidation = validateRuleUpdateProposalBody(
            canonicalized.target,
            target.full_rule_body
          );
          if (!bodyValidation.ok) {
            return {
              ...bodyValidation,
              details: {
                proposal_id: target.proposal_id,
                ...bodyValidation.details
              }
            };
          }
        }
      }
      const now = new Date().toISOString();
      if (count > 0) {
        const wait = activateRuleUpdateReviewWaitOnDb(db, reviewId, now);
        if (!wait.ok) return wait;
      }
      db.prepare(
        `UPDATE rule_update_reviews
         SET status = ?, published_at = ?, completed_at = ? WHERE id = ?`
      ).run(count === 0 ? "completed" : "published", now, count === 0 ? now : null, reviewId);
      insertEvent(
        db,
        buildLoggedEvent("rule_update_review_published", {
          review_id: reviewId,
          proposal_count: count,
          published_at: now
        })
      );
      return {
        ok: true as const,
        review: {
          ...review,
          status: count === 0 ? "completed" as const : "published" as const,
          published_at: now,
          completed_at: count === 0 ? now : null
        },
        proposal_count: count
      };
    });
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

export function getRuleUpdateReviewProjection(projectPath: string):
  | {
      ok: true;
      reviews: RuleUpdateReviewProjection[];
      categories_with_unfinished_proposals: string[];
    }
  | { ok: false; reason: "db_error" } {
  const db = openProjectDb(projectPath);
  try {
    const reviewRows = db
      .prepare(
        `SELECT id, reconciliation_id, status, context, created_at,
                published_at, completed_at
         FROM rule_update_reviews
         WHERE status IN ('published', 'completed')
           AND context <> 'Legacy Rule Update'
         ORDER BY created_at DESC, id DESC`
      )
      .all() as unknown as ReviewRow[];
    const reviews = reviewRows.map((review) => {
      const ids = db
        .prepare(
          `SELECT id FROM rule_update_proposals
           WHERE review_id = ? ORDER BY created_at, id`
        )
        .all(review.id) as unknown as Array<{ id: string }>;
      const proposals = ids
        .map(({ id }) => proposalProjectionOnDb(db, id))
        .filter((value): value is RuleUpdateProposalProjection => value !== null);
      const reconciliation = review.reconciliation_id
        ? db
            .prepare(
              `SELECT run_id, session_id, transcript_json
               FROM conversation_reconciliations WHERE id = ?`
            )
            .get(review.reconciliation_id) as
            | { run_id: string; session_id: string; transcript_json: string }
            | undefined
        : undefined;
      let transcript: RuleUpdateReviewProjection["transcript"] = [];
      try {
        const parsed = reconciliation
          ? JSON.parse(reconciliation.transcript_json) as unknown
          : [];
        if (Array.isArray(parsed)) {
          transcript = parsed.filter(
            (item): item is RuleUpdateReviewProjection["transcript"][number] =>
              Boolean(
                item && typeof item === "object" &&
                typeof (item as { id?: unknown }).id === "string" &&
                ["designer", "agent"].includes(String((item as { role?: unknown }).role)) &&
                typeof (item as { content?: unknown }).content === "string"
              )
          );
        }
      } catch {
        transcript = [];
      }
      const interactions: RuleUpdateReviewProjection["interactions"] = [];
      for (const proposal of proposals) {
        const revisions = db
          .prepare(
            `SELECT revision, title, full_rule_body, target_category, author, created_at
             FROM rule_update_proposal_revisions
             WHERE proposal_id = ? ORDER BY revision`
          )
          .all(proposal.id) as unknown as Array<{
            revision: number;
            title: string;
            full_rule_body: string;
            target_category: RuleUpdateCategory;
            author: "agent" | "designer";
            created_at: string;
          }>;
        for (const revision of revisions) {
          interactions.push({
            id: `${proposal.id}:revision:${revision.revision}`,
            kind: revision.revision === 1 ? "proposal" : "revision",
            proposal_id: proposal.id,
            revision: revision.revision,
            title: revision.title,
            description: proposal.kind === "retire"
              ? proposal.reason
              : proposal.change_description,
            created_at: revision.created_at,
            target_category: revision.target_category,
            terminal:
              revision.revision !== proposal.revision ||
              proposal.status === "rejected" ||
              proposal.status === "applied"
          });
        }
        const decision = db
          .prepare(
            `SELECT decision, revision, decided_at FROM rule_update_designer_decisions
             WHERE proposal_id = ? ORDER BY decided_at DESC LIMIT 1`
          )
          .get(proposal.id) as
          | { decision: "accepted" | "rejected"; revision: number; decided_at: string }
          | undefined;
        if (decision) {
          interactions.push({
            id: `${proposal.id}:decision:${decision.revision}`,
            kind: decision.decision,
            proposal_id: proposal.id,
            revision: decision.revision,
            title: proposal.title,
            description: decision.decision === "accepted" ? "Designer accepted this revision." : "Designer rejected this revision.",
            created_at: decision.decided_at,
            target_category: proposal.target.category,
            terminal:
              decision.decision === "rejected" || proposal.status === "applied"
          });
        }
        const apply = db
          .prepare(
            `SELECT status, revision, error, completed_at, created_at
             FROM rule_update_apply_attempts WHERE proposal_id = ?
             ORDER BY created_at DESC LIMIT 1`
          )
          .get(proposal.id) as
          | { status: string; revision: number; error: string | null; completed_at: string | null; created_at: string }
          | undefined;
        if (apply && ["applied", "failed", "needs_revision"].includes(apply.status)) {
          interactions.push({
            id: `${proposal.id}:apply:${apply.revision}`,
            kind: apply.status === "applied" ? "applied" : "failed",
            proposal_id: proposal.id,
            revision: apply.revision,
            title: proposal.title,
            description: apply.status === "applied"
              ? proposal.kind === "retire"
                ? "Agent retired the accepted Rule and declared the source artifact."
                : "Agent applied and declared the source artifact."
              : apply.error ?? "Application needs a new revision.",
            created_at: apply.completed_at ?? apply.created_at,
            target_category: proposal.target.category,
            terminal: true
          });
        }
      }
      interactions.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
      return {
        ...review,
        transcript,
        run_id: reconciliation?.run_id ?? null,
        session_id: reconciliation?.session_id ?? null,
        interactions,
        proposals
      };
    });
    const categories = new Set<string>();
    for (const review of reviews) {
      for (const proposal of review.proposals) {
        if (proposal.status !== "applied" && proposal.status !== "rejected") {
          categories.add(proposal.target.category);
        }
      }
    }
    return {
      ok: true,
      reviews,
      categories_with_unfinished_proposals: [...categories].sort()
    };
  } catch {
    return { ok: false, reason: "db_error" };
  } finally {
    closeProjectDb(db);
  }
}
