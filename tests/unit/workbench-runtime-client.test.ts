// Task 11 consistency guards: connection-ready baselines, latest-request wins,
// and post-mutation authoritative refresh behavior.

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

/** Authoritative Workbench GET batch size, including Design Intent Alignment. */
const LOAD_BATCH = 6;

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

function layoutResponse(
  options?: {
    ok?: boolean;
    status?: number;
    error?: string;
    layout?: unknown;
  }
): Response {
  const ok = options?.ok ?? true;
  return new Response(
    JSON.stringify(
      ok
        ? {
            ok: true,
            layout:
              options?.layout ??
              { version: 1, camera: { x: 0, y: 0, z: 1 }, frames: {} }
          }
        : { ok: false, error: options?.error ?? "load_failed" }
    ),
    {
      status: options?.status ?? (ok ? 200 : 500),
      headers: { "Content-Type": "application/json" }
    }
  );
}

function readinessResponse(
  options?: { ok?: boolean; status?: number; error?: string; description?: string }
): Response {
  const ok = options?.ok ?? true;
  return new Response(
    JSON.stringify(
      ok
        ? {
            ok: true,
            preconditions: [],
            designLanguageDescription: options?.description ?? ""
          }
        : { ok: false, error: options?.error ?? "load_failed" }
    ),
    {
      status: options?.status ?? (ok ? 200 : 500),
      headers: { "Content-Type": "application/json" }
    }
  );
}

