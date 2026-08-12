"use client";

import { useState } from "react";

/* Shared mock model + DS Browser shell for the Rule Update Review prototype
 * (Issue 34). Variants differ ONLY in how the proposal card signals state;
 * data, copy, and interaction logic all live here so the comparison isolates
 * the signaling axis.
 *
 * Language: UI chrome is English (matching the production DS Browser);
 * design-system content (rules, proposals, reasons, exchanges) is Chinese. */

export type ProposalKind = "new" | "update" | "move";
export type ProposalState = "pending" | "accepted";

export interface Exchange {
  author: "设计师" | "Agent";
  text: string;
}

export interface Proposal {
  id: string;
  kind: ProposalKind;
  categoryId: string;
  /** update 提案紧贴的目标 Rule。 */
  targetRuleId?: string;
  /** move 提案的来源位置说明。 */
  moveFrom?: { categoryId: string; ruleTitle: string };
  title: string;
  body: string;
  reason: string;
  revision: number;
  revisedBy?: string;
  exchanges: Exchange[];
  state: ProposalState;
}

export interface Rule {
  id: string;
  categoryId: string;
  title: string;
  body: string;
  origin: string;
}

export interface Category {
  id: string;
  label: string;
}

/** All interactions:每条记录 = 一个决定事实(Issue 39)。 */
export interface HistoryRecord {
  id: string;
  reviewId: string;
  /** 指向仍存在(未 rejected)的 proposal 时可深链。 */
  proposalId?: string;
  kind: "created" | "revision" | "accepted" | "rejected";
  title: string;
  categoryId: string;
  fact: string;
  exchanges: Exchange[];
  /** 终局标签:proposal 已不在规则流时显示(Rejected / Applied as rule)。 */
  terminalLabel?: string;
}

export const CATEGORIES: Category[] = [
  { id: "color", label: "Color" },
  { id: "typography", label: "Typography" },
  { id: "layout", label: "Layout" },
  { id: "component", label: "Component" },
  { id: "interaction", label: "Interaction" }
];

export const RULES: Rule[] = [
  {
    id: "color-r1",
    categoryId: "color",
    title: "语义色成对出现",
    body: "成功、警告、危险等语义色必须同时定义前景与背景对,并以配对形式使用;禁止将语义色单独用作正文文本色。",
    origin: "seed · Foundation/Colors"
  },
  {
    id: "color-r2",
    categoryId: "color",
    title: "中性灰阶梯固定为八级",
    body: "界面灰阶只取自 8 级阶梯,相邻级差保持感知均匀;组件不得引入阶梯之外的中间灰。",
    origin: "seed · Foundation/Colors"
  },
  {
    id: "typo-r1",
    categoryId: "typography",
    title: "正文行高保持 1.5–1.6",
    body: "长文正文行高不低于 1.5;密集列表可降至 1.45,但不得更低。",
    origin: "seed · Foundation/Type"
  },
  {
    id: "layout-r1",
    categoryId: "layout",
    title: "页面左右留白随断点收敛",
    body: "主内容最大宽度 1120;窄断点下左右留白收敛为 20px 安全边距。",
    origin: "seed · Foundation/Layout"
  },
  {
    id: "comp-r1",
    categoryId: "component",
    title: "按钮高度固定 32 / 40 两档",
    body: "默认 32;强调与表单主操作 40。不得出现其他高度。",
    origin: "seed · Components/Button"
  },
  {
    id: "int-r1",
    categoryId: "interaction",
    title: "悬停反馈不超过 150ms",
    body: "所有悬停态在 150ms 内以 ease-out 完成;禁止 ease-in,禁止超过 200ms 的 UI 过渡。",
    origin: "seed · Foundation/Motion"
  }
];

