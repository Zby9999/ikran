"use client";

import {
  CardActions,
  CardDetail,
  CardEditor,
  Chevron,
  Shell,
  useReviewModel,
  type Proposal,
  type ReviewModel
} from "./shared";

/* Dot(圆点派):卡片上没有 chip,状态复用 Sidebar 的 5px 圆点语言——
 * 绿点 = 待审阅,灰点 = 等待 Agent,与类别行上的绿点形成同一词汇。
 * 状态文字只在展开后的 caption 里出现。 */

function DotCard({ p, model }: { p: Proposal; model: ReviewModel }) {
  const open = model.isExpanded(p.id);
  const editing = model.editingId === p.id;
  return (
    <div className="rur-slot" data-exiting={model.isExiting(p.id) || undefined}>
      <article
        className="rur-card"
        data-variant="dot"
        data-state={p.state}
        data-open={open}
        data-flash={model.flashId === p.id || undefined}
      >
        <button
          type="button"
          className="rur-card-head"
          aria-expanded={open}
          onClick={() => model.toggleExpand(p.id)}
        >
          <span className="rur-card-title">{p.title}</span>
          <span
            className="rur-dot"
            data-state={p.state}
            role="img"
            aria-label={p.state === "pending" ? "Pending review" : "Waiting for Agent"}
          />
          <Chevron />
        </button>
        <div className="rur-card-body">
          <div className="rur-card-body-inner">
            {editing ? (
              <CardEditor p={p} model={model} />
            ) : (
              <>
                <CardDetail p={p} model={model} />
                <CardActions p={p} model={model} />
              </>
            )}
          </div>
        </div>
      </article>
    </div>
  );
}

export default function Dot() {
  const model = useReviewModel();
  return <Shell model={model} renderProposal={(p) => <DotCard key={p.id} p={p} model={model} />} />;
}
