"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight01Icon,
  Edit02Icon,
  InformationCircleIcon
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { subscribeRuntimeEvents } from "@/components/runtime/runtime-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ruleUpdateCategories,
  ruleUpdateCategoryArtifact,
  ruleUpdateCategoryLabel,
  type RuleUpdateCategory
} from "@/lib/runtime/rule-update-category";

export type { RuleUpdateCategory } from "@/lib/runtime/rule-update-category";

export type RuleUpdateProposalView = {
  id: string;
  review_id: string;
  kind: "new" | "update" | "move";
  classification: string;
  title: string;
  full_rule_body: string;
  current_rule_body: string | null;
  reason: string;
  affected_items: string[];
  status: "pending_review" | "waiting_agent" | "applied" | "rejected" | "failed" | "needs_revision";
  target: {
    category: RuleUpdateCategory;
    sourceCategory: RuleUpdateCategory | null;
    sourceArtifactPath: string | null;
    entryId: string | null;
    proposedTargetPath: string | null;
  };
  revision: number;
  revision_author: "agent" | "designer";
  created_at: string;
  revised_at: string;
  decided_at: string | null;
};

export type RuleUpdateReviewView = {
  id: string;
  status: "published" | "completed";
  context: string;
  created_at: string;
  published_at: string | null;
  completed_at: string | null;
  run_id: string | null;
  session_id: string | null;
  transcript: Array<{ id: string; role: "designer" | "agent"; content: string }>;
  interactions: Array<{
    id: string;
    kind: "proposal" | "revision" | "accepted" | "rejected" | "applied" | "failed";
    proposal_id: string;
    revision: number;
    title: string;
    description: string;
    created_at: string;
    target_category: RuleUpdateCategory;
    terminal: boolean;
  }>;
  proposals: RuleUpdateProposalView[];
};

export type RuleUpdateProjection = {
  reviews: RuleUpdateReviewView[];
  categories_with_unfinished_proposals: RuleUpdateCategory[];
};

export function useRuleUpdateReviewView(session: string, open: boolean) {
  const [projection, setProjection] = useState<RuleUpdateProjection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/rule-update-review", {
        headers: { "x-ikran-session": session },
        cache: "no-store"
      });
      const data = await response.json() as RuleUpdateProjection & { ok?: boolean; error?: string };
      if (!response.ok || data.ok !== true) {
        setError(data.error ?? "rule_update_review_unavailable");
        return;
      }
      setProjection({
        reviews: data.reviews,
        categories_with_unfinished_proposals: data.categories_with_unfinished_proposals
      });
      setError(null);
    } catch {
      setError("network");
    }
  }, [session]);
  useEffect(() => {
    if (open) void load();
  }, [load, open]);
  useEffect(
    () => subscribeRuntimeEvents(session, {
      onRecord: (event) => {
        if (event.kind === "rule-update" || event.kind === "design-system") void load();
      }
    }),
    [load, session]
  );
  return { projection, error, reload: load };
}

export function categoryLabel(category: RuleUpdateCategory): string {
  return ruleUpdateCategoryLabel(category);
}

function proposalStatusLabel(status: RuleUpdateProposalView["status"]): string {
  if (status === "waiting_agent") return "Waiting for Agent";
  if (status === "needs_revision") return "Needs revision";
  if (status === "failed") return "Apply failed";
  return "Pending review";
}

async function postReviewAction(
  session: string,
  action: "revise" | "decide",
  input: unknown
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch("/api/rule-update-review", {
      method: "POST",
      headers: {
        "x-ikran-session": session,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ action, input })
    });
    const data = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
    return response.ok && data.ok === true
      ? { ok: true }
      : { ok: false, error: data.error ?? `${action}_failed` };
  } catch {
    return { ok: false, error: "network" };
  }
}

