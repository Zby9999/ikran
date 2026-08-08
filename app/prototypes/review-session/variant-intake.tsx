"use client";

import { useRef, useState } from "react";
import { FEEDBACK, feedbackById } from "./shared";

/**
 * Intake — promotion-first riff of Ledger.
 * Default layer: only proposals that WRITE to the design system (new global
 * rule / rule update). Everything else (page-local, overturned, no-change,
 * open gap) is an interaction record with a destination marker, collapsed
 * behind one toggle. Decisions happen only on the default layer; the audit
 * layer is accept-by-default with a send-back escape.
 */

type RuleProposal = {
  id: string;
  kind: "new" | "update";
  title: string;
  before: string;
  after: string;
  reason: string;
  affectedItems: string[];
  feedbackIds: string[];
  status: "pending" | "confirmed" | "canceled";
};

type Destination =
  | { type: "promoted"; proposalId: string; proposalTitle: string }
  | { type: "page-local"; note: string }
  | { type: "overturned"; byId: string; note: string }
  | { type: "no-change"; note: string };

const RULE_PROPOSALS: RuleProposal[] = [
  {
    id: "ip1",
    kind: "new",
    title: "卡片间距规则扩展至列表场景",
    before: "spacing/card-gap · 12px · 仅卡片网格",
    after: "spacing/card-gap · 16px · 卡片与列表容器",
    reason:
      "三条独立反馈指向同一判断:拥挤感不只出现在卡片网格,列表场景同样存在。设计师已给出明确数值 16px。",
    affectedItems: ["spacing/card-gap", "component/list", "component/card-grid"],
    feedbackIds: ["f1", "f2", "f3"],
    status: "confirmed"
  },
  {
    id: "ip2",
    kind: "update",
    title: "标题层级规则补充「详情页」用法",
    before: "typography/heading · 覆盖列表页与营销页",
    after: "typography/heading · 新增详情页层级约定(标题降一级)",
    reason:
      "设计师指出详情页标题层级不对。现有规则只覆盖了列表页与营销页两种场景,详情页无据可依。",
    affectedItems: ["typography/heading"],
    feedbackIds: ["f4"],
    status: "pending"
  }
];

const DESTINATIONS: Record<string, Destination> = {
  f1: { type: "promoted", proposalId: "ip1", proposalTitle: "卡片间距规则扩展" },
  f2: { type: "promoted", proposalId: "ip1", proposalTitle: "卡片间距规则扩展" },
  f3: { type: "promoted", proposalId: "ip1", proposalTitle: "卡片间距规则扩展" },
  f4: { type: "promoted", proposalId: "ip2", proposalTitle: "标题层级规则补充" },
  f5: {
    type: "page-local",
    note: "留在本页 prototype(actions 区按钮 8px),不入全局规则"
  },
  f6: {
    type: "overturned",
    byId: "f7",
    note: "被 15:47 的反馈推翻;冲突已登记,规则维持不变"
  },
  f7: { type: "no-change", note: "与现行规则一致,无需变更" }
};

const OPEN_GAPS = [
  {
    id: "g1",
    title: "深色模式 token 缺失",
    note: "color/* 全部 token 仅有亮色定义。本轮未触及,按约定登记为开放缺口。"
  }
];

const DEST_MARK: Record<Destination["type"], { mark: string; label: string }> = {
  promoted: { mark: "→", label: "已纳入提案" },
  "page-local": { mark: "◦", label: "局部例外" },
  overturned: { mark: "×", label: "已被推翻" },
  "no-change": { mark: "=", label: "无需变更" }
};

