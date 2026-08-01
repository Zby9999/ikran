"use client";

/**
 * Layout Atlas (Issue 09C-B03) — the Layout leaf's card stream, replacing
 * the 09C-A resizable split. One card per layout rule:
 *
 *   left  — the rule's own schematic (frame-free, measurements drawn in
 *           from the 09C-B spatial-fact vocabulary; single-rule granularity,
 *           never a collective page);
 *   right — quiet name + status + ⓘ evidence, the one-line meaning at
 *           display size, structured facts as a badge row, the relationship
 *           line, and the Open questions affordance;
 *   bottom — the approval bar (candidate → formalized lives at the card
 *           bottom by designer decision);
 *   rich fields (responsiveBehavior / acceptanceChecks / tokenLinks) and
 *   the raw JSON collapse into "Rule details".
 *
 * Open Questions is a large centered dialog (list form — every question
 * visible at once — with airy, Interview-grade spacing) where the designer
 * answers each question inline; answers persist through the
 * answer-open-question command (source file + DB write-back).
 *
 * Language rule: UI chrome is English; designer-input content (meanings,
 * rules, questions, answers) renders verbatim in its source language.
 *
 * The projection (./design-system-layout-atlas-projection) is deterministic
 * and unit-tested; this file is a pure function of it plus the shared row
 * wiring (status chip, ⓘ popover, approval state machine).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  projectLayoutAtlasCards,
  type LayoutAtlasCard
} from "./design-system-layout-atlas-projection";
import type { LayoutSpatialFact } from "./design-system-layout-projection";
import type { DsRow } from "./design-system-view-model";
import type { ApprovalState } from "./design-system-view-model";
import { InfoPopover, StatusChip } from "./design-system-browser";

/* ------------------------------ schematic -------------------------------- */

const S_INK = "#8a8a8a";
const S_FAINT = "#c9c9c9";
const S_FILL = "#ececec";
const S_FILL_DEEP = "#e0e0e0";
const S_DIM = "#3a93ff";

function HDim({
  x1,
  x2,
  y,
  label
}: {
  x1: number;
  x2: number;
  y: number;
  label: string;
}) {
  return (
    <g stroke={S_DIM} strokeWidth={1}>
      <line x1={x1} y1={y} x2={x2} y2={y} />
      <line x1={x1} y1={y - 3} x2={x1} y2={y + 3} />
      <line x1={x2} y1={y - 3} x2={x2} y2={y + 3} />
      <text
        x={(x1 + x2) / 2}
        y={y - 5}
        textAnchor="middle"
        className="dsb-atlas-svg-dim"
        fill={S_DIM}
        stroke="none"
      >
        {label}
      </text>
    </g>
  );
}

function VDim({
  y1,
  y2,
  x,
  label
}: {
  y1: number;
  y2: number;
  x: number;
  label: string;
}) {
  return (
    <g stroke={S_DIM} strokeWidth={1}>
      <line x1={x} y1={y1} x2={x} y2={y2} />
      <line x1={x - 3} y1={y1} x2={x + 3} y2={y1} />
      <line x1={x - 3} y1={y2} x2={x + 3} y2={y2} />
      <text
        x={x + 6}
        y={(y1 + y2) / 2 + 3}
        className="dsb-atlas-svg-dim"
        fill={S_DIM}
        stroke="none"
      >
        {label}
      </text>
    </g>
  );
}

/**
 * Per-rule schematic: a pure function of the rule's 09C-B spatial facts.
 *
 * GENERATIVE GRAMMAR (locked): this renderer is a stable visual grammar
 * for ANY extracted layout rule, present and future — never bespoke
 * per-rule or per-project drawing code. The rules of the grammar:
 *   - Recognition vocabulary is finite and owned by the projection
 *     (container / regions / columns / gutter / rhythm / breakpoints);
 *     a fact the vocabulary cannot recognize is simply not drawn.
 *   - Composition precedence is fixed: regions stack → columns split →
 *     bare container frame; gutter / rhythm / container / breakpoint
 *     facts render as measurements on top, in fixed positions.
 *   - Labels are verbatim source values — the drawing never paraphrases,
 *     interpolates, or invents geometry.
 *   - A rule with no drawable facts gets the honest placeholder, never
 *     a fabricated scene.
 * Future sections (Interaction, Components) extend THIS grammar rather
 * than inventing new per-section drawing styles.
 */
