// Browser Runtime event client — one EventSource per session (ref-counted).
// Shared by ProjectSetupCard (heartbeat) and Workbench (heartbeat + record).

import type { RecordBusEvent } from "@/lib/runtime/record-bus";
import type { SeedReferenceRecord } from "@/lib/runtime/seed-reference";
import type { FigmaEvidenceSurfaceRecord } from "@/lib/runtime/evidence-package";
import type { RegionAnnotationRecord } from "@/lib/runtime/region-annotation";
import type { NormalizedRect } from "@/components/workbench/region-annotation-geometry";

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
};

export type RuntimeMutationResult =
  | { ok: true }
  | { ok: false; error: string };

type RuntimeFetch = (
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

        const [seedRes, surfaceRes, annotationRes] = await Promise.all([
          fetchJson(fetcher, "/api/seed-reference", session, { method: "GET" }),
          fetchJson(fetcher, "/api/evidence-package", session, {
            method: "GET"
          }),
          fetchJson(fetcher, "/api/region-annotation", session, {
            method: "GET"
          })
        ]);

        if (!active) {
          return { ok: false, error: "runtime_client_disposed" };
        }

        if (requestGeneration !== generation) {
          const newest = latestLoad;
          if (newest && newest !== request) return newest;
          return { ok: false, error: "load_superseded" };
        }

        if (seedRes.ok && surfaceRes.ok && annotationRes.ok) {
          options.onSnapshot({
            seeds: (seedRes.data.records as SeedReferenceRecord[]) ?? [],
            surfaces:
              (surfaceRes.data.records as FigmaEvidenceSurfaceRecord[]) ?? [],
            annotations:
              (annotationRes.data.records as RegionAnnotationRecord[]) ?? []
          });
          options.onError(null);
          return { ok: true };
        }

        lastError = resultError(seedRes, surfaceRes, annotationRes);
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
  }): Promise<RuntimeMutationResult> => {
    const result = await fetchJson(fetcher, "/api/region-annotation", session, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        surfaceArtifactId: payload.surfaceArtifactId,
        author: "designer",
        body: "Placeholder annotation",
        rect: payload.rect
      })
    });
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

    const reloaded = await loadAll();
    if (!reloaded.ok) {
      return reportMutationError(
        `delete_succeeded_reload_failed:${reloaded.error}`
      );
    }
    return { ok: true };
  };

  return {
    loadAll,
    createAnnotation,
    deleteAnnotation,
    dispose() {
      active = false;
      generation += 1;
    }
  };
}
