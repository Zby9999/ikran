"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight01Icon,
  Edit02Icon,
  InformationCircleIcon,
  MultiplicationSignIcon,
  SaveIcon
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { subscribeRuntimeEvents } from "@/components/runtime/runtime-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
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

/**
 * True when any published Rule Update still has unfinished proposals —
 * the same signal Browser nav rows use for the red attention dot.
 */
export function useDesignSystemHasPendingRuleUpdate(
  session: string,
  enabled: boolean
): boolean {
  const [hasPending, setHasPending] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setHasPending(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/rule-update-review", {
          headers: { "x-ikran-session": session },
          cache: "no-store"
        });
        const data = (await response.json()) as RuleUpdateProjection & {
          ok?: boolean;
        };
        if (cancelled) return;
        if (!response.ok || data.ok !== true) {
          setHasPending(false);
          return;
        }
        setHasPending(data.categories_with_unfinished_proposals.length > 0);
      } catch {
        if (!cancelled) setHasPending(false);
      }
    };
    void load();
    const unsubscribe = subscribeRuntimeEvents(session, {
      onRecord: (event) => {
        if (event.kind === "rule-update" || event.kind === "design-system") {
          void load();
        }
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [session, enabled]);

  return hasPending;
}

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
  return "Pending Review";
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
  onChanged,
  focused,
  embedded = false,
  number
}: {
  proposal: RuleUpdateProposalView;
  transcript: RuleUpdateReviewView["transcript"];
  session: string;
  onChanged: () => Promise<unknown>;
  focused: boolean;
  embedded?: boolean;
  number?: number;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(proposal.title);
  const [body, setBody] = useState(proposal.full_rule_body);
  const [busy, setBusy] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cardRef = useRef<HTMLElement>(null);
  const dirty = title !== proposal.title || body !== proposal.full_rule_body;
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
    const targetPath = ruleUpdateCategoryArtifact(proposal.target.category);
    setBusy(true);
    setError(null);
    const result = await postReviewAction(session, "revise", {
      proposalId: proposal.id,
      title: trimmedTitle,
      fullRuleBody: trimmedBody,
      target: {
        category: proposal.target.category,
        sourceCategory: proposal.target.sourceCategory ?? undefined,
        sourceArtifactPath:
          proposal.kind === "move"
            ? proposal.target.sourceArtifactPath
            : targetPath,
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

  const cancelEditing = () => {
    setTitle(proposal.title);
    setBody(proposal.full_rule_body);
    setError(null);
    setEditing(false);
  };

  return (
    <div className="dsb-ru-slot" data-exiting={exiting || undefined}>
      <article
        ref={cardRef}
        className="dsb-ru-card"
        data-embedded={embedded || undefined}
        data-open={open || undefined}
        data-status={proposal.status}
        data-flash={focused || undefined}
      >
        {!embedded ? (
          <div className="dsb-ru-meta">
            <span className="dsb-ru-number" aria-hidden>
              {number ?? 1}
            </span>
            <span className="dsb-ru-status" data-status={proposal.status}>
              {proposalStatusLabel(proposal.status)}
            </span>
          </div>
        ) : null}
        <div className="dsb-ru-head">
          <div className="dsb-ru-title-row">
            {editing ? (
              <Input
                className="dsb-ru-title dsb-ru-inline-title"
                aria-label="Rule Update title"
                value={title}
                disabled={busy}
                autoFocus
                onChange={(event) => setTitle(event.target.value)}
              />
            ) : (
              <span className="dsb-ru-title">{proposal.title}</span>
            )}
            {embedded && !editing ? (
              <span
                className="dsb-ru-pending-dot"
                aria-label="Pending Rule Update"
              />
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="dsb-ru-toggle"
            aria-label={`${open ? "Collapse" : "Expand"} ${proposal.title}`}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              size={14}
              className="dsb-ru-chevron"
              color="currentColor"
              strokeWidth={2}
            />
          </Button>
        </div>
        <div className="dsb-ru-body">
          <div className="dsb-ru-body-inner">
            <div className="dsb-ru-detail">
              <div>
                <span className="dsb-ru-label">Proposed</span>
                {editing ? (
                  <Textarea
                    className="dsb-ru-inline-body"
                    aria-label="Proposed rule"
                    value={body}
                    disabled={busy}
                    rows={1}
                    onChange={(event) => setBody(event.target.value)}
                  />
                ) : (
                  <p>{proposal.full_rule_body}</p>
                )}
              </div>
              <div>
                <span className="dsb-ru-label">Reason</span>
                <p>{proposal.reason}</p>
              </div>
              {editing ? (
                <div className="dsb-ru-actions">
                  {dirty ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="dsb-rule-save-icon active:scale-[0.96] active:translate-y-0"
                      aria-label={`Save Rule Update ${proposal.title}`}
                      disabled={busy || !title.trim() || !body.trim()}
                      onClick={() => void save()}
                    >
                      <HugeiconsIcon
                        icon={SaveIcon}
                        size={12}
                        strokeWidth={1.5}
                        color="currentColor"
                        aria-hidden
                      />
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="dsb-rule-edit-icon active:scale-[0.96] active:translate-y-0"
                    aria-label={`Cancel editing Rule Update ${proposal.title}`}
                    aria-pressed="true"
                    disabled={busy}
                    onClick={cancelEditing}
                  >
                    <HugeiconsIcon
                      icon={MultiplicationSignIcon}
                      size={12}
                      strokeWidth={1.5}
                      color="currentColor"
                      aria-hidden
                    />
                  </Button>
                  {proposal.status === "pending_review" ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        className="dsb-ru-accept"
                        disabled={busy || dirty}
                        onClick={() => void decide("accepted")}
                      >
                        Accept
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="dsb-ru-reject"
                        disabled={busy || dirty}
                        onClick={() => void decide("rejected")}
                      >
                        Reject
                      </Button>
                      <RuleUpdateTranscriptPopover
                        proposalTitle={proposal.title}
                        transcript={transcript}
                      />
                    </>
                  ) : null}
                </div>
              ) : proposal.status === "waiting_agent" ? (
                  <p className="dsb-ru-wait-copy">
                    Ask the Agent to continue.
                  </p>
                ) : proposal.status === "failed" ? (
                  <p className="dsb-ru-wait-copy">
                    Application failed. The Agent can retry the same command.
                  </p>
                ) : proposal.status === "needs_revision" ? (
                  <div className="dsb-ru-actions">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="dsb-rule-edit-icon active:scale-[0.96] active:translate-y-0"
                      aria-label={`Edit ${proposal.title}`}
                      disabled={busy}
                      onClick={() => setEditing(true)}
                    >
                      <HugeiconsIcon
                        icon={Edit02Icon}
                        size={12}
                        color="currentColor"
                        strokeWidth={1.5}
                        aria-hidden
                      />
                    </Button>
                  </div>
                ) : (
                  <div className="dsb-ru-actions">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="dsb-rule-edit-icon active:scale-[0.96] active:translate-y-0"
                      aria-label={`Edit ${proposal.title}`}
                      disabled={busy}
                      onClick={() => setEditing(true)}
                    >
                      <HugeiconsIcon
                        icon={Edit02Icon}
                        size={12}
                        color="currentColor"
                        strokeWidth={1.5}
                        aria-hidden
                      />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="dsb-ru-accept"
                      disabled={busy}
                      onClick={() => void decide("accepted")}
                    >
                      Accept
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="dsb-ru-reject"
                      disabled={busy}
                      onClick={() => void decide("rejected")}
                    >
                      Reject
                    </Button>
                    <RuleUpdateTranscriptPopover
                      proposalTitle={proposal.title}
                      transcript={transcript}
                    />
                  </div>
                )}
            </div>
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
  onNavigate,
  focusProposalId
}: {
  category: RuleUpdateCategory;
  projection: RuleUpdateProjection;
  session: string;
  componentCategories: RuleUpdateCategory[];
  onChanged: () => Promise<unknown>;
  onNavigate: (category: RuleUpdateCategory, proposalId: string) => void;
  focusProposalId: string | null;
}) {
  const active = projection.reviews.flatMap((review) =>
    review.proposals
      .filter(
        (proposal) =>
          proposal.target.category === category &&
          !["applied", "rejected"].includes(proposal.status) &&
          (proposal.kind !== "update" || proposal.target.entryId === null)
      )
      .map((proposal) => ({ proposal, transcript: review.transcript }))
  );
  const traces = projection.reviews
    .flatMap((review) => review.proposals)
    .filter(
      (proposal) =>
        proposal.kind === "move" &&
        proposal.target.sourceCategory === category &&
        proposal.target.category !== category &&
        proposal.status !== "rejected"
    );
  if (active.length === 0 && traces.length === 0) return null;
  return (
    <section className="dsb-ru-stream" aria-label="Rule Update proposals">
      {active.map(({ proposal, transcript }, index) => (
        <ProposalCard
          key={proposal.id}
          proposal={proposal}
          transcript={transcript}
          session={session}
          onChanged={onChanged}
          focused={focusProposalId === proposal.id}
          number={index + 1}
        />
      ))}
      {traces.map((proposal) => (
        <button
          key={`trace:${proposal.id}`}
          type="button"
          className="dsb-ru-trace"
          onClick={() => onNavigate(proposal.target.category, proposal.id)}
        >
          {proposal.title} moved to {categoryLabel(proposal.target.category)}
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            size={13}
            color="currentColor"
            strokeWidth={2}
          />
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
  const active = projection.reviews.flatMap((review) =>
    review.proposals
      .filter(
        (proposal) =>
          proposal.kind === "update" &&
          proposal.target.category === category &&
          proposal.target.entryId === entryId &&
          !["applied", "rejected"].includes(proposal.status)
      )
      .map((proposal) => ({ proposal, transcript: review.transcript }))
  );
  if (active.length === 0) return null;
  return (
    <>
      {active.map(({ proposal, transcript }) => (
        <ProposalCard
          key={proposal.id}
          proposal={proposal}
          transcript={transcript}
          session={session}
          onChanged={onChanged}
          focused={focusProposalId === proposal.id}
          embedded
        />
      ))}
    </>
  );
}

function RuleUpdateTranscriptPopover({
  proposalTitle,
  transcript
}: {
  proposalTitle: string;
  transcript: RuleUpdateReviewView["transcript"];
}) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);

  const openPopover = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setOpen(true);
  };
  const scheduleClose = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
    }, 90);
  };

  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    },
    []
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="dsb-ru-action-icon dsb-ru-info-trigger"
          aria-label={`Interaction record for ${proposalTitle}`}
          onMouseEnter={openPopover}
          onMouseLeave={scheduleClose}
          onFocus={openPopover}
          onBlur={scheduleClose}
        >
          <HugeiconsIcon
            icon={InformationCircleIcon}
            size={12}
            color="currentColor"
            strokeWidth={2}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="dsb-popover dsb-ru-interaction-popover"
        side="top"
        align="end"
        collisionPadding={16}
        onMouseEnter={openPopover}
        onMouseLeave={scheduleClose}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <p className="dsb-popover-title">Interaction record</p>
        {transcript.length > 0 ? (
          <div className="dsb-ru-popover-messages">
            {transcript.map((message) => (
              <section key={message.id} className="dsb-evidence-section">
                <p className="dsb-evidence-label">
                  {message.role === "designer" ? "Designer" : "Agent"}
                </p>
                <p className="dsb-evidence-item">{message.content}</p>
              </section>
            ))}
          </div>
        ) : (
          <p className="dsb-evidence-empty">No frozen interaction record.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function RuleUpdateInteractionsPage({
  projection,
  onNavigate
}: {
  projection: RuleUpdateProjection;
  onNavigate: (category: RuleUpdateCategory, proposalId: string) => void;
}) {
  return (
    <div className="dsb-ru-history" data-testid="rule-update-interaction-records">
      {projection.reviews.map((review) => (
        <section key={review.id} className="dsb-ru-history-group">
          <h1>{review.context}</h1>
          {(review.proposals.length > 0 ? review.proposals : [null]).map(
            (proposal, index) => (
            <article
              key={proposal?.id ?? `${review.id}:record`}
              className="dsb-ru-record"
            >
              <div className="dsb-ru-record-head">
                <span className="dsb-ru-record-number" aria-hidden>
                  {index + 1}
                </span>
                {proposal ? (
                  <span className="dsb-ru-record-kind">Proposal</span>
                ) : null}
                {proposal ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="dsb-ru-check"
                    onClick={() =>
                      onNavigate(proposal.target.category, proposal.id)
                    }
                  >
                    Check
                  </Button>
                ) : null}
              </div>
              <time
                dateTime={
                  proposal?.created_at ??
                  review.published_at ??
                  review.created_at
                }
              >
                {formatInteractionRecordTime(
                  proposal?.created_at ??
                    review.published_at ??
                    review.created_at
                )}
              </time>
              <div className="dsb-ru-transcript">
                {review.transcript.length > 0 ? (
                  review.transcript.map((message) => (
                    <div key={message.id} className="dsb-ru-message">
                      <strong>
                        {message.role === "designer" ? "Designer" : "Agent"}
                      </strong>
                      <p>{message.content}</p>
                    </div>
                  ))
                ) : proposal ? (
                  <p className="dsb-ru-record-summary">
                    {proposal.full_rule_body}
                  </p>
                ) : null}
              </div>
            </article>
            )
          )}
        </section>
      ))}
    </div>
  );
}

function formatInteractionRecordTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
