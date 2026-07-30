"use client";

// Unified Workbench Runtime hook (Task 11).
//
// One EventSource (via runtime-client) + authoritative GET for seeds / evidence
// surfaces / region annotations. SSE `record` frames coalesce into a debounced
// reload — the client never invents records from SSE payloads.

import { useCallback, useEffect, useRef, useState } from "react";
import type { SeedReferenceRecord } from "@/lib/runtime/seed-reference";
import type { FigmaEvidenceSurfaceRecord } from "@/lib/runtime/evidence-package";
import type { RegionAnnotationRecord } from "@/lib/runtime/region-annotation";
import type { WorkbenchLayoutDocument } from "@/lib/runtime/workbench-layout-shared";
import { emptyWorkbenchLayout } from "@/lib/runtime/workbench-layout-shared";
import type { NormalizedRect } from "@/components/workbench/region-annotation-geometry";
import type { DesignIntentAlignmentSnapshot } from "@/lib/runtime/design-intent-alignment";
import {
  createWorkbenchDataClient,
  subscribeRuntimeEvents,
  type RuntimeMutationResult,
  type WorkbenchRuntimeSnapshot
} from "./runtime-client";

export { createWorkbenchDataClient } from "./runtime-client";

export type WorkbenchRuntimeStatus = "idle" | "loading" | "ready";

export type MutationResult = RuntimeMutationResult;

const RELOAD_DEBOUNCE_MS = 50;
/** Background self-heal after loadAll exhausts its in-request retries. */
const BACKGROUND_HEAL_MS = 1000;

function seedSignature(records: SeedReferenceRecord[]): string {
  return records
    .map(
      (r) =>
        `${r.id}:${r.current_surface_id ?? ""}:${r.original_design_intent}`
    )
    .join("|");
}

function surfaceSignature(records: FigmaEvidenceSurfaceRecord[]): string {
  return records
    .map(
      (r) =>
        [
          r.id,
          r.seed_reference_id ?? "",
          r.figma_seed_reference,
          r.frame_name,
          r.screenshot_data_url ?? "",
          r.screenshot_artifact_path ?? "",
          r.surface_bounds_json ?? "",
          r.frame_bounds_json ?? "",
          r.superseded_by ?? ""
        ].join(":")
    )
    .join("|");
}

export function annotationSignature(records: RegionAnnotationRecord[]): string {
  // Refresh does not rewrite the captured annotation row, but list-time
  // correspondence adds a new current evidence id / node / rect (or stale
  // status). Those derived fields drive marker placement, so they must
  // invalidate the React state just like persisted annotation fields do.
  return JSON.stringify(
    records.map((r) => [
      r.id,
      r.surface_id,
      r.surface_artifact_id,
      r.surface_node_id,
      r.target_kind,
      r.target_evidence_version_id,
      r.target_node_id,
      r.current_evidence_version_id,
      r.current_node_id,
      r.current_rect_x,
      r.current_rect_y,
      r.current_rect_w,
      r.current_rect_h,
      r.correspondence_status,
      r.stale,
      r.author,
      r.type,
      r.body,
      r.section,
      r.rect_x,
      r.rect_y,
      r.rect_w,
      r.rect_h,
      r.primary_node_id,
      r.candidates_json,
      r.created_at,
      r.geometry_version,
      r.from_point
    ])
  );
}

function layoutSignature(layout: WorkbenchLayoutDocument): string {
  const cam = layout.camera;
  const frameKeys = Object.keys(layout.frames).sort();
  const frames = frameKeys
    .map((id) => {
      const f = layout.frames[id]!;
      return `${id}:${f.x}:${f.y}:${f.w}:${f.h}:${f.layoutLocked ? 1 : 0}`;
    })
    .join("|");
  return `${layout.version}:${cam.x}:${cam.y}:${cam.z}:${frames}`;
}

function alignmentSignature(alignment: DesignIntentAlignmentSnapshot): string {
  return JSON.stringify(alignment);
}

