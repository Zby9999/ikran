import { afterEach, describe, expect, test, vi } from "vitest";

import {
  createRuntimeLifecycle,
  registerRuntimeControl,
  withRuntimeJob,
  type RuntimeLifecycle
} from "../../lib/runtime/runtime-lifecycle";

describe("Runtime lifecycle leases", () => {
  let lifecycle: RuntimeLifecycle | undefined;

  afterEach(() => {
    lifecycle?.dispose();
    lifecycle = undefined;
    vi.useRealTimers();
  });

  test("a Runtime with no leases starts its idle countdown immediately", () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    lifecycle = createRuntimeLifecycle({ idleMs: 1_000, onIdle });

    vi.advanceTimersByTime(999);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledOnce();
  });

  test("MCP disconnect does not stop Runtime while Workbench remains connected", () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    lifecycle = createRuntimeLifecycle({ idleMs: 1_000, onIdle });
    const releaseMcp = lifecycle.acquire("mcp");
    const releaseWorkbench = lifecycle.acquire("workbench");

    releaseMcp();
    vi.advanceTimersByTime(2_000);
    expect(onIdle).not.toHaveBeenCalled();

    releaseWorkbench();
    vi.advanceTimersByTime(999);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledOnce();
  });

  test("a reconnect cancels pending idle shutdown", () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    lifecycle = createRuntimeLifecycle({ idleMs: 1_000, onIdle });
    const release = lifecycle.acquire("mcp");
    release();
    vi.advanceTimersByTime(500);
    const releaseAgain = lifecycle.acquire("mcp");
    vi.advanceTimersByTime(1_000);
    expect(onIdle).not.toHaveBeenCalled();
    releaseAgain();
    vi.advanceTimersByTime(1_000);
    expect(onIdle).toHaveBeenCalledOnce();
  });

  test("tracks in-flight jobs separately for graceful shutdown", () => {
    lifecycle = createRuntimeLifecycle({ idleMs: 1_000, onIdle: vi.fn() });
    const releaseMcp = lifecycle.acquire("mcp");
    const releaseJob = lifecycle.acquire("job");

    expect(lifecycle.activeLeaseCount()).toBe(2);
    expect(lifecycle.activeLeaseCount("job")).toBe(1);
    releaseJob();
    expect(lifecycle.activeLeaseCount("job")).toBe(0);
    releaseMcp();
  });

  test("the shared command seam holds an HTTP job lease until async work settles", async () => {
    lifecycle = createRuntimeLifecycle({ idleMs: 1_000, onIdle: vi.fn() });
    let finish!: () => void;
    const operation = new Promise<void>((resolve) => { finish = resolve; });
    const unregister = registerRuntimeControl({ lifecycle, requestShutdown: vi.fn() });

    const running = withRuntimeJob(() => operation);
    expect(lifecycle.activeLeaseCount("job")).toBe(1);
    finish();
    await running;
    expect(lifecycle.activeLeaseCount("job")).toBe(0);
    unregister();
  });

  test("the shared command seam rejects new work after shutdown begins", async () => {
    lifecycle = createRuntimeLifecycle({ idleMs: 1_000, onIdle: vi.fn() });
    const operation = vi.fn(async () => "done");
    const unregister = registerRuntimeControl({
      lifecycle,
      requestShutdown: vi.fn(),
      acceptingJobs: () => false
    });

    await expect(withRuntimeJob(operation)).rejects.toThrow("shutting down");
    expect(operation).not.toHaveBeenCalled();
    unregister();
  });
});
