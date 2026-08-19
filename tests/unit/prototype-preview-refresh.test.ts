// Runtime-owned Prototype screenshot refresh coordinator.
// Watcher, debounce, ignore rules, latest-wins queue, and shutdown are all
// injected — these tests never open a real filesystem watcher or Chromium.

import { afterEach, expect, test } from "vitest";

import {
  artifactBelongsToPrototypeRoot,
  isPrototypePreviewRefreshActive,
  prototypePreviewRefreshSessionCountForTests,
  refreshCoveredPrototypeSurfacesAfterArtifact,
  setPrototypePreviewRefreshTestHost,
  shouldIgnorePrototypePreviewPath,
  startPrototypePreviewRefresh,
  stopAllPrototypePreviewRefresh,
  stopPrototypePreviewRefresh,
  waitForPrototypePreviewRefreshIdleForTests,
  type PrototypePreviewCaptureTarget,
  type PrototypePreviewRefreshHost
} from "../../lib/runtime/prototype-preview-refresh";

afterEach(() => {
  stopAllPrototypePreviewRefresh();
  setPrototypePreviewRefreshTestHost(null);
});

type Harness = {
  events: string[];
  bumps: number;
  captures: PrototypePreviewCaptureTarget[];
  failures: Array<{ surfaceId: string; reason: string }>;
  stale: Array<{ surfaceId: string; reason: string }>;
  flushDebounce: () => void;
  emitWatch: (filename: string | null) => void;
  resolveCapture: (result: { ok: true; artifact_path: string } | { ok: false; reason: string }) => void;
  host: Partial<PrototypePreviewRefreshHost>;
};

function harness(options?: {
  probeUrl?: () => Promise<boolean>;
  fetchStatus?: PrototypePreviewRefreshHost["fetchStatus"];
  hangCapture?: boolean;
}): Harness {
  const listeners: Array<(filename: string | null) => void> = [];
  let debounce: (() => void) | null = null;
  let captureWait:
    | ((
        result:
          | { ok: true; artifact_path: string }
          | { ok: false; reason: string }
      ) => void)
    | null = null;
  const state: Harness = {
    events: [],
    bumps: 0,
    captures: [],
    failures: [],
    stale: [],
    flushDebounce() {
      const pending = debounce;
      debounce = null;
      pending?.();
    },
    emitWatch(filename) {
      for (const listener of listeners) listener(filename);
    },
    resolveCapture(result) {
      captureWait?.(result);
      captureWait = null;
    },
    host: {}
  };

  let generation = 0;
  const surfaces = new Map<string, { id: string; surface_url: string }>([
    ["surface-a", { id: "surface-a", surface_url: "http://127.0.0.1:4300/" }]
  ]);

  state.host = {
    watch(_root, onEvent) {
      listeners.push(onEvent);
      return {
        close() {
          state.events.push("watch-close");
        }
      };
    },
    scheduleDebounce(callback) {
      debounce = callback;
      return {
        cancel() {
          if (debounce === callback) debounce = null;
        }
      };
    },
    probeUrl: options?.probeUrl ?? (async () => true),
    fetchStatus:
      options?.fetchStatus ??
      (async () => ({ ok: true as const, status: 200 })),
    bumpGeneration() {
      state.bumps += 1;
      generation += 1;
      return [...surfaces.values()].map((surface) => ({
        ...surface,
        generation
      }));
    },
    bumpGenerationForIds(_projectPath, surfaceIds) {
      state.bumps += 1;
      generation += 1;
      return surfaceIds.map((id) => ({
        id,
        surface_url: surfaces.get(id)?.surface_url ?? "http://127.0.0.1:4300/",
        generation
      }));
    },
    listSurfaceUrls(_projectPath, surfaceIds) {
      return surfaceIds.map((id) => ({
        id,
        surface_url: surfaces.get(id)?.surface_url ?? "http://127.0.0.1:4300/"
      }));
    },
    async capture(_projectPath, target) {
      state.captures.push(target);
      if (options?.hangCapture && state.captures.length === 1) {
        return await new Promise((resolve) => {
          captureWait = resolve;
        });
      }
      return { ok: true, artifact_path: `.ikran/artifacts/${target.id}.png` };
    },
    markStale(_projectPath, surfaceId, reason) {
      state.stale.push({ surfaceId, reason });
    },
    logFailure(_projectPath, surfaceId, _previewUrl, reason) {
      state.failures.push({ surfaceId, reason });
    }
  };
  return state;
}

