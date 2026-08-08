"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CLASS_META,
  INITIAL_PROPOSALS,
  feedbackById,
  type Proposal
} from "./shared";

/** Sequential verdict flow: one proposal in focus, decide and advance.
    j/k move between proposals (←/→ belong to the variant picker). */
export default function Queue() {
  const [proposals, setProposals] = useState<Proposal[]>(INITIAL_PROPOSALS);
  const [index, setIndex] = useState(2); // first pending proposal (p3)

  const decided = proposals.filter((p) => p.status !== "pending").length;
  const allDone = decided === proposals.length;
  const current = proposals[Math.min(index, proposals.length - 1)];

  const go = useCallback(
    (delta: number) =>
      setIndex((i) =>
        Math.max(0, Math.min(proposals.length - 1, i + delta))
      ),
    [proposals.length]
  );

  const decide = useCallback(
    (status: "confirmed" | "canceled") => {
      if (allDone) return;
      setProposals((list) =>
        list.map((p, i) => (i === index ? { ...p, status } : p))
      );
      // Advance to the next pending proposal, if any.
      const nextPending = proposals.findIndex(
        (p, i) => i > index && p.status === "pending"
      );
      if (nextPending !== -1) setIndex(nextPending);
    },
    [allDone, index, proposals]
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target.isContentEditable) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "j") go(1);
      else if (event.key === "k") go(-1);
      else if (event.key === "Enter") decide("confirmed");
      else if (event.key === "Backspace") decide("canceled");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [go, decide]);

  return (
    <aside className="prs-panel prs-queue">
      <div className="prs-queue-dots" aria-label="进度">
        {proposals.map((p, i) => (
          <button
            className="prs-queue-dot"
            key={p.id}
            {...(p.status !== "pending" ? { "data-status": p.status } : {})}
            {...(i === index && !allDone ? { "data-current": true } : {})}
            aria-label={`提案 ${i + 1}:${p.title}`}
            onClick={() => setIndex(i)}
          />
        ))}
      </div>

      {allDone ? (
        <div className="prs-queue-done">
          <p className="prs-queue-done-num">
            {proposals.filter((p) => p.status === "confirmed").length}
            <span style={{ color: "#b3b3b3" }}> / {proposals.length}</span>
          </p>
          <p className="prs-queue-done-text">
            条提案已确认。已确认的变更将由 Agent 写入规则文件并声明 artifact。
          </p>
        </div>
      ) : (
        <>
          <div className="prs-queue-card" key={current.id}>
            <div>
              <span
                className="prs-chip"
                data-tone={CLASS_META[current.classification].tone}
              >
                {CLASS_META[current.classification].label}
              </span>
              {current.status !== "pending" && (
                <span
                  className="prs-state"
                  data-kind={current.status}
                  style={{ marginLeft: 8 }}
                >
                  {current.status === "confirmed" ? "✓ 已确认" : "已取消"}
                </span>
              )}
            </div>
            <h3 className="prs-queue-title">{current.title}</h3>

            <div className="prs-queue-section">
              <p className="prs-group-label">改什么</p>
              <p className="prs-group-text">{current.change}</p>
            </div>

            <div className="prs-queue-section">
              <p className="prs-group-label">为什么</p>
              <p className="prs-group-text">{current.reason}</p>
            </div>

            <div className="prs-queue-section">
              <p className="prs-group-label">影响项</p>
              <div className="prs-affected" style={{ padding: "4px 0 0" }}>
                {current.affectedItems.map((item) => (
                  <span className="prs-affected-item" key={item}>
                    {item}
                  </span>
                ))}
              </div>
            </div>

            {current.feedbackIds.length > 0 && (
              <div className="prs-queue-section">
                <p className="prs-group-label">
                  聚合自 {current.feedbackIds.length} 条反馈
                </p>
                <div className="prs-queue-feedback">
                  {current.feedbackIds.map((fid) => {
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
              </div>
            )}

            <div className="prs-queue-actions">
              <button
                className="prs-decide"
                data-kind="confirm"
                disabled={current.status !== "pending"}
                onClick={() => decide("confirmed")}
              >
                ✓ Confirm
              </button>
              <button
                className="prs-decide"
                data-kind="cancel"
                disabled={current.status !== "pending"}
                onClick={() => decide("canceled")}
              >
                Cancel
              </button>
            </div>
          </div>

          <p className="prs-queue-hint">
            j / k 切换提案 · Enter 确认 · Backspace 取消 · {decided} /{" "}
            {proposals.length} 已处理
          </p>
        </>
      )}
    </aside>
  );
}
