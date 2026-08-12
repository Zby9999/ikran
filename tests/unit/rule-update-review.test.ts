import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";

import { initializeProjectDb } from "../../lib/runtime/db";
import { readActiveRuleUpdateReviewWaitScope } from "../../lib/runtime/agent-command";
import {
  decideRuleUpdateProposal,
  failRuleUpdateApply,
  claimRuleUpdateDecision,
  createRuleUpdateReview,
  draftRuleUpdateProposal,
  getRuleUpdateReviewProjection,
  publishRuleUpdateReview,
  reviseRuleUpdateProposal,
  retryRuleUpdateApply
} from "../../lib/runtime/rule-update-review";
import { findEarliestPendingAgentCommand } from "../../lib/runtime/agent-command";
import { closeProjectDb, openProjectDb } from "../../lib/runtime/db";
import { authorizeRuleUpdateProposalPathOnDb } from "../../lib/runtime/rule-update-policy";
import { completeRuleUpdateApplyOnArtifactDeclaration } from "../../lib/runtime/rule-update-apply";
import { logEventOnDb } from "../../lib/runtime/events";

const cleanup: string[] = [];

afterEach(() => {
  for (const projectPath of cleanup.splice(0)) {
    rmSync(projectPath, { recursive: true, force: true });
  }
});

function createProject(): string {
  const projectPath = mkdtempSync(path.join(tmpdir(), "ikran-rule-review-"));
  cleanup.push(projectPath);
  initializeProjectDb(projectPath);
  return projectPath;
}

test("draft proposals stay private until their Review publishes as one batch", () => {
  const projectPath = createProject();
  const review = createRuleUpdateReview(projectPath, {
    context: "Prototype validation · navigation behavior"
  });
  expect(review).toMatchObject({ ok: true, review: { status: "draft" } });
  if (!review.ok) return;

  const proposal = draftRuleUpdateProposal(projectPath, {
    reviewId: review.review.id,
    kind: "new",
    classification: "proposed_update",
    title: "Sticky navigation remains visible",
    fullRuleBody: "Keep the primary navigation visible while scrolling.",
    reason: "The confirmed prototype made this behavior reusable.",
    affectedItems: ["Primary navigation"],
    evidenceRecordIds: [],
    target: {
      category: "foundations.interaction",
      sourceArtifactPath: "design-system/interaction-rules.json"
    }
  });
  expect(proposal).toMatchObject({
    ok: true,
    proposal: { status: "pending_review", revision: 1 }
  });
  expect(getRuleUpdateReviewProjection(projectPath)).toEqual({
    ok: true,
    reviews: [],
    categories_with_unfinished_proposals: []
  });
  expect(readActiveRuleUpdateReviewWaitScope(projectPath)).toBeNull();

  expect(publishRuleUpdateReview(projectPath, review.review.id)).toMatchObject({
    ok: true,
    review: { id: review.review.id, status: "published" },
    proposal_count: 1
  });
  expect(getRuleUpdateReviewProjection(projectPath)).toMatchObject({
    ok: true,
    reviews: [
      {
        id: review.review.id,
        status: "published",
        proposals: [
          {
            title: "Sticky navigation remains visible",
            full_rule_body:
              "Keep the primary navigation visible while scrolling.",
            status: "pending_review",
            target: { category: "foundations.interaction" },
            revision: 1
          }
        ]
      }
    ],
    categories_with_unfinished_proposals: ["foundations.interaction"]
  });
  expect(readActiveRuleUpdateReviewWaitScope(projectPath)).toMatchObject({
    scope: { kind: "rule_update_review", id: review.review.id },
    status: "active"
  });
});

test("an empty Review publishes as a completed no-change round without waiting", () => {
  const projectPath = createProject();
  const review = createRuleUpdateReview(projectPath, { context: "No reusable changes" });
  if (!review.ok) throw new Error(review.reason);
  expect(publishRuleUpdateReview(projectPath, review.review.id)).toMatchObject({
    ok: true,
    review: { status: "completed" },
    proposal_count: 0
  });
  expect(readActiveRuleUpdateReviewWaitScope(projectPath)).toBeNull();
});

