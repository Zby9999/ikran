import { describe, expect, test, vi } from "vitest";
import type { DesignSystemView } from "@/lib/runtime/design-system-view";
import { createDesignSystemViewClient } from "@/components/workbench/design-system-view-client";

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

function designSystemView(name: string): DesignSystemView {
  return {
    generated_at: "2026-08-10T00:00:00.000Z",
    name,
    foundations: { visualLanguage: null, concepts: [] },
    tokens: { primitive: [], semantic: [], component: [] },
    layout: [],
    interaction: [],
    components: { inventory: [], specs: [] }
  };
}

function viewResponse(view: DesignSystemView): Response {
  return new Response(JSON.stringify({ ok: true, view }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

describe("Design System view client", () => {
  test("an out-of-order older GET cannot replace the latest view", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const applied: string[] = [];
    const errors: string[] = [];
    const client = createDesignSystemViewClient("session", {
      fetcher,
      onView: (view) => applied.push(view.name),
      onError: (error) => errors.push(error)
    });

    const olderLoad = client.load();
    const latestLoad = client.load();
    second.resolve(viewResponse(designSystemView("latest")));
    await expect(latestLoad).resolves.toMatchObject({ ok: true });
    first.resolve(viewResponse(designSystemView("stale")));
    await expect(olderLoad).resolves.toEqual({ ok: false, superseded: true });

    expect(applied).toEqual(["latest"]);
    expect(errors).toEqual([]);
  });

  test("an optimistic mutation invalidates every GET already in flight", async () => {
    const response = deferred<Response>();
    const onView = vi.fn();
    const onError = vi.fn();
    const client = createDesignSystemViewClient("session", {
      fetcher: () => response.promise,
      onView,
      onError
    });

    const staleLoad = client.load();
    client.invalidate();
    response.resolve(viewResponse(designSystemView("before mutation")));

    await expect(staleLoad).resolves.toEqual({
      ok: false,
      superseded: true
    });
    expect(onView).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  test("a pre-commit SSE GET cannot replace optimistic mutation state", async () => {
    const crossingCommit = deferred<Response>();
    const postCommit = deferred<Response>();
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(crossingCommit.promise)
      .mockReturnValueOnce(postCommit.promise);
    const applied: string[] = [];
    const client = createDesignSystemViewClient("session", {
      fetcher,
      onView: (view) => applied.push(view.name),
      onError: vi.fn()
    });

    // Models the previous mutation's reload already running when the next
    // optimistic mutation begins.
    const crossingCommitLoad = client.load();
    const mutation = client.beginMutation();
    let ready = false;
    void mutation.ready.then(() => {
      ready = true;
    });
    await Promise.resolve();
    expect(ready).toBe(false);

    crossingCommit.resolve(viewResponse(designSystemView("crossing-commit")));
    await expect(crossingCommitLoad).resolves.toEqual({
      ok: false,
      superseded: true
    });
    await mutation.ready;
    expect(ready).toBe(true);
    expect(applied).toEqual([]);

    // A delayed SSE arriving during the POST is held without starting a GET.
    await expect(client.load()).resolves.toEqual({
      ok: false,
      superseded: true
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    mutation.finish();
    const authoritativeLoad = client.load();
    postCommit.resolve(viewResponse(designSystemView("post-commit")));
    await expect(authoritativeLoad).resolves.toMatchObject({ ok: true });
    expect(applied).toEqual(["post-commit"]);
  });
});