const INITIAL_PROPOSALS: Proposal[] = [
  {
    id: "p1",
    kind: "new",
    categoryId: "color",
    title: "强调色仅用于主行动点",
    body: "每屏至多一个填充式强调按钮;其余操作使用描边或文字样式。危险操作不与品牌强调色同屏竞争注意力。",
    reason:
      "「设置页 v2」原型中填充式 danger 与 accent 按钮同屏出现,设计师指出「红色太多,主次不清」。",
    revision: 1,
    exchanges: [
      { author: "设计师", text: "这个页面红色太多了,保存和删除看起来一样重。" },
      { author: "Agent", text: "提议新增全局规则:将填充式强调限制为每屏一个主行动点。" }
    ],
    state: "pending"
  },
  {
    id: "p2",
    kind: "update",
    categoryId: "color",
    targetRuleId: "color-r1",
    title: "语义色成对出现",
    body: "成功、警告、危险等语义色必须同时定义前景与背景对,并以配对形式使用。数据可视化中的系列色不受此限,但同一图表内不得超过六个色相。",
    reason: "图表页验证时设计师确认「图表里不需要成对」,原规则需要增加数据可视化例外。",
    revision: 2,
    revisedBy: "设计师",
    exchanges: [
      { author: "设计师", text: "图表里不用成对吧,不然没法画。" },
      { author: "Agent", text: "已在提案正文中加入数据可视化例外,配对要求保持不变。" }
    ],
    state: "pending"
  },
  {
    id: "p3",
    kind: "new",
    categoryId: "typography",
    title: "数字统一使用 tabular-nums",
    body: "表格、统计与计时数字必须启用 tabular-nums,避免列宽随内容跳动。",
    reason: "订单列表页金额列在刷新时横向抖动,设计师确认「数字要定宽」。",
    revision: 1,
    exchanges: [{ author: "设计师", text: "数字要定宽,不然每次刷新都在抖。" }],
    state: "accepted"
  },
  {
    id: "p4",
    kind: "move",
    categoryId: "interaction",
    moveFrom: { categoryId: "component", ruleTitle: "Destructive 操作必须二次确认" },
    title: "Destructive 操作必须二次确认",
    body: "删除、清空等不可逆操作必须经过显式二次确认;确认层使用 danger 色,并把焦点移入确认操作。",
    reason: "该规则约束操作行为而非组件外观,评审中设计师同意从「组件」移至「交互」。",
    revision: 1,
    exchanges: [{ author: "设计师", text: "这条其实不是说按钮长什么样,是说流程。" }],
    state: "pending"
  }
];

const REVIEWS: { id: string; label: string }[] = [
  { id: "r3", label: "Review 3 · from 「设置页 v2」 prototype validation" },
  { id: "r2", label: "Review 2 · from 「订单列表」 prototype validation" }
];

const INITIAL_HISTORY: HistoryRecord[] = [
  {
    id: "h1",
    reviewId: "r3",
    proposalId: "p1",
    kind: "created",
    title: "强调色仅用于主行动点",
    categoryId: "color",
    fact: "Proposal published · New rule",
    exchanges: [
      { author: "设计师", text: "这个页面红色太多了,保存和删除看起来一样重。" },
      { author: "Agent", text: "提议新增全局规则:将填充式强调限制为每屏一个主行动点。" }
    ]
  },
  {
    id: "h2",
    reviewId: "r3",
    proposalId: "p2",
    kind: "revision",
    title: "语义色成对出现",
    categoryId: "color",
    fact: "revision 2 · edited by designer",
    exchanges: [
      { author: "设计师", text: "图表里不用成对吧,不然没法画。" },
      { author: "Agent", text: "已在提案正文中加入数据可视化例外,配对要求保持不变。" }
    ]
  },
  {
    id: "h3",
    reviewId: "r3",
    proposalId: "p3",
    kind: "accepted",
    title: "数字统一使用 tabular-nums",
    categoryId: "typography",
    fact: "Accepted · waiting for Agent",
    exchanges: [{ author: "设计师", text: "数字要定宽,不然每次刷新都在抖。" }]
  },
  {
    id: "h4",
    reviewId: "r3",
    proposalId: "p4",
    kind: "created",
    title: "Destructive 操作必须二次确认",
    categoryId: "interaction",
    fact: "Move proposed · from Component",
    exchanges: [{ author: "设计师", text: "这条其实不是说按钮长什么样,是说流程。" }]
  },
  {
    id: "h5",
    reviewId: "r2",
    kind: "rejected",
    title: "阴影层级固定为四级",
    categoryId: "color",
    fact: "Rejected · not promoted to a rule",
    exchanges: [
      { author: "设计师", text: "阴影先不定死,这个项目我想再试试。" },
      { author: "Agent", text: "已记录:该提案不提升为全局规则,保留在本轮审查记录中。" }
    ],
    terminalLabel: "Rejected"
  },
  {
    id: "h6",
    reviewId: "r2",
    kind: "accepted",
    title: "圆角阶梯固定为 4 / 8 / 12",
    categoryId: "component",
    fact: "Accepted · applied as rule",
    exchanges: [
      { author: "设计师", text: "圆角就按这三档走,可以定下来。" },
      { author: "Agent", text: "已写入设计系统:组件/圆角。" }
    ],
    terminalLabel: "Applied as rule"
  }
];