function publishedProposal(projectPath: string) {
  const review = createRuleUpdateReview(projectPath, { context: "Review 1" });
  if (!review.ok) throw new Error(review.reason);
  const proposal = draftRuleUpdateProposal(projectPath, {
    reviewId: review.review.id,
    kind: "update",
    classification: "proposed_update",
    title: "Original title",
    fullRuleBody: "Original complete rule.",
    reason: "Confirmed behavior changed.",
    affectedItems: ["Navigation"],
    evidenceRecordIds: [],
    target: {
      category: "foundations.layout",
      sourceArtifactPath: "design-system/layout-rules.json",
      entryId: "layout.navigation"
    }
  });
  if (!proposal.ok) throw new Error(proposal.reason);
  const published = publishRuleUpdateReview(projectPath, review.review.id);
  if (!published.ok) throw new Error(published.reason);
  return { review: review.review, proposal: proposal.proposal };
}

test("designer edits append an immutable revision without deciding or waking the Agent", () => {
  const projectPath = createProject();
  const { proposal } = publishedProposal(projectPath);

  expect(
    reviseRuleUpdateProposal(projectPath, {
      proposalId: proposal.id,
      title: "Revised title",
      fullRuleBody: "Revised complete rule.",
      target: {
        category: "foundations.interaction",
        sourceArtifactPath: "design-system/interaction-rules.json",
        entryId: "interaction.navigation"
      }
    })
  ).toMatchObject({
    ok: true,
    proposal: {
      title: "Revised title",
      revision: 2,
      revision_author: "designer",
      status: "pending_review",
      target: { category: "foundations.interaction" }
    }
  });
  expect(findEarliestPendingAgentCommand(projectPath)).toBeNull();

  const db = openProjectDb(projectPath);
  try {
    expect(
      db
        .prepare(
          `SELECT revision, title, author
           FROM rule_update_proposal_revisions
           WHERE proposal_id = ? ORDER BY revision`
        )
        .all(proposal.id)
    ).toEqual([
      { revision: 1, title: "Original title", author: "agent" },
      { revision: 2, title: "Revised title", author: "designer" }
    ]);
  } finally {
    closeProjectDb(db);
  }

  expect(
    reviseRuleUpdateProposal(projectPath, {
      proposalId: proposal.id,
      title: "Revised title",
      fullRuleBody: "Revised complete rule.",
      target: {
        category: "foundations.interaction",
        sourceArtifactPath: "design-system/interaction-rules.json",
        entryId: "interaction.navigation"
      }
    })
  ).toEqual({ ok: false, reason: "revision_unchanged" });
});

test("Accept records one exact decision and publishes an Agent-visible command", () => {
  const projectPath = createProject();
  const { review, proposal } = publishedProposal(projectPath);
  const decision = decideRuleUpdateProposal(projectPath, {
    proposalId: proposal.id,
    decision: "accepted"
  });
  expect(decision).toMatchObject({
    ok: true,
    proposal: { id: proposal.id, revision: 1, status: "waiting_agent" },
    command: {
      command_type: "apply_rule_update_decision",
      scope: { kind: "rule_update_review", id: review.id },
      payload: {
        proposal_id: proposal.id,
        revision: 1,
        decision: "accepted",
        title: "Original title",
        full_rule_body: "Original complete rule.",
        target: {
          category: "foundations.layout",
          sourceArtifactPath: "design-system/layout-rules.json",
          entryId: "layout.navigation"
        }
      }
    }
  });
  expect(readActiveRuleUpdateReviewWaitScope(projectPath)).toBeNull();
  expect(findEarliestPendingAgentCommand(projectPath)).toMatchObject({
    id: decision.ok ? decision.command.id : "",
    status: "pending"
  });
  expect(
    decideRuleUpdateProposal(projectPath, {
      proposalId: proposal.id,
      decision: "accepted"
    })
  ).toMatchObject({ ok: true, reused: true });
});

