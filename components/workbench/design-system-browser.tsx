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
// locks active), and the Esc-from-canvas isolation needs a boundary the
// component fully owns (bubble-phase on the sheet root, so the sheet's own
// controls receive keydown before propagation stops). The ⓘ hover layer
// DOES use radix Popover (components/ui/popover), portaled into the sheet
// root so its keydown events stay inside the isolation boundary.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  ColorsIcon,
  ComponentIcon,
  GridViewIcon,
  Home01Icon,
  InformationCircleIcon,
  Layers01Icon,
  MultiplicationSignIcon,
  Route01Icon,
  TextFontIcon
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import { subscribeRuntimeEvents } from "@/components/runtime/runtime-client";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion";
import { LeafSplit } from "./ds-split-pane";
import { DEFAULT_DS_SPLIT_RATIO } from "./ds-split-pane-model";
import {
  DESIGN_SYSTEM_BROWSER_PREFERENCES_VERSION,
  parseDesignSystemBrowserPreferences
} from "@/lib/runtime/design-system-browser-preferences-shared";
import {
  projectObjectFields,
  projectInteractionLeaf,
  projectPrinciple,
  projectTypographyLeaf,
  typographyAtlasItems,
  typographyLayersFromView,
  type PrincipleProjection,
  type TokenLayerKey,
  type TypographyAtlasItem
} from "./design-system-reader-projection";
import {
  BLUEPRINT_SCALE_REFERENCE_PX,
  containerDrawsToScale,
  firstFactOfKind,
  projectLayoutBlueprint,
  sliceLayoutBlueprint,
  type LayoutBlueprintModel,
  type LayoutRuleProjection
} from "./design-system-layout-projection";
import {
  DS_SECTION_NAMES,
  TOKEN_LAYER_LABELS,
  approvalReducer,
  breadcrumbFor,
  buildDesignSystemBrowserModel,
  componentLeafId,
  formatEntryValue,
  sheetReducer,
  sheetEscapeAction,
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
export const DESIGN_SYSTEM_SHEET_REDUCED_MOTION_EXIT_MS = 150;

export function designSystemSheetExitMs(prefersReducedMotion: boolean): number {
  return prefersReducedMotion
    ? DESIGN_SYSTEM_SHEET_REDUCED_MOTION_EXIT_MS
    : DESIGN_SYSTEM_SHEET_EXIT_MS;
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
  return (
    <span className="dsb-chip" data-status={status} data-testid={testId}>
      {status === "gap" ? "open gap" : status}
    </span>
  );
}

/** The one status → dot color mapping (chips, stat dots, specimen
 * annotations all read the same three tokens). */
function statusDotColor(status: DsStatus): string {
  if (status === "formalized") return "var(--dsc-green)";
  if (status === "candidate") return "var(--dsc-accent)";
  return "var(--dsc-ink-3)";
}

function dotColor(label: string): string {
  const status: DsStatus = label.includes("formalized")
    ? "formalized"
    : label.includes("candidate")
      ? "candidate"
      : "gap";
  return statusDotColor(status);
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

/* ------------------------------ visual origin ------------------------------ */

/** Where a visual sample comes from (09C-B): the four outcomes must stay
 * distinguishable in the UI and the accessibility tree, so a schematic
 * composition is never mistaken for a rendered component. Rendered as an
 * outlined tag — visually distinct from the filled status chip. */
export type DsVisualOrigin =
  | "code-backed"
  | "source-generated"
  | "schematic"
  | "unavailable";

export const DS_VISUAL_ORIGIN_LABELS: Record<DsVisualOrigin, string> = {
  "code-backed": "Code-backed",
  "source-generated": "Source-generated",
  schematic: "Schematic",
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
  onApprove: () => void;
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
  numbered?: boolean;
  approvals: Record<string, ApprovalState>;
  infoKey: string | null;
  popoverInstant: (key: string) => boolean;
  portalContainer: HTMLElement | null;
  onInfoKey: (key: string | null) => void;
  onInfoHoverOpen: (key: string) => void;
  onInfoHoverClose: () => void;
  onApprove: (row: DsRow) => void;
  /** 09C-B Blueprint anchor wiring: when present, each row carries its 1-based
   * anchor number and hover/focus drives row ↔ drawing isolation. */
  anchorState?: {
    active: number | null;
    onHover: (anchor: number | null) => void;
  };
  /** 09C-B Checklist composition: when present, rows gain a leading check
   * control and the whole row toggles membership in the composed drawing. */
  selectState?: {
    selected: ReadonlySet<number>;
    onToggle: (anchor: number) => void;
  };
};

/** Everything RowList needs except the rows themselves — shared by all pages. */
export type RowSharedProps = Omit<RowListProps, "rows" | "numbered">;

function RowList({
  rows,
  numbered = false,
  anchorState,
  selectState,
  ...rest
}: RowListProps) {
  return (
    <div className="dsb-rows">
      {rows.map((row, index) => {
        const specRow = (
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
            onApprove={() => rest.onApprove(row)}
          />
        );
        if (!anchorState) return specRow;
        const anchor = index + 1;
        const selected = selectState?.selected.has(anchor) ?? false;
        return (
          <div
            key={row.key}
            className="dsb-row-anchor"
            data-anchor-active={anchorState.active === anchor || undefined}
            data-selectable={selectState ? "" : undefined}
            data-selected={selected || undefined}
            onMouseEnter={() => anchorState.onHover(anchor)}
            onMouseLeave={() => anchorState.onHover(null)}
            onClick={
              selectState
                ? (event) => {
                    // The whole row is the toggle target — but clicks meant
                    // for nested controls (info popover, approve) stay theirs.
                    if (
                      event.target instanceof HTMLElement &&
                      event.target.closest("button, a, input") !== null
                    ) {
                      return;
                    }
                    selectState.onToggle(anchor);
                  }
                : undefined
            }
          >
            {selectState ? (
              <button
                type="button"
                className="dsb-row-check"
                data-checked={selected || undefined}
                aria-pressed={selected}
                aria-label={`Include ${row.name} in the drawing`}
                onClick={(event) => {
                  event.stopPropagation();
                  selectState.onToggle(anchor);
                }}
              >
                <svg viewBox="0 0 10 10" fill="none" aria-hidden>
                  <path
                    d="M1.5 5.2 4 7.5 8.5 2.5"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            ) : null}
            <span aria-hidden className="dsb-anchor-num">
              {anchor}
            </span>
            {specRow}
          </div>
        );
      })}
    </div>
  );
}

function PageSummary({
  meta,
  chips
}: {
  meta: string;
  chips: string[];
}) {
  return (
    <div className="dsb-intro">
      <p className="dsb-meta">{meta}</p>
      <StatDots items={chips} />
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
      <PageSummary meta={meta} chips={chips} />
    </>
  );
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

/** Principle rule card (09A: principles 规则卡 on Foundations Home — cards in
 * the prototype's LeafCard visual language, not spec rows). Rich values
 * (09B: statement / rationale / scope / use / avoid / exceptions) project
 * into readable fields (09C-A); chip + ⓘ evidence affordance in the footer. */
function PrincipleCard({
  row,
  approval,
  rows
}: {
  row: DsRow;
  approval: ApprovalState;
  rows: RowSharedProps;
}) {
  const principle: PrincipleProjection = projectPrinciple(row.entry);
  return (
    <div
      className="dsb-card dsb-principle"
      data-testid={`ds-principle-${row.entryId}`}
      data-approve-error={approval.kind === "error" || undefined}
    >
      <span className="dsb-card-title">{principle.statement}</span>
      {row.meaning ? (
        <span className="dsb-card-desc">{row.meaning}</span>
      ) : null}
      {principle.isRich ? (
        <div className="dsb-principle-fields">
          {principle.rationale ? (
            <span className="dsb-principle-field">
              <span className="dsb-principle-field-label">Rationale</span>
              <p className="dsb-principle-field-text">{principle.rationale}</p>
            </span>
          ) : null}
          {principle.scope ? (
            <span className="dsb-principle-field">
              <span className="dsb-principle-field-label">Scope</span>
              <p className="dsb-principle-field-text">{principle.scope}</p>
            </span>
          ) : null}
          {principle.use.length > 0 ? (
            <span className="dsb-principle-field">
              <span className="dsb-principle-field-label">Use</span>
              <ul className="dsb-principle-list">
                {principle.use.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </span>
          ) : null}
          {principle.avoid.length > 0 ? (
            <span className="dsb-principle-field">
              <span className="dsb-principle-field-label">Avoid</span>
              <ul className="dsb-principle-list">
                {principle.avoid.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </span>
          ) : null}
          {principle.exceptions.length > 0 ? (
            <span className="dsb-principle-field">
              <span className="dsb-principle-field-label">Exceptions</span>
              <ul className="dsb-principle-list">
                {principle.exceptions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </span>
          ) : null}
          {principle.extraFields
            ? principle.extraFields.map((field) => (
                <span key={field.label} className="dsb-principle-field">
                  <span className="dsb-principle-field-label">
                    {field.label}
                  </span>
                  <p className="dsb-principle-field-text">{field.text}</p>
                </span>
              ))
            : null}
        </div>
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
        <section className="dsb-section dsb-narrative">
          <GroupLabel>Visual language</GroupLabel>
          <p className="dsb-narrative-text">
            {visualLanguage.description || visualLanguage.row.value}
          </p>
          <RowList rows={[visualLanguage.row]} {...rows} />
        </section>
      ) : null}
      {principles.length > 0 ? (
        <section className="dsb-section">
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
        </section>
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
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                size={14}
                className="dsb-card-chevron"
                color="currentColor"
                strokeWidth={2}
              />
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

function InteractionRuleCard({
  rule,
  approval,
  rows
}: {
  rule: ReturnType<typeof projectInteractionLeaf>[number];
  approval: ApprovalState;
  rows: RowSharedProps;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = `ds-interaction-details-${rule.row.entryId.replace(
    /[^a-zA-Z0-9_-]/g,
    "-"
  )}`;
  return (
    <li
      className="dsb-interaction-rule"
      data-testid={`ds-interaction-rule-${rule.anchor}`}
      data-expanded={expanded || undefined}
      data-approve-error={approval.kind === "error" || undefined}
    >
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="dsb-interaction-ledger-row"
            aria-label={rule.statement}
            aria-controls={detailsId}
          >
            <span className="dsb-interaction-anchor" aria-hidden>
              {rule.anchor}
            </span>
            <span className="dsb-interaction-ledger-main">
              <span className="dsb-card-title">{rule.statement}</span>
              {rule.meaning ? (
                <span className="dsb-card-desc">{rule.meaning}</span>
              ) : null}
            </span>
            <StatusChip status={rule.status} testId="ds-interaction-status" />
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              size={14}
              className="dsb-interaction-ledger-chevron"
              aria-hidden
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent asChild>
          <div className="dsb-interaction-ledger-details" id={detailsId}>
            {rule.isRich ? (
              <div className="dsb-principle-fields">
                {rule.description ? (
                  <span className="dsb-principle-field">
                    <span className="dsb-principle-field-label">Description</span>
                    <p className="dsb-principle-field-text">{rule.description}</p>
                  </span>
                ) : null}
                {(["behavior", "accessibility"] as const).map((field) =>
                  rule[field].length > 0 ? (
                    <span className="dsb-principle-field" key={field}>
                      <span className="dsb-principle-field-label">
                        {field[0]!.toUpperCase() + field.slice(1)}
                      </span>
                      <ul className="dsb-principle-list">
                        {rule[field].map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    </span>
                  ) : null
                )}
              </div>
            ) : null}
            <div className="dsb-principle-footer">
              <InfoPopover
                entry={rule.row.entry}
                approval={approval}
                infoOpen={rows.infoKey === rule.key}
                popoverInstant={rows.popoverInstant(rule.key)}
                portalContainer={rows.portalContainer}
                ariaLabel={`Evidence for interaction rule ${rule.row.entryId}`}
                onInfoOpenChange={(open) => rows.onInfoKey(open ? rule.key : null)}
                onInfoHoverOpen={() => rows.onInfoHoverOpen(rule.key)}
                onInfoHoverClose={rows.onInfoHoverClose}
                onApprove={() => rows.onApprove(rule.row)}
              />
            </div>
            {approval.kind === "error" ? (
              <span className="dsb-row-error" role="alert">
                Approval failed: {approval.message}
              </span>
            ) : null}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </li>
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
      <PageHeading
        title="Interaction"
        meta={`${leaf.rows.length} rules`}
        chips={leaf.chips}
      />
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
          <section
            key={group.layer}
            className="dsb-section"
            data-testid={`ds-token-layer-${group.layer}`}
          >
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

/* ------------------------- 09C-A: leaf split pages ------------------------- */

/** Ratio state threaded from the browser-level preference hook. */
interface LeafSplitRatioProps {
  ratio: number;
  onRatioChange: (ratio: number) => void;
  onRatioCommit: (ratio: number) => void;
}

/** Honest right-pane state for leaves whose visual grammar lands in 09C-B/C:
 * an explicit "no visual samples yet", never a fake sample. Locked decision:
 * no standalone explanatory paragraph in the right pane — the marker alone
 * carries the state. */
function VisualSamplesEmpty() {
  return (
    <div className="dsb-samples" data-testid="ds-samples-empty">
      <GroupLabel>Visual samples</GroupLabel>
      <div className="dsb-samples-empty">
        <p className="dsb-samples-empty-title">No visual samples yet</p>
      </div>
    </div>
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

/** Render the style name in its declared type treatment. Invalid CSS values
 * stay out of the specimen while their source text remains available in the
 * disclosure below. Large sizes cap against the row container so a long role
 * name never truncates. */
function typographySpecimenCss(item: TypographyAtlasItem): React.CSSProperties {
  const css: React.CSSProperties & { "--dsb-type-size"?: string } = {};
  if (item.specimenFamily) css.fontFamily = item.specimenFamily;
  if (item.fontSizePx !== null) {
    css["--dsb-type-size"] = `${Math.min(item.fontSizePx, 64)}px`;
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
  onToggle
}: {
  item: TypographyAtlasItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  const metrics = typographyLedgerMetrics(item);
  const detailsId = `dsb-type-details-${item.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  return (
    <article
      className="dsb-type-item"
      data-expanded={expanded || undefined}
      data-testid={`ds-atlas-${item.sourceRows[0]?.entryId ?? item.key}`}
    >
      <div className="dsb-type-row">
        <div className="dsb-type-name">
          {item.specimenFamily ? (
            <h2 className="dsb-type-specimen" style={typographySpecimenCss(item)}>
              {item.label}
            </h2>
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
          <dl className="dsb-type-details">
            {metrics.map((metric) => (
              <div key={metric.label} className="dsb-type-detail">
                <dt>{metric.label}</dt>
                <dd>{metric.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </article>
  );
}

/** Typography leaf: a quiet, visual-first ledger. Each row shows the style
 * name in its declared type treatment, its intended use, and one disclosure
 * for construction details. Evidence, approval state and source ids remain
 * outside this interaction surface. */
export function TypographyLeafPage({
  layers
}: {
  layers: {
    layer: TokenLayerKey;
    entries: DesignSystemEntryView[];
  }[];
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

  return (
    <div className="dsb-typography-page">
      <h1 className="dsb-h1">Typography</h1>
      {orderedItems.length > 0 ? (
        <section
          className="dsb-section dsb-typography-atlas"
          data-testid="ds-typography-ledger"
        >
          <p className="dsb-type-count" data-testid="ds-typography-summary">
            {orderedItems.length} type styles
          </p>
          <div className="dsb-type-columns" aria-hidden="true">
            <span>Typeface</span>
            <span>Used for</span>
            <span />
          </div>
          <div className="dsb-type-list">
            {orderedItems.map((item) => (
              <TypographyLedgerRow
                key={item.key}
                item={item}
                expanded={expandedKey === item.key}
                onToggle={() =>
                  setExpandedKey((current) =>
                    current === item.key ? null : item.key
                  )
                }
              />
            ))}
          </div>
        </section>
      ) : (
        <p className="dsb-empty-body dsb-page-note">
          No typography tokens classified here yet.
        </p>
      )}
    </div>
  );
}

/* ------------------------- 09C-B: layout blueprint ------------------------- */

/**
 * Layout leaf (09C-B, designer-selected Blueprint direction): one schematic
 * architectural drawing composes every drawable rule — container dimension,
 * shell regions, grid columns, gutter measure, section rhythm, breakpoint
 * ruler — with circled anchors keying each measurement to its rule row.
 * Hovering or keyboard-focusing either side isolates the other (逐项对应).
 * Rules with no drawable spatial vocabulary stay out of the drawing and get
 * an explicit unavailable sample instead of a fabricated visual.
 *
 * Visual language (locked against the prototype):
 *   - accent fills / dimension lines = quantitative source-backed facts;
 *   - gray blocks = declared structural regions (qualitative);
 *   - dashed frames = presentation scaffold (viewport, content field) or
 *     honest unknowns — never source claims;
 *   - anchor dots carry the rule's status color (the same three tokens as
 *     stat dots and chips), so candidate/gap stay recognizable INSIDE the
 *     visual module; isolation is opacity-only and never recolors status.
 */

const BP_VP = { x: 70, y: 40, w: 620, h: 480 } as const;
const BP_BODY = { y: 48, h: 460 } as const;

interface LayoutAnchorWiring {
  activeAnchor: number | null;
  onActiveAnchor: (anchor: number | null) => void;
}

function LayoutAnchorGroup({
  anchor,
  status,
  wiring,
  children
}: {
  anchor: number;
  status: DsStatus;
  wiring: LayoutAnchorWiring;
  children: React.ReactNode;
}) {
  return (
    <g
      className="dsb-bp-anchor"
      data-anchor={anchor}
      data-status={status}
      data-anchor-active={wiring.activeAnchor === anchor ? "" : undefined}
      onMouseEnter={() => wiring.onActiveAnchor(anchor)}
      onMouseLeave={() => wiring.onActiveAnchor(null)}
    >
      {children}
    </g>
  );
}

/** Circled anchor number, keyboard-focusable so the correspondence path does
 * not require a pointer. Focus/blur isolates exactly like hover. */
function AnchorDot({
  n,
  cx,
  cy,
  label,
  wiring
}: {
  n: number;
  cx: number;
  cy: number;
  label: string;
  wiring: LayoutAnchorWiring;
}) {
  return (
    <g
      className="dsb-bp-dot-focus"
      tabIndex={0}
      role="img"
      aria-label={`Anchor ${n}: ${label}`}
      onFocus={() => wiring.onActiveAnchor(n)}
      onBlur={() => wiring.onActiveAnchor(null)}
    >
      <circle className="dsb-bp-dot" cx={cx} cy={cy} r={8} />
      <text
        className="dsb-bp-dot-num"
        x={cx}
        y={cy + 3}
        textAnchor="middle"
        fontSize={9}
        fontWeight={600}
      >
        {n}
      </text>
    </g>
  );
}

function LayoutBlueprintSvg({
  model,
  wiring
}: {
  model: LayoutBlueprintModel;
  wiring: LayoutAnchorWiring;
}) {
  const containerEntry = firstFactOfKind(model, "container");
  const regionsEntry = firstFactOfKind(model, "regions");
  const columnsEntry = firstFactOfKind(model, "columns");
  const gutterEntry = firstFactOfKind(model, "gutter");
  const rhythmEntry = firstFactOfKind(model, "rhythm");
  const breakpointsEntry = firstFactOfKind(model, "breakpoints");

  // Container: proportional against a nominal 1440 reference viewport when a
  // px width is declared; normalized otherwise, and the drawing says so.
  const containerPx = containerEntry?.fact.maxWidthPx ?? null;
  const toScale = containerDrawsToScale(containerPx);
  const containerW = toScale
    ? Math.round((BP_VP.w * containerPx!) / BLUEPRINT_SCALE_REFERENCE_PX)
    : 517;
  const containerX = BP_VP.x + (BP_VP.w - containerW) / 2;
  const containerRight = containerX + containerW;

  // Shell regions: declared stacks divide the body; without them a single
  // dashed content field provides neutral coordinates (scaffold, not a claim).
  const regions = regionsEntry?.fact.regions ?? null;
  const regionGap = 6;
  const regionH = regions
    ? (BP_BODY.h - (regions.length - 1) * regionGap) / regions.length
    : 0;
  const regionRect = (index: number) => ({
    x: containerX,
    y: BP_BODY.y + index * (regionH + regionGap),
    w: containerW,
    h: regionH
  });

  // Columns live inside the second-to-last region (above the footer, the
  // content position), or in a centered zone of the scaffold field.
  let columnsZone: { x: number; y: number; w: number; h: number } | null = null;
  if (columnsEntry) {
    if (regions) {
      const host = Math.max(0, regions.length - 2);
      const rect = regionRect(host);
      columnsZone = {
        x: rect.x + 12,
        y: rect.y + 10,
        w: rect.w - 24,
        h: rect.h - 20
      };
    } else {
      columnsZone = {
        x: containerX + 16,
        y: BP_BODY.y + BP_BODY.h / 2 - 32,
        w: containerW - 32,
        h: 64
      };
    }
  }
  const colCount = columnsEntry?.fact.columns ?? 0;
  const schematicGap = 6;
  const colH = columnsZone ? Math.min(columnsZone.h, 64) : 0;
  const colY = columnsZone ? columnsZone.y + (columnsZone.h - colH) / 2 : 0;
  const colW = columnsZone
    ? (columnsZone.w - (colCount - 1) * schematicGap) / colCount
    : 0;

  // Rhythm: a vertical measure across the hero→next boundary (the region
  // above the content position), or between two scaffold sections.
  let rhythmBracket: { x: number; top: number; bottom: number } | null = null;
  let rhythmSections: { x: number; y: number; w: number; h: number }[] | null =
    null;
  if (rhythmEntry) {
    const x = containerRight - 16;
    if (regions && regions.length >= 2) {
      const upper = Math.max(0, regions.length - 3);
      const boundaryY = regionRect(upper).y + regionH + regionGap / 2;
      rhythmBracket = { x, top: boundaryY - 17, bottom: boundaryY + 17 };
    } else if (!regions) {
      rhythmSections = [
        { x: containerX + 16, y: 88, w: containerW - 32, h: 140 },
        { x: containerX + 16, y: 268, w: containerW - 32, h: 170 }
      ];
      rhythmBracket = { x, top: 228, bottom: 268 };
    }
  }

  // Gutter-only rules (no grid): two neutral blocks with the measure between.
  const gutterOnly = gutterEntry !== null && columnsEntry === null;
  const gutterOnlyX = containerX + (containerW - 216) / 2;
  const gutterOnlyY = BP_BODY.y + BP_BODY.h / 2;

  const bpRulerY = 545;
  const bpTickX = (
    mark: { px: number | null },
    index: number,
    total: number
  ): number =>
    mark.px !== null
      ? Math.min(BP_VP.x + (mark.px / 1400) * BP_VP.w, BP_VP.x + BP_VP.w)
      : BP_VP.x + ((index + 1) / (total + 1)) * BP_VP.w;

  const ariaFacts = [
    containerEntry ? `container ${containerEntry.fact.label}` : null,
    regionsEntry ? `regions ${regionsEntry.fact.regions!.join(", ")}` : null,
    columnsEntry ? `${columnsEntry.fact.label} columns` : null,
    gutterEntry ? `gutter ${gutterEntry.fact.label}` : null,
    rhythmEntry ? `section rhythm ${rhythmEntry.fact.label}` : null,
    breakpointsEntry ? `breakpoints ${breakpointsEntry.fact.label}` : null
  ].filter((part): part is string => part !== null);

  return (
    <svg
      className="dsb-bp-svg"
      viewBox="0 0 720 600"
      role="img"
      aria-label={`Schematic layout blueprint (anchors key each measurement to its rule row): ${ariaFacts.join(
        "; "
      )}`}
      data-testid="ds-layout-blueprint-svg"
      data-active-anchor={wiring.activeAnchor ?? undefined}
      style={{ display: "block", width: "100%", height: "auto" }}
    >
      {/* Reference viewport — presentation scaffold. */}
      <rect
        x={BP_VP.x}
        y={BP_VP.y}
        width={BP_VP.w}
        height={BP_VP.h}
        fill="none"
        stroke="rgb(0 0 0 / 22%)"
        strokeDasharray="4 4"
        rx={6}
      />
      <text x={BP_VP.x + BP_VP.w - 2} y={BP_VP.y - 8} textAnchor="end" fontSize={10}>
        {toScale ? "nominal 1440 viewport" : "viewport"}
      </text>

      {/* Container frame: solid when its width is declared, dashed scaffold
          otherwise. */}
      <rect
        x={containerX}
        y={BP_BODY.y}
        width={containerW}
        height={BP_BODY.h}
        fill="none"
        stroke={
          containerEntry ? "rgb(0 0 0 / 20%)" : "rgb(0 0 0 / 14%)"
        }
        strokeDasharray={containerEntry ? undefined : "3 3"}
        rx={4}
      />

      {/* Container dimension. */}
      {containerEntry ? (
        <LayoutAnchorGroup
          anchor={containerEntry.rule.anchor}
          status={containerEntry.rule.row.status}
          wiring={wiring}
        >
          <line className="dsb-bp-dim" x1={containerX} y1={26} x2={containerRight} y2={26} />
          <line className="dsb-bp-dim" x1={containerX} y1={22} x2={containerX} y2={30} />
          <line className="dsb-bp-dim" x1={containerRight} y1={22} x2={containerRight} y2={30} />
          <text x={BP_VP.x + BP_VP.w / 2} y={18} textAnchor="middle" fontSize={10.5}>
            {containerEntry.fact.label}
          </text>
          {!toScale ? (
            <text x={containerRight} y={36} textAnchor="end" fontSize={9} className="dsb-bp-note">
              not to scale
            </text>
          ) : null}
          <AnchorDot
            n={containerEntry.rule.anchor}
            cx={containerX - 16}
            cy={26}
            label={`${containerEntry.rule.concern} — ${containerEntry.fact.label}`}
            wiring={wiring}
          />
        </LayoutAnchorGroup>
      ) : null}

      {/* Shell regions, or the scaffold content field. */}
      {regions && regionsEntry ? (
        <LayoutAnchorGroup
          anchor={regionsEntry.rule.anchor}
          status={regionsEntry.rule.row.status}
          wiring={wiring}
        >
          {regions.map((name, index) => {
            const rect = regionRect(index);
            return (
              <g key={name}>
                <rect
                  x={rect.x}
                  y={rect.y}
                  width={rect.w}
                  height={rect.h}
                  className="dsb-bp-block"
                  rx={4}
                />
                <text
                  x={rect.x + rect.w / 2}
                  y={rect.y + rect.h / 2 + 3}
                  textAnchor="middle"
                  fontSize={10}
                >
                  {name}
                </text>
              </g>
            );
          })}
          <AnchorDot
            n={regionsEntry.rule.anchor}
            cx={containerX - 10}
            cy={BP_BODY.y + BP_BODY.h / 2}
            label={`${regionsEntry.rule.concern} — ${regions.join(", ")}`}
            wiring={wiring}
          />
        </LayoutAnchorGroup>
      ) : null}
      {!regions && !rhythmSections && (columnsEntry || gutterEntry) ? (
        <rect
          x={containerX + 16}
          y={BP_BODY.y + 40}
          width={containerW - 32}
          height={BP_BODY.h - 80}
          className="dsb-bp-scaffold"
          rx={4}
        />
      ) : null}
      {rhythmSections?.map((rect, index) => (
        <rect
          key={index}
          x={rect.x}
          y={rect.y}
          width={rect.w}
          height={rect.h}
          className="dsb-bp-scaffold"
          rx={4}
        />
      ))}

      {/* Grid columns. */}
      {columnsEntry && columnsZone ? (
        <LayoutAnchorGroup
          anchor={columnsEntry.rule.anchor}
          status={columnsEntry.rule.row.status}
          wiring={wiring}
        >
          {Array.from({ length: colCount }).map((_, index) => (
            <rect
              key={index}
              x={columnsZone.x + index * (colW + schematicGap)}
              y={colY}
              width={colW}
              height={colH}
              className="dsb-bp-block-accent"
              rx={2}
            />
          ))}
          <text
            x={columnsZone.x + columnsZone.w / 2 - 40}
            y={colY + colH + 13}
            textAnchor="middle"
            fontSize={10}
          >
            {columnsEntry.fact.label} columns
          </text>
          <AnchorDot
            n={columnsEntry.rule.anchor}
            cx={columnsZone.x + columnsZone.w / 2 - 86}
            cy={colY + colH + 10}
            label={`${columnsEntry.rule.concern} — ${columnsEntry.fact.label} columns`}
            wiring={wiring}
          />
        </LayoutAnchorGroup>
      ) : null}

      {/* Gutter measure: inside the grid when both exist, else between two
          neutral blocks. */}
      {gutterEntry && columnsZone ? (
        <LayoutAnchorGroup
          anchor={gutterEntry.rule.anchor}
          status={gutterEntry.rule.row.status}
          wiring={wiring}
        >
          <line
            className="dsb-bp-dim"
            x1={columnsZone.x + colW}
            y1={colY + colH + 10}
            x2={columnsZone.x + colW + schematicGap}
            y2={colY + colH + 10}
          />
          <text
            x={columnsZone.x + columnsZone.w / 2 + 44}
            y={colY + colH + 13}
            textAnchor="middle"
            fontSize={10}
          >
            gap {gutterEntry.fact.label}
          </text>
          <AnchorDot
            n={gutterEntry.rule.anchor}
            cx={columnsZone.x + columnsZone.w / 2 + 4}
            cy={colY + colH + 10}
            label={`${gutterEntry.rule.concern} — ${gutterEntry.fact.label}`}
            wiring={wiring}
          />
        </LayoutAnchorGroup>
      ) : null}
      {gutterOnly && gutterEntry ? (
        <LayoutAnchorGroup
          anchor={gutterEntry.rule.anchor}
          status={gutterEntry.rule.row.status}
          wiring={wiring}
        >
          <rect x={gutterOnlyX} y={gutterOnlyY - 12} width={84} height={24} className="dsb-bp-block" rx={4} />
          <line
            className="dsb-bp-dim"
            x1={gutterOnlyX + 84}
            y1={gutterOnlyY}
            x2={gutterOnlyX + 132}
            y2={gutterOnlyY}
          />
          <rect x={gutterOnlyX + 132} y={gutterOnlyY - 12} width={84} height={24} className="dsb-bp-block" rx={4} />
          <text x={gutterOnlyX + 108} y={gutterOnlyY + 22} textAnchor="middle" fontSize={10}>
            {gutterEntry.fact.label}
          </text>
          <AnchorDot
            n={gutterEntry.rule.anchor}
            cx={gutterOnlyX + 108}
            cy={gutterOnlyY - 22}
            label={`${gutterEntry.rule.concern} — ${gutterEntry.fact.label}`}
            wiring={wiring}
          />
        </LayoutAnchorGroup>
      ) : null}

      {/* Section rhythm. */}
      {rhythmEntry && rhythmBracket ? (
        <LayoutAnchorGroup
          anchor={rhythmEntry.rule.anchor}
          status={rhythmEntry.rule.row.status}
          wiring={wiring}
        >
          <line
            className="dsb-bp-dim"
            x1={rhythmBracket.x}
            y1={rhythmBracket.top}
            x2={rhythmBracket.x}
            y2={rhythmBracket.bottom}
          />
          <line
            className="dsb-bp-dim"
            x1={rhythmBracket.x - 3}
            y1={rhythmBracket.top}
            x2={rhythmBracket.x + 3}
            y2={rhythmBracket.top}
          />
          <line
            className="dsb-bp-dim"
            x1={rhythmBracket.x - 3}
            y1={rhythmBracket.bottom}
            x2={rhythmBracket.x + 3}
            y2={rhythmBracket.bottom}
          />
          <text
            x={rhythmBracket.x - 8}
            y={(rhythmBracket.top + rhythmBracket.bottom) / 2 + 3}
            textAnchor="end"
            fontSize={10.5}
          >
            {rhythmEntry.fact.label}
          </text>
          <AnchorDot
            n={rhythmEntry.rule.anchor}
            cx={rhythmBracket.x}
            cy={rhythmBracket.top - 18}
            label={`${rhythmEntry.rule.concern} — ${rhythmEntry.fact.label}`}
            wiring={wiring}
          />
        </LayoutAnchorGroup>
      ) : null}

      {/* Undrawable rules: honest dashed unknowns docked in the frame, never
          placed where the source did not put them. */}
      {model.unavailable.slice(0, 3).map((rule, index) => {
        const text = `${rule.concern} ?`;
        const width = Math.min(170, 16 + text.length * 5.4);
        const x = containerRight - 8 - width;
        const y = 56 + index * 26;
        return (
          <LayoutAnchorGroup
            key={rule.row.key}
            anchor={rule.anchor}
            status={rule.row.status}
            wiring={wiring}
          >
            <rect
              x={x}
              y={y}
              width={width}
              height={20}
              rx={4}
              className="dsb-bp-unknown"
            />
            <text x={x + width / 2} y={y + 13.5} textAnchor="middle" fontSize={9}>
              {text}
            </text>
            <AnchorDot
              n={rule.anchor}
              cx={x - 12}
              cy={y + 10}
              label={`${rule.concern} — no drawable spatial values`}
              wiring={wiring}
            />
          </LayoutAnchorGroup>
        );
      })}
      {model.unavailable.length > 3 ? (
        <text
          x={containerRight - 8}
          y={56 + 3 * 26 + 6}
          textAnchor="end"
          fontSize={9}
          className="dsb-bp-note"
        >
          +{model.unavailable.length - 3} more unknowns
        </text>
      ) : null}

      {/* Breakpoint ruler. */}
      {breakpointsEntry ? (
        <LayoutAnchorGroup
          anchor={breakpointsEntry.rule.anchor}
          status={breakpointsEntry.rule.row.status}
          wiring={wiring}
        >
          <line className="dsb-bp-dim" x1={BP_VP.x} y1={bpRulerY} x2={BP_VP.x + BP_VP.w} y2={bpRulerY} />
          {breakpointsEntry.fact.breakpoints!.map((mark, index, marks) => {
            const x = bpTickX(mark, index, marks.length);
            return (
              <g key={`${mark.label}-${index}`}>
                <line className="dsb-bp-dim" x1={x} y1={bpRulerY - 4} x2={x} y2={bpRulerY + 4} />
                <text x={x} y={bpRulerY + 19} textAnchor="middle" fontSize={9.5}>
                  {mark.label}
                </text>
              </g>
            );
          })}
          <AnchorDot
            n={breakpointsEntry.rule.anchor}
            cx={BP_VP.x - 12}
            cy={bpRulerY}
            label={`${breakpointsEntry.rule.concern} — ${breakpointsEntry.fact.label}`}
            wiring={wiring}
          />
        </LayoutAnchorGroup>
      ) : null}
    </svg>
  );
}

function unavailableReason(rule: LayoutRuleProjection): string {
  return rule.row.meaning.trim() !== ""
    ? rule.row.meaning
    : "The source declares no drawable spatial values for this rule.";
}

/** Which rule set the right pane is drawing: the whole leaf by default, one
 * hover-isolated rule, or the explicitly composed selection (09C-B Checklist). */
type LayoutSamplesView =
  | { kind: "all" }
  | { kind: "isolated"; anchor: number }
  | { kind: "composed"; count: number };

/** Right pane for the Layout leaf: the composed blueprint plus one explicit
 * unavailable sample per undrawable rule. */
function LayoutSamples({
  blueprint,
  wiring,
  view
}: {
  blueprint: LayoutBlueprintModel;
  wiring: LayoutAnchorWiring;
  view: LayoutSamplesView;
}) {
  if (blueprint.rules.length === 0) return <VisualSamplesEmpty />;
  const toScale = blueprint.drawable.some((rule) =>
    rule.facts.some(
      (fact) => fact.kind === "container" && containerDrawsToScale(fact.maxWidthPx)
    )
  );
  const hasContainer = blueprint.drawable.some((rule) =>
    rule.facts.some((fact) => fact.kind === "container")
  );
  const scaleNote = hasContainer && !toScale ? " · container not to scale" : "";
  const caption =
    view.kind === "isolated"
      ? `Isolated scene — only anchor ${view.anchor}'s facts are drawn${scaleNote}`
      : view.kind === "composed"
        ? `Composed from ${view.count} rule${
            view.count === 1 ? "" : "s"
          } — first fact per kind claims the drawing${scaleNote}`
        : `One schematic drawing per rule set — anchors key each measurement to its rule row${scaleNote}`;
  return (
    <div className="dsb-samples" data-testid="ds-layout-samples">
      <GroupLabel>Visual samples</GroupLabel>
      {blueprint.drawable.length > 0 ? (
        <div className="dsb-sample" data-testid="ds-layout-blueprint">
          <div className="dsb-sample-stage">
            <LayoutBlueprintSvg model={blueprint} wiring={wiring} />
          </div>
          <div className="dsb-sample-caption">
            <span>{caption}</span>
            <OriginTag origin="schematic" />
          </div>
        </div>
      ) : null}
      {blueprint.unavailable.map((rule) => (
        <div
          key={rule.row.key}
          className="dsb-sample"
          data-testid={`ds-layout-unavailable-${rule.row.entryId}`}
        >
          <div
            className="dsb-sample-stage"
            role="img"
            aria-label={`No visual sample for ${rule.concern}: the source declares no drawable spatial values`}
          >
            <div className="dsb-sample-unavailable">
              <span aria-hidden className="dsb-sample-unavailable-mark">
                ⌀
              </span>
              <span>
                No visual sample — the source declares no drawable spatial
                values for this rule.
              </span>
            </div>
          </div>
          <div className="dsb-sample-caption">
            <span>
              <span aria-hidden className="dsb-anchor-num">
                {rule.anchor}
              </span>{" "}
              {rule.concern} — {unavailableReason(rule)}
            </span>
            <OriginTag origin="unavailable" />
            <StatusChip
              status={rule.row.status}
              testId={`ds-layout-unavailable-status-${rule.row.entryId}`}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Layout leaf (09C-B): standard Browser heading + anchored rule rows on the
 * left, the Blueprint visual sample on the right; the 09C-A resizable split
 * stays. Anchor hover/focus state lives here because it spans both panes.
 * Checklist composition: the whole row (or its check control) toggles the
 * rule into the composed drawing; with nothing checked, hovering a row
 * isolates that rule's scene and the default stage draws every rule. */
export function LayoutLeafPage({
  leaf,
  rows,
  split
}: {
  leaf: { rows: DsRow[]; chips: string[] };
  rows: RowSharedProps;
  split: LeafSplitRatioProps;
}) {
  const [activeAnchor, setActiveAnchor] = useState<number | null>(null);
  const [selectedAnchors, setSelectedAnchors] = useState<ReadonlySet<number>>(
    () => new Set()
  );
  const blueprint = useMemo(() => projectLayoutBlueprint(leaf.rows), [leaf.rows]);
  const displayed = useMemo(() => {
    if (selectedAnchors.size > 0) {
      return sliceLayoutBlueprint(blueprint, selectedAnchors);
    }
    if (activeAnchor !== null) {
      return sliceLayoutBlueprint(blueprint, new Set([activeAnchor]));
    }
    return blueprint;
  }, [blueprint, selectedAnchors, activeAnchor]);
  const view: LayoutSamplesView =
    selectedAnchors.size > 0
      ? { kind: "composed", count: selectedAnchors.size }
      : activeAnchor !== null
        ? { kind: "isolated", anchor: activeAnchor }
        : { kind: "all" };
  const toggleAnchor = (anchor: number) =>
    setSelectedAnchors((prev) => {
      const next = new Set(prev);
      if (next.has(anchor)) {
        next.delete(anchor);
      } else {
        next.add(anchor);
      }
      return next;
    });
  return (
    <LeafSplit
      {...split}
      left={
        <>
          <PageHeading
            title="Layout"
            meta={`${leaf.rows.length} rules`}
            chips={leaf.chips}
          />
          {leaf.rows.length > 0 ? (
            <RowList
              rows={leaf.rows}
              {...rows}
              anchorState={{ active: activeAnchor, onHover: setActiveAnchor }}
              selectState={{ selected: selectedAnchors, onToggle: toggleAnchor }}
            />
          ) : (
            <p className="dsb-empty-body dsb-page-note">
              No rules declared yet.
            </p>
          )}
        </>
      }
      right={
        <LayoutSamples
          blueprint={displayed}
          wiring={{ activeAnchor, onActiveAnchor: setActiveAnchor }}
          view={view}
        />
      }
    />
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

/**
 * Browser-level split ratio preference (09C-A): loaded once per browser
 * mount from the project-local server route, kept locally during gestures,
 * and committed (debounced) on gesture end. Best-effort UX state — a failed
 * load/save leaves the default or local ratio in place, never an error UI.
 * Lives at the browser container so switching leaves never resets it.
 */
function useDesignSystemSplitRatio(session: string, open: boolean) {
  const [ratio, setRatio] = useState(DEFAULT_DS_SPLIT_RATIO);
  const loadedRef = useRef(false);
  const putTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open || loadedRef.current) return;
    loadedRef.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/design-system-browser-preferences", {
          cache: "no-store",
          headers: { "x-ikran-session": session }
        });
        const data = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          preferences?: unknown;
        };
        if (!cancelled && response.ok && data.ok === true) {
          const parsed = parseDesignSystemBrowserPreferences(data.preferences);
          if (parsed) setRatio(parsed.splitRatio);
        }
      } catch {
        // Best-effort preference — the default ratio still works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, session]);

  const commitRatio = useCallback(
    (next: number) => {
      if (putTimerRef.current) clearTimeout(putTimerRef.current);
      putTimerRef.current = setTimeout(() => {
        putTimerRef.current = null;
        void fetch("/api/design-system-browser-preferences", {
          method: "PUT",
          headers: {
            "x-ikran-session": session,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            preferences: {
              version: DESIGN_SYSTEM_BROWSER_PREFERENCES_VERSION,
              splitRatio: next
            }
          })
        }).catch(() => {
          // Best-effort UX preference, not research data.
        });
      }, 300);
    },
    [session]
  );

  useEffect(
    () => () => {
      if (putTimerRef.current) clearTimeout(putTimerRef.current);
    },
    []
  );

  return { ratio, setRatio, commitRatio };
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
  const splitRatio = useDesignSystemSplitRatio(session, open);
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

  // Canvas keyboard isolation + focus trap. Attached as a BUBBLE-phase React
  // handler on the sheet root (see onSheetKeyDown): keydown first serves the
  // sheet's own interactive elements (divider keyboard resize, ⓘ buttons,
  // future inputs), then stops at the root so it never reaches tldraw's
  // body-level bindings. A capture-phase window listener used to swallow
  // events BEFORE the sheet's own controls could receive them — that made
  // every keyboard interaction inside the sheet inert.
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

  const renderMain = (): { node: React.ReactNode; layout: "page" | "leaf" } => {
    if (error && !model) {
      return {
        layout: "page",
        node: (
          <div className="dsb-empty">
            <p className="dsb-empty-title dsb-load-error">
              Could not load the design system
            </p>
            <p className="dsb-empty-body">{error}</p>
          </div>
        )
      };
    }
    if (!model) {
      return {
        layout: "page",
        node: (
          <div className="dsb-empty">
            <p className="dsb-empty-body">Loading…</p>
          </div>
        )
      };
    }
    if (model.empty) {
      return {
        layout: "page",
        node: (
          <div className="dsb-empty" data-testid="ds-empty-state">
            <p className="dsb-empty-title">No design system entries yet</p>
            <p className="dsb-empty-body">
              Alignment is complete, but the agent has not declared any
              design-system artifacts yet. Once design-system JSON sources are
              declared and ingested, they appear here.
            </p>
          </div>
        )
      };
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

    if (route.kind === "section") return { layout: "page", node: sectionHome };

    const splitProps: LeafSplitRatioProps = {
      ratio: splitRatio.ratio,
      onRatioChange: splitRatio.setRatio,
      onRatioCommit: splitRatio.commitRatio
    };

    if (route.section === "foundations") {
      if (route.leaf === "layout") {
        // 09C-B: the Blueprint visual grammar replaces the empty samples
        // pane; the split itself stays.
        return {
          layout: "leaf",
          node: (
            <LayoutLeafPage
              leaf={model.foundations.layout}
              rows={rowListProps}
              split={splitProps}
            />
          )
        };
      }
      if (route.leaf === "interaction") {
        return {
          layout: "page",
          node: (
            <RulesLeafPage
              leaf={model.foundations.interaction}
              rows={rowListProps}
            />
          )
        };
      }
      const tokenLeaf =
        model.foundations.tokenLeaves.find((leaf) => leaf.id === route.leaf) ??
        null;
      if (tokenLeaf) {
        // Typography is the 09C-A tracer bullet: Reader Projection + real
        // specimens. Color / Materials keep their token rows until 09C-C.
        if (tokenLeaf.id === "typography" && view) {
          return {
            layout: "leaf",
            node: (
              <TypographyLeafPage
                layers={typographyLayersFromView(view)}
                rows={rowListProps}
              />
            )
          };
        }
        return {
          layout: "leaf",
          node: (
            <LeafSplit
              {...splitProps}
              left={<TokenLeafPage leaf={tokenLeaf} rows={rowListProps} />}
              right={<VisualSamplesEmpty />}
            />
          )
        };
      }
    } else {
      const entryId = componentLeafId(route.leaf);
      const component =
        model.components.list.find((c) => c.entryId === entryId) ?? null;
      if (component) {
        return {
          layout: "leaf",
          node: (
            <LeafSplit
              {...splitProps}
              left={<ComponentDetail component={component} rows={rowListProps} />}
              right={<VisualSamplesEmpty />}
            />
          )
        };
      }
    }

    // Stale route after a refetch (leaf/component vanished): render the
    // section home rather than a blank main.
    return { layout: "page", node: sectionHome };
  };

  const sidebarLeaves: { id: DsLeafId; name: string; icon: IconSvgElement }[] =
    section === "foundations"
      ? FOUNDATIONS_LEAVES
      : (model?.components.list.map((component) => ({
          id: component.leafId,
          name: component.name,
          icon: ComponentIcon
        })) ?? []);

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
        <header className="dsb-header">
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
            <HugeiconsIcon
              icon={MultiplicationSignIcon}
              size={14}
              color="currentColor"
              strokeWidth={2}
            />
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
                <HugeiconsIcon
                  icon={Home01Icon}
                  size={14}
                  className="dsb-navrow-icon"
                  color="currentColor"
                  strokeWidth={2}
                />
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
                  <HugeiconsIcon
                    icon={leaf.icon}
                    size={14}
                    className="dsb-navrow-icon"
                    color="currentColor"
                    strokeWidth={2}
                  />
                  <span className="dsb-navrow-label">{leaf.name}</span>
                </button>
              ))}
            </div>
          </aside>
          <main className="dsb-main">
            <div
              key={`${route.kind}-${route.kind === "leaf" ? route.leaf : route.section}`}
              className={
                mainContent.layout === "leaf"
                  ? "dsb-enter dsb-leaf"
                  : "dsb-enter dsb-page"
              }
            >
              {mainContent.node}
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
        <section className="dsb-section">
          <GroupLabel>Status &amp; evidence</GroupLabel>
          <RowList rows={statusRows} {...rows} />
        </section>
      ) : null}
      {detail ? (
        <>
          <section className="dsb-section">
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
          </section>
          <section className="dsb-section">
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
          </section>
          <section className="dsb-section">
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
          </section>
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