test("ignore rules skip git, ikran, framework, and temp paths", () => {
  expect(shouldIgnorePrototypePreviewPath(".git/HEAD")).toBe(true);
  expect(shouldIgnorePrototypePreviewPath(".ikran/artifacts/x.png")).toBe(true);
  expect(shouldIgnorePrototypePreviewPath("app/.next/cache")).toBe(true);
  expect(shouldIgnorePrototypePreviewPath("node_modules/react/index.js")).toBe(
    true
  );
  expect(shouldIgnorePrototypePreviewPath("dist/index.js")).toBe(true);
  expect(shouldIgnorePrototypePreviewPath("coverage/lcov.info")).toBe(true);
  expect(shouldIgnorePrototypePreviewPath("page.tsx.tmp")).toBe(true);
  expect(shouldIgnorePrototypePreviewPath("page.tsx.swp")).toBe(true);
  expect(shouldIgnorePrototypePreviewPath("page.tsx~")).toBe(true);
  expect(shouldIgnorePrototypePreviewPath("src/page.tsx")).toBe(false);
  expect(
    artifactBelongsToPrototypeRoot("prototype/page.tsx", "prototype")
  ).toBe(true);
  expect(artifactBelongsToPrototypeRoot("scripts/build.ts", "prototype")).toBe(
    false
  );
});

test("a save burst collapses to one generation bump and one capture", async () => {
  const h = harness();
  startPrototypePreviewRefresh({
    projectPath: "/tmp/refresh-a",
    prototypeRoot: "prototype",
    surfaceId: "surface-a",
    host: h.host
  });
  h.emitWatch("src/page.tsx");
  h.emitWatch("src/page.tsx");
  h.emitWatch("src/page.css");
  expect(h.bumps).toBe(0);
  h.flushDebounce();
  await waitForPrototypePreviewRefreshIdleForTests();
  expect(h.bumps).toBe(1);
  expect(h.captures).toHaveLength(1);
  expect(h.captures[0]?.generation).toBe(1);
});

test("ignored writes never enqueue a capture", async () => {
  const h = harness();
  startPrototypePreviewRefresh({
    projectPath: "/tmp/refresh-ignore",
    prototypeRoot: "prototype",
    surfaceId: "surface-a",
    host: h.host
  });
  h.emitWatch(".next/cache");
  h.emitWatch("node_modules/left-pad/index.js");
  h.flushDebounce();
  expect(h.bumps).toBe(0);
  expect(h.captures).toEqual([]);
});

test("two surfaces on one root share a watcher and capture serially", async () => {
  const h = harness();
  h.host.bumpGeneration = () => {
    h.bumps += 1;
    return [
      { id: "surface-a", surface_url: "http://127.0.0.1:4300/", generation: 1 },
      { id: "surface-b", surface_url: "http://127.0.0.1:4300/about", generation: 1 }
    ];
  };
  startPrototypePreviewRefresh({
    projectPath: "/tmp/refresh-multi",
    prototypeRoot: "prototype",
    surfaceId: "surface-a",
    host: h.host
  });
  startPrototypePreviewRefresh({
    projectPath: "/tmp/refresh-multi",
    prototypeRoot: "prototype",
    surfaceId: "surface-b",
    host: h.host
  });
  expect(prototypePreviewRefreshSessionCountForTests()).toBe(1);
  h.emitWatch("src/page.tsx");
  h.flushDebounce();
  await waitForPrototypePreviewRefreshIdleForTests();
  expect(h.captures.map((item) => item.id)).toEqual(["surface-a", "surface-b"]);
});

test("latest-wins drops not-yet-started work and CAS-skips the in-flight capture", async () => {
  const h = harness({ hangCapture: true });
  startPrototypePreviewRefresh({
    projectPath: "/tmp/refresh-latest",
    prototypeRoot: "prototype",
    surfaceId: "surface-a",
    host: h.host
  });
  h.emitWatch("one.tsx");
  h.flushDebounce();
  await Promise.resolve();
  expect(h.captures).toHaveLength(1);

  h.emitWatch("two.tsx");
  h.flushDebounce();
  h.resolveCapture({ ok: false, reason: "generation_mismatch" });
  await waitForPrototypePreviewRefreshIdleForTests();
  expect(h.captures).toHaveLength(2);
  expect(h.captures[1]?.generation).toBe(2);
  expect(h.failures).toEqual([]);
});