test("Agent claim receives the frozen decision; Reject completes without a source write", () => {
  const projectPath = createProject();
  const { review, proposal } = publishedProposal(projectPath);
  expect(
    decideRuleUpdateProposal(projectPath, {
      proposalId: proposal.id,
      decision: "rejected"
    })
  ).toMatchObject({ ok: true, proposal: { status: "rejected" } });

  expect(claimRuleUpdateDecision(projectPath)).toMatchObject({
    ok: true,
    reused: false,
    completed: true,
    command: {
      status: "completed",
      payload: {
        proposal_id: proposal.id,
        revision: 1,
        decision: "rejected"
      }
    }
  });
  expect(getRuleUpdateReviewProjection(projectPath)).toMatchObject({
    ok: true,
    reviews: [{ id: review.id, status: "completed" }],
    categories_with_unfinished_proposals: []
  });
});

test("Reject records the linked feedback disposition instead of blocking formalization", () => {
  const projectPath = createProject();
  const db = openProjectDb(projectPath);
  try {
    db.prepare(
      `INSERT INTO designer_feedback
         (id, summary, run_id, session_id, created_at)
       VALUES ('feedback-rejected', 'Keep this local', 'run-1', 'session-1', ?)`
    ).run(new Date().toISOString());
  } finally {
    closeProjectDb(db);
  }
  const review = createRuleUpdateReview(projectPath, { context: "Reject feedback" });
  if (!review.ok) throw new Error(review.reason);
  const proposal = draftRuleUpdateProposal(projectPath, {
    reviewId: review.review.id,
    kind: "new",
    classification: "local_exception",
    title: "Do not promote",
    fullRuleBody: "This stays local.",
    reason: "The designer rejected global reuse.",
    affectedItems: ["Local prototype"],
    evidenceRecordIds: ["feedback-rejected"],
    target: {
      category: "foundations.interaction",
      sourceArtifactPath: "design-system/interaction-rules.json"
    }
  });
  if (!proposal.ok) throw new Error(proposal.reason);
  expect(publishRuleUpdateReview(projectPath, review.review.id).ok).toBe(true);
  expect(
    decideRuleUpdateProposal(projectPath, {
      proposalId: proposal.proposal.id,
      decision: "rejected"
    }).ok
  ).toBe(true);
  const checked = openProjectDb(projectPath);
  try {
    expect(
      checked
        .prepare(
          `SELECT proposal_id FROM designer_feedback_review_consumption
           WHERE feedback_id = 'feedback-rejected'`
        )
        .get()
    ).toEqual({ proposal_id: proposal.proposal.id });
  } finally {
    closeProjectDb(checked);
  }
});

test("an accepted proposal cannot authorize a declaration before Agent claim", () => {
  const projectPath = createProject();
  const { proposal } = publishedProposal(projectPath);
  expect(
    decideRuleUpdateProposal(projectPath, {
      proposalId: proposal.id,
      decision: "accepted"
    }).ok
  ).toBe(true);
  const db = openProjectDb(projectPath);
  try {
    expect(
      authorizeRuleUpdateProposalPathOnDb(
        db,
        proposal.id,
        "design-system/layout-rules.json",
        true
      )
    ).toEqual({ ok: false, reason: "proposal_apply_not_claimed" });
  } finally {
    closeProjectDb(db);
  }
});