function alignmentResponse(): Response {
  return new Response(
    JSON.stringify({
      ok: true,
      sections: [
        "design-principle",
        "visual-language",
        "token",
        "layout",
        "component",
        "interaction"
      ],
      alignment: { status: "draft", completed_at: null },
      annotations: [],
      question_cards: [],
      coverage: {
        sections: {},
        can_complete: false
      }
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function batchResponse(url: string, seedRecords: unknown[]): Response {
  if (url.includes("design-intent-alignment")) return alignmentResponse();
  if (url.includes("workbench-layout")) return layoutResponse();
  if (url.includes("project/readiness")) return readinessResponse();
  if (url.includes("seed-reference")) return jsonResponse(seedRecords);
  return jsonResponse([]);
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
  test("retries a transient annotation db_error without retrying unrelated failures", async () => {
    let posts = 0;
    const sleeps: number[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts += 1;
        return new Response(
          JSON.stringify(posts === 1 ? { ok: false, error: "db_error" } : { ok: true }),
          {
            status: posts === 1 ? 500 : 200,
            headers: { "Content-Type": "application/json" }
          }
        );
      }
      return batchResponse(String(input), []);
    });
    const { createWorkbenchDataClient } = await import(
      "../../components/runtime/use-workbench-runtime"
    );
    const client = createWorkbenchDataClient("session", {
      fetcher,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      onSnapshot: () => {},
      onError: () => {}
    });

    expect(
      await client.createAnnotation({
        surfaceArtifactId: "surface-1",
        rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }
      })
    ).toEqual({ ok: true });
    expect(posts).toBe(2);
    expect(sleeps).toEqual([50]);
    client.dispose();
  });

  test("loads alignment and exposes answer, append, and complete mutations", async () => {
    const snapshots: unknown[] = [];
    const writes: unknown[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("design-intent-alignment") && init?.method === "PATCH") {
        writes.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      return batchResponse(url, []);
    });
    const { createWorkbenchDataClient } = await import(
      "../../components/runtime/use-workbench-runtime"
    );
    const client = createWorkbenchDataClient("session", {
      fetcher,
      sleep: async () => {},
      onSnapshot: (snapshot) => snapshots.push(snapshot),
      onError: () => {}
    });

    expect(await client.loadAll()).toEqual({ ok: true });
    expect(snapshots.at(-1)).toMatchObject({
      alignment: { alignment: { status: "draft" }, question_cards: [] }
    });
    expect(await client.recordDesignerAnswer("question-1", "Use 16px")).toEqual({ ok: true });
    expect(await client.appendAgentAnnotationInformation("annotation-1", "Keep this exception")).toEqual({ ok: true });
    expect(await client.completeDesignIntentAlignment()).toEqual({ ok: true });
    expect(writes).toEqual([
      {
        action: "record-designer-answer",
        input: { questionCardId: "question-1", finalAnswer: "Use 16px" }
      },
      {
        action: "append-agent-annotation-information",
        input: { annotationId: "annotation-1", information: "Keep this exception" }
      },
      { action: "complete" }
    ]);
    client.dispose();
  });

  test("structural click creates an explicit figma-node target", async () => {
    let posted: unknown = null;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") {
        posted = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      return batchResponse(url, []);
    });
    const { createWorkbenchDataClient } = await import(
      "../../components/runtime/use-workbench-runtime"
    );
    const client = createWorkbenchDataClient("session", {
      fetcher,
      sleep: async () => {},
      onSnapshot: () => {},
      onError: () => {}
    });

    const result = await client.createAnnotation({
      surfaceArtifactId: "surface-v1",
      rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.2 },
      targetNodeId: "12:34"
    });

    expect(result).toEqual({ ok: true });
    expect(posted).toEqual({
      target: {
        kind: "figma-node",
        evidenceVersionId: "surface-v1",
        nodeId: "12:34"
      },
      author: "designer",
      body: "Placeholder annotation"
    });
    client.dispose();
  });

  test("connection-ready baseline closes the initial GET/SSE window with latest records", async () => {
    vi.stubGlobal("EventSource", MockEventSource);
    const {
      createWorkbenchDataClient,
      startWorkbenchRuntimeSubscription
    } = await import("../../components/runtime/use-workbench-runtime");

    const firstResponses = Array.from({ length: LOAD_BATCH }, () =>
      deferred<Response>()
    );
    let fetchIndex = 0;
    let latest = false;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!latest) {
        return firstResponses[fetchIndex++].promise;
      }
      const i = fetchIndex++;
      // Within each batch of 4, first URL resolved as seed when index%4===0 —
      // but Promise.all order follows call order: seed, surface, annotation, layout.
      if (url.includes("seed-reference")) {
        return jsonResponse([{ id: "seed-latest" }]);
      }
      if (url.includes("workbench-layout")) return layoutResponse();
      if (url.includes("project/readiness")) return readinessResponse();
      return jsonResponse([]);
      void i;
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
    firstResponses[3].resolve(layoutResponse());
    firstResponses[4].resolve(readinessResponse());
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
    const responses = Array.from({ length: LOAD_BATCH * 2 }, () =>
      deferred<Response>()
    );
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

    // Both core batches start together (5 requests each); alignment follows
    // its core batch to avoid another concurrent project-DB connection.
    responses[5].resolve(jsonResponse([{ id: "new" }]));
    responses[6].resolve(jsonResponse([]));
    responses[7].resolve(jsonResponse([]));
    responses[8].resolve(layoutResponse());
    responses[9].resolve(readinessResponse());
    responses[10].resolve(alignmentResponse());
    await newer;

    responses[0].resolve(jsonResponse([{ id: "old" }]));
    responses[1].resolve(jsonResponse([]));
    responses[2].resolve(jsonResponse([]));
    responses[3].resolve(layoutResponse());
    responses[4].resolve(readinessResponse());
    responses[11].resolve(alignmentResponse());
    await older;

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].seeds).toEqual([{ id: "new" }]);
    client.dispose();
  });

  test("create mutation returns false when post-success authoritative reload fails", async () => {
    const errors: Array<string | null> = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
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

    const result = await client.createAnnotation({
      surfaceArtifactId: "surface-1",
      rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }
    });

    expect(result).toEqual({
      ok: false,
      error: "create_succeeded_reload_failed:reload_failed"
    });
    expect(errors.at(-1)).toBe("create_succeeded_reload_failed:reload_failed");
    client.dispose();
  });

  test("annotation delete reports a failed background refresh without delaying success", async () => {
    const errors: Array<string | null> = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") {
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

    await expect(client.deleteAnnotation("annotation-1")).resolves.toEqual({
      ok: true
    });
    await vi.waitFor(() =>
      expect(errors.at(-1)).toBe("delete_succeeded_reload_failed:reload_failed")
    );
    client.dispose();
  });

  test("annotation delete returns after the authoritative DELETE without waiting for a full reload", async () => {
    const evidenceResponse = deferred<Response>();
    let deleteCompleted = false;
    let reloadStarted = false;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "DELETE") {
        deleteCompleted = true;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url.includes("evidence-package")) {
        reloadStarted = true;
        return evidenceResponse.promise;
      }
      return batchResponse(url, []);
    });
    const { createWorkbenchDataClient } = await import(
      "../../components/runtime/use-workbench-runtime"
    );
    const client = createWorkbenchDataClient("session", {
      fetcher,
      onSnapshot: () => {},
      onError: () => {}
    });

    let settled = false;
    const deletion = client.deleteAnnotation("annotation-1").then((result) => {
      settled = true;
      return result;
    });

    try {
      await vi.waitFor(() => expect(deleteCompleted).toBe(true));
      await vi.waitFor(() => expect(reloadStarted).toBe(true));
      await vi.waitFor(() => expect(settled).toBe(true), { timeout: 100 });
      expect(await deletion).toEqual({ ok: true });
    } finally {
      evidenceResponse.resolve(jsonResponse([]));
      await deletion;
      client.dispose();
    }
  });

  test("loadAll retries full batch with exponential backoff then succeeds", async () => {
    const sleeps: number[] = [];
    let batch = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const current = Math.floor(batch / LOAD_BATCH);
      batch += 1;
      if (current < 2) {
        return jsonResponse([], {
          ok: false,
          status: 500,
          error: "transient_500"
        });
      }
      return batchResponse(url, [{ id: "seed-healed" }]);
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
    expect(fetcher).toHaveBeenCalledTimes(3 * LOAD_BATCH);
    expect(sleeps).toEqual([...LOAD_BACKOFF_MS]);
    expect(errors).toEqual(["transient_500", "transient_500", null]);
    expect(snapshots.at(-1)?.seeds).toEqual([{ id: "seed-healed" }]);
    client.dispose();
  });

  test("layout failure falls back without blocking semantic records", async () => {
    const snapshots: Array<{
      seeds: Array<{ id: string }>;
      layout: { camera: { x: number } };
    }> = [];
    const errors: Array<string | null> = [];
    let layoutLoads = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("workbench-layout")) {
        layoutLoads += 1;
        if (layoutLoads === 1) {
          return layoutResponse({
            layout: {
              version: 1,
              camera: { x: 42, y: 0, z: 1 },
              frames: {}
            }
          });
        }
        return layoutResponse({ ok: false, status: 500, error: "read_failed" });
      }
      return batchResponse(url, [{ id: `seed-${layoutLoads || 1}` }]);
    });
    const { createWorkbenchDataClient } = await import(
      "../../components/runtime/runtime-client"
    );
    const client = createWorkbenchDataClient("session", {
      fetcher,
      maxLoadAttempts: 1,
      onSnapshot: (snapshot) => {
        snapshots.push(snapshot as (typeof snapshots)[number]);
      },
      onError: (error) => errors.push(error)
    });

    expect(await client.loadAll()).toEqual({ ok: true });
    expect(await client.loadAll()).toEqual({ ok: true });
    expect(snapshots.at(-1)?.seeds).toEqual([{ id: "seed-1" }]);
    expect(snapshots.at(-1)?.layout.camera.x).toBe(42);
    expect(errors).toEqual([null, null]);
    client.dispose();
  });

  test("layout PUTs are serialized in call order", async () => {
    const responses = [deferred<Response>(), deferred<Response>()];
    const bodies: Array<{
      layout: { camera: { x: number } };
      writeRevision: number;
    }> = [];
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return responses[bodies.length - 1]!.promise;
      }
    );
    const { createWorkbenchDataClient } = await import(
      "../../components/runtime/runtime-client"
    );
    const client = createWorkbenchDataClient("session", {
      fetcher,
      onSnapshot: () => {},
      onError: () => {}
    });
    const layout = (x: number) => ({
      version: 1 as const,
      camera: { x, y: 0, z: 1 },
      frames: {}
    });

    const first = client.putWorkbenchLayout(layout(1));
    const second = client.putWorkbenchLayout(layout(2));
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);

    responses[0].resolve(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    await first;
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    responses[1].resolve(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    await second;

    expect(bodies.map((body) => body.layout)).toEqual([
      layout(1),
      layout(2)
    ]);
    expect(bodies[1]!.writeRevision).toBeGreaterThan(
      bodies[0]!.writeRevision
    );
    client.dispose();
  });

  test("layout flush bypasses a blocked queue with a newer revision", async () => {
    const responses = [deferred<Response>(), deferred<Response>()];
    const bodies: Array<{ layout: { camera: { x: number } }; writeRevision: number }> = [];
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return responses[bodies.length - 1]!.promise;
      }
    );
    const { createWorkbenchDataClient } = await import(
      "../../components/runtime/runtime-client"
    );
    const client = createWorkbenchDataClient("session", {
      fetcher,
      onSnapshot: () => {},
      onError: () => {}
    });
    const layout = (x: number) => ({
      version: 1 as const,
      camera: { x, y: 0, z: 1 },
      frames: {}
    });

    const queued = client.putWorkbenchLayout(layout(1));
    await Promise.resolve();
    const flushed = client.flushWorkbenchLayout(layout(2));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(bodies.map((body) => body.layout.camera.x)).toEqual([1, 2]);
    expect(bodies[1]!.writeRevision).toBeGreaterThan(bodies[0]!.writeRevision);

    for (const response of responses) {
      response.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    }
    await Promise.all([queued, flushed]);
    client.dispose();
  });

  test("an older client can produce a newer revision on a later write", async () => {
    let now = 100;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    const requests: Array<{ client: string; writeRevision: number }> = [];
    const makeFetcher = (client: string) =>
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { writeRevision: number };
        requests.push({ client, writeRevision: body.writeRevision });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      });
    const { createWorkbenchDataClient } = await import(
      "../../components/runtime/runtime-client"
    );
    const options = (client: string) => ({
      fetcher: makeFetcher(client),
      onSnapshot: () => {},
      onError: () => {}
    });
    const older = createWorkbenchDataClient("session", options("older"));
    now = 200;
    const newer = createWorkbenchDataClient("session", options("newer"));
    const layout = {
      version: 1 as const,
      camera: { x: 0, y: 0, z: 1 },
      frames: {}
    };

    await newer.putWorkbenchLayout(layout);
    now = 300;
    await older.putWorkbenchLayout(layout);

    expect(requests[1]!.writeRevision).toBeGreaterThan(
      requests[0]!.writeRevision
    );
    older.dispose();
    newer.dispose();
    nowSpy.mockRestore();
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
    expect(fetcher).toHaveBeenCalledTimes(LOAD_MAX_ATTEMPTS * LOAD_BATCH);
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
