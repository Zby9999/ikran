// Design-system status 3-tier cross-validation (Issue 09 / 09A decision 4,
// Task B).
//
// Statuses are verified by Runtime, never self-reported by the Agent:
//   - formalized: must either link an answered Question card with
//     answer_source = "designer-edited" OR match a prior Browser approval
//     event for the same source path + entry id + approved content digest.
//     of designer intent, declaration/ingest is rejected.
//   - candidate: must link an answered card (any answer_source) or an Agent
//     annotation with inference = "reasonable" ("confirmed" also qualifies —
//     it is a strictly stronger agent-attested signal of the same kind).
//   - gap: explicit declaration only, carries no links (the schema rejects
//     gap entries with links) and is never derived from unanswered cards —
//     the 07 Complete gate means unanswered cards do not exist at this
//     point.
//
// Entry checks are pure and run against pre-fetched lookup maps; the
// DB-touching helpers (index loader, declaration link check) stay separate
// so Task C's ingest can call the pure part inside its own transaction.

import type { DatabaseSync as DatabaseType } from "node:sqlite";
import type { AnswerSource } from "./design-intent-alignment";
import type { DesignSystemStatus } from "./design-system-schema";

// ---------------------------------------------------------------------------
// Declaration-time link requirement (09A decision 4: declarations link
// answered question cards and/or Agent annotations)
// ---------------------------------------------------------------------------

export type DesignSystemDeclarationLinkReason =
  | "unlinked_design_system_artifact"
  | "link_not_answered_card_or_annotation";

export type DesignSystemDeclarationLinkResult =
  | { ok: true }
  | { ok: false; reason: DesignSystemDeclarationLinkReason; details?: unknown };

/**
 * Design-system declarations must reference at least one record, and every
 * referenced id must be EITHER an ANSWERED alignment question card
 * (non-empty final_answer) OR an existing Agent alignment annotation
 * (09A decision 4). Runs on an existing connection inside the declaration
 * transaction.
 */
