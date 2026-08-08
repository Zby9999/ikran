import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";

import { claimConsolidateReview } from "../../lib/runtime/consolidate-review";
import {
  reconcileDesignerConversation
} from "../../lib/runtime/conversation-reconciliation";
import { initializeProjectDb } from "../../lib/runtime/db";
import { listEvents } from "../../lib/runtime/events";
import { proposeRuleUpdate } from "../../lib/runtime/rule-update-proposal";

function withProject(run: (projectPath: string) => void): void {
  const projectPath = mkdtempSync(
    path.join(tmpdir(), "ikran-conversation-reconciliation-")
  );
  try {
    initializeProjectDb(projectPath);
    run(projectPath);
  } finally {
    rmSync(projectPath, { recursive: true, force: true });
  }
}

test("a completed bounded conversation review atomically becomes Consolidate feedback", () => {
  withProject((projectPath) => {
    const result = reconcileDesignerConversation(projectPath, {
      reviewId: "review-1",
      conversationId: "conversation-1",
      runId: "run-1",
      sessionId: "session-1",
      startMessageId: "message-1",
      endMessageId: "message-4",
      messages: [
        {
          id: "message-1",
          role: "designer",
          content: "导航栏滚动时保持透明。"
        },
        {
          id: "message-2",
          role: "agent",
          content: "我会调整透明度。"
        },
        {
          id: "message-3",
          role: "designer",
          content: "更正：滚动时保持不透明。"
        },
        {
          id: "message-4",
          role: "designer",
          content: "没有问题了，开始 Rule Update。"
        }
      ],
      decisions: [
        {
          summary: "导航栏滚动时保持不透明。",
          disposition: "final_decision",
          sourceMessageIds: ["message-3", "message-4"]
        },
        {
          summary: "导航栏滚动时保持透明。",
          disposition: "superseded",
          sourceMessageIds: ["message-1", "message-3"]
        }
      ]
    });

    expect(result).toMatchObject({
      ok: true,
      replayed: false,
      reconciliation: {
        id: "review-1",
        conversation_id: "conversation-1",
        start_message_id: "message-1",
        end_message_id: "message-4",
        message_count: 4,
        decision_count: 2
      }
    });
    if (!result.ok) return;
    expect(result.reconciliation.transcript_sha256).toMatch(/^[a-f0-9]{64}$/);

    const review = claimConsolidateReview(projectPath, "review-1");
    expect(review.ok).toBe(true);
    if (!review.ok) return;
    expect(review.feedback).toEqual([
      expect.objectContaining({
        summary: "导航栏滚动时保持不透明。",
        reconciliation_id: "review-1",
        decision_disposition: "final_decision",
        source_message_ids: ["message-3", "message-4"]
      }),
      expect.objectContaining({
        summary: "导航栏滚动时保持透明。",
        reconciliation_id: "review-1",
        decision_disposition: "superseded",
        source_message_ids: ["message-1", "message-3"]
      })
    ]);

    expect(listEvents(projectPath, "conversation_reconciliation_completed"))
      .toEqual([
        expect.objectContaining({
          payload: expect.objectContaining({
            reconciliation_id: "review-1",
            conversation_id: "conversation-1",
            start_message_id: "message-1",
            end_message_id: "message-4",
            message_count: 4,
            decision_count: 2,
            feedback_ids: result.feedback.map((item) => item.id)
          })
        })
      ]);
  });
});