export default function Intake() {
  const [proposals, setProposals] = useState<RuleProposal[]>(RULE_PROPOSALS);
  const [expandedSources, setExpandedSources] = useState<string[]>([]);
  const [auditOpen, setAuditOpen] = useState(false);
  const [returned, setReturned] = useState<string[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const proposalRefs = useRef<Record<string, HTMLElement | null>>({});

  const decided = proposals.filter((p) => p.status !== "pending").length;
  const pageLocalCount = Object.values(DESTINATIONS).filter(
    (d) => d.type === "page-local"
  ).length;

  const decide = (id: string, status: "confirmed" | "canceled") =>
    setProposals((list) =>
      list.map((p) => (p.id === id ? { ...p, status } : p))
    );

  const toggleSources = (id: string) =>
    setExpandedSources((list) =>
      list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
    );

  const jumpToProposal = (id: string) => {
    setAuditOpen(false);
    proposalRefs.current[id]?.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
    setFlash(id);
    window.setTimeout(() => setFlash(null), 1200);
  };

  return (
    <aside className="prs-panel prs-intake">
      <div className="prs-panel-head">
        <h2 className="prs-panel-title">规则收录审查</h2>
        <span className="prs-panel-progress">
          {decided} / {proposals.length} 已裁决
        </span>
      </div>

      <div className="prs-panel-body">
        <p className="prs-intake-intro">
          以下变更将写入 Design System 全局规则:
        </p>

        <div className="prs-stagger">
          {proposals.map((p) => {
            const sourcesOpen = expandedSources.includes(p.id);
            return (
              <section
                className="prs-intake-card"
                key={p.id}
                ref={(el) => {
                  proposalRefs.current[p.id] = el;
                }}
                {...(flash === p.id ? { "data-flash": true } : {})}
                {...(p.status !== "pending"
                  ? { "data-decided": p.status }
                  : {})}
              >
                <div className="prs-intake-card-top">
                  <span
                    className="prs-chip"
                    data-tone={p.kind === "new" ? "blue" : "green"}
                  >
                    {p.kind === "new" ? "新增规则" : "规则更新"}
                  </span>
                  {p.status !== "pending" && (
                    <span className="prs-state" data-kind={p.status}>
                      {p.status === "confirmed" ? "✓ 已收录" : "未收录"}
                    </span>
                  )}
                </div>

                <h3 className="prs-intake-title">{p.title}</h3>

                <div className="prs-diff">
                  <div className="prs-diff-row">
                    <span className="prs-diff-mark" data-kind="before">
                      现
                    </span>
                    <span className="prs-diff-text">{p.before}</span>
                  </div>
                  <div className="prs-diff-row">
                    <span className="prs-diff-mark" data-kind="after">
                      改
                    </span>
                    <span className="prs-diff-text">{p.after}</span>
                  </div>
                </div>

                <p className="prs-intake-reason">{p.reason}</p>

                <div className="prs-affected" style={{ padding: 0 }}>
                  {p.affectedItems.map((item) => (
                    <span className="prs-affected-item" key={item}>
                      {item}
                    </span>
                  ))}
                </div>

                {p.feedbackIds.length > 0 && (
                  <>
                    <button
                      className="prs-sources-toggle"
                      onClick={() => toggleSources(p.id)}
                      aria-expanded={sourcesOpen}
                    >
                      <span
                        className="prs-group-chevron"
                        style={
                          sourcesOpen ? { transform: "rotate(90deg)" } : {}
                        }
                      >
                        ▶
                      </span>
                      聚合自 {p.feedbackIds.length} 条反馈
                    </button>
                    <div
                      className="prs-group-body"
                      {...(sourcesOpen ? { "data-open": true } : {})}
                      style={
                        sourcesOpen ? { gridTemplateRows: "1fr" } : {}
                      }
                    >
                      <div className="prs-group-body-inner">
                        <div className="prs-group-feedback">
                          {p.feedbackIds.map((fid) => {
                            const fb = feedbackById(fid);
                            return (
                              <div className="prs-fb" key={fid}>
                                <span className="prs-fb-time">{fb.time}</span>
                                <span>{fb.summary}</span>
                                {fb.linkage && (
                                  <span className="prs-fb-link">
                                    {fb.linkage}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {p.status === "pending" && (
                  <div className="prs-intake-actions">
                    <button
                      className="prs-decide"
                      data-kind="confirm"
                      onClick={() => decide(p.id, "confirmed")}
                    >
                      ✓ 收录
                    </button>
                    <button
                      className="prs-decide"
                      data-kind="cancel"
                      onClick={() => decide(p.id, "canceled")}
                    >
                      不收录
                    </button>
                  </div>
                )}
              </section>
            );
          })}
        </div>

        <p className="prs-intake-footnote">
          另登记 {pageLocalCount} 条局部例外、{OPEN_GAPS.length}{" "}
          个开放缺口——见交互记录。
        </p>

        {/* -------- audit layer: every interaction record, collapsed -------- */}
        <div className="prs-audit">
          <button
            className="prs-audit-toggle"
            onClick={() => setAuditOpen((v) => !v)}
            aria-expanded={auditOpen}
          >
            <span
              className="prs-group-chevron"
              style={auditOpen ? { transform: "rotate(90deg)" } : {}}
            >
              ▶
            </span>
            全部交互记录 · {FEEDBACK.length}
          </button>

          <div
            className="prs-group-body"
            style={auditOpen ? { gridTemplateRows: "1fr" } : {}}
          >
            <div className="prs-group-body-inner">
              <div className="prs-audit-list">
                {FEEDBACK.map((fb) => {
                  const dest = DESTINATIONS[fb.id];
                  const mark = DEST_MARK[dest.type];
                  const isReturned = returned.includes(fb.id);
                  return (
                    <div className="prs-audit-item" key={fb.id}>
                      <div className="prs-fb">
                        <span className="prs-fb-time">{fb.time}</span>
                        <span>{fb.summary}</span>
                      </div>
                      <div
                        className="prs-dest"
                        data-type={dest.type}
                      >
                        <span className="prs-dest-mark">{mark.mark}</span>
                        {dest.type === "promoted" ? (
                          <button
                            className="prs-dest-link"
                            onClick={() => jumpToProposal(dest.proposalId)}
                          >
                            {mark.label}「{dest.proposalTitle}」
                          </button>
                        ) : (
                          <span>
                            {mark.label} · {dest.note}
                          </span>
                        )}
                      </div>
                      {dest.type === "page-local" && (
                        <button
                          className="prs-return"
                          disabled={isReturned}
                          onClick={() =>
                            setReturned((list) => [...list, fb.id])
                          }
                        >
                          {isReturned
                            ? "✓ 已打回,待 Agent 重新处理"
                            : "打回,要求提升为全局提案"}
                        </button>
                      )}
                    </div>
                  );
                })}

                <p className="prs-lane-title" style={{ marginTop: 14 }}>
                  开放缺口 · {OPEN_GAPS.length}
                </p>
                {OPEN_GAPS.map((gap) => (
                  <div className="prs-audit-item" key={gap.id}>
                    <div className="prs-fb">
                      <span className="prs-chip" data-tone="pink">
                        缺口
                      </span>
                      <span>{gap.title}</span>
                    </div>
                    <div className="prs-dest" data-type="no-change">
                      <span className="prs-dest-mark">◆</span>
                      <span>{gap.note}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