test("multiple decisions against one source preserve the accepted base digest", () => {
  const projectPath = createProject();
  const db = openProjectDb(projectPath);
  try {
    db.prepare(
      `INSERT INTO source_artifacts
         (id, path, artifact_type, semantic_purpose, related_record_ids_json,
          readiness, declaration_version, status, created_at, updated_at,
          content_digest)
       VALUES ('source-1', 'design-system/interaction-rules.json',
               'interaction-rules.json', 'test', '[]', NULL, 1, 'ingested',
               '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z', 'digest-1')`
    ).run();
  } finally {
    closeProjectDb(db);
  }
  const review = createRuleUpdateReview(projectPath, { context: "Shared source" });
  if (!review.ok) throw new Error(review.reason);
  const draft = (title: string) => draftRuleUpdateProposal(projectPath, {
    reviewId: review.review.id,
    kind: "new",
    classification: "proposed_update",
    title,
    fullRuleBody: `${title} body`,
    reason: "reason",
    affectedItems: [title],
    evidenceRecordIds: [],
    target: {
      category: "foundations.interaction",
      sourceArtifactPath: "design-system/interaction-rules.json"
    }
  });
  const rejected = draft("Rejected");
  const accepted = draft("Accepted");
  if (!rejected.ok || !accepted.ok) throw new Error("draft failed");
  expect(publishRuleUpdateReview(projectPath, review.review.id).ok).toBe(true);
  expect(decideRuleUpdateProposal(projectPath, { proposalId: rejected.proposal.id, decision: "rejected" }).ok).toBe(true);
  expect(decideRuleUpdateProposal(projectPath, { proposalId: accepted.proposal.id, decision: "accepted" }).ok).toBe(true);
  expect(claimRuleUpdateDecision(projectPath)).toMatchObject({ ok: true, completed: true });
  expect(claimRuleUpdateDecision(projectPath)).toMatchObject({
    ok: true,
    completed: false,
    proposal: { id: accepted.proposal.id, base_digest: "digest-1" }
  });
});

test("later accepted proposals rebase only onto an earlier applied command in the same Review", () => {
  const projectPath = createProject();
  const db = openProjectDb(projectPath);
  try {
    db.prepare(
      `INSERT INTO source_artifacts
         (id, path, artifact_type, semantic_purpose, related_record_ids_json,
          readiness, declaration_version, status, created_at, updated_at,
          content_digest)
       VALUES ('source-sequence', 'design-system/interaction-rules.json',
               'interaction-rules.json', 'test', '[]', NULL, 1, 'ingested',
               '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z', 'digest-1')`
    ).run();
  } finally {
    closeProjectDb(db);
  }
  const review = createRuleUpdateReview(projectPath, { context: "Sequential source" });
  if (!review.ok) throw new Error(review.reason);
  const draft = (title: string) => draftRuleUpdateProposal(projectPath, {
    reviewId: review.review.id,
    kind: "new",
    classification: "proposed_update",
    title,
    fullRuleBody: `${title} body`,
    reason: "reason",
    affectedItems: [title],
    evidenceRecordIds: [],
    target: {
      category: "foundations.interaction",
      sourceArtifactPath: "design-system/interaction-rules.json"
    }
  });
  const first = draft("First accepted");
  const second = draft("Second accepted");
  if (!first.ok || !second.ok) throw new Error("draft failed");
  expect(publishRuleUpdateReview(projectPath, review.review.id).ok).toBe(true);
  expect(decideRuleUpdateProposal(projectPath, { proposalId: first.proposal.id, decision: "accepted" }).ok).toBe(true);
  expect(decideRuleUpdateProposal(projectPath, { proposalId: second.proposal.id, decision: "accepted" }).ok).toBe(true);
  expect(claimRuleUpdateDecision(projectPath)).toMatchObject({
    ok: true,
    proposal: { id: first.proposal.id, base_digest: "digest-1" }
  });
  const applied = openProjectDb(projectPath);
  try {
    applied.prepare(
      `UPDATE source_artifacts SET content_digest = 'digest-2'
       WHERE path = 'design-system/interaction-rules.json'`
    ).run();
    const firstAttempt = applied
      .prepare(
        `SELECT command_id, revision FROM rule_update_apply_attempts
         WHERE proposal_id = ? AND status = 'claimed'`
      )
      .get(first.proposal.id) as { command_id: string; revision: number };
    logEventOnDb(applied, "source_artifact_declared", {
      proposal_id: first.proposal.id,
      path: "design-system/interaction-rules.json",
      rule_update_command_id: firstAttempt.command_id,
      rule_update_revision: firstAttempt.revision
    });
    expect(
      completeRuleUpdateApplyOnArtifactDeclaration(
        applied,
        first.proposal.id,
        "design-system/interaction-rules.json",
        "digest-2",
        new Date().toISOString()
      )
    ).toMatchObject({ applied: true, reviewId: review.review.id });
  } finally {
    closeProjectDb(applied);
  }
  expect(claimRuleUpdateDecision(projectPath)).toMatchObject({
    ok: true,
    proposal: {
      id: second.proposal.id,
      base_digest: "digest-2",
      base_digests: {
        "design-system/interaction-rules.json": "digest-2"
      }
    }
  });
});