export function checkDesignSystemDeclarationLinksOnDb(
  db: DatabaseType,
  relatedRecordIds: string[]
): DesignSystemDeclarationLinkResult {
  if (relatedRecordIds.length === 0) {
    return { ok: false, reason: "unlinked_design_system_artifact" };
  }
  const cardStmt = db.prepare(
    "SELECT final_answer FROM alignment_question_cards WHERE id = ?"
  );
  const annotationStmt = db.prepare(
    "SELECT 1 AS ok FROM agent_alignment_annotations WHERE id = ?"
  );
  for (const id of relatedRecordIds) {
    const card = cardStmt.get(id) as { final_answer: string | null } | undefined;
    const answeredCard =
      typeof card?.final_answer === "string" &&
      card.final_answer.trim().length > 0;
    if (answeredCard) continue;
    if (annotationStmt.get(id) !== undefined) continue;
    return {
      ok: false,
      reason: "link_not_answered_card_or_annotation",
      details: { recordId: id }
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Status 3-tier cross-validation (pure entry check + pre-fetched index)
// ---------------------------------------------------------------------------

export interface DesignSystemLinkIndex {
  /** Answered question cards: id → answer_source. */
  answeredCards: ReadonlyMap<string, AnswerSource>;
  /** Agent alignment annotations: id → inference. */
  annotations: ReadonlyMap<string, "confirmed" | "reasonable">;
  /** Direct designer edits are durable candidate-grade provenance. */
  designerEditEvents?: ReadonlySet<string>;
  /** Latest designer-authored Formalized content for each entry identity. */
  designerApprovedEntries?: ReadonlySet<string>;
  /** Latest direct status decision for these identities is Candidate. */
  designerRevertedEntries?: ReadonlySet<string>;
}

export function designSystemApprovedEntryKey(
  sourceArtifactPath: string,
  entryId: string,
  contentDigest: string
): string {
  return `${sourceArtifactPath}\u0000${entryId}\u0000${contentDigest}`;
}

/** Pre-fetch the lookup maps for a batch of entry checks (Task C ingest). */
export function loadDesignSystemLinkIndex(
  db: DatabaseType
): DesignSystemLinkIndex {
  const cards = db
    .prepare(
      `SELECT id, answer_source FROM alignment_question_cards
       WHERE final_answer IS NOT NULL AND TRIM(final_answer) <> ''`
    )
    .all() as Array<{ id: string; answer_source: string | null }>;
  // Only candidate-grade inferences count (confirmed is the strictly
  // stronger agent-attested value); anything else must not back an entry.
  const annotations = db
    .prepare(
      `SELECT id, inference FROM agent_alignment_annotations
       WHERE inference IN ('reasonable', 'confirmed')`
    )
    .all() as Array<{ id: string; inference: string }>;
  const designerEditEvents = db
    .prepare(
      "SELECT event_id, payload FROM events WHERE type = 'design_system_entry_edited'"
    )
    .all() as Array<{ event_id: string; payload: string }>;
  const designerStatusEvents = db
    .prepare(
      `SELECT type, payload FROM events
       WHERE type IN (
         'design_system_entry_approved',
         'design_system_entry_reverted',
         'design_system_entry_edited'
       )
       ORDER BY rowid`
    )
    .all() as Array<{ type: string; payload: string }>;
  const currentApprovals = new Map<string, string | null>();
  for (const event of designerStatusEvents) {
    try {
      const payload = JSON.parse(event.payload) as Record<string, unknown>;
      if (
        typeof payload.source_artifact_path !== "string" ||
        typeof payload.entry_id !== "string"
      ) continue;
      const identity = `${payload.source_artifact_path}\u0000${payload.entry_id}`;
      if (
        event.type === "design_system_entry_reverted" ||
        (event.type === "design_system_entry_edited" &&
          payload.to_status !== "formalized")
      ) {
        currentApprovals.set(identity, null);
      } else if (typeof payload.content_digest === "string") {
        currentApprovals.set(identity, payload.content_digest);
      }
    } catch {
      // Ignore malformed historical audit payloads; they grant no authority.
    }
  }
  return {
    answeredCards: new Map(
      cards
        .filter((c) => typeof c.answer_source === "string")
        .map((c) => [c.id, c.answer_source as AnswerSource])
    ),
    annotations: new Map(
      annotations.map((a) => [
        a.id,
        a.inference as "confirmed" | "reasonable"
      ])
    ),
    designerEditEvents: new Set(designerEditEvents.map((event) => event.event_id)),
    designerApprovedEntries: new Set(
      [...currentApprovals]
        .filter((entry): entry is [string, string] => entry[1] !== null)
        .map(([identity, digest]) => `${identity}\u0000${digest}`)
    ),
    designerRevertedEntries: new Set(
      [...currentApprovals]
        .filter((entry) => entry[1] === null)
        .map(([identity]) => identity)
    )
  };
}

export type DesignSystemStatusCheckReason =
  | "formalized_requires_designer_edited_link"
  | "candidate_requires_answered_card_or_reasonable_annotation"
  | "gap_must_not_link";

export type DesignSystemStatusCheckResult =
  | { ok: true }
  | { ok: false; reason: DesignSystemStatusCheckReason; details?: unknown };

/**
 * Verify one entry's declared status against its links. Links that resolve
 * to nothing (unknown id, unanswered card) never count — an Agent cannot
 * spoof a tier by forging ids.
 */
export function checkDesignSystemEntryStatus(
  entry: {
    status: DesignSystemStatus;
    links: string[];
    sourceArtifactPath?: string;
    entryId?: string;
    contentDigest?: string;
  },
  index: DesignSystemLinkIndex
): DesignSystemStatusCheckResult {
  if (entry.status === "gap") {
    return entry.links.length === 0
      ? { ok: true }
      : {
          ok: false,
          reason: "gap_must_not_link",
          details: { links: entry.links }
        };
  }
  if (entry.status === "formalized") {
    const identity =
      entry.sourceArtifactPath !== undefined && entry.entryId !== undefined
        ? `${entry.sourceArtifactPath}\u0000${entry.entryId}`
        : null;
    if (
      identity !== null &&
      index.designerRevertedEntries?.has(identity) === true
    ) {
      return {
        ok: false,
        reason: "formalized_requires_designer_edited_link",
        details: { links: entry.links }
      };
    }
    const backedByAnswer = entry.links.some(
      (link) => index.answeredCards.get(link) === "designer-edited"
    );
    const backedByDirectApproval =
      entry.sourceArtifactPath !== undefined &&
      entry.entryId !== undefined &&
      entry.contentDigest !== undefined &&
      index.designerApprovedEntries?.has(
        designSystemApprovedEntryKey(
          entry.sourceArtifactPath,
          entry.entryId,
          entry.contentDigest
        )
      ) === true;
    const backed = backedByAnswer || backedByDirectApproval;
    return backed
      ? { ok: true }
      : {
          ok: false,
          reason: "formalized_requires_designer_edited_link",
          details: { links: entry.links }
        };
  }
  // candidate
  const backed = entry.links.some(
    (link) =>
      index.answeredCards.has(link) ||
      index.annotations.has(link) ||
      index.designerEditEvents?.has(link) === true
  );
  return backed
    ? { ok: true }
    : {
        ok: false,
        reason: "candidate_requires_answered_card_or_reasonable_annotation",
        details: { links: entry.links }
      };
}