function LayoutAtlasSchematic({
  facts,
  name
}: {
  facts: LayoutSpatialFact[];
  name: string;
}) {
  if (facts.length === 0) {
    return (
      <div
        className="dsb-atlas-figure-empty"
        role="img"
        aria-label={`No drawable spatial values for ${name}`}
      >
        <span aria-hidden>⌀</span> No drawable spatial values
      </div>
    );
  }

  const regions = facts.find((f) => f.kind === "regions");
  const columns = facts.find((f) => f.kind === "columns");
  const container = facts.find((f) => f.kind === "container");
  const gutter = facts.find((f) => f.kind === "gutter");
  const rhythm = facts.find((f) => f.kind === "rhythm");
  const breakpoints = facts.find((f) => f.kind === "breakpoints");

  const W = 400;
  const H = 240;
  const PAD = 28;
  const innerW = W - PAD * 2;

  // Region stack (top to bottom) or column split or bare container frame.
  let blocks: React.ReactNode = null;
  let blockTop = 56;
  let blockBottom = 188;
  if (regions?.regions && regions.regions.length > 0) {
    const list = regions.regions;
    const gapPx = 10;
    const slot = (blockBottom - blockTop - gapPx * (list.length - 1)) / list.length;
    const height = Math.max(14, Math.min(34, slot));
    const total = height * list.length + gapPx * (list.length - 1);
    let y = blockTop + (blockBottom - blockTop - total) / 2;
    blocks = list.map((region, i) => {
      const block = (
        <g key={region}>
          <rect
            x={PAD}
            y={y}
            width={innerW}
            height={height}
            rx={3}
            fill={i === 0 ? S_FILL_DEEP : S_FILL}
          />
          <text
            x={PAD + 8}
            y={y + height / 2 + 3}
            className="dsb-atlas-svg-label"
            fill={S_INK}
          >
            {region}
          </text>
        </g>
      );
      y += height + gapPx;
      return block;
    });
  } else if (columns?.columns) {
    const count = Math.max(1, columns.columns);
    if (count > 12) {
      // Grammar rule: beyond the drawable range the drawing goes ABSTRACT
      // (representative columns + the verbatim count) instead of silently
      // drawing fewer columns than the source declares.
      const colW = 28;
      const gapPx = 10;
      blocks = (
        <g>
          {[0, 1, 2].map((i) => (
            <rect
              key={i}
              x={PAD + i * (colW + gapPx)}
              y={blockTop}
              width={colW}
              height={blockBottom - blockTop}
              rx={3}
              fill={i === 0 ? S_FILL_DEEP : S_FILL}
            />
          ))}
          <text
            x={PAD + 3 * (colW + gapPx) + 6}
            y={(blockTop + blockBottom) / 2 + 4}
            className="dsb-atlas-svg-label"
            fill={S_INK}
          >
            … {count} columns
          </text>
        </g>
      );
    } else {
      const gapPx = 8;
      const colW = (innerW - gapPx * (count - 1)) / count;
      blocks = Array.from({ length: count }, (_, i) => (
        <rect
          key={i}
          x={PAD + i * (colW + gapPx)}
          y={blockTop}
          width={colW}
          height={blockBottom - blockTop}
          rx={3}
          fill={i === 0 ? S_FILL_DEEP : S_FILL}
        />
      ));
    }
  } else if (container) {
    // Bare container: width proportion when parseable, else a nominal inset.
    const ratio =
      container.maxWidthPx != null && container.maxWidthPx > 0
        ? Math.min(1, container.maxWidthPx / 1440)
        : 0.82;
    const frameW = Math.round(innerW * ratio);
    const frameX = PAD + (innerW - frameW) / 2;
    blocks = (
      <rect
        x={frameX}
        y={blockTop}
        width={frameW}
        height={blockBottom - blockTop}
        rx={4}
        fill={S_FILL}
        stroke={S_FAINT}
        strokeDasharray="3 4"
      />
    );
  }
  // Grammar rule: no container/regions/columns fact means NO frame — a lone
  // measurement (gutter, rhythm, breakpoints) draws on the empty stage; an
  // unmotivated frame would imply a container the source never declared.

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="dsb-atlas-svg"
      role="img"
      aria-label={`Schematic for ${name}: ${facts
        .map((f) => f.label)
        .join(", ")}`}
      data-testid={`ds-atlas-schematic-${name}`}
    >
      {/* Breakpoint ticks along the top baseline. */}
      {breakpoints?.breakpoints ? (
        <g>
          <line x1={PAD} y1={30} x2={W - PAD} y2={30} stroke={S_FAINT} />
          {breakpoints.breakpoints.map((mark, i) => {
            const x =
              mark.px != null
                ? PAD + Math.min(1, mark.px / 1440) * innerW
                : PAD + ((i + 1) / (breakpoints.breakpoints!.length + 1)) * innerW;
            return (
              <g key={`${mark.label}-${i}`}>
                <line x1={x} y1={26} x2={x} y2={34} stroke={S_DIM} />
                <text
                  x={x}
                  y={22}
                  textAnchor="middle"
                  className="dsb-atlas-svg-dim"
                  fill={S_DIM}
                >
                  {mark.label}
                </text>
              </g>
            );
          })}
        </g>
      ) : null}

      {blocks}

      {/* Gutter measurement between the first two children. */}
      {gutter ? (
        columns?.columns && columns.columns >= 2 && columns.columns <= 12 ? (
          <HDim
            x1={PAD + (innerW - 8 * (columns.columns - 1)) / columns.columns}
            x2={
              PAD +
              (innerW - 8 * (columns.columns - 1)) / columns.columns +
              8
            }
            y={blockBottom + 18}
            label={gutter.label}
          />
        ) : (
          <HDim
            x1={W / 2 - 10}
            x2={W / 2 + 10}
            y={blockBottom + 18}
            label={gutter.label}
          />
        )
      ) : null}

      {/* Container width measurement along the bottom. */}
      {container ? (
        <HDim
          x1={PAD}
          x2={W - PAD}
          y={H - 12}
          label={container.label}
        />
      ) : null}

      {/* Section rhythm measurement on the right edge. */}
      {rhythm ? (
        <VDim y1={blockTop} y2={blockTop + 40} x={W - PAD + 10} label={rhythm.label} />
      ) : null}
    </svg>
  );
}