test("move proposals preserve their typed source category for the trace projection", () => {
  const projectPath = createProject();
  const review = createRuleUpdateReview(projectPath, { context: "Move trace" });
  if (!review.ok) throw new Error(review.reason);
  expect(
    draftRuleUpdateProposal(projectPath, {
      reviewId: review.review.id,
      kind: "move",
      classification: "rule_conflict",
      title: "Move type token",
      fullRuleBody: "Move the type token into Color.",
      reason: "The semantic destination changed.",
      affectedItems: ["token.type.body"],
      evidenceRecordIds: [],
      target: {
        category: "foundations.color",
        sourceCategory: "foundations.typography",
        sourceArtifactPath: "design-system/token.json",
        proposedTargetPath: "design-system/token.json",
        entryId: "token.type.body"
      }
    })
  ).toMatchObject({
    ok: true,
    proposal: {
      target: {
        category: "foundations.color",
        sourceCategory: "foundations.typography"
      }
    }
  });
});

test("component categories cannot authorize another component artifact", () => {
  const projectPath = createProject();
  const review = createRuleUpdateReview(projectPath, { context: "Typed component" });
  if (!review.ok) throw new Error(review.reason);
  expect(
    draftRuleUpdateProposal(projectPath, {
      reviewId: review.review.id,
      kind: "new",
      classification: "proposed_update",
      title: "Button rule",
      fullRuleBody: "Buttons keep one action hierarchy.",
      reason: "Reusable component behavior.",
      affectedItems: ["button"],
      evidenceRecordIds: [],
      target: {
        category: "component:button",
        sourceArtifactPath: "design-system/components/card.json"
      }
    })
  ).toEqual({ ok: false, reason: "invalid_proposal_target" });
});

test("base drift becomes needs_revision before the Agent may write", () => {
  const projectPath = createProject();
  const db = openProjectDb(projectPath);
  try {
    db.prepare(
      `INSERT INTO source_artifacts
         (id, path, artifact_type, semantic_purpose, related_record_ids_json,
          readiness, declaration_version, status, created_at, updated_at,
          content_digest)
       VALUES ('source-conflict', 'design-system/interaction-rules.json',
               'interaction-rules.json', 'test', '[]', NULL, 1, 'ingested',
               '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z', 'digest-1')`
    ).run();
  } finally {
    closeProjectDb(db);
  }
  const review = createRuleUpdateReview(projectPath, { context: "Drift" });
  if (!review.ok) throw new Error(review.reason);
  const drafted = draftRuleUpdateProposal(projectPath, {
    reviewId: review.review.id,
    kind: "new",
    classification: "proposed_update",
    title: "Drift",
    fullRuleBody: "Drift body",
    reason: "reason",
    affectedItems: ["Drift"],
    evidenceRecordIds: [],
    target: {
      category: "foundations.interaction",
      sourceArtifactPath: "design-system/interaction-rules.json"
    }
  });
  if (!drafted.ok) throw new Error(drafted.reason);
  const proposal = drafted.proposal;
  expect(publishRuleUpdateReview(projectPath, review.review.id).ok).toBe(true);
  expect(decideRuleUpdateProposal(projectPath, { proposalId: proposal.id, decision: "accepted" }).ok).toBe(true);
  const changed = openProjectDb(projectPath);
  try {
    changed.prepare(
      "UPDATE source_artifacts SET content_digest = 'digest-2' WHERE path = 'design-system/interaction-rules.json'"
    ).run();
  } finally {
    closeProjectDb(changed);
  }
  expect(claimRuleUpdateDecision(projectPath)).toMatchObject({
    ok: false,
    reason: "proposal_base_digest_conflict",
    details: { expected: "digest-1", observed: "digest-2" }
  });
  expect(getRuleUpdateReviewProjection(projectPath)).toMatchObject({
    ok: true,
    reviews: [{ proposals: [{ id: proposal.id, status: "needs_revision" }] }]
  });
});

