// Browser Runtime event client — one EventSource per session (ref-counted).
// Shared by ProjectSetupCard (heartbeat) and Workbench (heartbeat + record).

import type { RecordBusEvent } from "@/lib/runtime/record-bus";
import type { SeedReferenceRecord } from "@/lib/runtime/seed-reference";
import type { FigmaEvidenceSurfaceRecord } from "@/lib/runtime/evidence-package";
import type { RegionAnnotationRecord } from "@/lib/runtime/region-annotation";
import type { PrototypeSurfaceRecord } from "@/lib/runtime/prototype-surface";
import type { WorkbenchLayoutDocument } from "@/lib/runtime/workbench-layout-shared";
import { emptyWorkbenchLayout } from "@/lib/runtime/workbench-layout-shared";
import type { NormalizedRect } from "@/components/workbench/region-annotation-geometry";
import type { DesignIntentAlignmentSnapshot } from "@/lib/runtime/design-intent-alignment";

export type RuntimeHeartbeatEvent = {
  type: "heartbeat";
  service: string;
  status: string;
  sequence: number;
  timestamp: string;
};

export type RuntimeEventHandlers = {
  /** Fires after EventSource has established (and on every reconnect). */
  onOpen?: () => void;
  onHeartbeat?: (event: RuntimeHeartbeatEvent) => void;
  onRecord?: (event: RecordBusEvent) => void;
  onError?: () => void;
};

type SessionEntry = {
  eventSource: EventSource;
  refCount: number;
  isOpen: boolean;
  openListeners: Set<() => void>;
  heartbeatListeners: Set<(event: RuntimeHeartbeatEvent) => void>;
  recordListeners: Set<(event: RecordBusEvent) => void>;
  errorListeners: Set<() => void>;
};

const GLOBAL_KEY = "__IKRAN_RUNTIME_EVENT_CLIENT__";

type GlobalClient = {
  sessions: Map<string, SessionEntry>;
};

function getStore(): GlobalClient {
  const g = globalThis as unknown as { [GLOBAL_KEY]?: GlobalClient };
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = { sessions: new Map() };
  }
  return g[GLOBAL_KEY]!;
}

function ensureSession(session: string): SessionEntry {
  const store = getStore();
  let entry = store.sessions.get(session);
  if (entry) return entry;

  const eventSource = new EventSource(
    `/api/events?session=${encodeURIComponent(session)}`
  );
  entry = {
    eventSource,
    refCount: 0,
    isOpen: false,
    openListeners: new Set(),
    heartbeatListeners: new Set(),
    recordListeners: new Set(),
    errorListeners: new Set()
  };

  eventSource.addEventListener("open", () => {
    entry!.isOpen = true;
    for (const listener of entry!.openListeners) listener();
  });

  eventSource.addEventListener("heartbeat", (message) => {
    try {
      const data = JSON.parse(
        (message as MessageEvent).data
      ) as RuntimeHeartbeatEvent;
      for (const listener of entry!.heartbeatListeners) listener(data);
    } catch {
      // ignore malformed frames
    }
  });

  eventSource.addEventListener("record", (message) => {
    try {
      const data = JSON.parse((message as MessageEvent).data) as RecordBusEvent;
      for (const listener of entry!.recordListeners) listener(data);
    } catch {
      // ignore malformed frames
    }
  });

  eventSource.onerror = () => {
    // EventSource reconnects automatically. The next `open` is a fresh
    // connection-ready boundary and must trigger a new authoritative baseline.
    entry!.isOpen = false;
    for (const listener of entry!.errorListeners) listener();
  };

  store.sessions.set(session, entry);
  return entry;
}

/**
 * Subscribe to Runtime SSE for a session. Same session reuses one EventSource.
 * Returns unsubscribe; when the last subscriber leaves, the connection closes.
 */
