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
// 09C-D03: there is no Components Home — the Components tab lands directly
// on the first component's Placard detail, and the components sidebar is a
// grouped direct-to-detail nav (Components group, then Blocks).
//
// The sheet hand-rolls its scrim/focus-trap/keyboard boundary instead of
// using components/ui/dialog: radix modal Dialog cannot drive the required
// interruptible CSS close transition (forceMount keeps its focus/scroll
// locks active), and the Esc-from-canvas isolation needs a boundary the
// component fully owns (bubble-phase on the sheet root, so the sheet's own
// controls receive keydown before propagation stops). The ⓘ hover layer
// DOES use radix Popover (components/ui/popover), portaled into the sheet
// root so its keydown events stay inside the isolation boundary.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { getSvgPath } from "figma-squircle";
import {
  ArrowDown01Icon,
  ColorsIcon,
  Edit02Icon,
  GridViewIcon,
  Home01Icon,
  InformationCircleIcon,
  Layers01Icon,
  MultiplicationSignIcon,
  Route01Icon,
  SaveIcon,
  TextFontIcon,
  Tick02Icon
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import { subscribeRuntimeEvents } from "@/components/runtime/runtime-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion";
import {
  formatRuleBody,
  projectObjectFields,
  projectDomainRuleLeaf,
  projectInteractionLeaf,
  projectTypographyLeaf,
  typographyAtlasItems,
  typographyLayersFromView,
  type TokenLayerKey,
  type TypographyAtlasItem
} from "./design-system-reader-projection";
import {
  captureNodeMark,
  captureOrientation,
  projectLayoutLeaf,
  type LayoutRuleProjection
} from "./design-system-layout-projection";
import { artifactScreenshotUrl } from "./projection/seed-projection";
import {
  DS_SECTION_NAMES,
  TOKEN_LAYER_LABELS,
  approvalReducer,
  breadcrumbFor,
  buildColorLeafModel,
  buildDesignSystemBrowserModel,
  componentLeafId,
  formatEntryValue,
  sheetReducer,
  sheetEscapeAction,
  syncWarningAppliesToRoute,
  toRow,
  withEntryStatus,
  type ApprovalState,
  type ComponentLeafId,
  type DesignSystemEntryView,
  type DesignSystemView,
  type DsBrowserModel,
  type DsColorLeafModel,
  type DsColorToken,
  type DsComponentDetailGroup,
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
export const DESIGN_SYSTEM_SHEET_REDUCED_MOTION_EXIT_MS = 150;

/** Figma sheet top corners — radius 24 + cornerSmoothing 60%. */
export const DESIGN_SYSTEM_SHEET_TOP_RADIUS = 24;
export const DESIGN_SYSTEM_SHEET_CORNER_SMOOTHING = 0.6;

export function designSystemSheetExitMs(prefersReducedMotion: boolean): number {
  return prefersReducedMotion
    ? DESIGN_SYSTEM_SHEET_REDUCED_MOTION_EXIT_MS
    : DESIGN_SYSTEM_SHEET_EXIT_MS;
}

/** Top-only Figma squircle clip. drop-shadow (CSS) replaces box-shadow so the
 *  clip does not erase the sheet elevation. */
function useTopSquircleSheet(
  cornerRadius: number,
  cornerSmoothing: number,
  enabled: boolean
) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      if (!width || !height) return;
      el.style.clipPath = `path('${getSvgPath({
        width,
        height,
        topLeftCornerRadius: cornerRadius,
        topRightCornerRadius: cornerRadius,
        bottomLeftCornerRadius: 0,
        bottomRightCornerRadius: 0,
        cornerSmoothing
      })}')`;
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      observer.disconnect();
      el.style.clipPath = "";
    };
  }, [cornerRadius, cornerSmoothing, enabled]);
  return ref;
}

/**
 * Delay before the ⓘ layer closes on pointer leave, so moving from trigger
 * to popover does not flicker it shut. Pairs with the hover fades (150ms
 * ease-out) in design-system-browser.css.
 */
const INFO_HOVER_CLOSE_MS = 90;

/* ------------------------------ small pieces ------------------------------ */

export function StatusChip({
  status,
  testId = "ds-status-chip"
}: {
  status: DsStatus;
  testId?: string;
}) {
  const label =
    status === "gap"
      ? "Open gap"
      : `${status.charAt(0).toUpperCase()}${status.slice(1)}`;
  return (
    <span className="dsb-chip" data-status={status} data-testid={testId}>
      {label}
    </span>
  );
}

