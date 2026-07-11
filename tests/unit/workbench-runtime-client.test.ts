// Task 11 consistency guards: connection-ready baselines, latest-request wins,
// and mutation success is not reported when authoritative reload fails.

import { afterEach, describe, expect, test, vi } from "vitest";

type Listener = (event: Event | MessageEvent) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];
  readonly url: string;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, Set<Listener>>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener) {
    let listeners = this.listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }
    listeners.add(listener);
  }

  close() {
    this.closed = true;
  }

  emitOpen() {
    for (const listener of this.listeners.get("open") ?? []) {
      listener(new Event("open"));
    }
  }

  static reset() {
    MockEventSource.instances = [];
  }
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function jsonResponse(
  records: unknown[],
  options?: { ok?: boolean; status?: number; error?: string }
): Response {
  const ok = options?.ok ?? true;
  return new Response(
    JSON.stringify(
      ok ? { ok: true, records } : { ok: false, error: options?.error ?? "load_failed" }
    ),
    {
      status: options?.status ?? (ok ? 200 : 500),
      headers: { "Content-Type": "application/json" }
    }
  );
}

afterEach(async () => {
  MockEventSource.reset();
  vi.unstubAllGlobals();
  const { resetRuntimeClientForTests } = await import(
    "../../components/runtime/runtime-client"
  );
  resetRuntimeClientForTests();
});

