/**
 * Shared specimen + annotation pieces for the Interaction variants.
 * Each specimen is a real, working control; forced states are expressed via
 * data-state and styled in interaction-reader.css. Declared states only —
 * a rule with no declared state for a slot renders nothing there.
 */

import type { InteractionRule, VisualOrigin } from "./interaction-data";

export function OriginBadge({ origin }: { origin: VisualOrigin }) {
  const label =
    origin === "source-generated"
      ? "Source-generated"
      : origin === "schematic"
        ? "Schematic"
        : "Unavailable";
  return (
    <span className="iproto-origin" data-origin={origin}>
      {label}
    </span>
  );
}

export function StatusChip({ status }: { status: InteractionRule["status"] }) {
  return (
    <span className="iproto-chip" data-status={status}>
      {status}
    </span>
  );
}

/** Shared per-rule block header: anchor keys back to the left-pane row. */
export function RuleBlockHeader({ rule }: { rule: InteractionRule }) {
  return (
    <header className="iproto-block-head">
      <span className="iproto-rule-anchor" aria-hidden>
        {rule.anchor}
      </span>
      <span className="iproto-block-name">{rule.name}</span>
      <StatusChip status={rule.status} />
      <OriginBadge origin={rule.origin} />
    </header>
  );
}

/** Honest unavailable stage — never a fabricated sample (09C-B). */
export function UnavailableBlock({ rule }: { rule: InteractionRule }) {
  return (
    <section className="iproto-block" data-unavailable>
      <RuleBlockHeader rule={rule} />
      <div className="iproto-unavailable" role="note">
        <p className="iproto-unavailable-title">No visual sample</p>
        <p className="iproto-unavailable-reason">{rule.missing}</p>
      </div>
    </section>
  );
}

/* -------------------------------- specimens ------------------------------- */

export function MiniLink({ state }: { state?: string }) {
  return (
    <span className="ispec-link" data-state={state}>
      Projects
    </span>
  );
}

export function MiniButton({
  state,
  label = "Save changes"
}: {
  state?: string;
  label?: string;
}) {
  return (
    <span className="ispec-btn" data-state={state}>
      {label}
    </span>
  );
}

export function MiniField({ state }: { state?: string }) {
  return (
    <span className="ispec-field" data-state={state}>
      <span className="ispec-field-placeholder">Search tokens…</span>
    </span>
  );
}

/** Static miniature of the bottom sheet in open or closed position. */
export function MiniSheet({ state }: { state: "open" | "closed" }) {
  return (
    <span className="ispec-sheet-stage" data-state={state}>
      <span className="ispec-sheet-scrim" />
      <span className="ispec-sheet-panel">
        <span className="ispec-sheet-grabber" />
      </span>
    </span>
  );
}

/** Renders the forced-state miniature matching a rule's control kind. */
export function MiniSpecimen({
  rule,
  state
}: {
  rule: InteractionRule;
  state?: string;
}) {
  switch (rule.control) {
    case "link":
      return <MiniLink state={state} />;
    case "button":
      return <MiniButton state={state} />;
    case "field":
      return <MiniField state={state} />;
    case "sheet":
      return <MiniSheet state={state === "closed" ? "closed" : "open"} />;
    default:
      return null;
  }
}