export const STATUS_LABEL: Record<ProposalState, string> = {
  pending: "Pending review",
  accepted: "Waiting for Agent"
};

export const KIND_LABEL: Record<ProposalKind, string> = {
  new: "New rule",
  update: "Update",
  move: "Move"
};

export interface ReviewModel {
  proposals: Proposal[];
  history: HistoryRecord[];
  /** 当前视图:categoryId 或 "interactions"。 */
  view: string;
  setActiveCategory: (id: string) => void;
  openInteractions: () => void;
  isExpanded: (id: string) => boolean;
  toggleExpand: (id: string) => void;
  isExchangesOpen: (id: string) => boolean;
  toggleExchanges: (id: string) => void;
  isExiting: (id: string) => boolean;
  flashId: string | null;
  editingId: string | null;
  draft: { title: string; body: string; categoryId: string } | null;
  startEdit: (p: Proposal) => void;
  cancelEdit: () => void;
  setDraft: (draft: { title: string; body: string; categoryId: string }) => void;
  saveEdit: () => void;
  accept: (id: string) => void;
  reject: (id: string) => void;
  hasUnfinished: (categoryId: string) => boolean;
  jumpToProposal: (proposalId: string) => void;
  proposalExists: (proposalId: string | undefined) => boolean;
}

export function useReviewModel(): ReviewModel {
  const [proposals, setProposals] = useState<Proposal[]>(INITIAL_PROPOSALS);
  const [history, setHistory] = useState<HistoryRecord[]>(INITIAL_HISTORY);
  const [view, setView] = useState("color");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [exchangesOpen, setExchangesOpen] = useState<Record<string, boolean>>({});
  const [exiting, setExiting] = useState<Record<string, boolean>>({});
  const [flashId, setFlashId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ReviewModel["draft"]>(null);

  const isExpanded = (id: string) => expanded[id] ?? false;
  const toggleExpand = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  const isExchangesOpen = (id: string) => exchangesOpen[id] ?? false;
  const toggleExchanges = (id: string) =>
    setExchangesOpen((prev) => ({ ...prev, [id]: !prev[id] }));
  const isExiting = (id: string) => exiting[id] ?? false;

  // 新记录插到最前;渲染按 reviewId 分组且保持数组顺序,因此组内也是新在前。
  const appendHistory = (record: Omit<HistoryRecord, "id">) =>
    setHistory((prev) => [
      { ...record, id: `h-live-${prev.length}-${Date.now()}` },
      ...prev
    ]);

  const startEdit = (p: Proposal) => {
    setEditingId(p.id);
    setDraft({ title: p.title, body: p.body, categoryId: p.categoryId });
    setExpanded((prev) => ({ ...prev, [p.id]: true }));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(null);
  };

  const saveEdit = () => {
    if (!editingId || !draft) return;
    const target = proposals.find((p) => p.id === editingId);
    if (!target) return;
    const blank = draft.title.trim() === "" || draft.body.trim() === "";
    const unchanged =
      draft.title === target.title &&
      draft.body === target.body &&
      draft.categoryId === target.categoryId;
    // 空白或无变化保存不制造 revision(Issue 37)。
    if (blank || unchanged) {
      cancelEdit();
      return;
    }
    const nextRevision = target.revision + 1;
    setProposals((prev) =>
      prev.map((p) =>
        p.id === editingId
          ? {
              ...p,
              title: draft.title.trim(),
              body: draft.body.trim(),
              categoryId: draft.categoryId,
              revision: nextRevision,
              revisedBy: "设计师"
            }
          : p
      )
    );
    appendHistory({
      reviewId: "r3",
      proposalId: target.id,
      kind: "revision",
      title: draft.title.trim(),
      categoryId: draft.categoryId,
      fact: `revision ${nextRevision} · edited by designer`,
      exchanges: target.exchanges
    });
    if (draft.categoryId !== target.categoryId) {
      setView(draft.categoryId);
    }
    cancelEdit();
  };

  const accept = (id: string) => {
    // 编辑中不可接受:编辑态会结构性替换操作行,这里是兜底。
    if (editingId === id) return;
    const target = proposals.find((p) => p.id === id);
    setProposals((prev) =>
      prev.map((p) => (p.id === id ? { ...p, state: "accepted" } : p))
    );
    if (target) {
      appendHistory({
        reviewId: "r3",
        proposalId: id,
        kind: "accepted",
        title: target.title,
        categoryId: target.categoryId,
        fact: `Accepted · revision ${target.revision} · waiting for Agent`,
        exchanges: target.exchanges
      });
    }
  };

  const reject = (id: string) => {
    if (editingId === id) cancelEdit();
    const target = proposals.find((p) => p.id === id);
    setExiting((prev) => ({ ...prev, [id]: true }));
    if (target) {
      appendHistory({
        reviewId: "r3",
        proposalId: id,
        kind: "rejected",
        title: target.title,
        categoryId: target.categoryId,
        fact: "Rejected · not promoted to a rule",
        exchanges: target.exchanges,
        terminalLabel: "Rejected"
      });
    }
    window.setTimeout(() => {
      setProposals((prev) => prev.filter((p) => p.id !== id));
    }, 260);
  };

  // 绿点 = 该类别有未完成 proposal(已接受但待 Agent 写入也算未完成)。
  const hasUnfinished = (categoryId: string) =>
    proposals.some((p) => p.categoryId === categoryId && !isExiting(p.id));

  const jumpToProposal = (proposalId: string) => {
    const p = proposals.find((item) => item.id === proposalId);
    if (!p) return;
    setView(p.categoryId);
    setExpanded((prev) => ({ ...prev, [p.id]: true }));
    setFlashId(p.id);
    window.setTimeout(() => setFlashId(null), 1400);
  };

  const proposalExists = (proposalId: string | undefined) =>
    !!proposalId && proposals.some((p) => p.id === proposalId);

  return {
    proposals,
    history,
    view,
    setActiveCategory: setView,
    openInteractions: () => setView("interactions"),
    isExpanded,
    toggleExpand,
    isExchangesOpen,
    toggleExchanges,
    isExiting,
    flashId,
    editingId,
    draft,
    startEdit,
    cancelEdit,
    setDraft,
    saveEdit,
    accept,
    reject,
    hasUnfinished,
    jumpToProposal,
    proposalExists
  };
}

/* --------------------------------- chrome --------------------------------- */

export function StatusChip({ state }: { state: ProposalState }) {
  return (
    <span className="rur-chip" data-status={state}>
      {STATUS_LABEL[state]}
    </span>
  );
}

export function Chevron() {
  return (
    <svg
      className="rur-chevron"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4.5 2.5 8 6l-3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <circle cx="6.5" cy="6.5" r="5.25" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M6.5 3.75v2.75l1.75 1"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* --------------------------- card body (shared) ---------------------------- */

export function CardDetail({ p, model }: { p: Proposal; model: ReviewModel }) {
  const currentRule =
    p.kind === "update" ? RULES.find((r) => r.id === p.targetRuleId) : undefined;
  const exchangesOpen = model.isExchangesOpen(p.id);

  return (
    <div className="rur-card-detail">
      {p.kind === "move" && p.moveFrom ? (
        <span className="rur-move-note">
          Moved from{" "}
          {CATEGORIES.find((c) => c.id === p.moveFrom?.categoryId)?.label ?? ""} ·{" "}
          {p.moveFrom.ruleTitle}
        </span>
      ) : null}

      {p.kind === "update" && currentRule ? (
        <>
          <div>
            <p className="rur-block-label">Proposed</p>
            <p className="rur-proposed-body">{p.body}</p>
          </div>
          <div>
            <p className="rur-block-label">Current</p>
            <p className="rur-current-body">{currentRule.body}</p>
          </div>
        </>
      ) : (
        <p className="rur-proposed-body">{p.body}</p>
      )}

      <div>
        <p className="rur-block-label">Reason</p>
        <p className="rur-reason">{p.reason}</p>
      </div>

      <Exchanges
        id={p.id}
        exchanges={p.exchanges}
        open={exchangesOpen}
        onToggle={() => model.toggleExchanges(p.id)}
      />

      <span className="rur-revision-caption">
        {STATUS_LABEL[p.state]} · {KIND_LABEL[p.kind]} · revision {p.revision}
        {p.revisedBy ? " · edited by designer" : ""}
      </span>
    </div>
  );
}

export function Exchanges({
  id,
  exchanges,
  open,
  onToggle
}: {
  id: string;
  exchanges: Exchange[];
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <button
        type="button"
        className="rur-exchanges-toggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        <Chevron />
        Exchanges · {exchanges.length}
      </button>
      <div className="rur-exchanges" data-open={open} id={`exchanges-${id}`}>
        <div className="rur-exchanges-inner">
          {exchanges.map((ex, i) => (
            <div className="rur-exchange" key={i}>
              <span className="rur-exchange-author">
                {ex.author === "设计师" ? "Designer" : "Agent"}
              </span>
              <p className="rur-exchange-text">{ex.text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function CardEditor({ p, model }: { p: Proposal; model: ReviewModel }) {
  const draft = model.draft;
  if (!draft) return null;
  return (
    <div className="rur-card-detail">
      <div className="rur-editor">
        <input
          className="rur-editor-title"
          value={draft.title}
          aria-label="Proposal title"
          onChange={(e) => model.setDraft({ ...draft, title: e.target.value })}
        />
        <textarea
          className="rur-editor-body"
          value={draft.body}
          aria-label="Proposal body"
          onChange={(e) => model.setDraft({ ...draft, body: e.target.value })}
        />
        <label className="rur-editor-row">
          Category
          <select
            className="rur-editor-select"
            value={draft.categoryId}
            onChange={(e) => model.setDraft({ ...draft, categoryId: e.target.value })}
          >
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <div className="rur-actions">
          <button type="button" className="rur-action" onClick={model.cancelEdit}>
            Cancel
          </button>
          <span className="rur-actions-spacer" />
          <button
            type="button"
            className="rur-action"
            data-kind="save"
            onClick={model.saveEdit}
          >
            Save revision
          </button>
        </div>
        <p className="rur-editor-hint">
          Accept and Reject are unavailable while editing. Saving creates revision{" "}
          {p.revision + 1}; Cancel returns to revision {p.revision}.
        </p>
      </div>
    </div>
  );
}

export function CardActions({ p, model }: { p: Proposal; model: ReviewModel }) {
  if (p.state === "accepted") {
    return (
      <div className="rur-card-detail" style={{ paddingTop: 0 }}>
        <span className="rur-accepted-note">
          Accepted · waiting for Agent to write the design system
        </span>
      </div>
    );
  }
  return (
    <div className="rur-card-detail" style={{ paddingTop: 0 }}>
      <div className="rur-actions">
        <button type="button" className="rur-action" onClick={() => model.startEdit(p)}>
          Edit
        </button>
        <span className="rur-actions-spacer" />
        <button
          type="button"
          className="rur-action"
          data-kind="reject"
          onClick={() => model.reject(p.id)}
        >
          Reject
        </button>
        <button
          type="button"
          className="rur-action"
          data-kind="accept"
          onClick={() => model.accept(p.id)}
        >
          Accept
        </button>
      </div>
    </div>
  );
}

/* ---------------------------- All interactions ----------------------------- */

const RECORD_KIND_LABEL: Record<HistoryRecord["kind"], string> = {
  created: "Proposal",
  revision: "Revision",
  accepted: "Accepted",
  rejected: "Rejected"
};

function HistoryRecordRow({
  record,
  model
}: {
  record: HistoryRecord;
  model: ReviewModel;
}) {
  const open = model.isExchangesOpen(record.id);
  const linkable = model.proposalExists(record.proposalId);
  const categoryLabel =
    CATEGORIES.find((c) => c.id === record.categoryId)?.label ?? record.categoryId;

  return (
    <article className="rur-record">
      <div className="rur-record-head">
        <span className="rur-chip" data-record={record.kind}>
          {RECORD_KIND_LABEL[record.kind]}
        </span>
        <span className="rur-record-title">{record.title}</span>
        <span className="rur-record-fact">{record.fact}</span>
        {linkable && record.proposalId ? (
          <button
            type="button"
            className="rur-tag"
            onClick={() => model.jumpToProposal(record.proposalId!)}
            aria-label={`Open this rule update in ${categoryLabel}`}
          >
            {categoryLabel} →
          </button>
        ) : (
          <span className="rur-chip">{record.terminalLabel ?? categoryLabel}</span>
        )}
        <button
          type="button"
          className="rur-info-btn"
          aria-expanded={open}
          aria-label="View the frozen transcript for this record"
          onClick={() => model.toggleExchanges(record.id)}
        >
          ⓘ
        </button>
      </div>
      <div className="rur-exchanges" data-open={open}>
        <div className="rur-exchanges-inner">
          <p className="rur-block-label" style={{ marginTop: 8 }}>
            Frozen transcript
          </p>
          {record.exchanges.map((ex, i) => (
            <div className="rur-exchange" key={i}>
              <span className="rur-exchange-author">
                {ex.author === "设计师" ? "Designer" : "Agent"}
              </span>
              <p className="rur-exchange-text">{ex.text}</p>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}

function InteractionsPage({ model }: { model: ReviewModel }) {
  return (
    <div className="rur-content">
      <div>
        <h1 className="rur-h1">All interactions</h1>
        <p className="rur-review-context">
          Only decisions and transcripts frozen by the Agent at review time appear
          here — host chat outside reconciliation is not part of this history.
        </p>
      </div>
      {REVIEWS.map((review) => {
        const records = model.history.filter((r) => r.reviewId === review.id);
        if (records.length === 0) return null;
        return (
          <section className="rur-section" key={review.id}>
            <h2 className="rur-group-label">{review.label}</h2>
            <div className="rur-flow" style={{ gap: 8 }}>
              {records.map((record) => (
                <HistoryRecordRow key={record.id} record={record} model={model} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/* ---------------------------------- shell ---------------------------------- */

export function Shell({
  model,
  renderProposal
}: {
  model: ReviewModel;
  renderProposal: (p: Proposal) => React.ReactNode;
}) {
  const inInteractions = model.view === "interactions";
  const active =
    CATEGORIES.find((c) => c.id === model.view) ?? CATEGORIES[0];
  const rules = RULES.filter((r) => r.categoryId === active.id);
  const proposals = model.proposals.filter((p) => p.categoryId === active.id);
  // 新规则与移入提案置顶;更新提案贴在目标 Rule 下方。
  const topProposals = proposals.filter((p) => p.kind !== "update");
  const updatesFor = (ruleId: string) =>
    proposals.filter((p) => p.kind === "update" && p.targetRuleId === ruleId);
  // 来源类别的移动说明(Issue 36):只读溯源,点击跳到目标类别并展开。
  const moveTraces = model.proposals.filter(
    (p) => p.kind === "move" && p.moveFrom?.categoryId === active.id
  );

  return (
    <div className="rur">
      <div className="rur-page">
        <div className="rur-canvas" aria-hidden="true">
          <div className="rur-surface">
            <div className="rur-surface-chrome" />
            <div className="rur-surface-shot" />
          </div>
          <div className="rur-surface">
            <div className="rur-surface-chrome" />
            <div className="rur-surface-shot" />
          </div>
        </div>

        <div className="rur-sheet">
          <div className="rur-body">
            <aside className="rur-sidebar">
              <span className="rur-sidebar-title">Design System</span>
              <nav className="rur-nav-list" aria-label="Design system categories">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="rur-navrow"
                    data-active={!inInteractions && c.id === active.id || undefined}
                    data-pending={model.hasUnfinished(c.id) || undefined}
                    onClick={() => model.setActiveCategory(c.id)}
                  >
                    <span className="rur-navrow-label">{c.label}</span>
                    {model.hasUnfinished(c.id) ? (
                      <span className="rur-nav-dot" aria-label="Has unfinished rule updates" />
                    ) : null}
                  </button>
                ))}
              </nav>
              <div className="rur-sidebar-footer">
                <button
                  type="button"
                  className="rur-navrow"
                  data-active={inInteractions || undefined}
                  onClick={model.openInteractions}
                >
                  <span className="rur-navrow-icon">
                    <HistoryIcon />
                  </span>
                  <span className="rur-navrow-label">All interactions</span>
                </button>
              </div>
            </aside>

            <main className="rur-main">
              <div className="rur-main-top">
                <span className="rur-breadcrumb">
                  Design system <span aria-hidden="true">/</span>{" "}
                  <span className="rur-breadcrumb-current">
                    {inInteractions ? "All interactions" : active.label}
                  </span>
                </span>
              </div>
              <div className="rur-page-scroll">
                {inInteractions ? (
                  <InteractionsPage model={model} />
                ) : (
                  <div className="rur-content">
                    <div>
                      <h1 className="rur-h1">{active.label}</h1>
                      <p className="rur-review-context">
                        Review 3 · proposals from 「设置页 v2」 prototype validation
                      </p>
                    </div>

                    <section className="rur-section">
                      <h2 className="rur-group-label">Rules</h2>
                      <div className="rur-flow">
                        {topProposals.map((p) => renderProposal(p))}
                        {rules.map((rule) => (
                          <RuleCard key={rule.id} rule={rule}>
                            {updatesFor(rule.id).map((p) => renderProposal(p))}
                          </RuleCard>
                        ))}
                        {moveTraces.map((p) => (
                          <button
                            key={`trace-${p.id}`}
                            type="button"
                            className="rur-trace"
                            onClick={() => model.jumpToProposal(p.id)}
                          >
                            「{p.title}」 proposed to move to{" "}
                            {CATEGORIES.find((c) => c.id === p.categoryId)?.label} →
                          </button>
                        ))}
                      </div>
                    </section>
                  </div>
                )}
              </div>
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}

function RuleCard({ rule, children }: { rule: Rule; children?: React.ReactNode }) {
  return (
    <>
      <article className="rur-rule">
        <div className="rur-rule-head">
          <span className="rur-rule-title">{rule.title}</span>
          <span className="rur-chip" data-status="formalized">
            Confirmed
          </span>
        </div>
        <p className="rur-rule-body">{rule.body}</p>
        <div className="rur-rule-caption">
          <span className="rur-origin-tag">source capture</span>
          <span>{rule.origin}</span>
        </div>
      </article>
      {children}
    </>
  );
}