describe("Workbench Runtime consistency", () => {
  test("connection-ready baseline closes the initial GET/SSE window with latest records", async () => {
    vi.stubGlobal("EventSource", MockEventSource);
    const {
      createWorkbenchDataClient,
      startWorkbenchRuntimeSubscription
    } = await import("../../components/runtime/use-workbench-runtime");

    const firstResponses = [deferred<Response>(), deferred<Response>(), deferred<Response>()];
    let fetchIndex = 0;
    let latest = false;
    const fetcher = vi.fn(async () => {
      if (!latest) {
        return firstResponses[fetchIndex++].promise;
      }
      return jsonResponse(
        fetchIndex++ % 3 === 0 ? [{ id: "seed-latest" }] : []
      );
    });

    const snapshots: Array<{ seeds: Array<{ id: string }> }> = [];
    const client = createWorkbenchDataClient("session", {
      fetcher,
      onSnapshot: (snapshot) => {
        snapshots.push(snapshot as { seeds: Array<{ id: string }> });
      },
      onError: () => {}
    });

    const subscription = startWorkbenchRuntimeSubscription("session", {
      loadBaseline: () => client.loadAll(),
      onRecord: () => {}
    });

    // A record commits after the initial GET started but before SSE is ready.
    latest = true;
    MockEventSource.instances[0].emitOpen();
    await vi.waitFor(() => {
      expect(snapshots.at(-1)?.seeds).toEqual([{ id: "seed-latest" }]);
    });

    // The stale initial response arrives last and must not overwrite baseline.
    firstResponses[0].resolve(jsonResponse([{ id: "seed-old" }]));
    firstResponses[1].resolve(jsonResponse([]));
    firstResponses[2].resolve(jsonResponse([]));
    await Promise.resolve();
    await Promise.resolve();

    expect(snapshots.at(-1)?.seeds).toEqual([{ id: "seed-latest" }]);
    subscription();
    client.dispose();
  });

  test("each open/reopen triggers exactly one authoritative baseline", async () => {
    vi.stubGlobal("EventSource", MockEventSource);
    const { startWorkbenchRuntimeSubscription } = await import(
      "../../components/runtime/use-workbench-runtime"
    );
    const loadBaseline = vi.fn(async () => ({ ok: true as const }));

    const unsubscribe = startWorkbenchRuntimeSubscription("session", {
      loadBaseline,
      onRecord: () => {}
    });
    expect(loadBaseline).toHaveBeenCalledTimes(1); // initial GET

    MockEventSource.instances[0].emitOpen();
    await vi.waitFor(() => expect(loadBaseline).toHaveBeenCalledTimes(2));

    MockEventSource.instances[0].emitOpen();
    await vi.waitFor(() => expect(loadBaseline).toHaveBeenCalledTimes(3));

    unsubscribe();
  });

  test("out-of-order loads only apply the newest response", async () => {
    const responses = Array.from({ length: 6 }, () => deferred<Response>());
    let index = 0;
    const snapshots: Array<{ seeds: Array<{ id: string }> }> = [];
    const { createWorkbenchDataClient } = await import(
      "../../components/runtime/use-workbench-runtime"
    );
    const client = createWorkbenchDataClient("session", {
      fetcher: () => responses[index++].promise,
      onSnapshot: (snapshot) => {
        snapshots.push(snapshot as { seeds: Array<{ id: string }> });
      },
      onError: () => {}
    });

    const older = client.loadAll();
    const newer = client.loadAll();

    responses[3].resolve(jsonResponse([{ id: "new" }]));
    responses[4].resolve(jsonResponse([]));
    responses[5].resolve(jsonResponse([]));
    await newer;

    responses[0].resolve(jsonResponse([{ id: "old" }]));
    responses[1].resolve(jsonResponse([]));
    responses[2].resolve(jsonResponse([]));
    await older;

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].seeds).toEqual([{ id: "new" }]);
    client.dispose();
  });

  test.each(["create", "delete"] as const)(
    "%s mutation returns false when post-success authoritative reload fails",
    async (operation) => {
      const errors: Array<string | null> = [];
      const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST" || init?.method === "DELETE") {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }
        return jsonResponse([], {
          ok: false,
          status: 500,
          error: "reload_failed"
        });
      });
      const { createWorkbenchDataClient } = await import(
        "../../components/runtime/use-workbench-runtime"
      );
      const client = createWorkbenchDataClient("session", {
        fetcher,
        sleep: async () => {},
        onSnapshot: () => {},
        onError: (error) => errors.push(error)
      });

      const result =
        operation === "create"
          ? await client.createAnnotation({
              surfaceArtifactId: "surface-1",
              rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }
            })
          : await client.deleteAnnotation("annotation-1");

      expect(result).toEqual({
        ok: false,
        error: `${operation}_succeeded_reload_failed:reload_failed`
      });
      expect(errors.at(-1)).toBe(
        `${operation}_succeeded_reload_failed:reload_failed`
      );
      client.dispose();
    }
  );

  test("loadAll retries full batch with exponential backoff then succeeds", async () => {
    const sleeps: number[] = [];
    let batch = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const current = Math.floor(batch / 3);
      batch += 1;
      if (current < 2) {
        return jsonResponse([], {
          ok: false,
          status: 500,
          error: "transient_500"
        });
      }
      if (url.includes("seed-reference")) {
        return jsonResponse([{ id: "seed-healed" }]);
      }
      return jsonResponse([]);
    });
    const errors: Array<string | null> = [];
    const snapshots: Array<{ seeds: Array<{ id: string }> }> = [];
    const { createWorkbenchDataClient, LOAD_BACKOFF_MS } = await import(
      "../../components/runtime/runtime-client"
    );
    const client = createWorkbenchDataClient("session", {
      fetcher,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      onSnapshot: (snapshot) => {
        snapshots.push(snapshot as { seeds: Array<{ id: string }> });
      },
      onError: (error) => errors.push(error)
    });

    const result = await client.loadAll();

    expect(result).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(9); // 3 attempts × 3 GETs
    expect(sleeps).toEqual([...LOAD_BACKOFF_MS]);
    expect(errors).toEqual(["transient_500", "transient_500", null]);
    expect(snapshots.at(-1)?.seeds).toEqual([{ id: "seed-healed" }]);
    client.dispose();
  });

  test("loadAll surfaces error on each attempt and gives up after max attempts", async () => {
    const sleeps: number[] = [];
    const fetcher = vi.fn(async () =>
      jsonResponse([], { ok: false, status: 500, error: "still_down" })
    );
    const errors: Array<string | null> = [];
    const { createWorkbenchDataClient, LOAD_MAX_ATTEMPTS, LOAD_BACKOFF_MS } =
      await import("../../components/runtime/runtime-client");
    const client = createWorkbenchDataClient("session", {
      fetcher,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      onSnapshot: () => {},
      onError: (error) => errors.push(error)
    });

    const result = await client.loadAll();

    expect(result).toEqual({ ok: false, error: "still_down" });
    expect(fetcher).toHaveBeenCalledTimes(LOAD_MAX_ATTEMPTS * 3);
    expect(sleeps).toEqual([...LOAD_BACKOFF_MS]);
    expect(errors).toEqual(["still_down", "still_down", "still_down"]);
    client.dispose();
  });

  test("SSE error then reconnect triggers a fresh authoritative baseline", async () => {
    vi.stubGlobal("EventSource", MockEventSource);
    const { startWorkbenchRuntimeSubscription } = await import(
      "../../components/runtime/use-workbench-runtime"
    );
    const loadBaseline = vi.fn(async () => ({ ok: true as const }));
    const onError = vi.fn();

    const unsubscribe = startWorkbenchRuntimeSubscription("session", {
      loadBaseline,
      onRecord: () => {},
      onError
    });
    expect(loadBaseline).toHaveBeenCalledTimes(1);

    MockEventSource.instances[0].emitOpen();
    await vi.waitFor(() => expect(loadBaseline).toHaveBeenCalledTimes(2));

    // Disconnect: EventSource.onerror notifies subscribers. Reconnect fires
    // `open` again and must reload the authoritative baseline.
    MockEventSource.instances[0].onerror?.();
    expect(onError).toHaveBeenCalledTimes(1);

    MockEventSource.instances[0].emitOpen();
    await vi.waitFor(() => expect(loadBaseline).toHaveBeenCalledTimes(3));

    unsubscribe();
  });
});
