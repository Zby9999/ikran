"use client";

// Issue 08A — Designer Annotation information entry state.
//
// Lives ABOVE <Tldraw> so both the tool controller (child of Tldraw) and the
// draft marker's HTML form (deep in the editor tree) share one pending entry.
// Channel: tool pointer-up → commitCreate → controller → `begin(...)`; the
// draft shape matching `pending.payload.draftShapeId` renders the entry form;
// submit composes the Runtime create payload (body + section + target) and
// awaits the injected mutation; cancel clears state and the draft shape
// deletes itself (no Runtime record — PRD 50: drafts are not research facts).
//
// Section is NOT chosen in the form (Figma 670:891): an annotation binds to
// the section (six-part stage) the designer is currently viewing, and only
// appears within that section.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from "react";
import type { AlignmentStageId } from "./alignment-stage-panel";
import type { NormalizedRect } from "./region-annotation-geometry";

/** Pointer-up payload from the annotate tool (no body/section yet). */
export type DesignerAnnotationPendingPayload = {
  surfaceArtifactId: string;
  rect: NormalizedRect;
  targetNodeId?: string;
  draftShapeId?: string;
};

/** Full Runtime create payload once the designer submits body + section. */
export type DesignerAnnotationCreateRequest = {
  surfaceArtifactId: string;
  rect: NormalizedRect;
  targetNodeId?: string;
  body: string;
  /** Section (six-part stage) the annotation belongs to — always the
   *  section the designer was viewing when annotating. */
  section: AlignmentStageId;
};

export type DesignerAnnotationMutationResult =
  | { ok: true }
  | { ok: false; error: string };

export type DesignerAnnotationEntryContextValue = {
  /** Non-null while a freshly placed marker waits for its text. */
  pending: { payload: DesignerAnnotationPendingPayload } | null;
  submitting: boolean;
  /** Tool controller entry point (pointer-up). */
  begin: (payload: DesignerAnnotationPendingPayload) => void;
  /**
   * Draft shape form submit. Resolves `{ ok: false }` without clearing
   * pending — the form stays open with the typed body so the designer can
   * retry; only an explicit cancel destroys the draft.
   */
  submit: (body: string) => Promise<DesignerAnnotationMutationResult>;
  /** Clear pending without creating a record. */
  cancel: () => void;
};

const DesignerAnnotationEntryContext =
  createContext<DesignerAnnotationEntryContextValue | null>(null);

export function useDesignerAnnotationEntry(): DesignerAnnotationEntryContextValue | null {
  return useContext(DesignerAnnotationEntryContext);
}

export function DesignerAnnotationEntryProvider({
  currentSection,
  onCreate,
  children
}: {
  /** Section (six-part stage) currently in view — new annotations bind to it. */
  currentSection: AlignmentStageId;
  /** Runtime client create mutation (injected — no direct fetch here). */
  onCreate?: (
    payload: DesignerAnnotationCreateRequest
  ) => Promise<DesignerAnnotationMutationResult>;
  children: ReactNode;
}) {
  const [pending, setPending] = useState<{
    payload: DesignerAnnotationPendingPayload;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const begin = useCallback((payload: DesignerAnnotationPendingPayload) => {
    setPending({ payload });
  }, []);

  const cancel = useCallback(() => {
    setPending(null);
  }, []);

  const submit = useCallback(
    async (body: string): Promise<DesignerAnnotationMutationResult> => {
      if (!pending || submitting) {
        return { ok: false as const, error: "no_pending_annotation" };
      }
      if (!onCreate) {
        return { ok: false as const, error: "create_annotation_unavailable" };
      }
      setSubmitting(true);
      try {
        const result = await onCreate({
          surfaceArtifactId: pending.payload.surfaceArtifactId,
          rect: pending.payload.rect,
          ...(pending.payload.targetNodeId
            ? { targetNodeId: pending.payload.targetNodeId }
            : {}),
          body,
          section: currentSection
        });
        // Success keeps the committing draft visible; projection sync swaps it
        // for the authoritative marker in the same batch.
        if (result.ok) setPending(null);
        return result;
      } finally {
        setSubmitting(false);
      }
    },
    [pending, submitting, onCreate, currentSection]
  );

  const value = useMemo<DesignerAnnotationEntryContextValue>(
    () => ({ pending, submitting, begin, submit, cancel }),
    [pending, submitting, begin, submit, cancel]
  );

  return (
    <DesignerAnnotationEntryContext.Provider value={value}>
      {children}
    </DesignerAnnotationEntryContext.Provider>
  );
}
