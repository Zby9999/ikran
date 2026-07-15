import type {
  FocusCardSelection,
  FocusModeAction
} from "./focus-mode";

export type FocusModeController = {
  selectFocusCard(selection: FocusCardSelection): void;
  canvasBlankSelected(): void;
  /** Returns true only when the key was handled as a focus-mode exit. */
  keyDown(event: { key: string }): boolean;
  maskTransitionCompleted(): void;
};

/**
 * Adapter kept independent of React and tldraw so the Workbench can wire its
 * card and canvas events without duplicating focus transition semantics.
 */
export function createFocusModeController(
  dispatch: (action: FocusModeAction) => void
): FocusModeController {
  return {
    selectFocusCard(selection) {
      dispatch({ type: "focus-card-selected", selection });
    },
    canvasBlankSelected() {
      dispatch({ type: "exit-requested" });
    },
    keyDown(event) {
      if (event.key !== "Escape") return false;
      dispatch({ type: "exit-requested" });
      return true;
    },
    maskTransitionCompleted() {
      dispatch({ type: "exit-transition-completed" });
    }
  };
}
