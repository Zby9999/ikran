// Runtime-owned Prototype Surface screenshot refresh (Issue 30).
//
// After `record_preview` establishes a mapping, Runtime watches the prototype
// tree, waits for writes to settle, and recaptures full-page PNGs. The Agent
// does not re-call a tool, and the Workbench does not need to stay open: the
// existing SSE `prototype` event plus `screenshot_captured_at` cache-bust is
// the update channel. Dev-server death still marks surfaces stale; this
// module never auto-restarts a process or installs dependencies.

import { watch as watchDirectory } from "node:fs";
import path from "node:path";

export const PROTOTYPE_PREVIEW_REFRESH_DEBOUNCE_MS = 1_000;

export const PROTOTYPE_PREVIEW_IGNORED_DIRECTORY_NAMES = [
  ".git",
  ".ikran",
  ".next",
  "node_modules",
  "dist",
  "build",
  "coverage"
] as const;

const IGNORED_DIRECTORY_SET = new Set<string>(
  PROTOTYPE_PREVIEW_IGNORED_DIRECTORY_NAMES
);

export type PrototypePreviewCaptureTarget = {
  id: string;
  surface_url: string;
  generation: number;
};

export type PrototypePreviewCaptureResult =
  | { ok: true; artifact_path: string }
  | { ok: false; reason: string };

export type PrototypePreviewRefreshHost = {
  watch(
    root: string,
    onEvent: (filename: string | null) => void
  ): { close(): void };
  scheduleDebounce(callback: () => void, ms: number): { cancel(): void };
  probeUrl(url: string): Promise<boolean>;
  fetchStatus(
    url: string
  ): Promise<{ ok: true; status: number } | { ok: false }>;
  bumpGeneration(
    projectPath: string,
    prototypeRoot: string
  ): PrototypePreviewCaptureTarget[];
  bumpGenerationForIds(
    projectPath: string,
    surfaceIds: readonly string[]
  ): PrototypePreviewCaptureTarget[];
  listSurfaceUrls(
    projectPath: string,
    surfaceIds: readonly string[]
  ): Array<{ id: string; surface_url: string }>;
  capture(
    projectPath: string,
    target: PrototypePreviewCaptureTarget
  ): Promise<PrototypePreviewCaptureResult>;
  markStale(projectPath: string, surfaceId: string, reason: string): void;
  logFailure(
    projectPath: string,
    surfaceId: string,
    previewUrl: string,
    reason: string
  ): void;
};

type RefreshSession = {
  key: string;
  projectPath: string;
  prototypeRoot: string;
  watchRoot: string;
  host: PrototypePreviewRefreshHost;
  watcher: { close(): void } | null;
  debounce: { cancel(): void } | null;
  surfaceIds: Set<string>;
  running: boolean;
  pending: PrototypePreviewCaptureTarget[] | null;
  closed: boolean;
};

const sessions = new Map<string, RefreshSession>();

let testHost: Partial<PrototypePreviewRefreshHost> | null = null;

/** Replace host effects in unit tests. Pass `null` to restore defaults. */
export function setPrototypePreviewRefreshTestHost(
  host: Partial<PrototypePreviewRefreshHost> | null
): void {
  testHost = host;
}

export function prototypePreviewRefreshSessionKey(
  projectPath: string,
  prototypeRoot: string
): string {
  return `${path.resolve(projectPath)}::${normalizeRoot(prototypeRoot)}`;
}

function normalizeRoot(prototypeRoot: string): string {
  return prototypeRoot.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function posixRelative(relativePath: string): string {
  return relativePath.replace(/\\/g, "/");
}

export function shouldIgnorePrototypePreviewPath(relativePath: string): boolean {
  const normalized = posixRelative(relativePath).replace(/^\/+/, "");
  if (normalized.length === 0) return false;
  const parts = normalized.split("/");
  if (parts.some((part) => IGNORED_DIRECTORY_SET.has(part))) return true;
  const base = parts[parts.length - 1] ?? "";
  if (base === ".DS_Store" || base.startsWith(".#")) return true;
  if (base.endsWith("~")) return true;
  if (/\.(tmp|swp|swx|bak)$/i.test(base)) return true;
  return false;
}

export function artifactBelongsToPrototypeRoot(
  relativeArtifactPath: string,
  prototypeRoot: string
): boolean {
  const artifact = posixRelative(relativeArtifactPath);
  const root = normalizeRoot(prototypeRoot);
  if (root.length === 0) return true;
  return artifact === root || artifact.startsWith(`${root}/`);
}

function defaultWatch(
  root: string,
  onEvent: (filename: string | null) => void
): { close(): void } {
  let watcher: ReturnType<typeof watchDirectory>;
  try {
    watcher = watchDirectory(root, { recursive: true }, (_event, filename) => {
      onEvent(filename == null ? null : String(filename));
    });
  } catch {
    return { close() {} };
  }
  watcher.on("error", () => {
    // Directory removal during shutdown is expected; never throw from watch.
  });
  return {
    close() {
      try {
        watcher.close();
      } catch {
        // Already closed.
      }
    }
  };
}

function defaultScheduleDebounce(
  callback: () => void,
  ms: number
): { cancel(): void } {
  const timer = setTimeout(callback, ms);
  return {
    cancel() {
      clearTimeout(timer);
    }
  };
}

async function defaultProbeUrl(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(5_000)
    });
    await response.arrayBuffer().catch(() => undefined);
    return response.status > 0;
  } catch {
    return false;
  }
}