export function EntryStatusChip({
  row,
  approval,
  onApprove,
  testId = "ds-status-chip"
}: {
  row: DsRow;
  approval: ApprovalState;
  onApprove?: () => void;
  testId?: string;
}) {
  if (row.status === "gap" || !onApprove) {
    return <StatusChip status={row.status} testId={testId} />;
  }
  const pending = approval.kind === "pending";
  const target = row.status === "candidate" ? "Formalized" : "Candidate";
  return (
    <button
      type="button"
      className="dsb-chip dsb-chip-action"
      data-status={row.status}
      data-testid={testId}
      aria-label={
        pending ? `Updating ${row.name} status` : `Switch ${row.name} to ${target}`
      }
      aria-busy={pending || undefined}
      disabled={pending}
      onClick={onApprove}
    >
      {pending ? "Updating…" : row.status === "candidate" ? "Candidate" : "Formalized"}
    </button>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="dsb-group-label">{children}</h2>;
}

/* ------------------------------ visual origin ------------------------------ */

/** Where a visual sample comes from. 09C-D03 shrank the origin chain to two
 * evidence-grade tiers — Code-backed (a later slice) and Source capture —
 * with everything else falling back to an explicit unavailable state; the
 * synthetic Source-generated / Schematic tiers were retired (they were the
 * only outcomes that could be mistaken for real pixels). Rendered as an
 * outlined tag — visually distinct from the filled status chip. */
export type DsVisualOrigin = "code-backed" | "source-capture" | "unavailable";

export const DS_VISUAL_ORIGIN_LABELS: Record<DsVisualOrigin, string> = {
  "code-backed": "Code-backed",
  "source-capture": "Source capture",
  unavailable: "Unavailable"
};

export function OriginTag({ origin }: { origin: DsVisualOrigin }) {
  return (
    <span className="dsb-origin" data-origin={origin}>
      {DS_VISUAL_ORIGIN_LABELS[origin]}
    </span>
  );
}

/* --------------------------- ⓘ evidence popover --------------------------- */

export function EvidenceInfoContent({
  entry
}: {
  entry: DesignSystemEntryView;
}) {
  const evidence = entry.evidence;
  const editHistory = evidence.edit_history ?? [];
  const hasEvidence =
    evidence.question_cards.length > 0 ||
    evidence.annotations.length > 0 ||
    evidence.evidence_versions.length > 0 ||
    evidence.designer_annotations.length > 0 ||
    editHistory.length > 0 ||
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
          {editHistory.length > 0 ? (
            <section className="dsb-evidence-section">
              <p className="dsb-evidence-label">Designer edits</p>
              {editHistory.map((edit) => (
                <p key={edit.id} className="dsb-evidence-item">
                  <span className="dsb-evidence-question">{edit.field}</span>
                  <br />
                  {edit.before} → {edit.after}
                  <br />
                  <span className="dsb-evidence-meta">{edit.created_at}</span>
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
    </div>
  );
}

/* --------------------------------- spec row --------------------------------- */

const INFO_POPOVER_WIDTH = 340;
const INFO_POPOVER_EDGE_PAD = 16;

type InfoPopoverSide = "top" | "right" | "bottom" | "left";

/** Prefer horizontal placement for tall evidence panels so they stay readable. */
function pickInfoPopoverSide(trigger: HTMLElement): InfoPopoverSide {
  const rect = trigger.getBoundingClientRect();
  const needW = INFO_POPOVER_WIDTH + INFO_POPOVER_EDGE_PAD;
  const right = window.innerWidth - rect.right - INFO_POPOVER_EDGE_PAD;
  const left = rect.left - INFO_POPOVER_EDGE_PAD;
  const bottom = window.innerHeight - rect.bottom - INFO_POPOVER_EDGE_PAD;
  const top = rect.top - INFO_POPOVER_EDGE_PAD;
  if (right >= needW) return "right";
  if (left >= needW) return "left";
  return bottom >= top ? "bottom" : "top";
}

export function InfoPopover({
  entry,
  infoOpen,
  popoverInstant,
  portalContainer,
  ariaLabel,
  onInfoOpenChange,
  onInfoHoverOpen,
  onInfoHoverClose,
  interactive = true
}: {
  entry: DesignSystemEntryView;
  infoOpen: boolean;
  popoverInstant: boolean;
  portalContainer: HTMLElement | null;
  ariaLabel: string;
  onInfoOpenChange: (open: boolean) => void;
  onInfoHoverOpen: () => void;
  onInfoHoverClose: () => void;
  /** When false, hover/focus still opens evidence; click does nothing. */
  interactive?: boolean;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [side, setSide] = useState<InfoPopoverSide>("right");

  useLayoutEffect(() => {
    if (!infoOpen || !triggerRef.current) return;
    setSide(pickInfoPopoverSide(triggerRef.current));
  }, [infoOpen, entry.entry_id]);

  const align = side === "left" || side === "right" ? "start" : "end";

  return (
    <Popover
      open={infoOpen}
      onOpenChange={(open) => {
        // Hover-only: ignore click-driven opens; still allow closes.
        if (!interactive && open) return;
        onInfoOpenChange(open);
      }}
    >
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          className="dsb-info-trigger"
          aria-label={ariaLabel}
          onClick={
            interactive
              ? undefined
              : (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }
          }
          onMouseEnter={onInfoHoverOpen}
          onMouseLeave={onInfoHoverClose}
          onFocus={onInfoHoverOpen}
          onBlur={onInfoHoverClose}
        >
          <HugeiconsIcon
            icon={InformationCircleIcon}
            size={12}
            color="currentColor"
            strokeWidth={2}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="dsb-popover"
        container={portalContainer}
        side={side}
        align={align}
        collisionPadding={INFO_POPOVER_EDGE_PAD}
        sticky="partial"
        data-instant={popoverInstant ? "" : undefined}
        onMouseEnter={onInfoHoverOpen}
        onMouseLeave={onInfoHoverClose}
        onOpenAutoFocus={(event) => event.preventDefault()}
        // This popover is hover-driven and reopens on trigger focus
        // (onFocus={onInfoHoverOpen}), so Radix's default focus-restore on
        // close would ignite a close→focus→reopen loop. Scoped to this usage
        // site — the shared primitive keeps the default a11y behavior.
        onCloseAutoFocus={(event) => event.preventDefault()}
        // Radix's dismissable layer listens for Escape on document CAPTURE,
        // which fires before the sheet root's bubble-phase keydown handler —
        // and its dismissal preventDefaults + closes the popover out from
        // under sheetEscapeAction (the ref it reads may or may not have
        // flushed yet, so one Esc could close popover AND sheet together).
        // Keep Radix inert here; the sheet's handler owns layered Esc (ⓘ
        // first, sheet second) deterministically.
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <EvidenceInfoContent entry={entry} />
      </PopoverContent>
    </Popover>
  );
}

export function SpecRowView({
  row,
  anchor,
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
  anchor?: number;
  approval: ApprovalState;
  infoOpen: boolean;
  popoverInstant: boolean;
  portalContainer: HTMLElement | null;
  onInfoOpenChange: (open: boolean) => void;
  onInfoHoverOpen: () => void;
  onInfoHoverClose: () => void;
  onApprove?: () => void;
}) {
  // Reader Projection (09C-A): structured object values render as labeled
  // field lines in the main reading layer — never serialized JSON. Alias
  // entries and single-key narrative objects keep their flat display. Rows
  // whose display value was overridden by the caller (e.g. ComponentDetail's
  // status rows show the source path, not the spec envelope) keep that
  // override — the projection only owns the DEFAULT display.
  const value = row.entry.value;
  const fields =
    row.value === formatEntryValue(row.entry) &&
    row.entry.alias === null &&
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(
      Object.keys(value).length === 1 &&
      typeof Object.values(value)[0] === "string"
    )
      ? projectObjectFields(value)
      : null;
  return (
    <div
      className={[
        "dsb-row",
        fields ? "dsb-row--object" : "",
        anchor !== undefined ? "dsb-row--interaction" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid={`ds-row-${row.entryId}`}
      data-approve-error={approval.kind === "error" || undefined}
    >
      {anchor !== undefined ? (
        <span className="dsb-interaction-anchor" aria-hidden>
          {anchor}
        </span>
      ) : null}
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
      {fields ? (
        <span className="dsb-fields">
          {fields.map((field) => (
            <span key={field.label} className="dsb-field">
              <span className="dsb-field-label">{field.label}</span>
              <span className="dsb-field-text">{field.text}</span>
            </span>
          ))}
        </span>
      ) : (
        <span className="dsb-row-value" title={row.value}>
          {row.value}
        </span>
      )}
      <span className="dsb-row-meaning" title={row.meaning}>
        {row.meaning}
      </span>
      <EntryStatusChip
        row={row}
        approval={approval}
        onApprove={onApprove}
      />
      <InfoPopover
        entry={row.entry}
        infoOpen={infoOpen}
        popoverInstant={popoverInstant}
        portalContainer={portalContainer}
        ariaLabel={`Evidence for ${row.name}`}
        onInfoOpenChange={onInfoOpenChange}
        onInfoHoverOpen={onInfoHoverOpen}
        onInfoHoverClose={onInfoHoverClose}
      />
      {approval.kind === "error" ? (
        <span className="dsb-row-error" role="alert">
          {approval.message}
        </span>
      ) : null}
    </div>
  );
}

/* ------------------------------ page renderers ------------------------------ */

type RowListProps = {
  rows: DsRow[];
  numbered?: boolean;
  approvals: Record<string, ApprovalState>;
  infoKey: string | null;
  popoverInstant: (key: string) => boolean;
  portalContainer: HTMLElement | null;
  onInfoKey: (key: string | null) => void;
  onInfoHoverOpen: (key: string) => void;
  onInfoHoverClose: () => void;
  onApprove?: (row: DsRow) => void;
  /** Batch approval for composite rows (Typography atlas): applied
   * sequentially so same-file writes never race each other. */
  onApproveRows?: (rows: DsRow[]) => void;
  onEditEntry?: (
    row: DsRow,
    field: "meaning" | "value" | "value.description",
    text: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
};

/** Everything RowList needs except the rows themselves — shared by all pages. */
export type RowSharedProps = Omit<RowListProps, "rows" | "numbered">;

type RuleInlineEditor = {
  editable: boolean;
  editing: boolean;
  dirty: boolean;
  pending: boolean;
  title: string;
  body: string;
  error: string | null;
  errorId: string;
  setTitle: (value: string) => void;
  setBody: (value: string) => void;
  toggle: () => void;
  save: () => Promise<void>;
};

function useRuleInlineEditor(
  row: DsRow,
  rows: RowSharedProps,
  displayBody = ""
): RuleInlineEditor {
  const value = row.entry.value;
  const bodyField =
    typeof value === "string"
      ? "value"
      : row.entry.section === "foundations.visual-language" &&
          value !== null &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          typeof (value as { description?: unknown }).description === "string"
        ? "value.description"
        : null;
  const sourceBody =
    bodyField === "value"
      ? (value as string)
      : bodyField === "value.description"
        ? (value as { description: string }).description
        : null;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(row.meaning);
  const [body, setBody] = useState(sourceBody ?? displayBody);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editing) return;
    setTitle(row.meaning);
    setBody(sourceBody ?? displayBody);
  }, [displayBody, editing, row.meaning, sourceBody]);

  const editable = Boolean(rows.onEditEntry && sourceBody !== null);
  const dirty = editable && (title !== row.meaning || body !== sourceBody);
  const toggle = () => {
    if (pending || !editable) return;
    setError(null);
    if (editing) {
      setTitle(row.meaning);
      setBody(sourceBody ?? displayBody);
    }
    setEditing((current) => !current);
  };
  const save = async () => {
    if (!rows.onEditEntry || !dirty || !title.trim() || !body.trim()) return;
    setPending(true);
    setError(null);
    if (title !== row.meaning) {
      const result = await rows.onEditEntry(row, "meaning", title);
      if (!result.ok) {
        setError(result.error);
        setPending(false);
        return;
      }
    }
    if (body !== sourceBody && bodyField) {
      const result = await rows.onEditEntry(row, bodyField, body);
      if (!result.ok) {
        setError(result.error);
        setPending(false);
        return;
      }
    }
    setPending(false);
    setEditing(false);
  };

  return {
    editable,
    editing,
    dirty,
    pending,
    title,
    body,
    error,
    errorId: `rule-edit-error-${safeDomId(row.key)}`,
    setTitle,
    setBody,
    toggle,
    save
  };
}

function RuleInlineTitle({ editor }: { editor: RuleInlineEditor }) {
  return editor.editing ? (
    <Input
      className="dsb-rule-inline-title"
      aria-label="Rule title"
      aria-describedby={editor.error ? editor.errorId : undefined}
      aria-invalid={Boolean(editor.error)}
      value={editor.title}
      disabled={editor.pending}
      autoFocus
      onChange={(event) => editor.setTitle(event.target.value)}
    />
  ) : (
    <span className="dsb-card-title">{editor.title}</span>
  );
}

function RuleInlineBody({ editor }: { editor: RuleInlineEditor }) {
  return editor.editing ? (
    <Textarea
      className="dsb-rule-inline-body"
      aria-label="Rule body"
      aria-describedby={editor.error ? editor.errorId : undefined}
      aria-invalid={Boolean(editor.error)}
      value={editor.body}
      disabled={editor.pending}
      rows={1}
      onChange={(event) => editor.setBody(event.target.value)}
    />
  ) : editor.body ? (
    <span className="dsb-card-desc">{editor.body}</span>
  ) : null;
}

function RuleInlineActions({
  row,
  editor
}: {
  row: DsRow;
  editor: RuleInlineEditor;
}) {
  if (!editor.editable) return null;
  const valid = editor.title.trim().length > 0 && editor.body.trim().length > 0;
  return (
    <span className="dsb-rule-inline-actions">
      {editor.dirty ? (
        <Button
          variant="ghost"
          size="icon-xs"
          className="dsb-rule-save-icon active:scale-[0.96] active:translate-y-0"
          data-testid={`ds-rule-save-${row.entryId}`}
          aria-label={`${editor.pending ? "Saving" : "Save"} rule ${row.meaning}`}
          disabled={editor.pending || !valid}
          onClick={() => void editor.save()}
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
        variant="ghost"
        size="icon-xs"
        className="dsb-rule-edit-icon active:scale-[0.96] active:translate-y-0"
        data-testid={`ds-rule-edit-${row.entryId}`}
        aria-label={`${editor.editing ? "Cancel editing" : "Edit"} rule ${row.meaning}`}
        aria-pressed={editor.editing}
        disabled={editor.pending}
        onClick={editor.toggle}
      >
        <HugeiconsIcon
          icon={editor.editing ? MultiplicationSignIcon : Edit02Icon}
          size={12}
          strokeWidth={1.5}
          color="currentColor"
          aria-hidden
        />
      </Button>
    </span>
  );
}

function RuleInlineError({ editor }: { editor: RuleInlineEditor }) {
  return editor.error ? (
    <span id={editor.errorId} className="dsb-rule-edit-error" role="alert">
      {editor.error}
    </span>
  ) : null;
}

function RowList({ rows, numbered = false, ...rest }: RowListProps) {
  return (
    <div className="dsb-rows">
      {rows.map((row, index) => (
        <SpecRowView
          key={row.key}
          row={row}
          anchor={numbered ? index + 1 : undefined}
          approval={rest.approvals[row.key] ?? { kind: "idle" }}
          infoOpen={rest.infoKey === row.key}
          popoverInstant={rest.popoverInstant(row.key)}
          portalContainer={rest.portalContainer}
          onInfoOpenChange={(open) => rest.onInfoKey(open ? row.key : null)}
          onInfoHoverOpen={() => rest.onInfoHoverOpen(row.key)}
          onInfoHoverClose={rest.onInfoHoverClose}
          onApprove={rest.onApprove ? () => rest.onApprove?.(row) : undefined}
        />
      ))}
    </div>
  );
}

function PageHeading({ title }: { title: string }) {
  return <h1 className="dsb-h1">{title}</h1>;
}

const FOUNDATIONS_LEAVES: {
  id: DsLeafId;
  name: string;
  icon: IconSvgElement;
}[] = [
  { id: "color", name: "Color", icon: ColorsIcon },
  { id: "typography", name: "Typography", icon: TextFontIcon },
  { id: "materials", name: "Materials", icon: Layers01Icon },
  { id: "layout", name: "Layout", icon: GridViewIcon },
  { id: "interaction", name: "Interaction", icon: Route01Icon }
];

/* ------------------------------- home pages ------------------------------- */

export function FoundationsHomePage({
  model,
  rows
}: {
  model: DsBrowserModel;
  rows: RowSharedProps;
}) {
  const { visualLanguage, principles } = model.foundations;
  const principleRules = useMemo(
    () => projectDomainRuleLeaf(principles),
    [principles]
  );
  const visualLanguageRule = useMemo(() => {
    if (!visualLanguage) return null;
    const { row, description } = visualLanguage;
    return {
      key: row.key,
      anchor: 1,
      title: row.meaning || row.name || row.entryId,
      body: description || formatRuleBody(row.entry.value),
      status: row.status,
      row
    };
  }, [visualLanguage]);
  return (
    <>
      <PageHeading title="Foundations" />
      {visualLanguageRule ? (
        <section className="dsb-section" data-testid="ds-visual-language-zone">
          <GroupLabel>Visual language</GroupLabel>
          <ol className="dsb-interaction-ledger">
            <RuleLedgerCardShell
              rule={visualLanguageRule}
              approval={
                rows.approvals[visualLanguageRule.key] ?? { kind: "idle" }
              }
              rows={rows}
              testId={`ds-visual-language-${visualLanguageRule.row.entryId}`}
              evidenceAriaLabel={`Evidence for visual language ${visualLanguageRule.row.entryId}`}
            />
          </ol>
        </section>
      ) : null}
      {principleRules.length > 0 ? (
        <section className="dsb-section" data-testid="ds-principles-zone">
          <GroupLabel>Principles</GroupLabel>
          <ol className="dsb-interaction-ledger">
            {principleRules.map((rule) => (
              <RuleLedgerCardShell
                key={rule.key}
                rule={rule}
                approval={rows.approvals[rule.key] ?? { kind: "idle" }}
                rows={rows}
                testId={`ds-principle-${rule.row.entryId}`}
                evidenceAriaLabel={`Evidence for principle ${rule.row.entryId}`}
              />
            ))}
          </ol>
        </section>
      ) : null}
      {!visualLanguageRule && principleRules.length === 0 ? (
        <p className="dsb-empty-body dsb-page-note">
          No principles or visual language declared yet — open a leaf on the
          left.
        </p>
      ) : null}
    </>
  );
}

/* ------------------------------- leaf pages ------------------------------- */

function safeDomId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function RuleLedgerCardShell({
  rule,
  approval,
  rows,
  testId,
  evidenceAriaLabel
}: {
  rule: {
    key: string;
    anchor: number;
    title: string;
    body: string;
    status: DsStatus;
    row: DsRow;
  };
  approval: ApprovalState;
  rows: RowSharedProps;
  testId: string;
  evidenceAriaLabel: string;
}) {
  const editor = useRuleInlineEditor(rule.row, rows, rule.body);
  return (
    <li
      className="dsb-interaction-rule"
      data-testid={testId}
      data-editing={editor.editing || undefined}
      data-approve-error={approval.kind === "error" || undefined}
    >
      <div className="dsb-interaction-ledger-row">
        <div className="dsb-interaction-ledger-meta">
          <span className="dsb-interaction-ledger-tags">
            <span className="dsb-interaction-anchor" aria-hidden>
              {rule.anchor}
            </span>
            <EntryStatusChip
              row={rule.row}
              approval={approval}
              onApprove={rows.onApprove ? () => rows.onApprove?.(rule.row) : undefined}
              testId="ds-interaction-status"
            />
          </span>
          <span className="dsb-rule-row-actions">
            <RuleInlineActions row={rule.row} editor={editor} />
            <InfoPopover
              entry={rule.row.entry}
              infoOpen={rows.infoKey === rule.key}
              popoverInstant={rows.popoverInstant(rule.key)}
              portalContainer={rows.portalContainer}
              ariaLabel={evidenceAriaLabel}
              onInfoOpenChange={(open) => rows.onInfoKey(open ? rule.key : null)}
              onInfoHoverOpen={() => rows.onInfoHoverOpen(rule.key)}
              onInfoHoverClose={rows.onInfoHoverClose}
              interactive={false}
            />
          </span>
        </div>
        <div className="dsb-interaction-ledger-main">
          <RuleInlineTitle editor={editor} />
          <RuleInlineBody editor={editor} />
        </div>
      </div>
      <RuleInlineError editor={editor} />
      {approval.kind === "error" ? (
        <span className="dsb-row-error" role="alert">
          {approval.message}
        </span>
      ) : null}
    </li>
  );
}

function InteractionRuleCard({
  rule,
  approval,
  rows
}: {
  rule: ReturnType<typeof projectInteractionLeaf>[number];
  approval: ApprovalState;
  rows: RowSharedProps;
}) {
  return (
    <RuleLedgerCardShell
      rule={rule}
      approval={approval}
      rows={rows}
      testId={`ds-interaction-rule-${rule.anchor}`}
      evidenceAriaLabel={`Evidence for interaction rule ${rule.row.entryId}`}
    />
  );
}

function DomainRulesZone({
  rules: sourceRules,
  rows
}: {
  rules: DsRow[];
  rows: RowSharedProps;
}) {
  const rules = useMemo(
    () => projectDomainRuleLeaf(sourceRules),
    [sourceRules]
  );
  return (
    <section className="dsb-section" data-testid="ds-rules-zone">
      <GroupLabel>Rules</GroupLabel>
      <ol className="dsb-interaction-ledger">
        {rules.map((rule) => {
          return (
            <RuleLedgerCardShell
              key={rule.key}
              rule={rule}
              approval={rows.approvals[rule.key] ?? { kind: "idle" }}
              rows={rows}
              testId={`ds-domain-rule-${rule.anchor}`}
              evidenceAriaLabel={`Evidence for domain rule ${rule.row.entryId}`}
            />
          );
        })}
      </ol>
    </section>
  );
}

/** Interaction leaf: cross-component strategies in the same text-card
 * language as Foundations principles. */
export function RulesLeafPage({
  leaf,
  rows
}: {
  leaf: { rows: DsRow[]; chips: string[] };
  rows: RowSharedProps;
}) {
  const rules = useMemo(() => projectInteractionLeaf(leaf.rows), [leaf.rows]);
  return (
    <>
      <PageHeading title="Interaction" />
      {leaf.rows.length > 0 ? (
        <ol className="dsb-interaction-ledger">
          {rules.map((rule) => (
            <InteractionRuleCard
              key={rule.key}
              rule={rule}
              approval={rows.approvals[rule.key] ?? { kind: "idle" }}
              rows={rows}
            />
          ))}
        </ol>
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
  const hasRules = leaf.rules.length > 0;
  const hasTokens = tokenCount > 0;
  return (
    <>
      <PageHeading title={leaf.name} />
      {hasRules ? <DomainRulesZone rules={leaf.rules} rows={rows} /> : null}
      {hasTokens ? (
        <section className="dsb-section" data-testid="ds-tokens-zone">
          <GroupLabel>Tokens</GroupLabel>
          {leaf.groups.map((group) => (
            <section
              key={group.layer}
              className="dsb-section"
              data-testid={`ds-token-layer-${group.layer}`}
            >
              <GroupLabel>{TOKEN_LAYER_LABELS[group.layer]}</GroupLabel>
              <RowList rows={group.rows} {...rows} />
            </section>
          ))}
        </section>
      ) : !hasRules ? (
        <p className="dsb-empty-body dsb-page-note">
          No tokens classified here yet.
        </p>
      ) : null}
    </>
  );
}

/* ------------------------------ color leaf ------------------------------ */

/** Swatch with a lightweight hover/focus tooltip carrying the primitive
 * provenance (terminal token name + resolved hex). The swatch is the only
 * hover target — hex is on-demand information, not first-class. */
function ColorSwatch({
  hex,
  source,
  name,
  portalContainer
}: {
  hex: string;
  source: string | null;
  name: string;
  portalContainer: HTMLElement | null;
}) {
  const label = `${source ?? name} · ${hex}`;
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span
          className="dsb-color-swatch-wrap"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          <span
            className="dsb-color-swatch"
            style={{ background: hex }}
            tabIndex={0}
            role="img"
            aria-label={label}
            data-testid={`ds-color-swatch-${name}`}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
          />
        </span>
      </PopoverAnchor>
      <PopoverContent
        className="dsb-color-tip"
        container={portalContainer}
        role="tooltip"
        side="top"
        align="center"
        sideOffset={0}
        avoidCollisions={false}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {label}
      </PopoverContent>
    </Popover>
  );
}

/** Ledger row for one semantic/component color token: swatch | role name |
 * usage meaning | status | ⓘ evidence. Same governance wiring as SpecRowView
 * (approval state keyed by row.key, hover-tracked ⓘ popover). */
function ColorRow({
  token,
  approval,
  infoOpen,
  popoverInstant,
  portalContainer,
  onInfoOpenChange,
  onInfoHoverOpen,
  onInfoHoverClose,
  onApprove
}: {
  token: DsColorToken;
  approval: ApprovalState;
  infoOpen: boolean;
  popoverInstant: boolean;
  portalContainer: HTMLElement | null;
  onInfoOpenChange: (open: boolean) => void;
  onInfoHoverOpen: () => void;
  onInfoHoverClose: () => void;
  onApprove?: () => void;
}) {
  return (
    <div
      className="dsb-color-row"
      data-testid={`ds-row-${token.row.entryId}`}
      data-approve-error={approval.kind === "error" || undefined}
    >
      <ColorSwatch
        hex={token.hex}
        source={token.source}
        name={token.name}
        portalContainer={portalContainer}
      />
      <span className="dsb-color-name" title={token.name}>
        {token.name}
      </span>
      <span className="dsb-color-meaning" title={token.meaning}>
        {token.meaning}
      </span>
      <EntryStatusChip
        row={token.row}
        approval={approval}
        onApprove={onApprove}
      />
      <InfoPopover
        entry={token.row.entry}
        infoOpen={infoOpen}
        popoverInstant={popoverInstant}
        portalContainer={portalContainer}
        ariaLabel={`Evidence for ${token.name}`}
        onInfoOpenChange={onInfoOpenChange}
        onInfoHoverOpen={onInfoHoverOpen}
        onInfoHoverClose={onInfoHoverClose}
      />
      {approval.kind === "error" ? (
        <span className="dsb-row-error" role="alert">
          {approval.message}
        </span>
      ) : null}
    </div>
  );
}

function ColorRowList({
  tokens,
  ...rest
}: { tokens: DsColorToken[] } & RowSharedProps) {
  return (
    <div className="dsb-color-rows">
      {tokens.map((token) => (
        <ColorRow
          key={token.row.key}
          token={token}
          approval={rest.approvals[token.row.key] ?? { kind: "idle" }}
          infoOpen={rest.infoKey === token.row.key}
          popoverInstant={rest.popoverInstant(token.row.key)}
          portalContainer={rest.portalContainer}
          onInfoOpenChange={(open) => rest.onInfoKey(open ? token.row.key : null)}
          onInfoHoverOpen={() => rest.onInfoHoverOpen(token.row.key)}
          onInfoHoverClose={rest.onInfoHoverClose}
          onApprove={rest.onApprove ? () => rest.onApprove?.(token.row) : undefined}
        />
      ))}
    </div>
  );
}

/** Color leaf: semantic/component tokens are the governed rows. Open design
 * questions use ordinary domain rules with gap status; primitive consumption
 * is never used as a proxy for a problem. */
export function ColorLeafPage({
  model,
  rows
}: {
  model: DsColorLeafModel;
  rows: RowSharedProps;
}) {
  const tokenCount = model.semantic.length + model.component.length;
  const hasRules = model.rules.length > 0;
  const hasTokens = tokenCount > 0;
  return (
    <>
      <PageHeading title="Color" />
      {hasRules ? <DomainRulesZone rules={model.rules} rows={rows} /> : null}
      {hasTokens ? (
        <section className="dsb-section" data-testid="ds-tokens-zone">
          <GroupLabel>Tokens</GroupLabel>
          {model.semantic.length > 0 ? (
            <section
              className="dsb-section"
              data-testid="ds-color-group-semantic"
            >
              <GroupLabel>Semantic</GroupLabel>
              <ColorRowList tokens={model.semantic} {...rows} />
            </section>
          ) : null}
          {model.component.length > 0 ? (
            <section
              className="dsb-section"
              data-testid="ds-color-group-component"
            >
              <GroupLabel>Component</GroupLabel>
              <ColorRowList tokens={model.component} {...rows} />
            </section>
          ) : null}
        </section>
      ) : !hasRules ? (
        <p className="dsb-empty-body dsb-page-note">
          No tokens classified here yet.
        </p>
      ) : null}
    </>
  );
}

function numericWeight(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 1000
    ? parsed
    : undefined;
}

const CSS_LENGTH_PATTERN = /^-?\d+(?:\.\d+)?(px|em|rem|%)$/;

function cssLength(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const trimmed = text.trim();
  return CSS_LENGTH_PATTERN.test(trimmed) ? trimmed : undefined;
}

function cssLineHeight(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (CSS_LENGTH_PATTERN.test(trimmed)) return trimmed;
  return /^\d+(?:\.\d+)?$/.test(trimmed) ? trimmed : undefined;
}

const CSS_TEXT_TRANSFORMS = new Set([
  "none",
  "uppercase",
  "lowercase",
  "capitalize"
]);

/** Render the readable role name in its declared type treatment. Invalid CSS
 * values stay out of the specimen while their source text remains available
 * in the disclosure below. */
function typographySpecimenCss(item: TypographyAtlasItem): React.CSSProperties {
  const css: React.CSSProperties & { "--dsb-type-size"?: string } = {};
  if (item.specimenFamily) css.fontFamily = item.specimenFamily;
  if (item.fontSizePx !== null) {
    css["--dsb-type-size"] = `${item.fontSizePx}px`;
  }
  const weight = numericWeight(item.specimenFontWeight ?? undefined);
  if (weight !== undefined) css.fontWeight = weight;
  const lineHeight = cssLineHeight(item.specimenLineHeight ?? undefined);
  if (lineHeight !== undefined) css.lineHeight = lineHeight;
  const tracking = cssLength(item.specimenLetterSpacing ?? undefined);
  if (tracking !== undefined) css.letterSpacing = tracking;
  const transform = item.specimenTextTransform?.trim().toLowerCase();
  if (transform && CSS_TEXT_TRANSFORMS.has(transform)) {
    css.textTransform = transform as React.CSSProperties["textTransform"];
  }
  return css;
}

function typographyLedgerValue(value: string | null): string {
  if (!value) return "—";
  return value.split(" · ").at(-1)?.trim() || value;
}

function typographyLedgerMetrics(
  item: TypographyAtlasItem
): { label: string; value: string }[] {
  return [
    {
      label: "Weight",
      value: typographyLedgerValue(
        item.specimenFontWeight ?? item.fontWeight
      )
    },
    {
      label: "Letter spacing",
      value: typographyLedgerValue(
        item.specimenLetterSpacing ?? item.letterSpacing
      )
    },
    { label: "Size", value: typographyLedgerValue(item.fontSize) },
    { label: "Typeface", value: typographyLedgerValue(item.fontFamily) }
  ];
}

function TypographyLedgerRow({
  item,
  expanded,
  onToggle,
  approvalPending = false,
  onApprove
}: {
  item: TypographyAtlasItem;
  expanded: boolean;
  onToggle: () => void;
  approvalPending?: boolean;
  onApprove?: () => void;
}) {
  const metrics = typographyLedgerMetrics(item);
  const detailsId = `dsb-type-details-${safeDomId(item.key)}`;
  const approveTarget =
    item.status === "candidate" ? "Formalized" : "Candidate";

  return (
    <article
      className="dsb-type-item"
      data-expanded={expanded || undefined}
      data-testid={`ds-atlas-${item.sourceRows[0]?.entryId ?? item.key}`}
    >
      <div className="dsb-type-row">
        <div className="dsb-type-name">
          {item.specimenFamily ? (
            <h3 className="dsb-type-specimen" style={typographySpecimenCss(item)}>
              {item.label}
            </h3>
          ) : (
            <div className="dsb-type-unresolved" role="note">
              <span>{item.label}</span>
              <small>Typeface unresolved</small>
            </div>
          )}
        </div>
        <p className="dsb-type-usage">
          {item.usage || "No usage note declared"}
        </p>
        {item.status === "gap" || !onApprove ? (
          <StatusChip status={item.status} testId="ds-typography-status" />
        ) : (
          <button
            type="button"
            className="dsb-chip dsb-chip-action"
            data-status={item.status}
            data-testid="ds-typography-status"
            aria-label={
              approvalPending
                ? `Updating ${item.label} status`
                : `Switch ${item.label} to ${approveTarget}`
            }
            aria-busy={approvalPending || undefined}
            disabled={approvalPending}
            onClick={onApprove}
          >
            {approvalPending
              ? "Updating…"
              : item.status === "candidate"
                ? "Candidate"
                : "Formalized"}
          </button>
        )}
        <Button
          className="dsb-type-expand"
          variant="outline"
          size="icon-sm"
          aria-label={`${expanded ? "Hide" : "Show"} details for ${item.label}`}
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={onToggle}
        >
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={14}
            color="currentColor"
            strokeWidth={2}
          />
        </Button>
      </div>
      {expanded ? (
        <div className="dsb-type-details-shell" id={detailsId}>
          <div className="dsb-type-details">
            <p className="dsb-type-identity">{item.canonicalIdentity}</p>
            <dl className="dsb-type-metrics">
              {metrics.map((metric) => (
                <div key={metric.label} className="dsb-type-detail">
                  <dt>{metric.label}</dt>
                  <dd>{metric.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      ) : null}
    </article>
  );
}

/** Typography leaf: a quiet, visual-first ledger. Each row shows the style
 * name in its declared type treatment, its intended use, and one disclosure
 * for construction details. Governance: the row carries the combined
 * candidate/formalized status of its composite source rows and, when writes
 * are allowed, flips all contributing rows together (approve candidates, or
 * revert a fully-formalized style back to candidate). Source ids and the
 * evidence chain stay on the ⓘ surfaces of the contributing rows. */
export function TypographyLeafPage({
  layers,
  rules = [],
  rows
}: {
  layers: {
    layer: TokenLayerKey;
    entries: DesignSystemEntryView[];
  }[];
  rules?: DsRow[];
  rows: RowSharedProps;
}) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const projection = useMemo(() => projectTypographyLeaf(layers), [layers]);
  const atlasItems = useMemo(
    () => typographyAtlasItems(projection),
    [projection]
  );
  const orderedItems = useMemo(
    () =>
      [...atlasItems].sort((a, b) => {
        if (a.fontSizePx === null && b.fontSizePx === null) {
          return a.label.localeCompare(b.label);
        }
        if (a.fontSizePx === null) return 1;
        if (b.fontSizePx === null) return -1;
        return b.fontSizePx - a.fontSizePx;
      }),
    [atlasItems]
  );
  const groups = useMemo(
    () =>
      ([
        {
          key: "type" as const,
          label: "Type",
          items: orderedItems.filter((item) => item.group === "type")
        },
        {
          key: "component" as const,
          label: "Component",
          items: orderedItems.filter((item) => item.group === "component")
        }
      ]).filter((group) => group.items.length > 0),
    [orderedItems]
  );

  return (
    <div className="dsb-typography-page">
      <h1 className="dsb-h1">Typography</h1>
      {rules.length > 0 ? <DomainRulesZone rules={rules} rows={rows} /> : null}
      {orderedItems.length > 0 ? (
        <section
          className="dsb-section"
          data-testid="ds-tokens-zone"
        >
          <GroupLabel>Tokens</GroupLabel>
          <div
          className="dsb-section dsb-typography-atlas"
          data-testid="ds-typography-ledger"
        >
          <div className="dsb-type-groups">
            {groups.map((group) => (
              <section
                className="dsb-type-group"
                data-testid={`ds-typography-group-${group.key}`}
                key={group.key}
              >
                <div className="dsb-type-columns">
                  <h2>
                    {group.label} · {group.items.length}
                  </h2>
                  <span>Used for</span>
                  <span />
                </div>
                <div className="dsb-type-list">
                  {group.items.map((item) => {
                    const approveTargets =
                      item.status === "candidate"
                        ? item.sourceRows.filter(
                            (sourceRow) => sourceRow.status === "candidate"
                          )
                        : item.status === "formalized"
                          ? item.sourceRows
                          : [];
                    return (
                      <TypographyLedgerRow
                        key={item.key}
                        item={item}
                        expanded={expandedKey === item.key}
                        onToggle={() =>
                          setExpandedKey((current) =>
                            current === item.key ? null : item.key
                          )
                        }
                        approvalPending={item.sourceRows.some(
                          (sourceRow) =>
                            rows.approvals[sourceRow.key]?.kind === "pending"
                        )}
                        onApprove={
                          rows.onApproveRows && approveTargets.length > 0
                            ? () => rows.onApproveRows?.(approveTargets)
                            : undefined
                        }
                      />
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
          </div>
        </section>
      ) : rules.length === 0 ? (
        <p className="dsb-empty-body dsb-page-note">
          No composite typography roles classified here yet.
        </p>
      ) : null}
    </div>
  );
}

/* ----------------------- 09C-D02: layout source capture ----------------------- */

/**
 * Layout leaf (09C-D02, designer-selected Source Capture direction — Placard
 * variant, v2 locator view): one vertical placard block per rule. A real Figma
 * node capture hangs in a fixed-ratio hairline frame — 3:2 landscape or 2:3
 * portrait by the node's own shape — with a hairline mark locating the node
 * inside the image when it doesn't nearly fill it. Below: the rule's
 * statement, its recognized spatial facts as one quiet line, and a
 * provenance caption (origin tag, node name, capture time, staleness).
 * Rules with no linked capture get an honest dashed unavailable block.
 *
 * This view is for orientation ("which part of the design does this rule
 * mean"), not inspection — detail lives on the Workbench canvas, so the v1
 * "View in frame" lightbox is retired; `surfaceId` stays purely for the
 * stale verdict.
 *
 * Captures are declared by the agent in layout-rules.json `sourceCaptures`
 * (screenshot taken via Figma MCP, framed to the ratio region containing
 * the node, stored under design-system/captures/) and decorated onto the
 * entry by the Runtime view. The Blueprint schematic drawing (09C-B) is
 * retired — a composition of parsed values could never show what the
 * layout actually looks like; a capture can.
 */

/** "2026-07-31T14:05:22Z" → "2026-07-31 14:05"; anything else passes through. */
function formatCapturedAt(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(iso.trim());
  return match ? `${match[1]} ${match[2]}` : iso;
}

function LayoutPlacardBlock({
  rule,
  index,
  session,
  rows
}: {
  rule: LayoutRuleProjection;
  index: number;
  session: string;
  rows: RowSharedProps;
}) {
  const [activeCapture, setActiveCapture] = useState(0);
  // The thumbnail strip may reference a capture index beyond the current
  // capture list; clamp instead of trusting the state.
  const activeIndex = Math.min(activeCapture, rule.captures.length - 1);
  const capture = rule.captures[activeIndex];
  const approval = rows.approvals[rule.row.key] ?? { kind: "idle" as const };
  const editor = useRuleInlineEditor(rule.row, rows, rule.body);
  const orientation = capture ? captureOrientation(capture) : null;
  const mark = capture ? captureNodeMark(capture) : null;
  return (
    <article
      className="dsb-placard dsb-placard-enter"
      style={{ "--i": index } as CSSProperties}
      data-testid={`ds-layout-placard-${rule.row.entryId}`}
    >
      {capture ? (
        <figure
          className="dsb-placard-figure"
          data-orientation={orientation}
          data-testid={`ds-layout-figure-${rule.row.entryId}`}
        >
          <img
            src={artifactScreenshotUrl(capture.artifactPath, session)}
            alt={`Source capture of ${capture.nodeName}`}
          />
          {mark ? (
            <span
              className="dsb-placard-mark"
              aria-hidden="true"
              style={{
                left: `${mark.x * 100}%`,
                top: `${mark.y * 100}%`,
                width: `${mark.width * 100}%`,
                height: `${mark.height * 100}%`
              }}
            />
          ) : null}
        </figure>
      ) : (
        <div
          className="dsb-placard-unavailable"
          role="img"
          aria-label={`No source capture for ${rule.headline}: this rule has no linked Figma node`}
          data-testid={`ds-layout-unavailable-${rule.row.entryId}`}
        >
          <span className="dsb-placard-unavailable-title">No source capture</span>
          <span className="dsb-placard-unavailable-note">
            This rule has no linked Figma node — nothing to show honestly.
          </span>
        </div>
      )}
      {rule.captures.length > 1 ? (
        <span className="dsb-placard-thumbs" role="group" aria-label="Other source nodes">
          {rule.captures.map((item, itemIndex) => (
            <button
              key={`${item.nodeName}-${itemIndex}`}
              type="button"
              className="dsb-placard-thumb"
              data-active={item === capture || undefined}
              aria-label={`Show ${item.nodeName}`}
              aria-pressed={item === capture}
              onClick={() => setActiveCapture(itemIndex)}
            >
              <img src={artifactScreenshotUrl(item.artifactPath, session)} alt="" />
            </button>
          ))}
        </span>
      ) : null}
      <div className="dsb-placard-body">
        <div className="dsb-placard-head">
          <span className="dsb-placard-statement">
            <RuleInlineTitle editor={editor} />
          </span>
          <span className="dsb-rule-row-actions">
            <EntryStatusChip
              row={rule.row}
              approval={approval}
              onApprove={rows.onApprove ? () => rows.onApprove?.(rule.row) : undefined}
              testId={`ds-layout-status-${rule.row.entryId}`}
            />
            <RuleInlineActions row={rule.row} editor={editor} />
            <InfoPopover
              entry={rule.row.entry}
              infoOpen={rows.infoKey === rule.row.key}
              popoverInstant={rows.popoverInstant(rule.row.key)}
              portalContainer={rows.portalContainer}
              ariaLabel={`Evidence for layout rule ${rule.row.entryId}`}
              onInfoOpenChange={(open) =>
                rows.onInfoKey(open ? rule.row.key : null)
              }
              onInfoHoverOpen={() => rows.onInfoHoverOpen(rule.row.key)}
              onInfoHoverClose={rows.onInfoHoverClose}
            />
          </span>
        </div>
        <div className="dsb-rule-prose">
          <RuleInlineBody editor={editor} />
        </div>
        <RuleInlineError editor={editor} />
        <div className="dsb-placard-caption">
          {capture ? (
            <>
              <OriginTag origin="source-capture" />
              <span>{capture.nodeName}</span>
              <span data-stale={capture.stale || undefined}>
                captured {formatCapturedAt(capture.capturedAt)}
                {capture.stale ? " · stale" : ""}
              </span>
            </>
          ) : (
            <OriginTag origin="unavailable" />
          )}
        </div>
        {approval.kind === "error" ? (
          <span className="dsb-row-error" role="alert">
            {approval.message}
          </span>
        ) : null}
      </div>
    </article>
  );
}

/** Layout leaf (09C-D02): standard Browser heading, then the placard stream.
 * Full-width page — the capture needs the whole reading column. */
export function LayoutLeafPage({
  leaf,
  rows,
  session
}: {
  leaf: { rows: DsRow[]; chips: string[] };
  rows: RowSharedProps;
  session: string;
}) {
  const model = useMemo(() => projectLayoutLeaf(leaf.rows), [leaf.rows]);
  return (
    <>
      <PageHeading title="Layout" />
      {model.rules.length > 0 ? (
        <div className="dsb-placard-list" data-testid="ds-layout-placards">
          {model.rules.map((rule, index) => (
            <LayoutPlacardBlock
              key={rule.row.key}
              rule={rule}
              index={index}
              session={session}
              rows={rows}
            />
          ))}
        </div>
      ) : (
        <p className="dsb-empty-body dsb-page-note">No rules declared yet.</p>
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
function useSheetPresence(
  open: boolean,
  exitMs: number
): { mounted: boolean; shown: boolean } {
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
    const timer = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(timer);
  }, [exitMs, open]);
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
  readOnly = false,
  onClose
}: {
  session: string;
  open: boolean;
  readOnly?: boolean;
  onClose: (source: SheetCloseSource) => void;
}) {
  const { view, setView, error, reload } = useDesignSystemView(session, open);
  const prefersReducedMotion = usePrefersReducedMotion();
  const { mounted, shown } = useSheetPresence(
    open,
    designSystemSheetExitMs(prefersReducedMotion)
  );
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
  const surfaceRef = useTopSquircleSheet(
    DESIGN_SYSTEM_SHEET_TOP_RADIUS,
    DESIGN_SYSTEM_SHEET_CORNER_SMOOTHING,
    mounted
  );
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null
  );

  const model = useMemo(
    () => (view ? buildDesignSystemBrowserModel(view) : null),
    [view]
  );

  // Sync warnings mount per page: only warnings whose source file feeds the
  // current route show (e.g. token.json flags the token leaves, not Home).
  const routeSyncWarnings = useMemo(
    () =>
      view && model
        ? (view.sync_warnings ?? []).filter((warning) =>
            syncWarningAppliesToRoute(warning.path, route, model)
          )
        : [],
    [view, model, route]
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
      const targetStatus =
        row.status === "candidate" ? "formalized" : "candidate";
      setApprovals((prev) => ({
        ...prev,
        [row.key]: approvalReducer(prev[row.key] ?? { kind: "idle" }, {
          type: "start"
        })
      }));
      // Optimistic switch; SSE refetch confirms, failure reverts below.
      setView((prev) =>
        prev
          ? withEntryStatus(
              prev,
              row.sourceArtifactPath,
              row.entryId,
              targetStatus
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
              entryId: row.entryId,
              targetStatus
            }
          })
        });
        const data = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          details?: unknown;
        };
        if (!(response.ok && data.ok === true)) {
          // A concurrent/stale click can lose after another request already
          // committed the same transition. Treat that as the desired final
          // state and let the authoritative reload confirm it.
          const alreadyAtTarget =
            (targetStatus === "formalized" &&
              data.error === "already_formalized") ||
            (targetStatus === "candidate" && data.error === "already_candidate");
          if (!alreadyAtTarget) {
            reason =
              typeof data.error === "string" ? data.error : "approve_failed";
            details = data.details;
          }
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
              row.status
            )
          : prev
      );
    },
    [session, reload, setView]
  );

  const editEntry = useCallback(
    async (
      row: DsRow,
      field: "meaning" | "value" | "value.description",
      text: string
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      try {
        const response = await fetch("/api/design-system", {
          method: "POST",
          headers: {
            "x-ikran-session": session,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            action: "edit-entry",
            input: {
              sourceArtifactPath: row.sourceArtifactPath,
              entryId: row.entryId,
              field,
              text
            }
          })
        });
        const data = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
        };
        if (!(response.ok && data.ok === true)) {
          return {
            ok: false,
            error: typeof data.error === "string" ? data.error : "edit_failed"
          };
        }
        await reload();
        return { ok: true };
      } catch {
        return { ok: false, error: "network" };
      }
    },
    [reload, session]
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

  // Canvas keyboard isolation + focus trap. Attached as a BUBBLE-phase React
  // handler on the sheet root (see onSheetKeyDown): keydown first serves the
  // sheet's own interactive elements (ⓘ buttons, future inputs), then stops
  // at the root so it never reaches tldraw's body-level bindings. A
  // capture-phase window listener used to swallow events BEFORE the sheet's
  // own controls could receive them — that made every keyboard interaction
  // inside the sheet inert.
  const infoKeyRef = useRef<string | null>(null);
  const shownRef = useRef(false);
  useEffect(() => {
    infoKeyRef.current = infoKey;
  }, [infoKey]);
  useEffect(() => {
    shownRef.current = shown;
  }, [shown]);

  // Restore focus to the pre-sheet element only once the sheet has fully
  // unmounted (the exit window keeps focus inside).
  useEffect(() => {
    if (!mounted) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    return () => {
      if (!rootRef.current) previouslyFocused?.focus();
    };
  }, [mounted]);

  /** Bubble-phase boundary on the sheet root: stop outbound propagation
   * (tldraw binds F → Frame on body), then layer Esc (ⓘ first, sheet second,
   * swallowed during the exit window) and trap Tab inside the sheet. */
  const onSheetKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
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
      const root = event.currentTarget;
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

  const switchTab = useCallback(
    (id: DsSectionId) => {
      setSection(id);
      // 09C-D03: no Components Home — the tab lands on the first component.
      const landing = id === "components" ? model?.components.landingLeaf : null;
      setRoute(
        landing
          ? { kind: "leaf", section: id, leaf: landing }
          : { kind: "section", section: id }
      );
    },
    [model]
  );
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
    onApprove: readOnly ? undefined : (row) => void approve(row),
    onApproveRows: readOnly
      ? undefined
      : (rowsToApprove) => {
          void (async () => {
            // Sequential: composite rows often share one source file, and
            // parallel writes would trip the concurrent-source guard.
            for (const rowToApprove of rowsToApprove) {
              await approve(rowToApprove);
            }
          })();
        },
    onEditEntry: readOnly ? undefined : editEntry
  };

  const renderMain = (): ReactNode => {
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

    // 09C-D03: the Components section has no home — it lands on the first
    // component's detail, or renders the honest empty state.
    const renderComponentsLanding = (): ReactNode => {
      const landing =
        model.components.list.find(
          (component) => component.leafId === model.components.landingLeaf
        ) ?? null;
      return landing ? (
        <ComponentDetail
          component={landing}
          rows={rowListProps}
          session={session}
        />
      ) : (
        <p className="dsb-empty-body dsb-page-note">
          No components inventoried yet.
        </p>
      );
    };

    if (route.kind === "section") {
      return route.section === "foundations" ? (
        <FoundationsHomePage model={model} rows={rowListProps} />
      ) : (
        renderComponentsLanding()
      );
    }

    if (route.section === "foundations") {
      if (route.leaf === "layout") {
        // 09C-D02: Source Capture placards — full-width page stream.
        return (
          <LayoutLeafPage
            leaf={model.foundations.layout}
            rows={rowListProps}
            session={session}
          />
        );
      }
      if (route.leaf === "interaction") {
        return (
          <RulesLeafPage
            leaf={model.foundations.interaction}
            rows={rowListProps}
          />
        );
      }
      const tokenLeaf =
        model.foundations.tokenLeaves.find((leaf) => leaf.id === route.leaf) ??
        null;
      if (tokenLeaf) {
        // Color: redesigned swatch-first ledger (primitive layer collapses
        // into hover provenance). Typography: Reader Projection + real
        // specimens. Materials keeps token rows until 09C-C lands.
        if (tokenLeaf.id === "color" && view) {
          return (
            <ColorLeafPage
              model={buildColorLeafModel(view)}
              rows={rowListProps}
            />
          );
        }
        if (tokenLeaf.id === "typography" && view) {
          return (
            <TypographyLeafPage
              layers={typographyLayersFromView(view)}
              rules={tokenLeaf.rules}
              rows={rowListProps}
            />
          );
        }
        return <TokenLeafPage leaf={tokenLeaf} rows={rowListProps} />;
      }
      // Stale foundations leaf after a refetch: back to the section home.
      return <FoundationsHomePage model={model} rows={rowListProps} />;
    }

    const entryId = componentLeafId(route.leaf);
    const component =
      model.components.list.find((c) => c.entryId === entryId) ?? null;
    if (component) {
      return (
        <ComponentDetail
          component={component}
          rows={rowListProps}
          session={session}
        />
      );
    }

    // Stale route after a refetch (component vanished): land on the first
    // component rather than a blank main.
    return renderComponentsLanding();
  };

  const sidebarLeaves: { id: DsLeafId; name: string; icon: IconSvgElement }[] =
    section === "foundations" ? FOUNDATIONS_LEAVES : [];
  const componentSidebarGroups = model?.components.groups ?? [];
  const homeHasCandidate = Boolean(
    model &&
      [
        ...model.foundations.principles,
        ...(model.foundations.visualLanguage
          ? [model.foundations.visualLanguage.row]
          : [])
      ].some((row) => row.status === "candidate")
  );
  const foundationLeafHasCandidate = (leafId: DsLeafId): boolean => {
    if (!model) return false;
    if (leafId === "layout") {
      return model.foundations.layout.rows.some(
        (row) => row.status === "candidate"
      );
    }
    if (leafId === "interaction") {
      return model.foundations.interaction.rows.some(
        (row) => row.status === "candidate"
      );
    }
    const leaf = model.foundations.tokenLeaves.find(
      (candidate) => candidate.id === leafId
    );
    return Boolean(
      leaf &&
        [...leaf.rules, ...leaf.groups.flatMap((group) => group.rows)].some(
          (row) => row.status === "candidate"
        )
    );
  };

  const mainContent = renderMain();

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
        onKeyDown={onSheetKeyDown}
      >
        <div className="dsb-sheet-surface" ref={surfaceRef}>
        <div className="dsb-body">
          <aside className="dsb-sidebar">
            <div className="dsb-sidebar-title">Design System</div>
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
            <div key={section} className="dsb-enter dsb-nav-list">
              {section === "foundations" ? (
                <>
                  <button
                    type="button"
                    className="dsb-navrow"
                    data-active={route.kind === "section" || undefined}
                    data-candidate={homeHasCandidate || undefined}
                    onClick={() => setRoute({ kind: "section", section })}
                  >
                    <HugeiconsIcon
                      icon={Home01Icon}
                      size={14}
                      className="dsb-navrow-icon"
                      color="currentColor"
                      strokeWidth={2}
                    />
                    <span className="dsb-navrow-label">Home</span>
                    {homeHasCandidate ? (
                      <span aria-hidden className="dsb-navrow-candidate-dot" />
                    ) : null}
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
                      data-candidate={
                        foundationLeafHasCandidate(leaf.id) || undefined
                      }
                      onClick={() => openLeaf(section, leaf.id)}
                    >
                      <HugeiconsIcon
                        icon={leaf.icon}
                        size={14}
                        className="dsb-navrow-icon"
                        color="currentColor"
                        strokeWidth={2}
                      />
                      <span className="dsb-navrow-label">{leaf.name}</span>
                      {foundationLeafHasCandidate(leaf.id) ? (
                        <span aria-hidden className="dsb-navrow-candidate-dot" />
                      ) : null}
                    </button>
                  ))}
                </>
              ) : (
                // 09C-D03: no Components Home — grouped direct-to-detail nav.
                // Components first, Blocks second; candidate pages carry the
                // same right-aligned blue dot as Foundations pages.
                componentSidebarGroups.map((group) => (
                  <div
                    key={group.id}
                    className="dsb-navgroup"
                    data-testid={`ds-navgroup-${group.id}`}
                  >
                    <div className="dsb-navgroup-head">
                      <span className="dsb-navgroup-name">{group.name}</span>
                    </div>
                    {group.items.map((item) => (
                      <button
                        key={item.leafId}
                        type="button"
                        className="dsb-navrow"
                        data-active={
                          (route.kind === "leaf" &&
                            route.leaf === item.leafId) ||
                          // Section-level route renders the landing detail —
                          // mark the landing item active so the sidebar
                          // selection matches the main pane.
                          (route.kind === "section" &&
                            item.leafId === model?.components.landingLeaf) ||
                          undefined
                        }
                        data-candidate={item.candidate || undefined}
                        onClick={() => openLeaf(section, item.leafId)}
                      >
                        <span className="dsb-navrow-label">{item.name}</span>
                        {item.candidate ? (
                          <span aria-hidden className="dsb-navrow-candidate-dot" />
                        ) : null}
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </aside>
          <main className="dsb-main">
            <button
              type="button"
              aria-label="Close Design System"
              className="dsb-icon-button dsb-main-close"
              data-testid="ds-close"
              onClick={() => onClose("button")}
            >
              <HugeiconsIcon
                icon={MultiplicationSignIcon}
                size={14}
                color="currentColor"
                strokeWidth={2}
              />
            </button>
            <div className="dsb-main-top">
              <nav aria-label="Breadcrumb" className="dsb-breadcrumb">
                {model
                  ? breadcrumbFor(route, model).map(
                      (segment, index, segments) => (
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
                      )
                    )
                  : null}
              </nav>
              {routeSyncWarnings.length > 0 ? (
                <p
                  className="dsb-page-note dsb-sync-warning"
                  data-testid="ds-sync-warning"
                  role="status"
                >
                  {routeSyncWarnings.length === 1
                    ? `One source file could not be synced (${routeSyncWarnings[0].path}) — showing its last synced version.`
                    : `${routeSyncWarnings.length} source files could not be synced — showing their last synced versions.`}
                </p>
              ) : null}
            </div>
            <div
              key={`${route.kind}-${route.kind === "leaf" ? route.leaf : route.section}`}
              className="dsb-enter dsb-page"
            >
              {mainContent}
            </div>
          </main>
        </div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- component detail ----------------------------- */

/* Component Reader: the hero remains the visual anchor. The reading column
 * projects the Runtime contract one-to-one as Overview, Variants, States,
 * Do / Don’ts, and complete Technical details. */

function columnsForRows(
  rows: readonly Record<string, unknown>[],
  leading: readonly string[] = []
): string[] {
  const available = new Set(rows.flatMap((row) => Object.keys(row)));
  const first = leading.filter((column) => available.delete(column));
  return [...first, ...available];
}

function formatColumnLabel(column: string): string {
  const words = column.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function ComponentRecordTable({
  rows,
  leading = []
}: {
  rows: readonly Record<string, unknown>[];
  leading?: readonly string[];
}) {
  const columns = columnsForRows(rows, leading);
  return (
    <table className="dsb-table">
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column}>{formatColumnLabel(column)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index}>
            {columns.map((column) => (
              <td key={column}>{formatMatrixCell(row[column])}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One data-driven optional group: prose lines verbatim, object rows as a
 * single table keyed by the union of row keys. */
function ComponentReferenceGroup({
  group
}: {
  group: DsComponentDetailGroup;
}) {
  return (
    <div
      className="dsb-reference-group"
      data-testid={`ds-component-group-${group.id}`}
    >
      <h3 className="dsb-reference-label">{group.label}</h3>
      {group.lines.length > 0 ? (
        <ul className="dsb-boundaries">
          {group.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {group.rows.length > 0 ? (
        <ComponentRecordTable rows={group.rows} />
      ) : null}
    </div>
  );
}

export function ComponentDetail({
  component,
  rows,
  session
}: {
  component: DsComponentModel;
  rows: RowSharedProps;
  session: string;
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
  const capture = component.captures[0] ?? null;
  const purpose =
    detail?.description || component.inventory?.meaning || "";
  const propColumns = detail
    ? columnsForRows(detail.props, ["name", "type"])
    : [];

  return (
    <article
      className="dsb-component"
      data-testid={`ds-component-${component.entryId}`}
    >
      <section className="dsb-hero" data-testid="ds-component-hero">
        <span className="dsb-hero-origin">
          <OriginTag origin={capture ? "source-capture" : "unavailable"} />
        </span>
        {capture ? (
          <img
            className="dsb-hero-image"
            src={artifactScreenshotUrl(capture.artifactPath, session)}
            alt={`Source capture of ${capture.nodeName}`}
          />
        ) : (
          <div
            className="dsb-placard-unavailable dsb-hero-unavailable"
            role="img"
            aria-label={`No source capture for ${component.name}`}
            data-testid="ds-component-unavailable"
          >
            <span className="dsb-placard-unavailable-title">
              No source capture
            </span>
            <span className="dsb-placard-unavailable-note">
              This component has no capture and no live implementation yet —
              ask the agent to implement this component for a real-time
              preview.
            </span>
          </div>
        )}
        {capture ? (
          <span
            className="dsb-hero-caption"
            data-testid="ds-component-caption"
          >
            <span>{capture.nodeName}</span>
            <span data-stale={capture.stale || undefined}>
              captured {formatCapturedAt(capture.capturedAt)}
              {capture.stale ? " · stale" : ""}
            </span>
          </span>
        ) : null}
        {detail && detail.stateNames.length > 0 ? (
          <div
            className="dsb-hero-states"
            aria-label="Declared states"
            data-testid="ds-component-states"
          >
            {detail.stateNames.map((name) => (
              <span key={name} className="dsb-hero-state">
                {name}
              </span>
            ))}
          </div>
        ) : null}
      </section>

      <div className="dsb-reader">
        <header className="dsb-reader-head">
          <div className="dsb-reader-title-row">
            <h1 className="dsb-h1" data-testid="ds-component-title">
              {component.name}
            </h1>
            <StatusChip
              status={component.status}
              testId="ds-component-status"
            />
          </div>
        </header>
        {purpose !== "" ? (
          <section className="dsb-section" data-testid="ds-component-overview">
            <GroupLabel>Overview</GroupLabel>
            <p className="dsb-reader-body">{purpose}</p>
          </section>
        ) : null}
        {detail && detail.variants.length > 0 ? (
          <section className="dsb-section" data-testid="ds-component-variants">
            <GroupLabel>Variants</GroupLabel>
            <ComponentRecordTable
              rows={detail.variants}
              leading={["axis", "name"]}
            />
          </section>
        ) : null}
        {detail && detail.props.length > 0 ? (
          <section className="dsb-section" data-testid="ds-component-properties">
            <GroupLabel>Properties</GroupLabel>
            <table className="dsb-table">
              <thead>
                <tr>
                  {propColumns.map(
                    (column) => <th key={column}>{formatColumnLabel(column)}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {detail.props.map((prop) => (
                  <tr
                    key={prop.name}
                    data-testid={`ds-component-prop-${prop.name}`}
                  >
                    {propColumns.map(
                      (column) => (
                        <td key={column}>
                          {column === "status" && prop[column] === "candidate" ? (
                            <StatusChip
                              status="candidate"
                              testId={`ds-component-prop-status-${prop.name}`}
                            />
                          ) : (
                            formatMatrixCell(prop[column])
                          )}
                        </td>
                      )
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}
        {detail && detail.stateMatrix.length > 0 ? (
          <section className="dsb-section" data-testid="ds-component-state-matrix">
            <GroupLabel>States</GroupLabel>
            <ComponentRecordTable rows={detail.stateMatrix} leading={["state"]} />
          </section>
        ) : null}
        {detail && detail.guidelines.length > 0 ? (
          <section className="dsb-section" data-testid="ds-component-guidelines">
            <GroupLabel>Do / Don’ts</GroupLabel>
            <div className="dsb-guidelines">
              {(["do", "dont"] as const).map((kind) => {
                const items = detail.guidelines.filter(
                  (guideline) => guideline.kind === kind
                );
                if (items.length === 0) return null;
                const label = kind === "do" ? "Do" : "Don’t";
                const rows = items.map(({ kind: _kind, ...guideline }) => guideline);
                const hasMetadata = rows.some((guideline) =>
                  Object.keys(guideline).some((key) => key !== "text")
                );
                return (
                  <div className="dsb-guideline-group" data-kind={kind} key={kind}>
                    <div className="dsb-guideline-label" aria-label={label}>
                      <HugeiconsIcon
                        icon={kind === "do" ? Tick02Icon : MultiplicationSignIcon}
                        size={14}
                        strokeWidth={2}
                        aria-hidden
                      />
                      <span>{label}</span>
                    </div>
                    {hasMetadata ? (
                      <ComponentRecordTable rows={rows} leading={["text"]} />
                    ) : (
                      <ul className="dsb-boundaries">
                        {items.map((guideline) => (
                          <li key={guideline.text}>{guideline.text}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}
        {detail || component.captures.length > 0 || statusRows.length > 0 ? (
          <section className="dsb-section" data-testid="ds-component-technical-details">
            <GroupLabel>Technical details</GroupLabel>
            <div className="dsb-technical-details">
              {component.captures.length > 0 ? (
                <div className="dsb-reference-group">
                  <h3 className="dsb-reference-label">Source captures</h3>
                  <ComponentRecordTable
                    rows={component.captures.map((sourceCapture) => ({
                      ...sourceCapture
                    }))}
                    leading={["nodeName", "artifactPath", "capturedAt"]}
                  />
                </div>
              ) : null}
              {detail?.referenceGroups.map((group) => (
                <ComponentReferenceGroup key={group.id} group={group} />
              ))}
              {statusRows.length > 0 ? (
                <div className="dsb-reference-group">
                  <h3 className="dsb-reference-label">Status &amp; evidence</h3>
                  <RowList rows={statusRows} {...rows} />
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
        {detail ? null : (
          <p className="dsb-empty-body dsb-page-note">
            No spec ingested for this component yet.
          </p>
        )}
      </div>
    </article>
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