/* --------------------------- open questions modal --------------------------- */

type AnswerHandler = (
  row: DsRow,
  question: string,
  answer: string
) => Promise<{ ok: true } | { ok: false; error: string }>;

function OpenQuestionsModal({
  card,
  portalContainer,
  onClose,
  onAnswer
}: {
  card: LayoutAtlasCard;
  /** The sheet root: portaling here keeps keydown inside the sheet's
   * isolation boundary (tldraw body shortcuts never fire while answering). */
  portalContainer: HTMLElement | null;
  onClose: () => void;
  onAnswer: AnswerHandler;
}) {
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [pending, setPending] = useState<Record<number, boolean>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  /** Locally confirmed answers for instant feedback; the authoritative
   * reload (design-system SSE) re-derives the same state from the DB. */
  const [localAnswers, setLocalAnswers] = useState<Record<string, string>>({});
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus discipline: focus the first answer field (or the panel when every
  // question is already answered), and RESTORE focus to the trigger on
  // close — keyboard users never lose their place in the card stream.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const firstInput = panel?.querySelector<HTMLElement>(
      ".dsb-atlas-oq-input:not(:disabled)"
    );
    (firstInput ?? panel)?.focus();
    return () => {
      previous?.focus?.();
    };
  }, []);

  // Escape layering is deterministic regardless of focus: a CAPTURE-phase
  // document listener closes the dialog before the sheet root's bubble-phase
  // handler (ⓘ → sheet) or any body-level binding can see the key.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const answeredServer = new Set(card.answeredQuestions.map((a) => a.question));
  const answered: Array<{ question: string; answer: string }> = [
    ...card.answeredQuestions,
    ...Object.entries(localAnswers)
      .filter(([q]) => !answeredServer.has(q))
      .map(([question, answer]) => ({ question, answer }))
  ];
  const open = card.openQuestions.filter((q) => localAnswers[q] === undefined);

  const submit = async (index: number, question: string) => {
    const draft = (drafts[index] ?? "").trim();
    if (!draft || pending[index]) return;
    setPending((p) => ({ ...p, [index]: true }));
    setErrors((e) => ({ ...e, [index]: "" }));
    const result = await onAnswer(card.row, question, draft);
    setPending((p) => ({ ...p, [index]: false }));
    if (result.ok) {
      setLocalAnswers((a) => ({ ...a, [question]: draft }));
    } else {
      setErrors((e) => ({ ...e, [index]: result.error }));
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Keep keys inside the dialog: the sheet's bubble-phase boundary must
    // not treat this Escape as its own (the capture listener above closes
    // the dialog first anyway), and tldraw's body shortcuts must not fire
    // while answering.
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "Tab") {
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.getClientRects().length > 0);
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  return createPortal(
    <div className="dsb-atlas-modal-backdrop" onClick={onClose}>
      <div
        ref={panelRef}
        className="dsb-atlas-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Open questions — ${card.name}`}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onClick={(event) => event.stopPropagation()}
        data-testid={`ds-atlas-oq-${card.row.entryId}`}
      >
        <div className="dsb-atlas-modal-head">
          <span className="dsb-atlas-modal-title">
            Open questions — {card.name}
          </span>
          <button
            type="button"
            className="dsb-atlas-modal-close"
            aria-label="Close open questions panel"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {open.length === 0 && answered.length === 0 ? (
          <p className="dsb-atlas-modal-empty">No open questions.</p>
        ) : null}

        <ul className="dsb-atlas-oq-list">
          {open.map((question, index) => (
            <li key={index} className="dsb-atlas-oq-item">
              <p className="dsb-atlas-oq-question" id={`dsb-atlas-oq-q-${index}`}>
                {question}
              </p>
              <div className="dsb-atlas-oq-compose">
                <input
                  className="dsb-atlas-oq-input"
                  type="text"
                  placeholder="Designer's answer…"
                  aria-labelledby={`dsb-atlas-oq-q-${index}`}
                  value={drafts[index] ?? ""}
                  disabled={pending[index] === true}
                  onChange={(event) =>
                    setDrafts((d) => ({ ...d, [index]: event.target.value }))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void submit(index, question);
                    }
                  }}
                />
                <button
                  type="button"
                  className="dsb-atlas-oq-submit"
                  disabled={
                    pending[index] === true ||
                    (drafts[index] ?? "").trim() === ""
                  }
                  onClick={() => void submit(index, question)}
                >
                  {pending[index] === true ? "Saving…" : "Answer"}
                </button>
              </div>
              {errors[index] ? (
                <p className="dsb-atlas-oq-error" role="alert">
                  Answer failed: {errors[index]}
                </p>
              ) : null}
            </li>
          ))}
          {answered.map(({ question, answer }, index) => (
            <li key={`answered-${index}`} className="dsb-atlas-oq-item" data-answered>
              <p className="dsb-atlas-oq-question">{question}</p>
              <p className="dsb-atlas-oq-answer">
                <span className="dsb-atlas-oq-check" aria-hidden>
                  ✓
                </span>
                {answer}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    portalContainer ?? document.body
  );
}

/* --------------------------------- cards --------------------------------- */

export type LayoutAtlasRowProps = {
  approvals: Record<string, ApprovalState>;
  infoKey: string | null;
  popoverInstant: (key: string) => boolean;
  portalContainer: HTMLElement | null;
  onInfoKey: (key: string | null) => void;
  onInfoHoverOpen: (key: string) => void;
  onInfoHoverClose: () => void;
  onApprove: (row: DsRow) => void;
  onAnswerOpenQuestion: AnswerHandler;
};

function LayoutAtlasCardView({
  card,
  rows
}: {
  card: LayoutAtlasCard;
  rows: LayoutAtlasRowProps;
}) {
  const [oqOpen, setOqOpen] = useState(false);
  const { row } = card;
  const approval = rows.approvals[row.key] ?? { kind: "idle" as const };
  const hasQuestions =
    card.openQuestions.length > 0 || card.answeredQuestions.length > 0;

  return (
    <article
      className="dsb-atlas-card"
      data-testid={`ds-atlas-card-${row.entryId}`}
      data-approve-error={approval.kind === "error" || undefined}
    >
      <div className="dsb-atlas-card-main">
        <figure className="dsb-atlas-figure">
          <LayoutAtlasSchematic facts={card.schematicFacts} name={card.name} />
        </figure>
        <div className="dsb-atlas-info">
          <header className="dsb-atlas-info-head">
            <h3 className="dsb-atlas-name" title={row.entryId}>
              {card.name}
            </h3>
            <StatusChip status={row.status} />
            <InfoPopover
              entry={row.entry}
              approval={approval}
              infoOpen={rows.infoKey === row.key}
              popoverInstant={rows.popoverInstant(row.key)}
              portalContainer={rows.portalContainer}
              ariaLabel={`Evidence for ${card.name}`}
              onInfoOpenChange={(open) => rows.onInfoKey(open ? row.key : null)}
              onInfoHoverOpen={() => rows.onInfoHoverOpen(row.key)}
              onInfoHoverClose={rows.onInfoHoverClose}
              onApprove={() => rows.onApprove(row)}
            />
          </header>
          {card.meaning ? (
            <p className="dsb-atlas-meaning">{card.meaning}</p>
          ) : null}
          {card.badges.length > 0 ? (
            <div className="dsb-atlas-badges">
              {card.badges.map((badge) => (
                <span key={badge.key} className="dsb-atlas-badge">
                  <span className="dsb-atlas-badge-key">{badge.key}</span>
                  <span className="dsb-atlas-badge-value">{badge.label}</span>
                </span>
              ))}
            </div>
          ) : null}
          {card.constraintLines.length > 0 ? (
            <p className="dsb-atlas-constraint">
              {card.constraintLines.join(" ")}
            </p>
          ) : null}
          {hasQuestions ? (
            <button
              type="button"
              className="dsb-atlas-oq-button"
              aria-expanded={oqOpen}
              data-testid={`ds-atlas-oq-open-${row.entryId}`}
              onClick={() => setOqOpen(true)}
            >
              Open questions
              <span
                className="dsb-atlas-oq-count"
                data-done={card.openQuestions.length === 0 || undefined}
              >
                {card.openQuestions.length}
              </span>
            </button>
          ) : null}
          {/* Rule details is ALWAYS available: rich lines render when
              declared, and the raw JSON (Technical details) never depends
              on which rich fields happen to exist. */}
          <details className="dsb-atlas-details">
            <summary>Rule details</summary>
            {card.responsiveLines.length > 0 ||
            card.acceptanceChecks.length > 0 ||
            card.tokenLinks.length > 0 ? (
              <dl className="dsb-atlas-detail-list">
                {card.responsiveLines.length > 0 ? (
                  <>
                    <dt>responsiveBehavior</dt>
                    <dd>{card.responsiveLines.join(" ")}</dd>
                  </>
                ) : null}
                {card.acceptanceChecks.length > 0 ? (
                  <>
                    <dt>acceptanceChecks</dt>
                    <dd>{card.acceptanceChecks.join(" ")}</dd>
                  </>
                ) : null}
                {card.tokenLinks.length > 0 ? (
                  <>
                    <dt>tokenLinks</dt>
                    <dd className="dsb-atlas-mono">
                      {card.tokenLinks.join(", ")}
                    </dd>
                  </>
                ) : null}
              </dl>
            ) : null}
            <pre className="dsb-atlas-json">
              {JSON.stringify(row.entry.value, null, 2)}
            </pre>
          </details>
        </div>
      </div>

      <footer
        className="dsb-atlas-approval"
        data-approved={row.status === "formalized" || undefined}
      >
        {row.status === "formalized" ? (
          <span className="dsb-atlas-approval-done">Formalized</span>
        ) : row.status === "candidate" ? (
          <button
            type="button"
            className="dsb-atlas-approval-button"
            data-testid={`ds-atlas-approve-${row.entryId}`}
            disabled={approval.kind === "pending"}
            onClick={() => rows.onApprove(row)}
          >
            {approval.kind === "pending"
              ? "Approving…"
              : "Approve as formalized"}
          </button>
        ) : (
          <span className="dsb-atlas-approval-note">
            Gap — the Agent fills this entry before approval.
          </span>
        )}
        {approval.kind === "error" ? (
          <span className="dsb-atlas-approval-error" role="alert">
            Approval failed: {approval.message}
          </span>
        ) : null}
      </footer>

      {oqOpen ? (
        <OpenQuestionsModal
          card={card}
          portalContainer={rows.portalContainer}
          onClose={() => setOqOpen(false)}
          onAnswer={rows.onAnswerOpenQuestion}
        />
      ) : null}
    </article>
  );
}

/** The Layout leaf: page heading + the Atlas card stream (no split panes). */
export function LayoutAtlasCards({
  rows,
  shared
}: {
  rows: DsRow[];
  shared: LayoutAtlasRowProps;
}) {
  const cards = useMemo(() => projectLayoutAtlasCards(rows), [rows]);
  if (rows.length === 0) {
    return <p className="dsb-empty-body dsb-page-note">No rules declared yet.</p>;
  }
  return (
    <div className="dsb-atlas-stack" data-testid="ds-layout-atlas">
      {cards.map((card) => (
        <LayoutAtlasCardView key={card.row.key} card={card} rows={shared} />
      ))}
    </div>
  );
}