function ProposalCard({
  proposal,
  transcript,
  session,
  categories,
  onChanged
  ,focused
}: {
  proposal: RuleUpdateProposalView;
  transcript: RuleUpdateReviewView["transcript"];
  session: string;
  categories: RuleUpdateCategory[];
  onChanged: () => Promise<unknown>;
  focused: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [exchangesOpen, setExchangesOpen] = useState(false);
  const [title, setTitle] = useState(proposal.title);
  const [body, setBody] = useState(proposal.full_rule_body);
  const [category, setCategory] = useState<RuleUpdateCategory>(proposal.target.category);
  const [busy, setBusy] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!focused) return;
    setOpen(true);
    cardRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focused]);

  const decide = async (decision: "accepted" | "rejected") => {
    setBusy(true);
    setError(null);
    const result = await postReviewAction(session, "decide", {
      proposalId: proposal.id,
      decision
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (decision === "rejected") {
      setExiting(true);
      window.setTimeout(() => void onChanged(), 240);
    } else {
      await onChanged();
    }
  };

  const save = async () => {
    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();
    if (!trimmedTitle || !trimmedBody) {
      setError("Title and proposed rule are required.");
      return;
    }
    const targetPath = ruleUpdateCategoryArtifact(category);
    setBusy(true);
    setError(null);
    const result = await postReviewAction(session, "revise", {
      proposalId: proposal.id,
      title: trimmedTitle,
      fullRuleBody: trimmedBody,
      target: {
        category,
        sourceCategory: proposal.target.sourceCategory ?? undefined,
        sourceArtifactPath: proposal.kind === "move" ? proposal.target.sourceArtifactPath : targetPath,
        entryId: proposal.target.entryId ?? undefined,
        proposedTargetPath: proposal.kind === "move" ? targetPath : undefined
      }
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEditing(false);
    await onChanged();
  };

  return (
    <div className="dsb-ru-slot" data-exiting={exiting || undefined}>
      <article ref={cardRef} className="dsb-ru-card" data-open={open || undefined} data-status={proposal.status} data-flash={focused || undefined}>
        <button
          type="button"
          className="dsb-ru-head"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="dsb-ru-title">{proposal.title}</span>
          <span className="dsb-ru-status" data-status={proposal.status}>
            {proposalStatusLabel(proposal.status)}
          </span>
          <HugeiconsIcon icon={ArrowRight01Icon} size={14} className="dsb-ru-chevron" color="currentColor" strokeWidth={2} />
        </button>
        <div className="dsb-ru-body">
          <div className="dsb-ru-body-inner">
            {editing ? (
              <div className="dsb-ru-editor">
                <label>Title<Input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
                <label>Proposed<Textarea value={body} onChange={(event) => setBody(event.target.value)} rows={4} /></label>
                <label>Category
                  <select value={category} onChange={(event) => setCategory(event.target.value as RuleUpdateCategory)}>
                    {categories.map((item) => <option key={item} value={item}>{categoryLabel(item)}</option>)}
                  </select>
                </label>
                <div className="dsb-ru-actions">
                  <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>
                  <Button type="button" size="sm" disabled={busy} onClick={() => void save()}>Save revision</Button>
                </div>
              </div>
            ) : (
              <div className="dsb-ru-detail">
                <div><span className="dsb-ru-label">Proposed</span><p>{proposal.full_rule_body}</p></div>
                {proposal.kind === "update" && proposal.current_rule_body ? (
                  <div><span className="dsb-ru-label">Current</span><p>{proposal.current_rule_body}</p></div>
                ) : null}
                <div><span className="dsb-ru-label">Reason</span><p>{proposal.reason}</p></div>
                {proposal.affected_items.length > 0 ? (
                  <div><span className="dsb-ru-label">Affected</span><p>{proposal.affected_items.join(" · ")}</p></div>
                ) : null}
                <div className="dsb-ru-exchanges" data-open={exchangesOpen || undefined}>
                  <button type="button" onClick={() => setExchangesOpen((value) => !value)}>
                    Exchanges <HugeiconsIcon icon={ArrowRight01Icon} size={13} color="currentColor" strokeWidth={2} />
                  </button>
                  <div>{transcript.map((message) => (
                    <p key={message.id}><strong>{message.role === "designer" ? "Designer" : "Agent"}</strong>{message.content}</p>
                  ))}</div>
                </div>
                <p className="dsb-ru-caption">
                  {proposalStatusLabel(proposal.status)} · {proposal.kind[0]!.toUpperCase() + proposal.kind.slice(1)} · revision {proposal.revision}
                  {proposal.revision_author === "designer" ? " · edited by designer" : ""}
                </p>
                {proposal.status === "waiting_agent" ? (
                  <p className="dsb-ru-wait-copy">Decision sent. The Agent will apply this exact revision.</p>
                ) : proposal.status === "failed" ? (
                  <p className="dsb-ru-wait-copy">Application failed. The Agent can retry the same command.</p>
                ) : proposal.status === "needs_revision" ? (
                  <div className="dsb-ru-actions">
                    <Button type="button" size="sm" disabled={busy} onClick={() => setEditing(true)}>
                      <HugeiconsIcon icon={Edit02Icon} size={13} color="currentColor" strokeWidth={2} /> Modify
                    </Button>
                  </div>
                ) : (
                  <div className="dsb-ru-actions">
                    <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(true)}>
                      <HugeiconsIcon icon={Edit02Icon} size={13} color="currentColor" strokeWidth={2} /> Modify
                    </Button>
                    <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void decide("rejected")}>Reject</Button>
                    <Button type="button" size="sm" disabled={busy} onClick={() => void decide("accepted")}>Accept</Button>
                  </div>
                )}
              </div>
            )}
            {error ? <p className="dsb-ru-error" role="alert">{error}</p> : null}
          </div>
        </div>
      </article>
    </div>
  );
}

export function RuleUpdateCategoryStream({
  category,
  projection,
  session,
  componentCategories,
  onChanged,
  onNavigate
  ,focusProposalId
}: {
  category: RuleUpdateCategory;
  projection: RuleUpdateProjection;
  session: string;
  componentCategories: RuleUpdateCategory[];
  onChanged: () => Promise<unknown>;
  onNavigate: (category: RuleUpdateCategory, proposalId: string) => void;
  focusProposalId: string | null;
}) {
  const categories = useMemo(
    () => ruleUpdateCategories(componentCategories),
    [componentCategories]
  );
  const active = projection.reviews.flatMap((review) =>
    review.proposals
      .filter((proposal) =>
        proposal.target.category === category &&
        !["applied", "rejected"].includes(proposal.status) &&
        (proposal.kind !== "update" || proposal.target.entryId === null)
      )
      .map((proposal) => ({ proposal, review }))
  );
  const traces = projection.reviews.flatMap((review) => review.proposals)
    .filter((proposal) => proposal.kind === "move" && proposal.target.sourceCategory === category && proposal.target.category !== category && proposal.status !== "rejected");
  if (active.length === 0 && traces.length === 0) return null;
  return (
    <section className="dsb-ru-stream" aria-label="Rule Update proposals">
      {active.map(({ proposal, review }) => (
        <ProposalCard key={proposal.id} proposal={proposal} transcript={review.transcript} session={session} categories={categories} onChanged={onChanged} focused={focusProposalId === proposal.id} />
      ))}
      {traces.map((proposal) => (
        <button key={`trace:${proposal.id}`} type="button" className="dsb-ru-trace" onClick={() => onNavigate(proposal.target.category, proposal.id)}>
          {proposal.title} moved to {categoryLabel(proposal.target.category)}
          <HugeiconsIcon icon={ArrowRight01Icon} size={13} color="currentColor" strokeWidth={2} />
        </button>
      ))}
    </section>
  );
}

export function RuleUpdateUpdatesForEntry({
  category,
  entryId,
  projection,
  session,
  componentCategories,
  onChanged,
  focusProposalId
}: {
  category: RuleUpdateCategory;
  entryId: string;
  projection: RuleUpdateProjection;
  session: string;
  componentCategories: RuleUpdateCategory[];
  onChanged: () => Promise<unknown>;
  focusProposalId: string | null;
}) {
  const categories = useMemo(
    () => ruleUpdateCategories(componentCategories),
    [componentCategories]
  );
  const active = projection.reviews.flatMap((review) =>
    review.proposals
      .filter((proposal) =>
        proposal.kind === "update" &&
        proposal.target.category === category &&
        proposal.target.entryId === entryId &&
        !["applied", "rejected"].includes(proposal.status)
      )
      .map((proposal) => ({ proposal, review }))
  );
  if (active.length === 0) return null;
  return (
    <>
      {active.map(({ proposal, review }) => (
        <ProposalCard
          key={proposal.id}
          proposal={proposal}
          transcript={review.transcript}
          session={session}
          categories={categories}
          onChanged={onChanged}
          focused={focusProposalId === proposal.id}
        />
      ))}
    </>
  );
}

export function RuleUpdateInteractionsPage({
  projection,
  onNavigate
}: {
  projection: RuleUpdateProjection;
  onNavigate: (category: RuleUpdateCategory, proposalId: string) => void;
}) {
  const [openTranscript, setOpenTranscript] = useState<string | null>(null);
  return (
    <div className="dsb-ru-history" data-testid="rule-update-all-interactions">
      <header><h1>All interactions</h1><p>Only decisions and transcripts frozen by the Agent at review time appear here.</p></header>
      {projection.reviews.map((review) => (
        <section key={review.id} className="dsb-ru-history-group">
          <div className="dsb-ru-history-group-head">
            <div>
              <h2>{review.context}</h2>
              <small>
                {review.published_at ?? review.created_at}
                {review.run_id ? ` · run ${review.run_id}` : ""}
                {review.session_id ? ` · session ${review.session_id}` : ""}
              </small>
            </div>
            <span>{review.status}</span>
          </div>
          {review.interactions.map((fact) => (
            <article key={fact.id} className="dsb-ru-record">
              <div className="dsb-ru-record-head">
                <span className="dsb-ru-record-kind" data-kind={fact.kind}>{fact.kind[0]!.toUpperCase() + fact.kind.slice(1)}</span>
                <strong>{fact.title}</strong>
                <span>{fact.description}</span>
                {fact.terminal ? <span className="dsb-ru-terminal">{fact.target_category}</span> : (
                  <button type="button" className="dsb-ru-category" onClick={() => onNavigate(fact.target_category, fact.proposal_id)}>{categoryLabel(fact.target_category)}</button>
                )}
                <button type="button" className="dsb-ru-info" aria-label="Show frozen transcript" aria-expanded={openTranscript === fact.id} onClick={() => setOpenTranscript((value) => value === fact.id ? null : fact.id)}>
                  <HugeiconsIcon icon={InformationCircleIcon} size={14} color="currentColor" strokeWidth={2} />
                </button>
              </div>
              {openTranscript === fact.id ? <div className="dsb-ru-transcript">{review.transcript.map((message) => <p key={message.id}><strong>{message.role === "designer" ? "Designer" : "Agent"}</strong>{message.content}</p>)}</div> : null}
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}
