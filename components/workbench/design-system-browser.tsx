"use client";

// Design System Browser (Issue 09A, Task E) — bottom sheet + Section Tabs.
//
// Visual/interaction basis: designer-confirmed prototype v3 (Section Tabs),
// ported — not linked — after the prototype surface was deleted at Browser
// 开工 (09A requirement). Motion follows the emil-design-eng rules (see
// design-system-browser.css).
//
// Data: ONLY GET /api/design-system (DB-backed, evidence chain joined in
// real time) — the sheet never reads design-system-view.json or the source
// files (09A d.2). Refetch on the SSE "design-system" record event.
//
// The sheet hand-rolls its scrim/focus-trap/keyboard boundary instead of
// using components/ui/dialog: radix modal Dialog cannot drive the required
// interruptible CSS close transition (forceMount keeps its focus/scroll
// locks active), and the Esc-from-canvas isolation needs a capture-phase
// boundary the component fully owns. The ⓘ hover layer DOES use radix
// Popover (components/ui/popover), portaled into the sheet root so its
// keydown events stay inside the isolation boundary.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  House,
  Info,
  Layers,
  LayoutGrid,
  MousePointerClick,
  Palette,
  Square,
  Type,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { subscribeRuntimeEvents } from "@/components/runtime/runtime-client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DS_SECTION_NAMES,
  TOKEN_LAYER_LABELS,
  approvalReducer,
  breadcrumbFor,
  buildDesignSystemBrowserModel,
  componentLeafId,
  sheetReducer,
  sheetEscapeAction,
  shouldIsolateKeydown,
  toRow,
  withEntryStatus,
  type ApprovalState,
  type ComponentLeafId,
  type DesignSystemEntryView,
  type DesignSystemView,
  type DsBrowserModel,
  type DsComponentModel,
  type DsLeafId,
  type DsRoute,
  type DsRow,
  type DsSectionId,
  type DsStatus,
  type DsTokenLeafModel,
  type SheetCloseSource
} from "./design-system-view-model";
import "./design-system-browser.css";

/**
 * How long the sheet stays mounted after close so its exit transition can
 * run. Must cover the 350ms transform transition on .dsb-sheet in
 * design-system-browser.css — keep the two in sync.
 */
export const DESIGN_SYSTEM_SHEET_EXIT_MS = 400;

/**
 * Delay before the ⓘ layer closes on pointer leave, so moving from trigger
 * to popover does not flicker it shut. Pairs with the hover fades (150ms
 * ease-out) in design-system-browser.css.
 */
const INFO_HOVER_CLOSE_MS = 90;

/* ------------------------------ small pieces ------------------------------ */

export function StatusChip({ status }: { status: DsStatus }) {
  return (
    <span className="dsb-chip" data-status={status} data-testid="ds-status-chip">
      {status === "gap" ? "open gap" : status}
    </span>
  );
}

function dotColor(label: string): string {
  if (label.includes("formalized")) return "var(--dsc-green)";
  if (label.includes("candidate")) return "var(--dsc-accent)";
  return "var(--dsc-ink-3)";
}

