"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type PropsWithChildren
} from "react";
import {
  FOCUS_MODE_IDLE,
  focusModeReducer,
  type FocusCardSelection,
  type FocusModeState
} from "./focus-mode";

type FocusModeContextValue = {
  state: FocusModeState;
  selectFocusCard: (selection: FocusCardSelection) => void;
  requestExit: () => void;
  finishExit: () => void;
};

const FocusModeContext = createContext<FocusModeContextValue | null>(null);

export function WorkbenchFocusModeProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(focusModeReducer, FOCUS_MODE_IDLE);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dispatch({ type: "exit-requested" });
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        (target.classList.contains("tl-background") ||
          target.closest(".tl-background__wrapper"))
      ) {
        dispatch({ type: "exit-requested" });
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, []);

  const selectFocusCard = useCallback((selection: FocusCardSelection) => {
    dispatch({ type: "focus-card-selected", selection });
  }, []);
  const requestExit = useCallback(() => {
    dispatch({ type: "exit-requested" });
  }, []);
  const finishExit = useCallback(() => {
    dispatch({ type: "exit-transition-completed" });
  }, []);
  const value = useMemo(
    () => ({ state, selectFocusCard, requestExit, finishExit }),
    [finishExit, requestExit, selectFocusCard, state]
  );
  return (
    <FocusModeContext.Provider value={value}>
      {children}
    </FocusModeContext.Provider>
  );
}

export function useWorkbenchFocusMode(): FocusModeContextValue {
  return (
    useContext(FocusModeContext) ?? {
      state: FOCUS_MODE_IDLE,
      selectFocusCard: () => {},
      requestExit: () => {},
      finishExit: () => {}
    }
  );
}
