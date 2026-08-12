import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";

import {
  activateRuleUpdateReviewWait,
  closeRuleUpdateReviewWait,
  publishAgentCommand,
  readActiveRuleUpdateReviewWaitScope
} from "../../lib/runtime/agent-command";
import {
  readAgentCommandWaitEligibility,
  waitForAgentCommand
} from "../../lib/runtime/adaptive-agent-wait";
import {
  closeProjectDb,
  initializeProjectDb,
  openProjectDb
} from "../../lib/runtime/db";

const cleanup: string[] = [];

afterEach(() => {
  for (const projectPath of cleanup.splice(0)) {
    rmSync(projectPath, { recursive: true, force: true });
  }
});

function createPostAlignmentProject(): string {
  const projectPath = mkdtempSync(
    path.join(tmpdir(), "ikran-scoped-command-")
  );
  cleanup.push(projectPath);
  initializeProjectDb(projectPath);
  const db = openProjectDb(projectPath);
  try {
    db.prepare(
      `UPDATE project_workflow
       SET stage = 'initial-design-system-preparing', updated_at = ?
       WHERE singleton = 1`
    ).run("2026-08-11T00:00:00.000Z");
  } finally {
    closeProjectDb(db);
  }
  return projectPath;
}

test("post-Alignment phase arms a lease only for an active Rule Update Review", async () => {
  const projectPath = createPostAlignmentProject();

  expect(readAgentCommandWaitEligibility(projectPath)).toMatchObject({
    ok: true,
    eligible: false,
    reason: "seed_reference_required"
  });

  const activated = activateRuleUpdateReviewWait(projectPath, "review-35");
  expect(activated).toMatchObject({
    ok: true,
    reused: false,
    wait_scope: {
      scope: { kind: "rule_update_review", id: "review-35" },
      status: "active"
    }
  });
  expect(readAgentCommandWaitEligibility(projectPath)).toMatchObject({
    ok: true,
    eligible: true,
    wait_scope: { kind: "rule_update_review", id: "review-35" }
  });
  await expect(
    waitForAgentCommand(projectPath, { windowMs: 0 })
  ).resolves.toEqual({
    ok: true,
    reason: "idle_no_command",
    command: null
  });

  expect(closeRuleUpdateReviewWait(projectPath, "review-35")).toEqual({
    ok: true,
    reused: false
  });
  expect(readActiveRuleUpdateReviewWaitScope(projectPath)).toBeNull();
  expect(readAgentCommandWaitEligibility(projectPath)).toMatchObject({
    ok: true,
    eligible: false
  });
});

test("Rule Update publication closes its lease atomically and remains durable for a later turn", async () => {
  const projectPath = createPostAlignmentProject();
  expect(activateRuleUpdateReviewWait(projectPath, "review-durable").ok).toBe(
    true
  );
  await expect(
    waitForAgentCommand(projectPath, { windowMs: 0 })
  ).resolves.toEqual({
    ok: true,
    reason: "idle_no_command",
    command: null
  });

  const input = {
    id: "command-rule-update-1",
    commandType: "apply_rule_update_decision",
    scope: {
      kind: "rule_update_review" as const,
      id: "review-durable"
    },
    payload: { proposal_id: "proposal-1", decision: "accepted" },
    idempotencyKey: "rule-update-decision:proposal-1:revision-2"
  };
  const published = publishAgentCommand(projectPath, input);
  expect(published).toMatchObject({
    ok: true,
    reused: false,
    command: {
      id: "command-rule-update-1",
      status: "pending",
      scope: { kind: "rule_update_review", id: "review-durable" },
      alignment_attempt_id: null
    }
  });
  expect(readActiveRuleUpdateReviewWaitScope(projectPath)).toBeNull();

  // Simulate the active Agent turn ending before it observes the decision.
  const db = openProjectDb(projectPath);
  closeProjectDb(db);

  await expect(
    waitForAgentCommand(projectPath, { windowMs: 0 })
  ).resolves.toMatchObject({
    ok: true,
    reason: "command_available",
    command: {
      id: "command-rule-update-1",
      scope: { kind: "rule_update_review", id: "review-durable" }
    }
  });
  expect(publishAgentCommand(projectPath, input)).toMatchObject({
    ok: true,
    reused: true,
    command: { id: "command-rule-update-1" }
  });
  expect(
    publishAgentCommand(projectPath, {
      ...input,
      payload: { proposal_id: "proposal-1", decision: "rejected" }
    })
  ).toEqual({ ok: false, reason: "idempotency_conflict" });
});

test("a Rule Update command wakes the active scoped wait", async () => {
  const projectPath = createPostAlignmentProject();
  expect(activateRuleUpdateReviewWait(projectPath, "review-active").ok).toBe(
    true
  );
  const waiting = waitForAgentCommand(projectPath, { windowMs: 1_000 });

  const published = publishAgentCommand(projectPath, {
    id: "command-rule-update-active",
    commandType: "apply_rule_update_decision",
    scope: { kind: "rule_update_review", id: "review-active" },
    payload: { proposal_id: "proposal-active", decision: "accepted" },
    idempotencyKey: "rule-update-decision:proposal-active:revision-1"
  });
  expect(published.ok).toBe(true);

  await expect(waiting).resolves.toMatchObject({
    ok: true,
    reason: "command_available",
    command: {
      id: "command-rule-update-active",
      scope: { kind: "rule_update_review", id: "review-active" }
    }
  });
});

test("only one Rule Update Review can own the wait lease", () => {
  const projectPath = createPostAlignmentProject();
  expect(activateRuleUpdateReviewWait(projectPath, "review-a").ok).toBe(true);
  expect(activateRuleUpdateReviewWait(projectPath, "review-a")).toMatchObject({
    ok: true,
    reused: true
  });
  expect(activateRuleUpdateReviewWait(projectPath, "review-b")).toEqual({
    ok: false,
    reason: "another_review_wait_active"
  });
});