export function subscribeRuntimeEvents(
  session: string,
  handlers: RuntimeEventHandlers
): () => void {
  const entry = ensureSession(session);
  entry.refCount += 1;

  if (handlers.onOpen) entry.openListeners.add(handlers.onOpen);
  if (handlers.onHeartbeat) entry.heartbeatListeners.add(handlers.onHeartbeat);
  if (handlers.onRecord) entry.recordListeners.add(handlers.onRecord);
  if (handlers.onError) entry.errorListeners.add(handlers.onError);

  // A subscriber may join an already-open session shared by another surface.
  // Notify synchronously so it can establish its own authoritative baseline.
  if (handlers.onOpen && entry.isOpen) handlers.onOpen();

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    if (handlers.onOpen) {
      entry.openListeners.delete(handlers.onOpen);
    }
    if (handlers.onHeartbeat) {
      entry.heartbeatListeners.delete(handlers.onHeartbeat);
    }
    if (handlers.onRecord) {
      entry.recordListeners.delete(handlers.onRecord);
    }
    if (handlers.onError) {
      entry.errorListeners.delete(handlers.onError);
    }
    entry.refCount -= 1;
    if (entry.refCount <= 0) {
      entry.eventSource.close();
      getStore().sessions.delete(session);
    }
  };
}

export function getRuntimeEventSourceCountForTests(): number {
  return getStore().sessions.size;
}

export function resetRuntimeClientForTests(): void {
  const store = getStore();
  for (const entry of store.sessions.values()) {
    entry.eventSource.close();
  }
  store.sessions.clear();
}

export type WorkbenchRuntimeSnapshot = {
  seeds: SeedReferenceRecord[];
  surfaces: FigmaEvidenceSurfaceRecord[];
  annotations: RegionAnnotationRecord[];
  /** Issue 30 — Prototype Evidence Surfaces (live dev-server previews). */
  prototypeSurfaces: PrototypeSurfaceRecord[];
  /** Project UX layout — frame geometry + camera (not research data). */
  layout: WorkbenchLayoutDocument;
  /** Project-level Design Language Description (Info tip). */
  designLanguageDescription: string;
  /** Issue 28 — completion-phase state machine. */
  projectPhase: string;
  /** Issue 07 — authoritative six-part Design Intent Alignment state. */
  alignment: DesignIntentAlignmentSnapshot;
};

export type RuntimeMutationResult =
  | { ok: true; reused?: boolean; seedId?: string }
  | { ok: false; error: string };

export type RuntimeFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

/** Authoritative GET retry: 3 attempts with short exponential backoff. */
export const LOAD_MAX_ATTEMPTS = 3;
/** Delays before attempt 2 and 3 (ms). Attempt 1 is immediate. */
export const LOAD_BACKOFF_MS = [150, 400] as const;

type WorkbenchDataClientOptions = {
  fetcher?: RuntimeFetch;
  onSnapshot: (snapshot: WorkbenchRuntimeSnapshot) => void;
  onError: (error: string | null) => void;
  /** Override sleep for tests (default: real timer). */
  sleep?: (ms: number) => Promise<void>;
  /** Override max attempts for tests (default: LOAD_MAX_ATTEMPTS). */
  maxLoadAttempts?: number;
  /** Override backoff schedule for tests (default: LOAD_BACKOFF_MS). */
  loadBackoffMs?: readonly number[];
};

type JsonResult = {
  ok: boolean;
  status: number;
  data: Record<string, unknown>;
};

export type ProjectBootstrapSnapshot = {
  project: { path: string; name: string } | null;
  cwdCandidate: {
    path: string;
    kind: "resume" | "init" | "manual";
  } | null;
  cwdMatchesActive: boolean;
};

type ProjectBootstrapOptions = {
  fetcher?: RuntimeFetch;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  backoffMs?: readonly number[];
};

async function fetchJson(
  fetcher: RuntimeFetch,
  url: string,
  session: string,
  init?: RequestInit
): Promise<JsonResult> {
  try {
    const response = await fetcher(url, {
      cache: "no-store",
      ...init,
      headers: {
        "x-ikran-session": session,
        ...(init?.headers ?? {})
      }
    });
    const data = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    return { ok: response.ok && data.ok === true, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "network" } };
  }
}