export function StatDots({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="dsb-statdots">
      {items.map((label) => (
        <span key={label} className="dsb-statdot">
          <span
            aria-hidden
            className="dsb-statdot-dot"
            style={{ background: dotColor(label) }}
          />
          {label}
        </span>
      ))}
    </div>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="dsb-group-label">{children}</h2>;
}

/* --------------------------- ⓘ evidence popover --------------------------- */

export function EvidenceInfoContent({
  entry,
  approval,
  onApprove
}: {
  entry: DesignSystemEntryView;
  approval: ApprovalState;
  onApprove: () => void;
}) {
  const evidence = entry.evidence;
  const hasEvidence =
    evidence.question_cards.length > 0 ||
    evidence.annotations.length > 0 ||
    evidence.evidence_versions.length > 0 ||
    evidence.designer_annotations.length > 0 ||
    evidence.unresolved_links.length > 0;

  return (
    <div data-testid={`ds-evidence-${entry.entry_id}`}>
      <p className="dsb-popover-title">Evidence · {entry.entry_id}</p>
      {!hasEvidence ? (
        <p className="dsb-evidence-empty">No linked evidence.</p>
      ) : (
        <>
          {evidence.question_cards.length > 0 ? (
            <section className="dsb-evidence-section">
              <p className="dsb-evidence-label">Question cards</p>
              {evidence.question_cards.map((card) => (
                <p key={card.id} className="dsb-evidence-item">
                  <span className="dsb-evidence-question">{card.question}</span>
                  <br />
                  {card.final_answer}
                  <br />
                  <span className="dsb-evidence-meta">
                    {card.section}
                    {card.answer_source ? ` · ${card.answer_source}` : ""}
                  </span>
                </p>
              ))}
            </section>
          ) : null}
          {evidence.annotations.length > 0 ? (
            <section className="dsb-evidence-section">
              <p className="dsb-evidence-label">Agent annotations</p>
              {evidence.annotations.map((annotation) => (
                <p key={annotation.id} className="dsb-evidence-item">
                  <span className="dsb-evidence-question">
                    {annotation.title}
                  </span>
                  <br />
                  {annotation.body}
                  <br />
                  <span className="dsb-evidence-meta">
                    inference: {annotation.inference}
                  </span>
                </p>
              ))}
            </section>
          ) : null}
          {evidence.evidence_versions.length > 0 ? (
            <section className="dsb-evidence-section">
              <p className="dsb-evidence-label">Evidence versions</p>
              {evidence.evidence_versions.map((version) => (
                <p key={version.id} className="dsb-evidence-item">
                  {version.frame_name}
                  <br />
                  <span className="dsb-evidence-meta">
                    {version.id} · {version.created_at}
                  </span>
                </p>
              ))}
            </section>
          ) : null}
          {evidence.designer_annotations.length > 0 ? (
            <section className="dsb-evidence-section">
              <p className="dsb-evidence-label">Designer annotations</p>
              {evidence.designer_annotations.map((annotation) => (
                <p key={annotation.id} className="dsb-evidence-item">
                  {annotation.body}
                  <br />
                  <span className="dsb-evidence-meta">
                    {annotation.section ?? "unscoped"} · {annotation.created_at}
                  </span>
                </p>
              ))}
            </section>
          ) : null}
          {evidence.unresolved_links.length > 0 ? (
            <section className="dsb-evidence-section">
              <p className="dsb-evidence-label">Unresolved links</p>
              {evidence.unresolved_links.map((link) => (
                <p key={link} className="dsb-evidence-item">
                  {link}
                </p>
              ))}
            </section>
          ) : null}
        </>
      )}
      {/*
        The tray is driven by the approval state machine, NOT the entry's
        (possibly optimistically flipped) status: pending keeps the tray
        visible with a disabled button so "Approving…" is actually seen;
        success retires it (status is formalized); failure reverts the flip
        and shows the typed reason here and inline on the row.
      */}
      {entry.status === "candidate" || approval.kind === "pending" ? (
        <div className="dsb-approve-tray">
          <button
            type="button"
            className="dsb-approve-button"
            data-testid={`ds-approve-${entry.entry_id}`}
            disabled={approval.kind === "pending"}
            onClick={onApprove}
          >
            {approval.kind === "pending"
              ? "Approving…"
              : "Approve → formalized"}
          </button>
          {approval.kind === "error" ? (
            <p className="dsb-approve-error" role="alert">
              {approval.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------------- spec row --------------------------------- */

export function InfoPopover({
  entry,
  approval,
  infoOpen,
  popoverInstant,
  portalContainer,
  ariaLabel,
  onInfoOpenChange,
  onInfoHoverOpen,
  onInfoHoverClose,
  onApprove
}: {
  entry: DesignSystemEntryView;
  approval: ApprovalState;
  infoOpen: boolean;
  popoverInstant: boolean;
  portalContainer: HTMLElement | null;
  ariaLabel: string;
  onInfoOpenChange: (open: boolean) => void;
  onInfoHoverOpen: () => void;
  onInfoHoverClose: () => void;
  onApprove: () => void;
}) {
  return (
    <Popover open={infoOpen} onOpenChange={onInfoOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="dsb-info-trigger"
          aria-label={ariaLabel}
          onMouseEnter={onInfoHoverOpen}
          onMouseLeave={onInfoHoverClose}
          onFocus={onInfoHoverOpen}
          onBlur={onInfoHoverClose}
        >
          <Info size={12} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="dsb-popover"
        container={portalContainer}
        data-instant={popoverInstant ? "" : undefined}
        onMouseEnter={onInfoHoverOpen}
        onMouseLeave={onInfoHoverClose}
        onOpenAutoFocus={(event) => event.preventDefault()}
        // This popover is hover-driven and reopens on trigger focus
        // (onFocus={onInfoHoverOpen}), so Radix's default focus-restore on
        // close would ignite a close→focus→reopen loop. Scoped to this usage
        // site — the shared primitive keeps the default a11y behavior.
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <EvidenceInfoContent
          entry={entry}
          approval={approval}
          onApprove={onApprove}
        />
      </PopoverContent>
    </Popover>
  );
}

export function SpecRowView({
  row,
  approval,
  infoOpen,
  popoverInstant,
  portalContainer,
  onInfoOpenChange,
  onInfoHoverOpen,
  onInfoHoverClose,
  onApprove
}: {
  row: DsRow;
  approval: ApprovalState;
  infoOpen: boolean;
  popoverInstant: boolean;
  portalContainer: HTMLElement | null;
  onInfoOpenChange: (open: boolean) => void;
  onInfoHoverOpen: () => void;
  onInfoHoverClose: () => void;
  onApprove: () => void;
}) {
  return (
    <div
      className="dsb-row"
      data-testid={`ds-row-${row.entryId}`}
      data-approve-error={approval.kind === "error" || undefined}
    >
      {row.swatch !== null ? (
        <span
          aria-hidden
          className="dsb-row-swatch"
          style={{ background: row.swatch }}
        />
      ) : null}
      <span className="dsb-row-name" title={row.name}>
        {row.name}
      </span>
      <span className="dsb-row-value" title={row.value}>
        {row.value}
      </span>
      <span className="dsb-row-meaning" title={row.meaning}>
        {row.meaning}
      </span>
      <StatusChip status={row.status} />
      <InfoPopover
        entry={row.entry}
        approval={approval}
        infoOpen={infoOpen}
        popoverInstant={popoverInstant}
        portalContainer={portalContainer}
        ariaLabel={`Evidence for ${row.name}`}
        onInfoOpenChange={onInfoOpenChange}
        onInfoHoverOpen={onInfoHoverOpen}
        onInfoHoverClose={onInfoHoverClose}
        onApprove={onApprove}
      />
      {approval.kind === "error" ? (
        <span className="dsb-row-error" role="alert">
          Approval failed: {approval.message}
        </span>
      ) : null}
    </div>
  );
}

/* ------------------------------ page renderers ------------------------------ */

type RowListProps = {
  rows: DsRow[];
  approvals: Record<string, ApprovalState>;
  infoKey: string | null;
  popoverInstant: (key: string) => boolean;
  portalContainer: HTMLElement | null;
  onInfoKey: (key: string | null) => void;
  onInfoHoverOpen: (key: string) => void;
  onInfoHoverClose: () => void;
  onApprove: (row: DsRow) => void;
};

/** Everything RowList needs except the rows themselves — shared by all pages. */
export type RowSharedProps = Omit<RowListProps, "rows">;

function RowList({ rows, ...rest }: RowListProps) {
  return (
    <div className="dsb-rows">
      {rows.map((row) => (
        <SpecRowView
          key={row.key}
          row={row}
          approval={rest.approvals[row.key] ?? { kind: "idle" }}
          infoOpen={rest.infoKey === row.key}
          popoverInstant={rest.popoverInstant(row.key)}
          portalContainer={rest.portalContainer}
          onInfoOpenChange={(open) => rest.onInfoKey(open ? row.key : null)}
          onInfoHoverOpen={() => rest.onInfoHoverOpen(row.key)}
          onInfoHoverClose={rest.onInfoHoverClose}
          onApprove={() => rest.onApprove(row)}
        />
      ))}
    </div>
  );
}

function PageHeading({
  title,
  meta,
  chips
}: {
  title: string;
  meta: string;
  chips: string[];
}) {
  return (
    <>
      <h1 className="dsb-h1">{title}</h1>
      <p className="dsb-meta">{meta}</p>
      <StatDots items={chips} />
    </>
  );
}

const FOUNDATIONS_LEAVES: {
  id: DsLeafId;
  name: string;
  icon: LucideIcon;
}[] = [
  { id: "color", name: "Color", icon: Palette },
  { id: "typography", name: "Typography", icon: Type },
  { id: "materials", name: "Materials", icon: Layers },
  { id: "layout", name: "Layout", icon: LayoutGrid },
  { id: "interaction", name: "Interaction", icon: MousePointerClick }
];

/* ------------------------------- home pages ------------------------------- */

/** Principle rule card (09A: principles 规则卡 on Foundations Home — cards in
 * the prototype's LeafCard visual language, not spec rows). Statement is the
 * card title, meaning the body; chip + ⓘ evidence affordance in the footer. */
function PrincipleCard({
  row,
  approval,
  rows
}: {
  row: DsRow;
  approval: ApprovalState;
  rows: RowSharedProps;
}) {
  return (
    <div
      className="dsb-card dsb-principle"
      data-testid={`ds-principle-${row.entryId}`}
      data-approve-error={approval.kind === "error" || undefined}
    >
      <span className="dsb-card-title">{row.value}</span>
      {row.meaning ? (
        <span className="dsb-card-desc">{row.meaning}</span>
      ) : null}
      <div className="dsb-principle-footer">
        <StatusChip status={row.status} />
        <InfoPopover
          entry={row.entry}
          approval={approval}
          infoOpen={rows.infoKey === row.key}
          popoverInstant={rows.popoverInstant(row.key)}
          portalContainer={rows.portalContainer}
          ariaLabel={`Evidence for principle ${row.entryId}`}
          onInfoOpenChange={(open) => rows.onInfoKey(open ? row.key : null)}
          onInfoHoverOpen={() => rows.onInfoHoverOpen(row.key)}
          onInfoHoverClose={rows.onInfoHoverClose}
          onApprove={() => rows.onApprove(row)}
        />
      </div>
      {approval.kind === "error" ? (
        <span className="dsb-row-error" role="alert">
          Approval failed: {approval.message}
        </span>
      ) : null}
    </div>
  );
}

export function FoundationsHomePage({
  model,
  rows
}: {
  model: DsBrowserModel;
  rows: RowSharedProps;
}) {
  const { visualLanguage, principles } = model.foundations;
  return (
    <>
      <PageHeading
        title="Foundations"
        meta={
          model.name
            ? `${model.name} · Extracted from the six-part alignment`
            : "Extracted from the six-part alignment"
        }
        chips={model.foundations.chips}
      />
      {visualLanguage ? (
        <section className="dsb-narrative">
          <GroupLabel>Visual language</GroupLabel>
          <p className="dsb-narrative-text">
            {visualLanguage.description || visualLanguage.row.value}
          </p>
          <RowList rows={[visualLanguage.row]} {...rows} />
        </section>
      ) : null}
      {principles.length > 0 ? (
        <>
          <GroupLabel>Principles</GroupLabel>
          <div className="dsb-cards dsb-principles">
            {principles.map((row) => (
              <PrincipleCard
                key={row.key}
                row={row}
                approval={rows.approvals[row.key] ?? { kind: "idle" }}
                rows={rows}
              />
            ))}
          </div>
        </>
      ) : null}
      {!visualLanguage && principles.length === 0 ? (
        <p className="dsb-empty-body dsb-page-note">
          No principles or visual language declared yet — open a leaf on the
          left.
        </p>
      ) : null}
    </>
  );
}

export function ComponentsHomePage({
  model,
  onOpenLeaf
}: {
  model: DsBrowserModel;
  onOpenLeaf: (leaf: ComponentLeafId) => void;
}) {
  return (
    <>
      <PageHeading
        title="Components"
        meta={`${model.components.list.length} component${
          model.components.list.length === 1 ? "" : "s"
        } inventoried`}
        chips={model.components.chips}
      />
      {model.components.list.length > 0 ? (
        <div className="dsb-cards">
          {model.components.list.map((component) => (
            <button
              key={component.leafId}
              type="button"
              className="dsb-card"
              data-testid={`ds-component-card-${component.entryId}`}
              onClick={() => onOpenLeaf(component.leafId)}
            >
              <ChevronRight size={14} className="dsb-card-chevron" />
              <span className="dsb-card-title">{component.name}</span>
              <span className="dsb-card-desc">
                {component.detail?.description ||
                  component.inventory?.meaning ||
                  "No description yet"}
              </span>
              <StatDots items={component.chips} />
            </button>
          ))}
        </div>
      ) : (
        <p className="dsb-empty-body dsb-page-note">
          No components inventoried yet.
        </p>
      )}
    </>
  );
}

/* ------------------------------- leaf pages ------------------------------- */

/** Layout / Interaction leaf: flat rule rows. */
export function RulesLeafPage({
  kind,
  leaf,
  rows
}: {
  kind: "layout" | "interaction";
  leaf: { rows: DsRow[]; chips: string[] };
  rows: RowSharedProps;
}) {
  return (
    <>
      <PageHeading
        title={kind === "layout" ? "Layout" : "Interaction"}
        meta={`${leaf.rows.length} rules`}
        chips={leaf.chips}
      />
      {leaf.rows.length > 0 ? (
        <RowList rows={leaf.rows} {...rows} />
      ) : (
        <p className="dsb-empty-body dsb-page-note">No rules declared yet.</p>
      )}
    </>
  );
}

/** Color / Typography / Materials leaf: token rows grouped by layer. */
export function TokenLeafPage({
  leaf,
  rows
}: {
  leaf: DsTokenLeafModel;
  rows: RowSharedProps;
}) {
  const tokenCount = leaf.groups.reduce(
    (total, group) => total + group.rows.length,
    0
  );
  return (
    <>
      <PageHeading
        title={leaf.name}
        meta={`${tokenCount} tokens across ${leaf.groups.length} layer${
          leaf.groups.length === 1 ? "" : "s"
        }`}
        chips={leaf.chips}
      />
      {leaf.groups.length > 0 ? (
        leaf.groups.map((group) => (
          <section key={group.layer} data-testid={`ds-token-layer-${group.layer}`}>
            <GroupLabel>{TOKEN_LAYER_LABELS[group.layer]}</GroupLabel>
            <RowList rows={group.rows} {...rows} />
          </section>
        ))
      ) : (
        <p className="dsb-empty-body dsb-page-note">
          No tokens classified here yet.
        </p>
      )}
    </>
  );
}

/* ------------------------------ container hook ------------------------------ */

function useDesignSystemView(session: string, open: boolean) {
  const [view, setView] = useState<DesignSystemView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/design-system", {
        cache: "no-store",
        headers: { "x-ikran-session": session }
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        view?: DesignSystemView;
        error?: string;
      };
      if (response.ok && data.ok === true && data.view) {
        setView(data.view);
        setError(null);
      } else {
        setError(data.error ?? "load_failed");
      }
    } catch {
      setError("network");
    }
  }, [session]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // Authoritative refresh on the design-system record-bus kind (ingest,
  // approval commit) — same SSE channel the rest of the workbench uses.
  useEffect(
    () =>
      subscribeRuntimeEvents(session, {
        onRecord: (event) => {
          if (event.kind === "design-system") void load();
        }
      }),
    [session, load]
  );

  return { view, setView, error, reload: load };
}

/** Mount/unmount timing so the close transition can run before unmount. */
function useSheetPresence(open: boolean): { mounted: boolean; shown: boolean } {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      // Two frames: paint the hidden state first so the open transition runs.
      let second = 0;
      const first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => setShown(true));
      });
      return () => {
        cancelAnimationFrame(first);
        cancelAnimationFrame(second);
      };
    }
    setShown(false);
    const timer = setTimeout(() => setMounted(false), DESIGN_SYSTEM_SHEET_EXIT_MS);
    return () => clearTimeout(timer);
  }, [open]);
  return { mounted, shown };
}

