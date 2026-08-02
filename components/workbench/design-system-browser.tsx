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
import type { CSSProperties } from "react";
import { getSvgPath } from "figma-squircle";
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

/** Where a visual sample comes from (09C-B/D): the outcomes must stay
 * distinguishable in the UI and the accessibility tree, so a schematic
 * composition is never mistaken for a rendered component, and a captured
 * Figma node (09C-D02) is never mistaken for either. Rendered as an
 * outlined tag — visually distinct from the filled status chip. */
export type DsVisualOrigin =
  | "code-backed"
  | "source-generated"
  | "source-capture"
  | "schematic"
  | "unavailable";

export const DS_VISUAL_ORIGIN_LABELS: Record<DsVisualOrigin, string> = {
  "code-backed": "Code-backed",
  "source-generated": "Source-generated",
  "source-capture": "Source capture",
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
};

/** Everything RowList needs except the rows themselves — shared by all pages. */
export type RowSharedProps = Omit<RowListProps, "rows" | "numbered">;

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
          onApprove={() => rest.onApprove(row)}
        />
      ))}
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
    { label: "Canonical identity", value: item.canonicalIdentity },
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
      {orderedItems.length > 0 ? (
        <section
          className="dsb-section dsb-typography-atlas"
          data-testid="ds-typography-ledger"
        >
          <p className="dsb-type-count" data-testid="ds-typography-summary">
            {orderedItems.length} type styles
          </p>
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
                  {group.items.map((item) => (
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
            ))}
          </div>
        </section>
      ) : (
        <p className="dsb-empty-body dsb-page-note">
          No composite typography roles classified here yet.
        </p>
      )}
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
          <span className="dsb-placard-statement">{rule.headline}</span>
          <StatusChip
            status={rule.row.status}
            testId={`ds-layout-status-${rule.row.entryId}`}
          />
          <InfoPopover
            entry={rule.row.entry}
            approval={approval}
            infoOpen={rows.infoKey === rule.row.key}
            popoverInstant={rows.popoverInstant(rule.row.key)}
            portalContainer={rows.portalContainer}
            ariaLabel={`Evidence for layout rule ${rule.row.entryId}`}
            onInfoOpenChange={(open) =>
              rows.onInfoKey(open ? rule.row.key : null)
            }
            onInfoHoverOpen={() => rows.onInfoHoverOpen(rule.row.key)}
            onInfoHoverClose={rows.onInfoHoverClose}
            onApprove={() => rows.onApprove(rule.row)}
          />
        </div>
        {rule.facts.length > 0 ? (
          <p className="dsb-placard-facts">
            {rule.facts.map((fact) => fact.label).join("  ·  ")}
          </p>
        ) : null}
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
            Approval failed: {approval.message}
          </span>
        ) : null}
      </div>
    </article>
  );
}

/** Layout leaf (09C-D02): standard Browser heading, then the placard stream.
 * Full-width page (no split) — the capture needs the whole reading column. */
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
      <PageHeading
        title="Layout"
        meta={`${leaf.rows.length} rules`}
        chips={leaf.chips}
      />
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
        // 09C-D02: Source Capture placards replace the Blueprint schematic —
        // a full-width page stream, no split.
        return {
          layout: "page",
          node: (
            <LayoutLeafPage
              leaf={model.foundations.layout}
              rows={rowListProps}
              session={session}
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
            </div>
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
