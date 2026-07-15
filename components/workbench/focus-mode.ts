export type FocusTargetRect = {
  /** Screenshot-normalized horizontal origin. */
  x: number;
  /** Screenshot-normalized vertical origin. */
  y: number;
  /** Screenshot-normalized width. */
  width: number;
  /** Screenshot-normalized height. */
  height: number;
};

/**
 * One auditable member of a multi-place focus target set. A target is never
 * detached from the Evidence Surface and captured evidence version it marks.
 */
export type FocusTarget = {
  targetId: string;
  surfaceArtifactId: string;
  evidenceVersionId: string;
  rect: FocusTargetRect;
};

export type FocusCardSelection = {
  cardId: string;
  targets: readonly FocusTarget[];
};

export type FocusModeState =
  | {
      phase: "idle";
      activeCardId: null;
      targets: readonly [];
    }
  | {
      phase: "active" | "exiting";
      activeCardId: string;
      targets: readonly FocusTarget[];
    };

export type FocusModeAction =
  | { type: "focus-card-selected"; selection: FocusCardSelection }
  | { type: "exit-requested" }
  | { type: "exit-transition-completed" };

export const FOCUS_MODE_IDLE: FocusModeState = {
  phase: "idle",
  activeCardId: null,
  targets: []
};

export function focusModeReducer(
  state: FocusModeState,
  action: FocusModeAction
): FocusModeState {
  if (action.type === "focus-card-selected") {
    if (
      state.phase === "active" &&
      state.activeCardId === action.selection.cardId
    ) {
      return state;
    }
    return {
      phase: "active",
      activeCardId: action.selection.cardId,
      targets: action.selection.targets
    };
  }
  if (action.type === "exit-requested") {
    if (state.phase !== "active") return state;
    return { ...state, phase: "exiting" };
  }
  if (action.type === "exit-transition-completed") {
    return state.phase === "exiting" ? FOCUS_MODE_IDLE : state;
  }
  return state;
}