/* --------------------------------- browser --------------------------------- */

export function DesignSystemEntryButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      className="seed-workbench__ds-entry"
      data-testid="open-design-system-browser"
      onClick={onOpen}
    >
      Draft Design System
    </button>
  );
}

export function DesignSystemBrowser({
  session,
  open,
  onClose
}: {
  session: string;
  open: boolean;
  onClose: (source: SheetCloseSource) => void;
}) {
  const { view, setView, error, reload } = useDesignSystemView(session, open);
  const { mounted, shown } = useSheetPresence(open);
  const [section, setSection] = useState<DsSectionId>("foundations");
  const [route, setRoute] = useState<DsRoute>({
    kind: "section",
    section: "foundations"
  });
  const [infoKey, setInfoKey] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<Record<string, ApprovalState>>(
    {}
  );
  const popoverSeenRef = useRef(false);
  const hoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null
  );

  const model = useMemo(
    () => (view ? buildDesignSystemBrowserModel(view) : null),
    [view]
  );

  // Fresh navigation context each time the sheet opens.
  useEffect(() => {
    if (!open) return;
    setSection("foundations");
    setRoute({ kind: "section", section: "foundations" });
    setInfoKey(null);
  }, [open]);

  useEffect(() => {
    if (mounted) setPortalContainer(rootRef.current);
  }, [mounted]);

  const approve = useCallback(
    async (row: DsRow) => {
      setApprovals((prev) => ({
        ...prev,
        [row.key]: approvalReducer(prev[row.key] ?? { kind: "idle" }, {
          type: "start"
        })
      }));
      // Optimistic flip; SSE refetch confirms, failure reverts below.
      setView((prev) =>
        prev
          ? withEntryStatus(
              prev,
              row.sourceArtifactPath,
              row.entryId,
              "formalized"
            )
          : prev
      );
      let reason: string | null = null;
      let details: unknown;
      try {
        const response = await fetch("/api/design-system", {
          method: "POST",
          headers: {
            "x-ikran-session": session,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            action: "approve-entry",
            input: {
              sourceArtifactPath: row.sourceArtifactPath,
              entryId: row.entryId
            }
          })
        });
        const data = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          details?: unknown;
        };
        if (!(response.ok && data.ok === true)) {
          reason =
            typeof data.error === "string" ? data.error : "approve_failed";
          details = data.details;
        }
      } catch {
        reason = "network";
      }

      if (reason === null) {
        setApprovals((prev) => ({
          ...prev,
          [row.key]: approvalReducer(prev[row.key] ?? { kind: "idle" }, {
            type: "succeeded"
          })
        }));
        // Authoritative reload (the design-system SSE event also fires).
        void reload();
        return;
      }
      setApprovals((prev) => ({
        ...prev,
        [row.key]: approvalReducer(prev[row.key] ?? { kind: "idle" }, {
          type: "failed",
          reason: reason!,
          details
        })
      }));
      setView((prev) =>
        prev
          ? withEntryStatus(
              prev,
              row.sourceArtifactPath,
              row.entryId,
              "candidate"
            )
          : prev
      );
    },
    [session, reload, setView]
  );

  const openInfo = useCallback((key: string) => {
    if (hoverCloseTimerRef.current) {
      clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
    setInfoKey(key);
  }, []);
  const closeInfoDelayed = useCallback(() => {
    if (hoverCloseTimerRef.current) clearTimeout(hoverCloseTimerRef.current);
    hoverCloseTimerRef.current = setTimeout(() => {
      hoverCloseTimerRef.current = null;
      setInfoKey(null);
    }, INFO_HOVER_CLOSE_MS);
  }, []);
  useEffect(
    () => () => {
      if (hoverCloseTimerRef.current) clearTimeout(hoverCloseTimerRef.current);
    },
    []
  );
  const popoverInstant = useCallback(
    (_key: string) => popoverSeenRef.current,
    []
  );
  const openInfoTracked = useCallback(
    (key: string) => {
      openInfo(key);
      // emil: the first popover animates from its trigger; every subsequent
      // open is instant.
      popoverSeenRef.current = true;
    },
    [openInfo]
  );

  // Canvas keyboard isolation + focus trap (capture phase). The listener
  // registers ONCE per mount and reads `infoKey`/`shown` through refs, so it
  // never closes over stale state — re-registering on infoKey changes used
  // to steal focus and leave Esc handled by stale closures. While the sheet
  // is MOUNTED — including the exit window after `shown` flips false, until
  // DESIGN_SYSTEM_SHEET_EXIT_MS elapses — keydown originating inside the
  // sheet never reaches tldraw. Esc is layered (see sheetEscapeAction): ⓘ
  // layer first, then the sheet; swallowed during the exit window.
  const infoKeyRef = useRef<string | null>(null);
  const shownRef = useRef(false);
  useEffect(() => {
    infoKeyRef.current = infoKey;
  }, [infoKey]);
  useEffect(() => {
    shownRef.current = shown;
  }, [shown]);

  useEffect(() => {
    if (!mounted) return;
    const root = rootRef.current;
    if (!root) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const onKeyDown = (event: KeyboardEvent) => {
      const inside = root.contains(event.target as Node);
      if (!shouldIsolateKeydown(true, inside)) return;
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        const action = sheetEscapeAction(
          infoKeyRef.current !== null,
          shownRef.current
        );
        if (action === "close-info") setInfoKey(null);
        else if (action === "close-sheet") onClose("escape");
        return;
      }
      if (event.key === "Tab" && shownRef.current) {
        const focusables = Array.from(
          root.querySelectorAll<HTMLElement>(
            'button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => el.getClientRects().length > 0);
        if (focusables.length === 0) {
          event.preventDefault();
          return;
        }
        const active = document.activeElement;
        const index = focusables.findIndex((el) => el === active);
        if (event.shiftKey && (index <= 0 || active === root)) {
          event.preventDefault();
          focusables[focusables.length - 1]!.focus();
        } else if (!event.shiftKey && (index === focusables.length - 1 || active === root)) {
          event.preventDefault();
          focusables[0]!.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      // Restore focus only when the sheet fully unmounts, so focus stays
      // inside during the exit window.
      if (!rootRef.current) previouslyFocused?.focus();
    };
  }, [mounted, onClose]);

  // Focus the sheet root exactly once per mount, on the first `shown`
  // transition. Re-focusing on every ⓘ change used to snatch focus back from
  // ⓘ triggers — making them keyboard-unreachable and, combined with Radix
  // close-focus-restore, igniting a close→focus→reopen loop.
  const didInitialFocusRef = useRef(false);
  useEffect(() => {
    if (!mounted) {
      didInitialFocusRef.current = false;
      return;
    }
    if (!shown || didInitialFocusRef.current) return;
    didInitialFocusRef.current = true;
    rootRef.current?.focus();
  }, [mounted, shown]);

  const switchTab = useCallback((id: DsSectionId) => {
    setSection(id);
    setRoute({ kind: "section", section: id });
  }, []);
  const openLeaf = useCallback((sectionId: DsSectionId, leaf: DsLeafId) => {
    setSection(sectionId);
    setRoute({ kind: "leaf", section: sectionId, leaf });
  }, []);

  if (!mounted) return null;

  const rowListProps: Omit<RowListProps, "rows"> = {
    approvals,
    infoKey,
    popoverInstant,
    portalContainer,
    onInfoKey: setInfoKey,
    onInfoHoverOpen: openInfoTracked,
    onInfoHoverClose: closeInfoDelayed,
    onApprove: (row) => void approve(row)
  };

  const renderMain = () => {
    if (error && !model) {
      return (
        <div className="dsb-empty">
          <p className="dsb-empty-title dsb-load-error">
            Could not load the design system
          </p>
          <p className="dsb-empty-body">{error}</p>
        </div>
      );
    }
    if (!model) {
      return (
        <div className="dsb-empty">
          <p className="dsb-empty-body">Loading…</p>
        </div>
      );
    }
    if (model.empty) {
      return (
        <div className="dsb-empty" data-testid="ds-empty-state">
          <p className="dsb-empty-title">No design system entries yet</p>
          <p className="dsb-empty-body">
            Alignment is complete, but the agent has not declared any
            design-system artifacts yet. Once design-system JSON sources are
            declared and ingested, they appear here.
          </p>
        </div>
      );
    }

    const sectionHome =
      route.section === "foundations" ? (
        <FoundationsHomePage model={model} rows={rowListProps} />
      ) : (
        <ComponentsHomePage
          model={model}
          onOpenLeaf={(leaf) => openLeaf("components", leaf)}
        />
      );

    if (route.kind === "section") return sectionHome;

    if (route.section === "foundations") {
      if (route.leaf === "layout" || route.leaf === "interaction") {
        return (
          <RulesLeafPage
            kind={route.leaf}
            leaf={model.foundations[route.leaf]}
            rows={rowListProps}
          />
        );
      }
      const tokenLeaf =
        model.foundations.tokenLeaves.find((leaf) => leaf.id === route.leaf) ??
        null;
      if (tokenLeaf) return <TokenLeafPage leaf={tokenLeaf} rows={rowListProps} />;
    } else {
      const entryId = componentLeafId(route.leaf);
      const component =
        model.components.list.find((c) => c.entryId === entryId) ?? null;
      if (component) {
        return <ComponentDetail component={component} rows={rowListProps} />;
      }
    }

    // Stale route after a refetch (leaf/component vanished): render the
    // section home rather than a blank main.
    return sectionHome;
  };

  const sidebarLeaves: { id: DsLeafId; name: string; icon: LucideIcon }[] =
    section === "foundations"
      ? FOUNDATIONS_LEAVES
      : (model?.components.list.map((component) => ({
          id: component.leafId,
          name: component.name,
          icon: Square
        })) ?? []);

  return (
    <div className="dsb" data-testid="design-system-browser">
      <div
        aria-hidden
        className="dsb-scrim"
        data-open={shown}
        data-testid="ds-scrim"
        onClick={() => onClose("scrim")}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Design System"
        className="dsb-sheet"
        data-open={shown}
        data-testid="ds-sheet"
        ref={rootRef}
        tabIndex={-1}
      >
        <header className="dsb-header">
          <button
            type="button"
            aria-label={`Back to ${DS_SECTION_NAMES[section]} home`}
            className="dsb-icon-button"
            disabled={route.kind === "section"}
            onClick={() => setRoute({ kind: "section", section })}
          >
            <ChevronLeft size={15} />
          </button>
          <span className="dsb-title">Design System</span>
          <span aria-hidden className="dsb-header-divider" />
          <nav aria-label="Breadcrumb" className="dsb-breadcrumb">
            {model
              ? breadcrumbFor(route, model).map((segment, index, segments) => (
                  <span key={`${segment}-${index}`}>
                    {index > 0 ? <span aria-hidden> / </span> : null}
                    <span
                      className={
                        index === segments.length - 1
                          ? "dsb-breadcrumb-current"
                          : undefined
                      }
                    >
                      {segment}
                    </span>
                  </span>
                ))
              : null}
          </nav>
          <button
            type="button"
            aria-label="Close Design System"
            className="dsb-icon-button dsb-header-close"
            data-testid="ds-close"
            onClick={() => onClose("button")}
          >
            <X size={14} />
          </button>
        </header>
        <div className="dsb-body">
          <aside className="dsb-sidebar">
            <div role="tablist" aria-label="Sections" className="dsb-tabs">
              <span
                aria-hidden
                data-second={section === "components" || undefined}
                className="dsb-tab-indicator"
              />
              {(Object.keys(DS_SECTION_NAMES) as DsSectionId[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={section === id}
                  title={`${DS_SECTION_NAMES[id]} home`}
                  className="dsb-tab"
                  onClick={() => switchTab(id)}
                >
                  {DS_SECTION_NAMES[id]}
                </button>
              ))}
            </div>
            <div key={section} className="dsb-enter">
              <button
                type="button"
                className="dsb-navrow"
                data-active={route.kind === "section" || undefined}
                onClick={() => setRoute({ kind: "section", section })}
              >
                <House size={14} className="dsb-navrow-icon" />
                <span className="dsb-navrow-label">Home</span>
              </button>
              {sidebarLeaves.map((leaf) => (
                <button
                  key={leaf.id}
                  type="button"
                  className="dsb-navrow"
                  data-active={
                    (route.kind === "leaf" && route.leaf === leaf.id) ||
                    undefined
                  }
                  onClick={() => openLeaf(section, leaf.id)}
                >
                  <leaf.icon size={14} className="dsb-navrow-icon" />
                  <span className="dsb-navrow-label">{leaf.name}</span>
                </button>
              ))}
            </div>
          </aside>
          <main className="dsb-main">
            <div
              key={`${route.kind}-${route.kind === "leaf" ? route.leaf : route.section}`}
              className="dsb-enter dsb-page"
            >
              {renderMain()}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- component detail ----------------------------- */

export function ComponentDetail({
  component,
  rows
}: {
  component: DsComponentModel;
  rows: RowSharedProps;
}) {
  // Status/evidence rows for the inventory + spec entries — built on toRow
  // (single owner of the row-key derivation) with display overrides.
  const statusRows: DsRow[] = [];
  if (component.inventory) {
    statusRows.push({
      ...toRow(component.inventory),
      name: "Inventory",
      value: component.inventory.source_artifact_path,
      swatch: null
    });
  }
  if (component.spec) {
    statusRows.push({
      ...toRow(component.spec),
      name: "Spec",
      value: component.spec.source_artifact_path,
      swatch: null
    });
  }

  const detail = component.detail;
  const matrixColumns = detail
    ? [
        "state",
        ...new Set(
          detail.stateMatrix.flatMap((row) =>
            Object.keys(row).filter((key) => key !== "state")
          )
        )
      ]
    : [];

  return (
    <>
      <PageHeading
        title={component.name}
        meta={
          detail?.description ||
          component.inventory?.meaning ||
          "Component detail"
        }
        chips={component.chips}
      />
      {statusRows.length > 0 ? (
        <>
          <GroupLabel>Status &amp; evidence</GroupLabel>
          <RowList rows={statusRows} {...rows} />
        </>
      ) : null}
      {detail ? (
        <>
          <GroupLabel>Props</GroupLabel>
          {detail.props.length > 0 ? (
            <table className="dsb-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Required</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {detail.props.map((prop) => (
                  <tr key={prop.name}>
                    <td>{prop.name}</td>
                    <td>{prop.type}</td>
                    <td>{prop.required === true ? "yes" : "—"}</td>
                    <td>{prop.description ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="dsb-empty-body">No props declared.</p>
          )}
          <GroupLabel>Boundaries</GroupLabel>
          {detail.boundaries.length > 0 ? (
            <ul className="dsb-boundaries">
              {detail.boundaries.map((boundary) => (
                <li key={boundary}>{boundary}</li>
              ))}
            </ul>
          ) : (
            <p className="dsb-empty-body">No boundaries declared.</p>
          )}
          <GroupLabel>State matrix</GroupLabel>
          {detail.stateMatrix.length > 0 ? (
            <table className="dsb-table">
              <thead>
                <tr>
                  {matrixColumns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detail.stateMatrix.map((stateRow, index) => (
                  <tr key={index}>
                    {matrixColumns.map((column) => (
                      <td key={column}>{formatMatrixCell(stateRow[column])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="dsb-empty-body">No states declared.</p>
          )}
        </>
      ) : (
        <p className="dsb-empty-body dsb-page-note">
          No spec ingested for this component yet.
        </p>
      )}
    </>
  );
}

function formatMatrixCell(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null || value === undefined) return "—";
  return JSON.stringify(value);
}

export type { ComponentLeafId };