async function defaultFetchStatus(
  url: string
): Promise<{ ok: true; status: number } | { ok: false }> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5_000),
      redirect: "follow"
    });
    await response.arrayBuffer().catch(() => undefined);
    return { ok: true, status: response.status };
  } catch {
    return { ok: false };
  }
}

async function defaultCapture(
  projectPath: string,
  target: PrototypePreviewCaptureTarget
): Promise<PrototypePreviewCaptureResult> {
  const { capturePrototypeSurfaceScreenshot } = await import(
    "./prototype-screenshot"
  );
  return capturePrototypeSurfaceScreenshot(
    projectPath,
    target.id,
    target.surface_url,
    undefined,
    { expectedGeneration: target.generation }
  );
}

const defaultHost: PrototypePreviewRefreshHost = {
  watch: defaultWatch,
  scheduleDebounce: defaultScheduleDebounce,
  probeUrl: defaultProbeUrl,
  fetchStatus: defaultFetchStatus,
  // DB callbacks are wired by prototype-surface when a watcher starts, so the
  // coordinator never statically imports that module (cycle with screenshot).
  bumpGeneration: () => [],
  bumpGenerationForIds: () => [],
  listSurfaceUrls: () => [],
  capture: defaultCapture,
  markStale: () => {},
  logFailure: () => {}
};

function resolveHost(
  overrides?: Partial<PrototypePreviewRefreshHost>
): PrototypePreviewRefreshHost {
  return {
    ...defaultHost,
    ...testHost,
    ...overrides
  };
}

export function isPrototypePreviewRefreshActive(
  projectPath: string,
  relativeArtifactPath: string
): boolean {
  const resolved = path.resolve(projectPath);
  for (const session of sessions.values()) {
    if (session.closed) continue;
    if (path.resolve(session.projectPath) !== resolved) continue;
    if (artifactBelongsToPrototypeRoot(relativeArtifactPath, session.prototypeRoot)) {
      return true;
    }
  }
  return false;
}

export function startPrototypePreviewRefresh(input: {
  projectPath: string;
  prototypeRoot: string;
  surfaceId: string;
  host?: Partial<PrototypePreviewRefreshHost>;
}): void {
  const prototypeRoot = normalizeRoot(input.prototypeRoot);
  const key = prototypePreviewRefreshSessionKey(input.projectPath, prototypeRoot);
  const existing = sessions.get(key);
  if (existing && !existing.closed) {
    existing.surfaceIds.add(input.surfaceId);
    if (input.host) existing.host = resolveHost(input.host);
    return;
  }

  const host = resolveHost(input.host);
  const watchRoot = path.join(path.resolve(input.projectPath), prototypeRoot);
  const session: RefreshSession = {
    key,
    projectPath: path.resolve(input.projectPath),
    prototypeRoot,
    watchRoot,
    host,
    watcher: null,
    debounce: null,
    surfaceIds: new Set([input.surfaceId]),
    running: false,
    pending: null,
    closed: false
  };
  session.watcher = host.watch(watchRoot, (filename) => {
    onWatchEvent(session, filename);
  });
  sessions.set(key, session);
}

function onWatchEvent(session: RefreshSession, filename: string | null): void {
  if (session.closed) return;
  if (filename !== null && shouldIgnorePrototypePreviewPath(filename)) return;
  session.debounce?.cancel();
  session.debounce = session.host.scheduleDebounce(() => {
    session.debounce = null;
    if (session.closed) return;
    const targets = session.host.bumpGeneration(
      session.projectPath,
      session.prototypeRoot
    );
    enqueue(session, targets);
  }, PROTOTYPE_PREVIEW_REFRESH_DEBOUNCE_MS);
}

