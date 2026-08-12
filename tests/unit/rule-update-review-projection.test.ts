import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";

import { closeProjectDb, initializeProjectDb, openProjectDb } from "../../lib/runtime/db";
import { logEvent } from "../../lib/runtime/events";
import {
  createRuleUpdateReview,
  decideRuleUpdateProposal,
  draftRuleUpdateProposal,
  getRuleUpdateReviewProjection,
  publishRuleUpdateReview,
  reviseRuleUpdateProposal
} from "../../lib/runtime/rule-update-review";

const cleanup: string[] = [];
afterEach(() => {
  for (const projectPath of cleanup.splice(0)) rmSync(projectPath, { recursive: true, force: true });
});

test("All interactions projects the frozen transcript, revisions and decisions without invented message times", () => {
  const projectPath = mkdtempSync(path.join(tmpdir(), "ikran-rule-history-"));
  cleanup.push(projectPath);
  initializeProjectDb(projectPath);
  const reconciliationId = "reconciliation-history";
  const db = openProjectDb(projectPath);
  try {
    db.prepare(
      `INSERT INTO conversation_reconciliations
         (id, conversation_id, run_id, session_id, start_message_id,
          end_message_id, transcript_json, transcript_sha256, payload_sha256,
          message_count, decision_count, completed_at)
       VALUES (?, 'conversation-1', 'run-1', 'session-1', 'm1', 'm2', ?,
               'transcript-digest', 'payload-digest', 2, 1,
               '2026-08-12T00:00:00.000Z')`
    ).run(reconciliationId, JSON.stringify([
      { id: "m1", role: "designer", content: "Keep feedback quiet." },
      { id: "m2", role: "agent", content: "I will propose the reusable rule." }
    ]));
  } finally {
    closeProjectDb(db);
  }
  logEvent(projectPath, "consolidate_review_started", {
    reconciliation_id: reconciliationId,
    prototype_confirmation_event_id: null
  });
  const review = createRuleUpdateReview(projectPath, {
    context: "Prototype validation · feedback",
    reconciliationId
  });
  if (!review.ok) throw new Error(review.reason);
  const proposal = draftRuleUpdateProposal(projectPath, {
    reviewId: review.review.id,
    kind: "new",
    classification: "proposed_update",
    title: "Quiet feedback",
    fullRuleBody: "Feedback remains quiet.",
    reason: "Designer confirmed it.",
    affectedItems: ["Feedback"],
    evidenceRecordIds: [],
    target: {
      category: "foundations.interaction",
      sourceArtifactPath: "design-system/interaction-rules.json"
    }
  });
  if (!proposal.ok) throw new Error(proposal.reason);
  expect(publishRuleUpdateReview(projectPath, review.review.id).ok).toBe(true);
  expect(reviseRuleUpdateProposal(projectPath, {
    proposalId: proposal.proposal.id,
    title: "Quiet, immediate feedback",
    fullRuleBody: "Feedback remains quiet and immediate.",
    target: {
      category: "foundations.interaction",
      sourceArtifactPath: "design-system/interaction-rules.json"
    }
  }).ok).toBe(true);
  expect(decideRuleUpdateProposal(projectPath, {
    proposalId: proposal.proposal.id,
    decision: "rejected"
  }).ok).toBe(true);

  const projection = getRuleUpdateReviewProjection(projectPath);
  expect(projection).toMatchObject({
    ok: true,
    categories_with_unfinished_proposals: [],
    reviews: [{
      id: review.review.id,
      run_id: "run-1",
      session_id: "session-1",
      transcript: [
        { id: "m1", role: "designer", content: "Keep feedback quiet." },
        { id: "m2", role: "agent", content: "I will propose the reusable rule." }
      ],
      interactions: [
        { kind: "proposal", revision: 1, terminal: true },
        { kind: "revision", revision: 2, terminal: true },
        { kind: "rejected", revision: 2, terminal: true }
      ]
    }]
  });
  expect(JSON.stringify(projection)).not.toContain("message_timestamp");
});
