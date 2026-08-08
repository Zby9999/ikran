"use client";

import { useState } from "react";
import {
  CLASS_META,
  INITIAL_PROPOSALS,
  INITIAL_UNPROMOTED,
  feedbackById,
  type Proposal
} from "./shared";

export default function Ledger() {
  const [proposals, setProposals] = useState<Proposal[]>(INITIAL_PROPOSALS);
  const [open, setOpen] = useState<string[]>(["p3"]);
  const [unpromoted, setUnpromoted] = useState(INITIAL_UNPROMOTED);

  const decided = proposals.filter((p) => p.status !== "pending").length;

  const decide = (id: string, status: "confirmed" | "canceled") =>
    setProposals((list) =>
      list.map((p) => (p.id === id ? { ...p, status } : p))
    );

  const toggle = (id: string) =>
    setOpen((list) =>
      list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
    );

  const sendBack = (feedbackId: string) =>
    setUnpromoted((list) =>
      list.map((item) =>
        item.feedback.id === feedbackId ? { ...item, returned: true } : item
      )
    );

  return (
    <aside className="prs-panel prs-ledger">
      <div className="prs-panel-head">
        <h2 className="prs-panel-title">规则审查</h2>
        <span className="prs-chip" data-tone="muted">
          7 条反馈
        </span>
        <span className="prs-panel-progress">
          {decided} / {proposals.length} 已处理
        </span>
      </div>

      <div className="prs-panel-body prs-stagger">
        {proposals.map((p) => {
          const meta = CLASS_META[p.classification];
          const isOpen = open.includes(p.id);
          return (
            <section
              className="prs-group"
              key={p.id}
              {...(isOpen ? { "data-open": true } : {})}
              {...(p.status !== "pending" ? { "data-decided": p.status } : {})}
            >
              <div style={{ display: "flex", alignItems: "center" }}>
                <button
                  className="prs-group-head"
                  onClick={() => toggle(p.id)}
                  aria-expanded={isOpen}
                >
                  <span className="prs-group-chevron">▶</span>
                  <span className="prs-chip" data-tone={meta.tone}>
                    {meta.label}
                  </span>
                  <span className="prs-group-title">{p.title}</span>
                </button>
                <div
                  className="prs-group-actions"
                  style={{ paddingRight: 12 }}
                >
                  {p.status === "pending" ? (
                    <>
                      <button
                        className="prs-decide"
                        data-kind="confirm"
                        onClick={() => decide(p.id, "confirmed")}
                      >
                        Confirm
                      </button>
                      <button
                        className="prs-decide"
                        data-kind="cancel"
                        onClick={() => decide(p.id, "canceled")}
                      >
                        ✗
                      </button>
                    </>
                  ) : (
                    <span className="prs-state" data-kind={p.status}>
                      {p.status === "confirmed" ? "✓ 已确认" : "已取消"}
                    </span>
                  )}
                </div>
              </div>

              <div className="prs-group-body">
                <div className="prs-group-body-inner">
                  <div className="prs-group-section">
                    <p className="prs-group-label">改什么</p>
                    <p className="prs-group-text">{p.change}</p>
                  </div>
                  <div className="prs-group-section">
                    <p className="prs-group-label">为什么</p>
                    <p className="prs-group-text">{p.reason}</p>
                  </div>
                  <div className="prs-affected">
                    {p.affectedItems.map((item) => (
                      <span className="prs-affected-item" key={item}>
                        {item}
                      </span>
                    ))}
                  </div>
                  {p.feedbackIds.length > 0 && (
                    <div className="prs-group-feedback">
                      {p.feedbackIds.map((fid) => {
                        const fb = feedbackById(fid);
                        return (
                          <div className="prs-fb" key={fid}>
                            <span className="prs-fb-time">{fb.time}</span>
                            <span>{fb.summary}</span>
                            {fb.linkage && (
                              <span className="prs-fb-link">{fb.linkage}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </section>
          );
        })}

        <div className="prs-lane">
          <p className="prs-lane-title">未提升为提案的反馈 · 2</p>
          {unpromoted.map((item) => (
            <div className="prs-lane-item" key={item.feedback.id}>
              <div className="prs-fb">
                <span className="prs-fb-time">{item.feedback.time}</span>
                <span>{item.feedback.summary}</span>
              </div>
              <p className="prs-lane-reason">Agent:{item.agentReason}</p>
              <button
                className="prs-return"
                disabled={item.returned}
                onClick={() => sendBack(item.feedback.id)}
              >
                {item.returned ? "✓ 已打回,待 Agent 重新提案" : "打回,要求重新提案"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