function resultError(...results: JsonResult[]): string {
  for (const result of results) {
    if (typeof result.data.error === "string" && result.data.error) {
      return result.data.error;
    }
  }
  return "load_failed";
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Loads the Runtime-global active project before the setup/workbench branch is
 * chosen. A transient read failure must not strand a valid project in the
 * empty setup state for the lifetime of the page.
 */
export async function loadProjectBootstrap(
  session: string,
  options: ProjectBootstrapOptions = {}
): Promise<
  | { ok: true; snapshot: ProjectBootstrapSnapshot }
  | { ok: false; error: string }
> {
  const fetcher = options.fetcher ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const maxAttempts = options.maxAttempts ?? LOAD_MAX_ATTEMPTS;
  const backoffMs = options.backoffMs ?? LOAD_BACKOFF_MS;
  let lastError = "load_failed";

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) {
      const delay = backoffMs[Math.min(attempt - 1, backoffMs.length - 1)] ?? 0;
      if (delay > 0) await sleep(delay);
    }

    const result = await fetchJson(fetcher, "/api/project", session, {
      method: "GET"
    });
    if (!result.ok) {
      lastError = resultError(result);
      const retryable =
        result.status === 0 ||
        result.status === 408 ||
        result.status === 429 ||
        result.status >= 500;
      if (!retryable) {
        return { ok: false, error: lastError };
      }
      continue;
    }

    const project = result.data.project;
    const cwdCandidate = result.data.cwd_candidate;
    return {
      ok: true,
      snapshot: {
        project:
          project &&
          typeof project === "object" &&
          typeof (project as { path?: unknown }).path === "string" &&
          typeof (project as { name?: unknown }).name === "string"
            ? (project as { path: string; name: string })
            : null,
        cwdCandidate:
          cwdCandidate &&
          typeof cwdCandidate === "object" &&
          typeof (cwdCandidate as { path?: unknown }).path === "string" &&
          ["resume", "init", "manual"].includes(
            String((cwdCandidate as { kind?: unknown }).kind)
          )
            ? (cwdCandidate as ProjectBootstrapSnapshot["cwdCandidate"])
            : null,
        cwdMatchesActive: result.data.cwd_matches_active === true
      }
    };
  }

  return { ok: false, error: lastError };
}

/**
 * Authoritative HTTP data client used by the React hook.
 *
 * Every load receives a monotonically increasing generation. Only the newest
 * request may apply records/errors. An older caller follows the newest load's
 * result, which prevents a mutation from failing merely because its reload was
 * superseded by a record/open reload.
 *
 * Transient GET failures retry the full three-endpoint batch with short
 * exponential backoff (see LOAD_MAX_ATTEMPTS / LOAD_BACKOFF_MS). Errors are
 * surfaced on each failed attempt so the UI can show them while self-healing.
 */