test("an interrupted caller can replay the same review id without duplicate feedback", () => {
  withProject((projectPath) => {
    const input = {
      reviewId: "review-replay",
      conversationId: "conversation-replay",
      runId: "run-replay",
      sessionId: "session-replay",
      startMessageId: "message-1",
      endMessageId: "message-2",
      messages: [
        {
          id: "message-1",
          role: "designer" as const,
          content: "卡片之间使用 16px 间距。"
        },
        {
          id: "message-2",
          role: "designer" as const,
          content: "设计完成。"
        }
      ],
      decisions: [
        {
          summary: "卡片之间使用 16px 间距。",
          disposition: "final_decision" as const,
          sourceMessageIds: ["message-1", "message-2"]
        }
      ]
    };

    const first = reconcileDesignerConversation(projectPath, input);
    const replay = reconcileDesignerConversation(projectPath, input);

    expect(first.ok).toBe(true);
    expect(replay).toMatchObject({ ok: true, replayed: true });
    if (!first.ok || !replay.ok) return;
    expect(replay.feedback).toEqual(first.feedback);
    expect(replay.event_id).toBe(first.event_id);
    expect(listEvents(projectPath, "designer_feedback_recorded")).toHaveLength(1);
    expect(
      listEvents(projectPath, "conversation_reconciliation_completed")
    ).toHaveLength(1);

    expect(
      reconcileDesignerConversation(projectPath, {
        ...input,
        decisions: [
          {
            ...input.decisions[0],
            summary: "卡片之间使用 24px 间距。"
          }
        ]
      })
    ).toEqual({ ok: false, reason: "reconciliation_conflict" });
  });
});

test("a decision without designer-authored evidence is rejected before anything is recorded", () => {
  withProject((projectPath) => {
    expect(
      reconcileDesignerConversation(projectPath, {
        reviewId: "review-agent-only",
        conversationId: "conversation-agent-only",
        runId: "run-agent-only",
        sessionId: "session-agent-only",
        startMessageId: "message-1",
        endMessageId: "message-2",
        messages: [
          {
            id: "message-1",
            role: "designer",
            content: "请看看导航栏。"
          },
          {
            id: "message-2",
            role: "agent",
            content: "导航栏应该使用深色背景。"
          }
        ],
        decisions: [
          {
            summary: "导航栏使用深色背景。",
            disposition: "final_decision",
            sourceMessageIds: ["message-2"]
          }
        ]
      })
    ).toEqual({ ok: false, reason: "designer_source_required" });

    expect(listEvents(projectPath, "designer_feedback_recorded")).toEqual([]);
    expect(
      listEvents(projectPath, "conversation_reconciliation_completed")
    ).toEqual([]);
  });
});

test("Consolidate claims are scoped to a completed reconciliation", () => {
  withProject((projectPath) => {
    expect(claimConsolidateReview(projectPath, "missing-review")).toEqual({
      ok: false,
      reason: "conversation_reconciliation_not_found"
    });

    const reconciled = reconcileDesignerConversation(projectPath, {
      reviewId: "review-empty",
      conversationId: "conversation-empty",
      runId: "run-empty",
      sessionId: "session-empty",
      startMessageId: "message-1",
      endMessageId: "message-1",
      messages: [
        {
          id: "message-1",
          role: "designer",
          content: "设计完成，没有需要沉淀的规则。"
        }
      ],
      decisions: []
    });
    expect(reconciled.ok).toBe(true);

    expect(claimConsolidateReview(projectPath, "review-empty")).toMatchObject({
      ok: true,
      reconciliation_id: "review-empty",
      feedback_count: 0
    });
  });
});

test("a forged linkage rolls back the entire reconciliation batch", () => {
  withProject((projectPath) => {
    expect(
      reconcileDesignerConversation(projectPath, {
        reviewId: "review-forged-link",
        conversationId: "conversation-forged-link",
        runId: "run-forged-link",
        sessionId: "session-forged-link",
        startMessageId: "message-1",
        endMessageId: "message-1",
        messages: [
          {
            id: "message-1",
            role: "designer",
            content: "这个结论关联当前 Seed。"
          }
        ],
        decisions: [
          {
            summary: "关联当前 Seed。",
            disposition: "final_decision",
            sourceMessageIds: ["message-1"],
            seedReferenceId: "forged-seed"
          }
        ]
      })
    ).toEqual({ ok: false, reason: "linkage_record_not_found" });

    expect(listEvents(projectPath, "designer_feedback_recorded")).toEqual([]);
    expect(
      listEvents(projectPath, "conversation_reconciliation_completed")
    ).toEqual([]);
  });
});

