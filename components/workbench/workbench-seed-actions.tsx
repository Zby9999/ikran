"use client";

// Workbench actions reachable from tldraw HTML shapes (Notes + Description).

import { createContext, useContext, type ReactNode } from "react";

export type WorkbenchSeedActions = {
  refreshSeedReference: (
    seedId: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  updateSeedReferenceNote: (
    seedId: string,
    referenceNote: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  updateDesignLanguageDescription: (
    designLanguageDescription: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
};

const WorkbenchSeedActionsContext = createContext<WorkbenchSeedActions | null>(
  null
);

export function WorkbenchSeedActionsProvider({
  value,
  children
}: {
  value: WorkbenchSeedActions;
  children: ReactNode;
}) {
  return (
    <WorkbenchSeedActionsContext.Provider value={value}>
      {children}
    </WorkbenchSeedActionsContext.Provider>
  );
}

export function useWorkbenchSeedActions(): WorkbenchSeedActions | null {
  return useContext(WorkbenchSeedActionsContext);
}