function enqueue(
  session: RefreshSession,
  targets: PrototypePreviewCaptureTarget[]
): void {
  if (session.closed || targets.length === 0) return;
  session.pending = targets;
  void pump(session);
}

async function pump(session: RefreshSession): Promise<void> {
  if (session.running) return;
  session.running = true;
  try {
    while (session.pending && !session.closed) {
      const work = session.pending;
      session.pending = null;
      for (const target of work) {
        if (session.closed || session.pending) break;
        const preflight = await session.host.fetchStatus(target.surface_url);
          if (!preflight.ok || preflight.status >= 400) {
          session.host.logFailure(
            session.projectPath,
            target.id,
            target.surface_url,
            preflight.ok ? `http_${preflight.status}` : "preview_unreachable"
          );
          continue;
        }
        const result = await session.host.capture(session.projectPath, target);
        if (!result.ok && result.reason !== "generation_mismatch") {
          session.host.logFailure(
            session.projectPath,
            target.id,
            target.surface_url,
            result.reason
          );
        }
      }
    }
  } finally {
    session.running = false;
  }
  if (session.pending && !session.closed) {
    await pump(session);
  }
}

/**
 * After a code/prototype artifact declaration: if an active watcher covers the
 * path, probe the live preview. Reachable surfaces bump a generation and queue
 * a screenshot; unreachable surfaces keep the existing `code_changed` stale
 * semantics. Compile 5xx is still reachable — skip this capture, keep the last
 * bitmap, and wait for the next write.
 */
export function refreshCoveredPrototypeSurfacesAfterArtifact(
  projectPath: string,
  surfaceIds: readonly string[]
): Promise<void> {
  if (surfaceIds.length === 0) return Promise.resolve();
  return refreshCoveredPrototypeSurfacesAfterArtifactAsync(
    projectPath,
    surfaceIds
  );
}

async function refreshCoveredPrototypeSurfacesAfterArtifactAsync(
  projectPath: string,
  surfaceIds: readonly string[]
): Promise<void> {
  const resolved = path.resolve(projectPath);
  const grouped = new Map<string, RefreshSession>();
  for (const session of sessions.values()) {
    if (session.closed) continue;
    if (path.resolve(session.projectPath) !== resolved) continue;
    grouped.set(session.key, session);
  }
  if (grouped.size === 0) return;

  for (const session of grouped.values()) {
    const owned = surfaceIds.filter((id) => session.surfaceIds.has(id));
    if (owned.length === 0) continue;
    const listed = session.host.listSurfaceUrls(session.projectPath, owned);
    const reachable: string[] = [];
    for (const surface of listed) {
      if (await session.host.probeUrl(surface.surface_url)) {
        reachable.push(surface.id);
      } else {
        session.host.markStale(session.projectPath, surface.id, "code_changed");
      }
    }
    if (reachable.length === 0) continue;
    enqueue(
      session,
      session.host.bumpGenerationForIds(session.projectPath, reachable)
    );
  }
}

export function stopPrototypePreviewRefresh(input: {
  projectPath: string;
  prototypeRoot: string;
  surfaceId?: string;
}): void {
  const key = prototypePreviewRefreshSessionKey(
    input.projectPath,
    input.prototypeRoot
  );
  const session = sessions.get(key);
  if (!session || session.closed) return;
  if (input.surfaceId) {
    session.surfaceIds.delete(input.surfaceId);
    if (session.surfaceIds.size > 0) return;
  }
  closeSession(session);
}

export function stopAllPrototypePreviewRefresh(): void {
  for (const session of [...sessions.values()]) {
    closeSession(session);
  }
}

function closeSession(session: RefreshSession): void {
  if (session.closed) return;
  session.closed = true;
  session.pending = null;
  session.debounce?.cancel();
  session.debounce = null;
  try {
    session.watcher?.close();
  } catch {
    // Watcher already gone.
  }
  session.watcher = null;
  sessions.delete(session.key);
}

/** Test helper: active session count after start/stop. */
export function prototypePreviewRefreshSessionCountForTests(): number {
  return sessions.size;
}

/** Drain in-flight capture pumps so unit tests can assert settled results. */
export async function waitForPrototypePreviewRefreshIdleForTests(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const busy = [...sessions.values()].some(
      (session) => session.running || session.pending !== null
    );
    if (!busy) return;
    await Promise.resolve();
  }
}