test("failed apply retries the same command and blocks later writes to the same source", () => {
  const projectPath = createProject();
  const db = openProjectDb(projectPath);
  try {
    db.prepare(
      `INSERT INTO source_artifacts
         (id, path, artifact_type, semantic_purpose, related_record_ids_json,
          readiness, declaration_version, status, created_at, updated_at,
          content_digest)
       VALUES ('source-retry', 'design-system/interaction-rules.json',
               'interaction-rules.json', 'test', '[]', NULL, 1, 'ingested',
               '2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z', 'digest-1')`
    ).run();
  } finally {
    closeProjectDb(db);
  }
  const review = createRuleUpdateReview(projectPath, { context: "Retry ordering" });
  if (!review.ok) throw new Error(review.reason);
  const make = (title: string) => draftRuleUpdateProposal(projectPath, {
    reviewId: review.review.id,
    kind: "new",
    classification: "proposed_update",
    title,
    fullRuleBody: `${title} body`,
    reason: "reason",
    affectedItems: [title],
    evidenceRecordIds: [],
    target: {
      category: "foundations.interaction",
      sourceArtifactPath: "design-system/interaction-rules.json"
    }
  });
  const first = make("First");
  const second = make("Second");
  if (!first.ok || !second.ok) throw new Error("draft failed");
  expect(publishRuleUpdateReview(projectPath, review.review.id).ok).toBe(true);
  const firstDecision = decideRuleUpdateProposal(projectPath, { proposalId: first.proposal.id, decision: "accepted" });
  const secondDecision = decideRuleUpdateProposal(projectPath, { proposalId: second.proposal.id, decision: "accepted" });
  if (!firstDecision.ok || !secondDecision.ok) throw new Error("decision failed");
  const claimed = claimRuleUpdateDecision(projectPath);
  expect(claimed).toMatchObject({ ok: true, command: { id: firstDecision.command.id } });
  expect(failRuleUpdateApply(projectPath, { commandId: firstDecision.command.id, error: "write_failed" })).toEqual({
    ok: true,
    command_id: firstDecision.command.id
  });
  expect(claimRuleUpdateDecision(projectPath)).toMatchObject({
    ok: false,
    reason: "earlier_rule_update_apply_failed",
    details: { blocking_command_id: firstDecision.command.id }
  });
  expect(retryRuleUpdateApply(projectPath, firstDecision.command.id)).toEqual({
    ok: true,
    command_id: firstDecision.command.id
  });
  const retriedDb = openProjectDb(projectPath);
  try {
    expect(
      retriedDb
        .prepare(
          `SELECT status FROM agent_command_wait_scopes
           WHERE scope_kind = 'rule_update_review' AND scope_id = ?`
        )
        .get(review.review.id)
    ).toEqual({ status: "closed" });
  } finally {
    closeProjectDb(retriedDb);
  }
  expect(claimRuleUpdateDecision(projectPath)).toMatchObject({
    ok: true,
    command: { id: firstDecision.command.id, status: "claimed" }
  });
});
