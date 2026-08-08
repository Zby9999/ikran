"use client";

import { useState } from "react";

/* Shared fixture + live preview primitives for the component-detail
   prototype. Content is product-shaped: a Button extracted from the
   Connect flow, formalized spec, one candidate variant (ghost). */

export type ButtonState = "default" | "hover" | "pressed" | "focus" | "disabled";

export const STATES: ButtonState[] = [
  "default",
  "hover",
  "pressed",
  "focus",
  "disabled"
];

export const SPEC = {
  name: "Button",
  status: "formalized" as const,
  context: "Primary action · Connect flow",
  origin: "Live · code-backed",
  purpose:
    "Carries the single primary commitment of a view — Connect, Continue, Save. Every competing action in the same view drops to a quieter variant.",
  props: [
    {
      name: "variant",
      type: "primary | secondary | ghost",
      note: "default primary · ghost is candidate",
      status: "formalized" as const
    },
    {
      name: "size",
      type: "sm | md | lg",
      note: "default md",
      status: "formalized" as const
    },
    {
      name: "disabled",
      type: "boolean",
      note: "blocks pointer, keeps layout",
      status: "formalized" as const
    },
    {
      name: "icon",
      type: "ReactNode",
      note: "leading slot only",
      status: "candidate" as const
    }
  ],
  boundaries: [
    "Not for navigation between pages — that is Link's job.",
    "One primary Button per view; competing actions drop to ghost.",
    "Never inline within running text."
  ],
  tokens: [
    { slot: "background", link: "color.action.primary", target: "primitive ink.900" },
    { slot: "corner radius", link: "radius.control", target: "8px" },
    { slot: "label", link: "type.role.call-to-action", target: "15 / 600 / −0.01" }
  ],
  motion: [
    { state: "hover", change: "background lightens 8%", timing: "120ms ease-out" },
    { state: "pressed", change: "scale 0.98", timing: "120ms ease-out" },
    { state: "focus", change: "2px accent ring", timing: "keyboard only" },
    { state: "disabled", change: "opacity 40%", timing: "—" }
  ],
  evidence: "2 answered cards · 1 designer annotation · evidence v3"
};

export function Chip({ status }: { status: "formalized" | "candidate" }) {
  return (
    <span className="pcd-chip" data-status={status}>
      {status}
    </span>
  );
}

export function OriginBadge() {
  return (
    <span className="pcd-origin">
      <span className="pcd-origin-dot" aria-hidden="true" />
      {SPEC.origin}
    </span>
  );
}

/* The real thing: a Button whose visual state can be forced from the
   states strip, and that still responds to direct interaction. */
export function LiveButton({ state }: { state: ButtonState }) {
  return (
    <button
      type="button"
      className="pcd-live-button"
      data-state={state}
      disabled={state === "disabled"}
      tabIndex={state === "disabled" ? -1 : 0}
    >
      Connect
    </button>
  );
}

export function StateTriggers({
  active,
  onPreview,
  className,
  itemClassName
}: {
  active: ButtonState;
  onPreview: (state: ButtonState) => void;
  className: string;
  itemClassName: string;
}) {
  return (
    <div className={className} role="group" aria-label="Preview states">
      {STATES.map((state) => (
        <button
          key={state}
          type="button"
          className={itemClassName}
          data-active={active === state ? "" : undefined}
          aria-label={`Preview ${state} state`}
          onMouseEnter={() => onPreview(state)}
          onMouseLeave={() => onPreview("default")}
          onFocus={() => onPreview(state)}
          onBlur={() => onPreview("default")}
          onClick={() => onPreview(state)}
        >
          {state}
        </button>
      ))}
    </div>
  );
}

export function useButtonState() {
  return useState<ButtonState>("default");
}
