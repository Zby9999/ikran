import type { DesignSystemView } from "@/lib/runtime/design-system-view";

type DesignSystemViewPayload = {
  ok?: boolean;
  view?: DesignSystemView;
  error?: string;
};

export type DesignSystemViewLoadResult =
  | { ok: true; view: DesignSystemView }
  | { ok: false; error: string }
  | { ok: false; superseded: true }
  | { ok: false; disposed: true };

export type DesignSystemViewFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

/**
 * Latest-request-wins reader for the Design System Browser.
 *
 * A load may be overtaken either by another load (open/SSE/post-mutation) or
 * by an optimistic local mutation. Superseded responses are observed by their
 * callers but never applied to React state, so an old GET cannot roll back a
 * newer candidate/formalized status.
 */
export function createDesignSystemViewClient(
  session: string,
  options: {
    fetcher?: DesignSystemViewFetcher;
    onView: (view: DesignSystemView) => void;
    onError: (error: string) => void;
  }
) {
  const fetcher = options.fetcher ?? fetch;
  let active = true;
  let generation = 0;
  let mutationsInFlight = 0;
  const loadsInFlight = new Set<Promise<DesignSystemViewLoadResult>>();

  const staleResult = (
    requestGeneration: number
  ): { ok: false; superseded: true } | { ok: false; disposed: true } | null => {
    if (!active) return { ok: false, disposed: true };
    if (requestGeneration !== generation) {
      return { ok: false, superseded: true };
    }
    // An SSE from a previous commit can arrive after the next optimistic
    // mutation starts. Its pre-commit snapshot must not replace local state.
    if (mutationsInFlight > 0) return { ok: false, superseded: true };
    return null;
  };

  const load = (): Promise<DesignSystemViewLoadResult> => {
    if (!active) return Promise.resolve({ ok: false, disposed: true });
    // GET performs lazy source→DB sync on the Runtime. Do not merely ignore
    // its response during a mutation: starting it could race the POST's
    // source/DB consistency checks and make a valid status switch fail.
    if (mutationsInFlight > 0) {
      return Promise.resolve({ ok: false, superseded: true });
    }
    const requestGeneration = ++generation;
    const request = (async (): Promise<DesignSystemViewLoadResult> => {
      try {
        const response = await fetcher("/api/design-system", {
          cache: "no-store",
          headers: { "x-ikran-session": session }
        });
        const data = (await response
          .json()
          .catch(() => ({}))) as DesignSystemViewPayload;
        const stale = staleResult(requestGeneration);
        if (stale) return stale;

        if (response.ok && data.ok === true && data.view) {
          options.onView(data.view);
          return { ok: true, view: data.view };
        }

        const error = data.error ?? "load_failed";
        options.onError(error);
        return { ok: false, error };
      } catch {
        const stale = staleResult(requestGeneration);
        if (stale) return stale;
        options.onError("network");
        return { ok: false, error: "network" };
      }
    })();

    loadsInFlight.add(request);
    void request.then(
      () => loadsInFlight.delete(request),
      () => loadsInFlight.delete(request)
    );
    return request;
  };

  return {
    load,
    /**
     * Hold authoritative reads for the lifetime of an optimistic mutation.
     * `ready` settles after earlier GET handlers have completed, so the POST
     * never overlaps their Runtime-side lazy sync. The release is idempotent.
     */
    beginMutation() {
      if (!active) {
        return { ready: Promise.resolve(), finish() {} };
      }
      mutationsInFlight += 1;
      generation += 1;
      const ready = Promise.allSettled([...loadsInFlight]).then(() => undefined);
      let ended = false;
      return {
        ready,
        finish() {
          if (ended) return;
          ended = true;
          mutationsInFlight = Math.max(0, mutationsInFlight - 1);
          generation += 1;
        }
      };
    },
    /** Supersede in-flight reads before applying an optimistic local write. */
    invalidate() {
      generation += 1;
    },
    dispose() {
      active = false;
      generation += 1;
    }
  };
}
