"use client";

import {
  CardActions,
  CardDetail,
  CardEditor,
  Chevron,
  Shell,
  STATUS_LABEL,
  useReviewModel,
  type Proposal,
  type ReviewModel
} from "./shared";

/* Inline(排版派):无 chip 无圆点,状态是标题右侧一行小号文字——
 * "Pending review" 用绿字,"Waiting for Agent" 用灰字。最贴近纯文本
 * Rule 语言,但彩色文字在规则流里自成一个"颜色词"。 */

function InlineCard({ p, model }: { p: Proposal; model: ReviewModel }) {
  const open = model.isExpanded(p.id);
  const editing = model.editingId === p.id;
  return (
    <div className="rur-slot" data-exiting={model.isExiting(p.id) || undefined}>
      <article
        className="rur-card"
        data-variant="inline"
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
          <span className="rur-status-text" data-state={p.state}>
            {STATUS_LABEL[p.state]}
          </span>
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

export default function Inline() {
  const model = useReviewModel();
  return <Shell model={model} renderProposal={(p) => <InlineCard key={p.id} p={p} model={model} />} />;
}
