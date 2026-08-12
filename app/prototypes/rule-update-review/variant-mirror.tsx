"use client";

import {
  CardActions,
  CardDetail,
  CardEditor,
  Chevron,
  Shell,
  StatusChip,
  useReviewModel,
  type Proposal,
  type ReviewModel
} from "./shared";

/* Mirror(镜像派):提案卡的标题行与正式 Rule 完全同构——标题 + 同一位置、
 * 同一规格的单个状态 chip(Rule 是 Confirmed,提案是 Pending review /
 * Waiting for Agent)。kind 与 revision 降级为展开后的小字 caption,
 * chevron 仅 hover 出现。 */

function MirrorCard({ p, model }: { p: Proposal; model: ReviewModel }) {
  const open = model.isExpanded(p.id);
  const editing = model.editingId === p.id;
  return (
    <div className="rur-slot" data-exiting={model.isExiting(p.id) || undefined}>
      <article
        className="rur-card"
        data-variant="mirror"
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
          <StatusChip state={p.state} />
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

export default function Mirror() {
  const model = useReviewModel();
  return <Shell model={model} renderProposal={(p) => <MirrorCard key={p.id} p={p} model={model} />} />;
}
