/**
 * Shared source-backed model for the Interaction Section exploration (09C-B).
 *
 * Every variant renders from THIS single model — the same shape the real
 * Browser projects from `design-system/interaction-rules.json` (rich fields:
 * appliesTo / stateBehavior / motion / layoutInvariants / accessibility /
 * acceptanceChecks — see RICH_INTERACTION_RULE_FIELDS in
 * lib/runtime/design-system-schema.ts).
 *
 * Values mirror the 09C-A e2e fixture shapes
 * (tests/unit/design-system-ingest.test.ts) and the workbench's real motion
 * tokens (app/globals.css: --motion-ease-out / --motion-ease-drawer).
 * Nothing here invents a design-system fact: candidates stay candidates, and
 * the loading-behavior gap stays an honest unavailable.
 */

export type InteractionStatus = "formalized" | "candidate" | "gap";

/** Where the visual sample comes from — must stay visible per 09C-B. */
export type VisualOrigin = "source-generated" | "schematic" | "unavailable";

export interface StateBehavior {
  state: string;
  behavior: string;
}

export interface MotionSpec {
  duration: string;
  easing: string;
  /** What moves — from the source's motion note, never invented. */
  target?: string;
}

/** Specimen kind a rule can honestly render. Null → unavailable stage. */
export type ControlKind = "link" | "button" | "sheet" | "field" | null;

export interface InteractionRule {
  id: string;
  /** Stable anchor number used to key visuals back to left-pane rule rows. */
  anchor: number;
  name: string;
  meaning: string;
  appliesTo: string[];
  states: StateBehavior[];
  motion: MotionSpec[];
  layoutInvariants: string[];
  accessibility: string[];
  acceptanceChecks: string[];
  status: InteractionStatus;
  origin: VisualOrigin;
  control: ControlKind;
  /** Gap reason, shown instead of a fabricated sample. */
  missing?: string;
}

export const MOTION_TOKENS: { name: string; value: string; note: string }[] = [
  { name: "duration.fast", value: "120ms", note: "Micro feedback" },
  { name: "duration.base", value: "160ms", note: "Standard UI transitions" },
  { name: "duration.sheet", value: "350ms", note: "Drawer / sheet travel" },
  {
    name: "easing.out",
    value: "cubic-bezier(0.23, 1, 0.32, 1)",
    note: "Entrances, never ease-in"
  },
  {
    name: "easing.drawer",
    value: "cubic-bezier(0.32, 0.72, 0, 1)",
    note: "Sheet spring"
  }
];

export const INTERACTION_RULES: InteractionRule[] = [
  {
    id: "nav-link",
    anchor: 1,
    name: "Navigation link",
    meaning: "Section navigation feedback",
    appliesTo: ["Sidebar links", "Breadcrumbs"],
    states: [
      { state: "default", behavior: "Ink-2 text, no underline" },
      { state: "hover", behavior: "Underline · full ink" },
      { state: "focus-visible", behavior: "2px accent ring" }
    ],
    motion: [{ duration: "150ms", easing: "ease-out", target: "color" }],
    layoutInvariants: ["Underline never shifts line height"],
    accessibility: ["Visible focus ring", "Keyboard activation works"],
    acceptanceChecks: ["Tab order follows visual order"],
    status: "formalized",
    origin: "source-generated",
    control: "link"
  },
  {
    id: "primary-button",
    anchor: 2,
    name: "Primary button",
    meaning: "Commit actions across the workbench",
    appliesTo: ["Buttons", "Icon buttons"],
    states: [
      { state: "default", behavior: "Filled ink surface" },
      { state: "hover", behavior: "Surface darkens 4%" },
      { state: "active", behavior: "Scale 0.97 press" },
      { state: "disabled", behavior: "35% opacity, no pointer" }
    ],
    motion: [
      { duration: "160ms", easing: "ease-out", target: "background-color" },
      { duration: "160ms", easing: "ease-out", target: "transform" }
    ],
    layoutInvariants: ["Press never shifts layout"],
    accessibility: ["Focus ring preserved while disabled is skipped"],
    acceptanceChecks: ["Space + Enter both activate"],
    status: "candidate",
    origin: "source-generated",
    control: "button"
  },
  {
    id: "sheet-drawer",
    anchor: 3,
    name: "Sheet drawer",
    meaning: "Bottom sheet enter / exit",
    appliesTo: ["Browser sheet", "Overlays"],
    states: [
      { state: "open", behavior: "Resting at 94vh, rounded top" },
      { state: "closed", behavior: "Translated 102% down, hidden" }
    ],
    motion: [
      {
        duration: "350ms",
        easing: "cubic-bezier(0.32, 0.72, 0, 1)",
        target: "transform"
      },
      { duration: "200ms", easing: "ease-out", target: "scrim opacity" }
    ],
    layoutInvariants: ["Sheet never covers the sidebar nav"],
    accessibility: ["Focus trapped while open", "Esc closes"],
    acceptanceChecks: ["Interruptible mid-gesture"],
    status: "candidate",
    origin: "schematic",
    control: "sheet"
  },
  {
    id: "text-field",
    anchor: 4,
    name: "Text field",
    meaning: "Single-line input feedback",
    appliesTo: ["Form fields", "Search"],
    states: [
      { state: "default", behavior: "Hairline border, placeholder ink-3" },
      { state: "hover", behavior: "Border deepens" },
      { state: "focus-visible", behavior: "Accent border + soft ring" },
      { state: "disabled", behavior: "Surface fill, no caret" }
    ],
    motion: [
      { duration: "150ms", easing: "ease-out", target: "border-color, ring" }
    ],
    layoutInvariants: ["Ring draws outside, never grows the box"],
    accessibility: ["Label association required"],
    acceptanceChecks: ["Focus visible at 200% zoom"],
    status: "candidate",
    origin: "source-generated",
    control: "field"
  },
  {
    id: "loading-state",
    anchor: 5,
    name: "Loading behavior",
    meaning: "Async wait feedback",
    appliesTo: ["Buttons", "Panels"],
    states: [],
    motion: [],
    layoutInvariants: [],
    accessibility: [],
    acceptanceChecks: [],
    status: "gap",
    origin: "unavailable",
    control: null,
    missing: "Loading behavior is not declared in the source yet"
  }
];