test("a failed capture keeps going without throwing and logs a diagnostic", async () => {
  const h = harness();
  h.host.capture = async () => ({ ok: false, reason: "capture_failed" });
  startPrototypePreviewRefresh({
    projectPath: "/tmp/refresh-fail",
    prototypeRoot: "prototype",
    surfaceId: "surface-a",
    host: h.host
  });
  h.emitWatch("src/page.tsx");
  h.flushDebounce();
  await waitForPrototypePreviewRefreshIdleForTests();
  expect(h.failures).toEqual([
    { surfaceId: "surface-a", reason: "capture_failed" }
  ]);
});

test("HTTP 500 during refresh logs and does not mark the surface stale", async () => {
  const h = harness({
    fetchStatus: async () => ({ ok: true, status: 500 })
  });
  startPrototypePreviewRefresh({
    projectPath: "/tmp/refresh-500",
    prototypeRoot: "prototype",
    surfaceId: "surface-a",
    host: h.host
  });
  h.emitWatch("src/page.tsx");
  h.flushDebounce();
  await waitForPrototypePreviewRefreshIdleForTests();
  expect(h.captures).toEqual([]);
  expect(h.stale).toEqual([]);
  expect(h.failures).toEqual([
    { surfaceId: "surface-a", reason: "http_500" }
  ]);
});

test("artifact declaration with a live watcher queues a refresh instead of stale", async () => {
  const h = harness();
  startPrototypePreviewRefresh({
    projectPath: "/tmp/refresh-artifact",
    prototypeRoot: "prototype",
    surfaceId: "surface-a",
    host: h.host
  });
  expect(
    isPrototypePreviewRefreshActive(
      "/tmp/refresh-artifact",
      "prototype/page.tsx"
    )
  ).toBe(true);
  await refreshCoveredPrototypeSurfacesAfterArtifact("/tmp/refresh-artifact", [
    "surface-a"
  ]);
  await waitForPrototypePreviewRefreshIdleForTests();
  expect(h.stale).toEqual([]);
  expect(h.captures).toHaveLength(1);
});

test("artifact declaration marks stale when the preview is unreachable", async () => {
  const h = harness({ probeUrl: async () => false });
  startPrototypePreviewRefresh({
    projectPath: "/tmp/refresh-down",
    prototypeRoot: "prototype",
    surfaceId: "surface-a",
    host: h.host
  });
  await refreshCoveredPrototypeSurfacesAfterArtifact("/tmp/refresh-down", [
    "surface-a"
  ]);
  await waitForPrototypePreviewRefreshIdleForTests();
  expect(h.stale).toEqual([
    { surfaceId: "surface-a", reason: "code_changed" }
  ]);
  expect(h.captures).toEqual([]);
});

test("shutdown closes the watcher and drops queued work", () => {
  const h = harness();
  startPrototypePreviewRefresh({
    projectPath: "/tmp/refresh-stop",
    prototypeRoot: "prototype",
    surfaceId: "surface-a",
    host: h.host
  });
  h.emitWatch("src/page.tsx");
  stopAllPrototypePreviewRefresh();
  expect(h.events).toEqual(["watch-close"]);
  expect(prototypePreviewRefreshSessionCountForTests()).toBe(0);
  h.flushDebounce();
  expect(h.bumps).toBe(0);
});

test("restore re-registers a watcher for a persisted ready surface", () => {
  const first = harness();
  startPrototypePreviewRefresh({
    projectPath: "/tmp/refresh-restore",
    prototypeRoot: "prototype",
    surfaceId: "surface-a",
    host: first.host
  });
  stopPrototypePreviewRefresh({
    projectPath: "/tmp/refresh-restore",
    prototypeRoot: "prototype",
    surfaceId: "surface-a"
  });
  expect(prototypePreviewRefreshSessionCountForTests()).toBe(0);

  const second = harness();
  startPrototypePreviewRefresh({
    projectPath: "/tmp/refresh-restore",
    prototypeRoot: "prototype",
    surfaceId: "surface-a",
    host: second.host
  });
  expect(prototypePreviewRefreshSessionCountForTests()).toBe(1);
  second.emitWatch("src/page.tsx");
  second.flushDebounce();
  expect(second.bumps).toBe(1);
});
