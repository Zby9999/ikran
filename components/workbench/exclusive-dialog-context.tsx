"use client";

// Global single-active-dialog coordination for the Workbench canvas.
//
// At most ONE input dialog may be open at a time, across every card family:
//   - "alignment"                — 07 question card answer form /
//                                  agent-annotation append form
//   - "designer-annotation"      — 08A filled card edit-in-place form
//   - "designer-annotation-entry" — 08A pending draft entry form
//
// Provider/impl split: the provider must wrap <Tldraw> (shape components
// render inside the editor tree), while the implementation needs `useEditor`
// (inside <Tldraw>). So the provider exposes stable controls that delegate
// to an impl registered by <ExclusiveDialogController /> mounted inside the
// editor — the same ref-bridge pattern as RegionAnnotationToolController.
//
// This module deliberately imports nothing from the workbench: shape files
// import it, and the controller imports the shape files — keeping the
// dependency graph acyclic.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type ReactNode
} from "react";

export type ExclusiveDialogFamily =
  | "alignment"
  | "designer-annotation"
  | "designer-annotation-entry";

export type ExclusiveDialogRequest = {
  family: ExclusiveDialogFamily;
  /** Shape id of the dialog becoming active. */
  id: string;
};

export type ExclusiveDialogImpl = {
  /** Activate the given dialog; every other dialog closes. */
  openDialog: (request: ExclusiveDialogRequest) => void;
  /** Close all card dialogs (does not cancel a pending entry draft). */
  closeDialogs: () => void;
};

type ExclusiveDialogContextValue = {
  controls: ExclusiveDialogImpl;
  registerImpl: (impl: ExclusiveDialogImpl | null) => void;
};

const ExclusiveDialogContext =
  createContext<ExclusiveDialogContextValue | null>(null);

export function ExclusiveDialogProvider({ children }: { children: ReactNode }) {
  const implRef = useRef<ExclusiveDialogImpl | null>(null);
  const controls = useMemo<ExclusiveDialogImpl>(
    () => ({
      openDialog: (request) => implRef.current?.openDialog(request),
      closeDialogs: () => implRef.current?.closeDialogs()
    }),
    []
  );
  const registerImpl = useCallback((impl: ExclusiveDialogImpl | null) => {
    implRef.current = impl;
  }, []);
  const value = useMemo(
    () => ({ controls, registerImpl }),
    [controls, registerImpl]
  );
  return (
    <ExclusiveDialogContext.Provider value={value}>
      {children}
    </ExclusiveDialogContext.Provider>
  );
}

/** Null when no provider is mounted (bare unit renders use local fallbacks). */
export function useExclusiveDialog(): ExclusiveDialogImpl | null {
  return useContext(ExclusiveDialogContext)?.controls ?? null;
}

export function useRegisterExclusiveDialogImpl(): (
  impl: ExclusiveDialogImpl | null
) => void {
  return useContext(ExclusiveDialogContext)?.registerImpl ?? (() => {});
}