test("the transcript hash covers the verbatim message content", () => {
  withProject((projectPath) => {
    const messages = [
      {
        id: "message-1",
        role: "designer" as const,
        content: "  保留原始空白。\n"
      }
    ];
    const result = reconcileDesignerConversation(projectPath, {
      reviewId: "review-verbatim",
      conversationId: "conversation-verbatim",
      runId: "run-verbatim",
      sessionId: "session-verbatim",
      startMessageId: "message-1",
      endMessageId: "message-1",
      messages,
      decisions: []
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reconciliation.transcript_sha256).toBe(
      createHash("sha256")
        .update(JSON.stringify(messages))
        .digest("hex")
    );
  });
});

test("Consolidate reads the selected reconciliation plus legacy feedback, not another conversation", () => {
  withProject((projectPath) => {
    const reconcile = (reviewId: string, conversationId: string, summary: string) =>
      reconcileDesignerConversation(projectPath, {
        reviewId,
        conversationId,
        runId: reviewId,
        sessionId: reviewId,
        startMessageId: `${reviewId}-message`,
        endMessageId: `${reviewId}-message`,
        messages: [
          {
            id: `${reviewId}-message`,
            role: "designer",
            content: summary
          }
        ],
        decisions: [
          {
            summary,
            disposition: "final_decision",
            sourceMessageIds: [`${reviewId}-message`]
          }
        ]
      });

    expect(reconcile("review-a", "conversation-a", "只属于会话 A。").ok)
      .toBe(true);
    expect(reconcile("review-b", "conversation-b", "只属于会话 B。").ok)
      .toBe(true);

    const review = claimConsolidateReview(projectPath, "review-b");
    expect(review.ok).toBe(true);
    if (!review.ok) return;
    expect(review.feedback.map((item) => item.summary)).toEqual([
      "只属于会话 B。"
    ]);
  });
});

test("a superseded reconciliation decision cannot become Rule Update evidence", () => {
  withProject((projectPath) => {
    const reconciled = reconcileDesignerConversation(projectPath, {
      reviewId: "review-superseded",
      conversationId: "conversation-superseded",
      runId: "run-superseded",
      sessionId: "session-superseded",
      startMessageId: "message-1",
      endMessageId: "message-2",
      messages: [
        {
          id: "message-1",
          role: "designer",
          content: "间距使用 24px。"
        },
        {
          id: "message-2",
          role: "designer",
          content: "更正，间距使用 16px。"
        }
      ],
      decisions: [
        {
          summary: "间距使用 24px。",
          disposition: "superseded",
          sourceMessageIds: ["message-1", "message-2"]
        }
      ]
    });
    expect(reconciled.ok).toBe(true);
    if (!reconciled.ok) return;

    expect(
      proposeRuleUpdate(projectPath, {
        kind: "new",
        classification: "reusable_candidate",
        title: "Card spacing",
        changeDescription: "Use 24px card spacing.",
        reason: "Promote the recorded decision.",
        affectedItems: ["Card grid"],
        evidenceRecordIds: [reconciled.feedback[0].id]
      })
    ).toEqual({
      ok: false,
      reason: "non_final_reconciliation_evidence"
    });
    expect(listEvents(projectPath, "rule_update_proposal_created")).toEqual([]);
  });
});

test("idempotent replay ignores object key order in opaque context", () => {
  withProject((projectPath) => {
    const base = {
      reviewId: "review-canonical",
      conversationId: "conversation-canonical",
      runId: "run-canonical",
      sessionId: "session-canonical",
      startMessageId: "message-1",
      endMessageId: "message-1",
      messages: [
        {
          id: "message-1",
          role: "designer" as const,
          content: "保留按钮上下文。"
        }
      ]
    };
    const first = reconcileDesignerConversation(projectPath, {
      ...base,
      decisions: [
        {
          summary: "保留按钮上下文。",
          disposition: "final_decision" as const,
          sourceMessageIds: ["message-1"],
          opaqueContext: { selector: "#primary", state: "hover" }
        }
      ]
    });
    expect(first.ok).toBe(true);

    expect(
      reconcileDesignerConversation(projectPath, {
        ...base,
        decisions: [
          {
            summary: "保留按钮上下文。",
            disposition: "final_decision",
            sourceMessageIds: ["message-1"],
            opaqueContext: { state: "hover", selector: "#primary" }
          }
        ]
      })
    ).toMatchObject({ ok: true, replayed: true });
  });
});
