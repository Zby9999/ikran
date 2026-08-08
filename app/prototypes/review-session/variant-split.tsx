"use client";

import { useState } from "react";
import {
  CLASS_META,
  FEEDBACK,
  INITIAL_PROPOSALS,
  INITIAL_UNPROMOTED,
  type Proposal
} from "./shared";

/** Master-detail audit: raw feedback stream on the left, proposals on the
    right; selecting either side lights up its counterparts. */
export default function Split() {
  const [proposals, setProposals] = useState<Proposal[]>(INITIAL_PROPOSALS);
  const [selected, setSelected] = useState<string | null>("p3");
  const [unpromoted, setUnpromoted] = useState(INITIAL_UNPROMOTED);

  const decided = proposals.filter((p) => p.status !== "pending").length;

  const selectedProposal = proposals.find((p) => p.id === selected) ?? null;
  const selectedFeedback = FEEDBACK.find((f) => f.id === selected) ?? null;

  // Which feedback ids are linked to the current selection?
  const linkedFeedback = selectedProposal
    ? selectedProposal.feedbackIds
    : selectedFeedback
      ? [selectedFeedback.id]
      : [];
  // Which proposal ids are linked to the current selection?
  const linkedProposals = selectedFeedback
    ? proposals
        .filter((p) => p.feedbackIds.includes(selectedFeedback.id))
        .map((p) => p.id)
    : selectedProposal
      ? [selectedProposal.id]
      : [];

  const decide = (id: string, status: "confirmed" | "canceled") =>
    setProposals((list) =>
      list.map((p) => (p.id === id ? { ...p, status } : p))
    );

  const sendBack = (feedbackId: string) =>
    setUnpromoted((list) =>
      list.map((item) =>
        item.feedback.id === feedbackId ? { ...item, returned: true } : item
      )
    );

  const unpromotedIds = unpromoted.map((item) => item.feedback.id);

  return (
    <aside className="prs-panel prs-split">
      <div className="prs-panel-head">
        <h2 className="prs-panel-title">规则审查</h2>
        <span className="prs-chip" data-tone="muted">
          7 条反馈 → {proposals.length} 条提案
        </span>
        <span className="prs-panel-progress">
          {decided} / {proposals.length} 已处理
        </span>
      </div>

      <div className="prs-split-cols">
        <div className="prs-split-left prs-stagger">
          <p className="prs-split-col-label">原始反馈 · run-3</p>
          {FEEDBACK.map((fb) => {
            const isUnpromoted = unpromotedIds.includes(fb.id);
            const isLinked = linkedFeedback.includes(fb.id);
            const isSelected = selected === fb.id;
            return (
              <button
                className="prs-split-fb"
                key={fb.id}
                {...(isSelected
                  ? { "data-selected": true }
                  : isLinked
                    ? { "data-linked": true }
                    : selected
                      ? { "data-dim": true }
                      : {})}
                onClick={() => setSelected(isSelected ? null : fb.id)}
              >
                <span className="prs-fb">
                  <span className="prs-fb-time">{fb.time}</span>
                  <span>{fb.summary}</span>
                </span>
                {isUnpromoted && (
                  <p className="prs-lane-reason" style={{ margin: "4px 0 0" }}>
                    {
                      unpromoted.find((x) => x.feedback.id === fb.id)
                        ?.agentReason
                    }
                  </p>
                )}
              </button>
            );
          })}
          <div style={{ padding: "4px 2px" }}>
            <button
              className="prs-return"
              disabled={unpromoted.every((x) => x.returned)}
              onClick={() =>
                unpromoted.forEach(
                  (x) => !x.returned && sendBack(x.feedback.id)
                )
              }
            >
              {unpromoted.every((x) => x.returned)
                ? "✓ 未提升条目已全部打回"
                : "打回未提升条目,要求重新提案"}
            </button>
          </div>
        </div>

        <div className="prs-split-right prs-stagger">
          <p className="prs-split-col-label">提案</p>
          {proposals.map((p) => {
            const meta = CLASS_META[p.classification];
            const isSelected = selected === p.id;
            const isLinked = linkedProposals.includes(p.id);
            return (
              <div
                className="prs-split-card"
                key={p.id}
                {...(isSelected
                  ? { "data-selected": true }
                  : isLinked && selected
                    ? { "data-linked": true }
                    : {})}
                onClick={() => setSelected(isSelected ? null : p.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelected(isSelected ? null : p.id);
                  }
                }}
              >
                <div className="prs-split-card-top">
                  <span className="prs-chip" data-tone={meta.tone}>
                    {meta.label}
                  </span>
                  <span className="prs-split-card-title">{p.title}</span>
                  {p.status !== "pending" && (
                    <span className="prs-state" data-kind={p.status}>
                      {p.status === "confirmed" ? "✓" : "✗"}
                    </span>
                  )}
                </div>
                {isSelected && (
                  <div className="prs-split-detail">
                    <p className="prs-group-label">改什么</p>
                    <p className="prs-group-text">{p.change}</p>
                    <p className="prs-group-label">为什么</p>
                    <p className="prs-group-text">{p.reason}</p>
                    <div className="prs-affected" style={{ padding: 0 }}>
                      {p.affectedItems.map((item) => (
                        <span className="prs-affected-item" key={item}>
                          {item}
                        </span>
                      ))}
                    </div>
                    {p.status === "pending" && (
                      <div className="prs-split-detail-actions">
                        <button
                          className="prs-decide"
                          data-kind="confirm"
                          onClick={(e) => {
                            e.stopPropagation();
                            decide(p.id, "confirmed");
                          }}
                        >
                          Confirm
                        </button>
                        <button
                          className="prs-decide"
                          data-kind="cancel"
                          onClick={(e) => {
                            e.stopPropagation();
                            decide(p.id, "canceled");
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
