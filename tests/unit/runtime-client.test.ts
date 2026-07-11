// Task 11 — single EventSource per session with ref-count reuse.

import { afterEach, describe, expect, test, vi } from "vitest";

type Listener = (ev: MessageEvent) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  closed = false;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, Set<Listener>>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener) {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data: unknown) {
    const payload = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const listener of this.listeners.get(type) ?? []) {
      listener(payload);
    }
  }

  emitOpen() {
    const payload = new Event("open");
    for (const listener of this.listeners.get("open") ?? []) {
      listener(payload as unknown as MessageEvent);
    }
  }

  static reset() {
    MockEventSource.instances = [];
  }
}

afterEach(() => {
  MockEventSource.reset();
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("runtime-client EventSource refcount", () => {
  test("same session reuses one EventSource; last unsubscribe closes it", async () => {
    vi.stubGlobal("EventSource", MockEventSource);
    const {
      subscribeRuntimeEvents,
      getRuntimeEventSourceCountForTests,
      resetRuntimeClientForTests
    } = await import("../../components/runtime/runtime-client");
    resetRuntimeClientForTests();

    const heartbeats: unknown[] = [];
    const records: unknown[] = [];

    const a = subscribeRuntimeEvents("sess-1", {
      onHeartbeat: (e) => heartbeats.push(e),
      onRecord: (e) => records.push(e)
    });
    const b = subscribeRuntimeEvents("sess-1", {
      onHeartbeat: (e) => heartbeats.push(e),
      onRecord: (e) => records.push(e)
    });

    expect(MockEventSource.instances).toHaveLength(1);
    expect(getRuntimeEventSourceCountForTests()).toBe(1);
    expect(MockEventSource.instances[0].url).toContain(
      "/api/events?session=sess-1"
    );

    MockEventSource.instances[0].emit("heartbeat", {
      type: "heartbeat",
      sequence: 1
    });
    MockEventSource.instances[0].emit("record", {
      kind: "seed",
      action: "created",
      id: "s1",
      projectPath: "/p",
      timestamp: "t"
    });
    expect(heartbeats).toHaveLength(2);
    expect(records).toHaveLength(2);

    a();
    expect(MockEventSource.instances[0].closed).toBe(false);
    expect(getRuntimeEventSourceCountForTests()).toBe(1);

    b();
    expect(MockEventSource.instances[0].closed).toBe(true);
    expect(getRuntimeEventSourceCountForTests()).toBe(0);
  });

  test("different sessions get separate EventSources", async () => {
    vi.stubGlobal("EventSource", MockEventSource);
    const {
      subscribeRuntimeEvents,
      resetRuntimeClientForTests
    } = await import("../../components/runtime/runtime-client");
    resetRuntimeClientForTests();

    const a = subscribeRuntimeEvents("a", {});
    const b = subscribeRuntimeEvents("b", {});
    expect(MockEventSource.instances).toHaveLength(2);
    a();
    b();
  });

  test("open is connection-ready, notifies late subscribers immediately, and fires on reconnect", async () => {
    vi.stubGlobal("EventSource", MockEventSource);
    const {
      subscribeRuntimeEvents,
      resetRuntimeClientForTests
    } = await import("../../components/runtime/runtime-client");
    resetRuntimeClientForTests();

    const opens: string[] = [];
    const first = subscribeRuntimeEvents("sess-ready", {
      onOpen: () => opens.push("first")
    });

    expect(opens).toEqual([]);
    MockEventSource.instances[0].emitOpen();
    expect(opens).toEqual(["first"]);

    const late = subscribeRuntimeEvents("sess-ready", {
      onOpen: () => opens.push("late")
    });
    expect(opens).toEqual(["first", "late"]);
    expect(MockEventSource.instances).toHaveLength(1);

    MockEventSource.instances[0].emitOpen();
    expect(opens).toEqual(["first", "late", "first", "late"]);

    first();
    late();
  });
});