/**
 * Subscribe before the initial GET. A fresh connection runs an initial load,
 * then another authoritative baseline after `open`; a subscriber joining an
 * already-open shared session receives the open callback synchronously and
 * therefore needs only that baseline. Every reconnect produces one baseline
 * (SSE error → EventSource reconnect → `open` → authoritative reload).
 */
export function startWorkbenchRuntimeSubscription(
  session: string,
  handlers: {
    loadBaseline: () => Promise<MutationResult>;
    onRecord: () => void;
    /** Optional: observe SSE disconnect; reload still happens on next `open`. */
    onError?: () => void;
  }
): () => void {
  let openedDuringSubscribe = false;
  const runBaseline = () => {
    void handlers.loadBaseline();
  };
  const unsubscribe = subscribeRuntimeEvents(session, {
    onOpen: () => {
      openedDuringSubscribe = true;
      runBaseline();
    },
    onRecord: handlers.onRecord,
    onError: handlers.onError
  });

  if (!openedDuringSubscribe) runBaseline();
  return unsubscribe;
}

export function useWorkbenchRuntime(session: string) {
  const [seeds, setSeeds] = useState<SeedReferenceRecord[]>([]);
  const [surfaces, setSurfaces] = useState<FigmaEvidenceSurfaceRecord[]>([]);
  const [annotations, setAnnotations] = useState<RegionAnnotationRecord[]>([]);
  const [layout, setLayout] = useState<WorkbenchLayoutDocument>(
    emptyWorkbenchLayout
  );
  const [designLanguageDescription, setDesignLanguageDescription] =
    useState("");
  const [alignment, setAlignment] =
    useState<DesignIntentAlignmentSnapshot | null>(null);
  const [status, setStatus] = useState<WorkbenchRuntimeStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<ReturnType<typeof createWorkbenchDataClient> | null>(
    null
  );
  const runLoadRef = useRef<(() => Promise<MutationResult>) | null>(null);

  const applySnapshot = useCallback((snapshot: WorkbenchRuntimeSnapshot) => {
    setSeeds((prev) =>
      seedSignature(prev) === seedSignature(snapshot.seeds)
        ? prev
        : snapshot.seeds
    );
    setSurfaces((prev) =>
      surfaceSignature(prev) === surfaceSignature(snapshot.surfaces)
        ? prev
        : snapshot.surfaces
    );
    setAnnotations((prev) =>
      annotationSignature(prev) === annotationSignature(snapshot.annotations)
        ? prev
        : snapshot.annotations
    );
    setLayout((prev) =>
      layoutSignature(prev) === layoutSignature(snapshot.layout)
        ? prev
        : snapshot.layout
    );
    setDesignLanguageDescription((prev) =>
      prev === snapshot.designLanguageDescription
        ? prev
        : snapshot.designLanguageDescription
    );
    setAlignment((prev) =>
      prev && alignmentSignature(prev) === alignmentSignature(snapshot.alignment)
        ? prev
        : snapshot.alignment
    );
  }, []);

  useEffect(() => {
    let mounted = true;
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    let healTimer: ReturnType<typeof setTimeout> | null = null;
    setStatus("loading");

    const client = createWorkbenchDataClient(session, {
      onSnapshot: (snapshot) => {
        if (!mounted) return;
        applySnapshot(snapshot);
        setStatus("ready");
      },
      onError: (nextError) => {
        if (!mounted) return;
        setError(nextError);
        setStatus("ready");
      }
    });
    clientRef.current = client;

    const clearHeal = () => {
      if (healTimer) {
        clearTimeout(healTimer);
        healTimer = null;
      }
    };

    const scheduleBackgroundHeal = () => {
      clearHeal();
      healTimer = setTimeout(() => {
        healTimer = null;
        if (!mounted) return;
        void runAuthoritativeLoad();
      }, BACKGROUND_HEAL_MS);
    };

    const runAuthoritativeLoad = async (): Promise<MutationResult> => {
      const result = await client.loadAll();
      if (!mounted) return result;
      if (result.ok) {
        clearHeal();
        return result;
      }
      // In-request retries exhausted (or superseded with a failed newest).
      // Keep self-healing in the background until a load succeeds or unmount.
      if (
        result.error !== "runtime_client_disposed" &&
        result.error !== "load_superseded"
      ) {
        scheduleBackgroundHeal();
      }
      return result;
    };
    runLoadRef.current = runAuthoritativeLoad;

    // SSE disconnect: EventSource reconnects automatically; the next `onOpen`
    // fires runAuthoritativeLoad for a fresh authoritative baseline.
    const unsubscribe = startWorkbenchRuntimeSubscription(session, {
      loadBaseline: runAuthoritativeLoad,
      onRecord: () => {
        if (!mounted) return;
        if (reloadTimer) clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => {
          reloadTimer = null;
          void runAuthoritativeLoad();
        }, RELOAD_DEBOUNCE_MS);
      }
    });

    return () => {
      mounted = false;
      runLoadRef.current = null;
      unsubscribe();
      client.dispose();
      // Child layout persistence flushes during the same unmount. Keep the
      // disposed client's mutation methods reachable until all effect cleanups
      // in this turn have run; no snapshot/error can apply after dispose.
      queueMicrotask(() => {
        if (clientRef.current === client) clientRef.current = null;
      });
      if (reloadTimer) clearTimeout(reloadTimer);
      clearHeal();
    };
  }, [session, applySnapshot]);

  const reload = useCallback(async () => {
    const run = runLoadRef.current;
    if (!run) {
      return { ok: false as const, error: "runtime_client_unavailable" };
    }
    return run();
  }, []);

  const createAnnotation = useCallback(
    async (payload: {
      surfaceArtifactId: string;
      rect: NormalizedRect;
      targetNodeId?: string;
      body: string;
      section: string;
    }): Promise<MutationResult> => {
      const client = clientRef.current;
      if (!client) {
        return { ok: false, error: "runtime_client_unavailable" };
      }
      return client.createAnnotation(payload);
    },
    []
  );

  const updateAnnotationBody = useCallback(
    async (payload: {
      annotationId: string;
      body: string;
    }): Promise<MutationResult> => {
      const client = clientRef.current;
      if (!client) {
        return { ok: false, error: "runtime_client_unavailable" };
      }
      return client.updateAnnotationBody(payload);
    },
    []
  );

  const deleteAnnotation = useCallback(
    async (annotationId: string): Promise<MutationResult> => {
      const client = clientRef.current;
      if (!client) {
        return { ok: false, error: "runtime_client_unavailable" };
      }
      const result = await client.deleteAnnotation(annotationId);
      if (result.ok) {
        // DELETE returns before its background full reload. Apply the accepted
        // semantic removal immediately so an equally-fast Command-Z always
        // produces an observable [] → restored-record projection transition.
        setAnnotations((prev) =>
          prev.some((record) => record.id === annotationId)
            ? prev.filter((record) => record.id !== annotationId)
            : prev
        );
      }
      return result;
    },
    []
  );

  const restoreAnnotation = useCallback(
    async (annotationId: string): Promise<MutationResult> => {
      const client = clientRef.current;
      if (!client) {
        return { ok: false, error: "runtime_client_unavailable" };
      }
      return client.restoreAnnotation(annotationId);
    },
    []
  );

  const deleteSeedReference = useCallback(
    async (seedId: string): Promise<MutationResult> => {
      const client = clientRef.current;
      if (!client) {
        return { ok: false, error: "runtime_client_unavailable" };
      }
      return client.deleteSeedReference(seedId);
    },
    []
  );

  const refreshSeedReference = useCallback(
    async (seedId: string): Promise<MutationResult> => {
      const client = clientRef.current;
      if (!client) {
        return { ok: false, error: "runtime_client_unavailable" };
      }
      return client.refreshSeedReference(seedId);
    },
    []
  );

  const getFigmaConnection = useCallback(async () => {
    const client = clientRef.current;
    if (!client) {
      return { ok: false as const, error: "runtime_client_unavailable" };
    }
    return client.getFigmaConnection();
  }, []);

  const connectFigma = useCallback(async (token: string) => {
    const client = clientRef.current;
    if (!client) {
      return { ok: false as const, error: "runtime_client_unavailable" };
    }
    return client.connectFigma(token);
  }, []);

  const captureSeedReference = useCallback(
    async (figmaSeedReference: string): Promise<MutationResult> => {
      const client = clientRef.current;
      if (!client) {
        return { ok: false, error: "runtime_client_unavailable" };
      }
      return client.captureSeedReference(figmaSeedReference);
    },
    []
  );

  const putWorkbenchLayout = useCallback(
    async (next: WorkbenchLayoutDocument): Promise<MutationResult> => {
      const client = clientRef.current;
      if (!client) {
        return { ok: false, error: "runtime_client_unavailable" };
      }
      return client.putWorkbenchLayout(next);
    },
    []
  );

  const flushWorkbenchLayout = useCallback(
    async (next: WorkbenchLayoutDocument): Promise<MutationResult> => {
      const client = clientRef.current;
      if (!client) {
        return { ok: false, error: "runtime_client_unavailable" };
      }
      return client.flushWorkbenchLayout(next);
    },
    []
  );

  const updateSeedReferenceNote = useCallback(
    async (
      seedId: string,
      referenceNote: string
    ): Promise<MutationResult> => {
      const client = clientRef.current;
      if (!client) {
        return { ok: false, error: "runtime_client_unavailable" };
      }
      return client.updateSeedReferenceNote(seedId, referenceNote);
    },
    []
  );

  const updateDesignLanguageDescription = useCallback(
    async (next: string): Promise<MutationResult> => {
      const client = clientRef.current;
      if (!client) {
        return { ok: false, error: "runtime_client_unavailable" };
      }
      return client.updateDesignLanguageDescription(next);
    },
    []
  );

  const recordDesignerAnswer = useCallback(
    async (questionCardId: string, finalAnswer: string): Promise<MutationResult> => {
      const client = clientRef.current;
      if (!client) return { ok: false, error: "runtime_client_unavailable" };
      return client.recordDesignerAnswer(questionCardId, finalAnswer);
    },
    []
  );

  const prepareDesignIntentAlignment = useCallback(async (): Promise<MutationResult> => {
    const client = clientRef.current;
    if (!client) return { ok: false, error: "runtime_client_unavailable" };
    return client.prepareDesignIntentAlignment();
  }, []);

  const returnToSeedReference = useCallback(async (): Promise<MutationResult> => {
    const client = clientRef.current;
    if (!client) return { ok: false, error: "runtime_client_unavailable" };
    return client.returnToSeedReference();
  }, []);

  const appendAgentAnnotationInformation = useCallback(
    async (annotationId: string, information: string): Promise<MutationResult> => {
      const client = clientRef.current;
      if (!client) return { ok: false, error: "runtime_client_unavailable" };
      return client.appendAgentAnnotationInformation(annotationId, information);
    },
    []
  );

  const completeDesignIntentAlignment = useCallback(async (): Promise<MutationResult> => {
    const client = clientRef.current;
    if (!client) return { ok: false, error: "runtime_client_unavailable" };
    return client.completeDesignIntentAlignment();
  }, []);

  return {
    seeds,
    surfaces,
    annotations,
    layout,
    designLanguageDescription,
    alignment,
    status,
    error,
    reload,
    createAnnotation,
    updateAnnotationBody,
    deleteAnnotation,
    restoreAnnotation,
    deleteSeedReference,
    refreshSeedReference,
    putWorkbenchLayout,
    flushWorkbenchLayout,
    updateSeedReferenceNote,
    updateDesignLanguageDescription,
    prepareDesignIntentAlignment,
    returnToSeedReference,
    recordDesignerAnswer,
    appendAgentAnnotationInformation,
    completeDesignIntentAlignment,
    getFigmaConnection,
    connectFigma,
    captureSeedReference
  };
}