export function createWorkbenchDataClient(
  session: string,
  options: WorkbenchDataClientOptions
) {
  const fetcher = options.fetcher ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const maxAttempts = options.maxLoadAttempts ?? LOAD_MAX_ATTEMPTS;
  const backoffMs = options.loadBackoffMs ?? LOAD_BACKOFF_MS;
  let active = true;
  let generation = 0;
  let latestLoad: Promise<RuntimeMutationResult> | null = null;
  let lastLayout = emptyWorkbenchLayout();
  let layoutWriteQueue: Promise<void> = Promise.resolve();
  let layoutWriteRevision = Date.now() * 1000;
  const nextLayoutWriteRevision = () => {
    layoutWriteRevision = Math.max(
      layoutWriteRevision + 1,
      Date.now() * 1000
    );
    return layoutWriteRevision;
  };

  const loadAll = (): Promise<RuntimeMutationResult> => {
    const requestGeneration = ++generation;
    let request: Promise<RuntimeMutationResult> | null = null;

    request = (async () => {
      let lastError = "load_failed";

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (!active) {
          return { ok: false, error: "runtime_client_disposed" };
        }
        if (requestGeneration !== generation) {
          const newest = latestLoad;
          if (newest && newest !== request) return newest;
          return { ok: false, error: "load_superseded" };
        }

        if (attempt > 0) {
          const delay =
            backoffMs[Math.min(attempt - 1, backoffMs.length - 1)] ?? 0;
          if (delay > 0) await sleep(delay);
          if (!active) {
            return { ok: false, error: "runtime_client_disposed" };
          }
          if (requestGeneration !== generation) {
            const newest = latestLoad;
            if (newest && newest !== request) return newest;
            return { ok: false, error: "load_superseded" };
          }
        }

        const [seedRes, surfaceRes, annotationRes, layoutRes, readinessRes] =
          await Promise.all([
          fetchJson(fetcher, "/api/seed-reference", session, { method: "GET" }),
          fetchJson(fetcher, "/api/evidence-package", session, {
            method: "GET"
          }),
          fetchJson(fetcher, "/api/region-annotation", session, {
            method: "GET"
          }),
          fetchJson(fetcher, "/api/workbench-layout", session, {
            method: "GET"
          }),
          fetchJson(fetcher, "/api/project/readiness", session, {
            method: "GET"
          })
        ]);
        // Alignment also opens the project DB. Fetch it after the existing
        // batch to avoid six simultaneous migration/read connections during
        // an SSE invalidation while a designer mutation is committing.
        const alignmentRes = await fetchJson(
          fetcher,
          "/api/design-intent-alignment",
          session,
          { method: "GET" }
        );
        const prototypeRes = await fetchJson(
          fetcher,
          "/api/prototype-surface",
          session,
          { method: "GET" }
        );

        if (!active) {
          return { ok: false, error: "runtime_client_disposed" };
        }

        if (requestGeneration !== generation) {
          const newest = latestLoad;
          if (newest && newest !== request) return newest;
          return { ok: false, error: "load_superseded" };
        }

        if (
          seedRes.ok &&
          surfaceRes.ok &&
          annotationRes.ok &&
          readinessRes.ok &&
          alignmentRes.ok &&
          prototypeRes.ok
        ) {
          if (layoutRes.ok) {
            const layoutRaw = layoutRes.data.layout;
            lastLayout =
              layoutRaw !== null && typeof layoutRaw === "object"
                ? (layoutRaw as WorkbenchLayoutDocument)
                : emptyWorkbenchLayout();
          }
          const designLanguageDescription =
            typeof readinessRes.data.designLanguageDescription === "string"
              ? readinessRes.data.designLanguageDescription
              : "";
          const projectPhase =
            typeof readinessRes.data.project_phase === "string"
              ? readinessRes.data.project_phase
              : "seed";
          options.onSnapshot({
            seeds: (seedRes.data.records as SeedReferenceRecord[]) ?? [],
            surfaces:
              (surfaceRes.data.records as FigmaEvidenceSurfaceRecord[]) ?? [],
            annotations:
              (annotationRes.data.records as RegionAnnotationRecord[]) ?? [],
            prototypeSurfaces:
              (prototypeRes.data.records as PrototypeSurfaceRecord[]) ?? [],
            layout: lastLayout,
            designLanguageDescription,
            projectPhase,
            alignment: alignmentRes.data as unknown as DesignIntentAlignmentSnapshot
          });
          options.onError(null);
          return { ok: true };
        }

        lastError = resultError(
          seedRes,
          surfaceRes,
          annotationRes,
          readinessRes,
          alignmentRes,
          prototypeRes
        );
        // Surface while retrying so the canvas is not silently stale.
        options.onError(lastError);
      }

      return { ok: false, error: lastError };
    })();

    latestLoad = request;
    return request;
  };

  const reportMutationError = (error: string): RuntimeMutationResult => {
    if (active) options.onError(error);
    return { ok: false, error };
  };

  const createAnnotation = async (payload: {
    surfaceArtifactId: string;
    rect: NormalizedRect;
    targetNodeId?: string;
    body: string;
    section: string;
  }): Promise<RuntimeMutationResult> => {
    const request = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target: payload.targetNodeId
          ? {
              kind: "figma-node",
              evidenceVersionId: payload.surfaceArtifactId,
              nodeId: payload.targetNodeId
            }
          : {
              kind: "figma-region",
              surfaceArtifactId: payload.surfaceArtifactId,
              rect: payload.rect
            },
        author: "designer",
        body: payload.body,
        section: payload.section
      })
    } satisfies RequestInit;
    let result = await fetchJson(
      fetcher,
      "/api/region-annotation",
      session,
      request
    );
    for (const delay of [50, 150]) {
      if (result.ok || result.data.error !== "db_error") break;
      await sleep(delay);
      result = await fetchJson(
        fetcher,
        "/api/region-annotation",
        session,
        request
      );
    }
    if (!result.ok) {
      return reportMutationError(
        (typeof result.data.error === "string" && result.data.error) ||
          "create_annotation_failed"
      );
    }

    const reloaded = await loadAll();
    if (!reloaded.ok) {
      return reportMutationError(
        `create_succeeded_reload_failed:${reloaded.error}`
      );
    }
    return { ok: true };
  };

  const updateAnnotationBody = async (payload: {
    annotationId: string;
    body: string;
  }): Promise<RuntimeMutationResult> => {
    const result = await fetchJson(
      fetcher,
      "/api/region-annotation",
      session,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          annotationId: payload.annotationId,
          body: payload.body
        })
      }
    );
    if (!result.ok) {
      return reportMutationError(
        (typeof result.data.error === "string" && result.data.error) ||
          "update_annotation_body_failed"
      );
    }

    const reloaded = await loadAll();
    if (!reloaded.ok) {
      return reportMutationError(
        `update_body_succeeded_reload_failed:${reloaded.error}`
      );
    }
    return { ok: true };
  };

  const deleteAnnotation = async (
    annotationId: string
  ): Promise<RuntimeMutationResult> => {
    const result = await fetchJson(
      fetcher,
      `/api/region-annotation?id=${encodeURIComponent(annotationId)}`,
      session,
      { method: "DELETE" }
    );
    if (!result.ok) {
      return reportMutationError(
        (typeof result.data.error === "string" && result.data.error) ||
          "delete_annotation_failed"
      );
    }

    // A successful DELETE is already authoritative. The canvas controller
    // removes the selected marker only after this method resolves, so waiting
    // for the full Workbench batch here makes a tiny delete wait on unrelated
    // evidence screenshots, layout, and readiness requests. Keep the
    // consistency refresh (SSE also schedules one) but never put it on the
    // direct manipulation path.
    void loadAll().then((reloaded) => {
      if (!reloaded.ok) {
        reportMutationError(`delete_succeeded_reload_failed:${reloaded.error}`);
      }
    });
    return { ok: true };
  };

  const restoreAnnotation = async (
    annotationId: string
  ): Promise<RuntimeMutationResult> => {
    const result = await fetchJson(
      fetcher,
      "/api/region-annotation",
      session,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ annotationId })
      }
    );
    if (!result.ok) {
      return reportMutationError(
        (typeof result.data.error === "string" && result.data.error) ||
          "restore_annotation_failed"
      );
    }

    const reloaded = await loadAll();
    if (!reloaded.ok) {
      return reportMutationError(
        `restore_succeeded_reload_failed:${reloaded.error}`
      );
    }
    return { ok: true };
  };

  const deleteSeedReference = async (
    seedId: string
  ): Promise<RuntimeMutationResult> => {
    const result = await fetchJson(
      fetcher,
      `/api/seed-reference?id=${encodeURIComponent(seedId)}`,
      session,
      { method: "DELETE" }
    );
    if (!result.ok) {
      return reportMutationError(
        (typeof result.data.error === "string" && result.data.error) ||
          "delete_seed_failed"
      );
    }

    const reloaded = await loadAll();
    if (!reloaded.ok) {
      return reportMutationError(
        `delete_succeeded_reload_failed:${reloaded.error}`
      );
    }
    return { ok: true };
  };

  const refreshSeedReference = async (
    seedReferenceId: string
  ): Promise<RuntimeMutationResult> => {
    const result = await fetchJson(
      fetcher,
      "/api/seed-reference/refresh",
      session,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seedReferenceId })
      }
    );
    if (!result.ok) {
      return reportMutationError(
        (typeof result.data.error === "string" && result.data.error) ||
          "refresh_seed_failed"
      );
    }
    const reloaded = await loadAll();
    if (!reloaded.ok) {
      return reportMutationError(
        `refresh_succeeded_reload_failed:${reloaded.error}`
      );
    }
    return { ok: true };
  };

  const putWorkbenchLayoutNow = async (
    layout: WorkbenchLayoutDocument,
    writeRevision: number
  ): Promise<RuntimeMutationResult> => {
    const result = await fetchJson(fetcher, "/api/workbench-layout", session, {
      method: "PUT",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layout, writeRevision })
    });
    if (!result.ok) {
      return reportMutationError(
        (typeof result.data.error === "string" && result.data.error) ||
          "put_workbench_layout_failed"
      );
    }
    return { ok: true };
  };

  const putWorkbenchLayout = (
    layout: WorkbenchLayoutDocument
  ): Promise<RuntimeMutationResult> => {
    const writeRevision = nextLayoutWriteRevision();
    const result = layoutWriteQueue.then(
      () => putWorkbenchLayoutNow(layout, writeRevision),
      () => putWorkbenchLayoutNow(layout, writeRevision)
    );
    layoutWriteQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };

  const flushWorkbenchLayout = (
    layout: WorkbenchLayoutDocument
  ): Promise<RuntimeMutationResult> =>
    putWorkbenchLayoutNow(layout, nextLayoutWriteRevision());

  const updateSeedReferenceNote = async (
    seedId: string,
    referenceNote: string
  ): Promise<RuntimeMutationResult> => {
    const result = await fetchJson(fetcher, "/api/seed-reference", session, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: seedId, referenceNote })
    });
    if (!result.ok) {
      return reportMutationError(
        (typeof result.data.error === "string" && result.data.error) ||
          "update_seed_note_failed"
      );
    }
    const reloaded = await loadAll();
    if (!reloaded.ok) {
      return reportMutationError(
        `update_note_succeeded_reload_failed:${reloaded.error}`
      );
    }
    return { ok: true };
  };

  const updateDesignLanguageDescription = async (
    designLanguageDescription: string
  ): Promise<RuntimeMutationResult> => {
    const result = await fetchJson(fetcher, "/api/project/readiness", session, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ designLanguageDescription })
    });
    if (!result.ok) {
      return reportMutationError(
        (typeof result.data.error === "string" && result.data.error) ||
          "update_design_language_description_failed"
      );
    }
    const reloaded = await loadAll();
    if (!reloaded.ok) {
      return reportMutationError(
        `update_description_succeeded_reload_failed:${reloaded.error}`
      );
    }
    return { ok: true };
  };

  const patchAlignment = async (
    body: Record<string, unknown>,
    fallbackError: string
  ): Promise<RuntimeMutationResult> => {
    const result = await fetchJson(
      fetcher,
      "/api/design-intent-alignment",
      session,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }
    );
    if (!result.ok) {
      return reportMutationError(
        (typeof result.data.error === "string" && result.data.error) ||
          fallbackError
      );
    }
    const reloaded = await loadAll();
    if (!reloaded.ok) {
      return reportMutationError(
        `alignment_update_succeeded_reload_failed:${reloaded.error}`
      );
    }
    return { ok: true };
  };

  const recordDesignerAnswer = (questionCardId: string, finalAnswer: string) =>
    patchAlignment(
      {
        action: "record-designer-answer",
        input: { questionCardId, finalAnswer }
      },
      "record_designer_answer_failed"
    );

  const appendAgentAnnotationInformation = (
    annotationId: string,
    information: string
  ) =>
    patchAlignment(
      {
        action: "append-agent-annotation-information",
        input: { annotationId, information }
      },
      "append_agent_annotation_information_failed"
    );

  const completeDesignIntentAlignment = () =>
    patchAlignment({ action: "complete" }, "complete_alignment_failed");

  const confirmPrototype = async (): Promise<RuntimeMutationResult> => {
    const result = await fetchJson(fetcher, "/api/project/phase", session, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "confirm-prototype" })
    });
    if (!result.ok) {
      return reportMutationError(
        (typeof result.data.error === "string" && result.data.error) ||
          "confirm_prototype_failed"
      );
    }
    const reloaded = await loadAll();
    if (!reloaded.ok) {
      return reportMutationError(
        `confirm_prototype_succeeded_reload_failed:${reloaded.error}`
      );
    }
    return { ok: true };
  };

  const prepareDesignIntentAlignment = () =>
    patchAlignment({ action: "prepare" }, "prepare_alignment_failed");

  const returnToSeedReference = () =>
    patchAlignment(
      { action: "return-to-seed-reference" },
      "return_to_seed_reference_failed"
    );

  return {
    loadAll,
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
    confirmPrototype,
    getFigmaConnection: async (): Promise<
      | { ok: true; connected: false }
      | {
          ok: true;
          connected: true;
          account: { handle: string; email?: string };
        }
      | { ok: false; error: string }
    > => {
      const result = await fetchJson(fetcher, "/api/figma-connection", session, {
        method: "GET"
      });
      if (!result.ok) {
        return {
          ok: false,
          error:
            (typeof result.data.error === "string" && result.data.error) ||
            "figma_connection_status_failed"
        };
      }
      if (result.data.connected === true) {
        const account = result.data.account as
          | { handle: string; email?: string }
          | undefined;
        if (!account || typeof account.handle !== "string") {
          return { ok: false, error: "figma_connection_status_failed" };
        }
        return { ok: true, connected: true, account };
      }
      return { ok: true, connected: false };
    },
    connectFigma: async (
      token: string
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const result = await fetchJson(fetcher, "/api/figma-connection", session, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token })
      });
      if (!result.ok) {
        return {
          ok: false,
          error:
            (typeof result.data.error === "string" && result.data.error) ||
            "figma_connect_failed"
        };
      }
      return { ok: true };
    },
    captureSeedReference: async (
      figmaSeedReference: string
    ): Promise<RuntimeMutationResult> => {
      const result = await fetchJson(fetcher, "/api/seed-capture", session, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ figmaSeedReference })
      });
      if (!result.ok) {
        return reportMutationError(
          (typeof result.data.error === "string" && result.data.error) ||
            "seed_capture_failed"
        );
      }
      const reused = result.data.reused === true;
      const record =
        result.data.record !== null &&
        typeof result.data.record === "object" &&
        !Array.isArray(result.data.record)
          ? (result.data.record as Record<string, unknown>)
          : null;
      const seedId =
        typeof record?.id === "string" && record.id.length > 0
          ? record.id
          : undefined;
      const reloaded = await loadAll();
      if (!reloaded.ok) {
        return reportMutationError(
          `capture_succeeded_reload_failed:${reloaded.error}`
        );
      }
      return {
        ok: true,
        ...(reused ? { reused: true } : {}),
        ...(seedId ? { seedId } : {})
      };
    },
    dispose() {
      active = false;
      generation += 1;
    }
  };
}
