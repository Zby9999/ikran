// Runtime-owned prototype dev-server lifecycle (Issue 30).
//
// The Agent writes prototype code and declares the artifact; it never
// supervises a dev server. Runtime owns install → start → probe and reports an
// explicit readiness (installing / starting / ready / failed) instead of a
// vague "loading". Every terminal path is reachable: a failed install, an
// occupied port that is not a live preview, a process that dies, and a probe
// that never succeeds all end in `failed` rather than hanging.
//
// A ready surface stays live until its process exits; Runtime then marks the
// surface stale and stops there — it never auto-restarts (Issue 30 stale
// semantics mirror the Figma evidence stale warning).
//
// All host effects go through `PreviewSupervisorDeps` so unit tests exercise
// the state machine without spawning processes or binding ports.

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import path from "node:path";

export type PreviewReadiness =
  | "installing"
  | "starting"
  | "ready"
  | "failed";

/** First port Runtime hands to a prototype preview. */
export const PREVIEW_PORT_BASE = 4300;
export const PREVIEW_PORT_RANGE = 100;

/** Overall budget for one record_preview readiness attempt. */
export const PREVIEW_READY_TIMEOUT_MS = 90_000;
const PREVIEW_PROBE_INTERVAL_MS = 250;

/**
 * The Agent declares a dev command, but Runtime owns the shell — `devCommand`
 * is executed with `shell: true`, so an unconstrained string would be a raw
 * exec channel bypassing the semantic-tool boundary. Only package-manager
 * script invocations are allowed (`npm run dev`, `pnpm dev`, `yarn dev`,
 * `bun run dev`, `npx vite`); anything with shell metacharacters, pipes,
 * chaining, or redirection is rejected before it ever reaches spawn.
 */
const ALLOWED_DEV_COMMAND =
  /^(?:(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+[a-zA-Z0-9:_-]+|npx\s+(?:[a-zA-Z0-9:@/._-]+\s+)?[a-zA-Z0-9:@/._-]+)$/;

export function isAllowedDevCommand(command: string): boolean {
  return ALLOWED_DEV_COMMAND.test(command.trim());
}

export interface PreviewProcessHandle {
  /** Resolves with the exit description once the dev server process ends. */
  exited: Promise<{ code: number | null; signal: string | null }>;
  kill(): void;
}

export interface PreviewSupervisorDeps {
  /** True when the prototype root already has installed dependencies. */
  dependenciesInstalled(root: string): boolean;
  /** Blocking dependency install; resolves false when it fails. */
  installDependencies(root: string): Promise<boolean>;
  startDevServer(input: {
    root: string;
    command: string;
    port: number;
  }): PreviewProcessHandle;
  /** True when the URL answers with any HTTP response. */
  probeUrl(url: string): Promise<boolean>;
  isPortFree(port: number): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export type PreviewStartOutcome = {
  readiness: PreviewReadiness;
  reason: string | null;
};

/**
 * Every dev server this Runtime spawned and has not seen exit. The Runtime
 * process owns these children, so a clean shutdown sweeps the registry
 * (`killAllPreviewServers`) instead of leaving orphaned servers behind.
 */
const livePreviewHandles = new Set<PreviewProcessHandle>();

/**
 * Handles stopped by Runtime shutdown rather than by an unexpected process
 * exit. A WeakSet lets the later `exited` continuation distinguish those two
 * causes without retaining completed handles. Shutdown parking owns the
 * surface state; if that best-effort DB write failed, leaving the previous
 * live row untouched lets the next Runtime recover it as an unclean shutdown.
 */
const intentionallyStoppedPreviewHandles = new WeakSet<PreviewProcessHandle>();

/**
 * Kill every Runtime-owned preview dev server. Called on Runtime shutdown;
 * the surfaces are marked stale (`runtime_shutdown`) separately, and the next
 * launch restores them from their persisted run records.
 */
export function killAllPreviewServers(): void {
  for (const handle of livePreviewHandles) {
    try {
      intentionallyStoppedPreviewHandles.add(handle);
      handle.kill();
    } catch {
      // Process already gone — nothing to sweep.
    }
  }
  livePreviewHandles.clear();
}

export interface PreviewStartInput {
  root: string;
  command: string;
  port: number;
  url: string;
  timeoutMs?: number;
  /** Persist each readiness transition (surface row + lifecycle event). */
  onReadiness(readiness: PreviewReadiness, reason: string | null): void;
  /** Called once the ready dev server exits — surface becomes stale. */
  onExit(reason: string): void;
}

export function previewUrlForPort(port: number): string {
  return `http://127.0.0.1:${port}`;
}

/**
 * Drive one surface from install to ready. Returns the terminal readiness for
 * this attempt; `onReadiness` reports every intermediate transition so the
 * designer sees installing/starting rather than a blank wait.
 */
export async function startPreviewServer(
  input: PreviewStartInput,
  deps: PreviewSupervisorDeps = defaultPreviewSupervisorDeps
): Promise<PreviewStartOutcome> {
  const timeoutMs = input.timeoutMs ?? PREVIEW_READY_TIMEOUT_MS;
  const deadline = deps.now() + timeoutMs;

  if (!deps.dependenciesInstalled(input.root)) {
    input.onReadiness("installing", null);
    const installed = await deps.installDependencies(input.root);
    if (!installed) {
      input.onReadiness("failed", "install_failed");
      return { readiness: "failed", reason: "install_failed" };
    }
  }

  input.onReadiness("starting", null);

  // An occupied port is only usable when it already answers as this preview;
  // anything else is a conflict the designer must resolve, not a retry loop.
  if (!(await deps.isPortFree(input.port))) {
    if (await deps.probeUrl(input.url)) {
      input.onReadiness("ready", null);
      return { readiness: "ready", reason: null };
    }
    input.onReadiness("failed", "port_conflict");
    return { readiness: "failed", reason: "port_conflict" };
  }

  const handle = deps.startDevServer({
    root: input.root,
    command: input.command,
    port: input.port
  });
  livePreviewHandles.add(handle);

  let exitReason: string | null = null;
  void handle.exited.then(() => {
    livePreviewHandles.delete(handle);
    exitReason = exitReason ?? "dev_server_exited";
  });

  while (deps.now() < deadline) {
    if (exitReason) {
      input.onReadiness("failed", "dev_server_exited");
      return { readiness: "failed", reason: "dev_server_exited" };
    }
    if (await deps.probeUrl(input.url)) {
      input.onReadiness("ready", null);
      // No auto-restart: a later exit only marks the surface stale.
      void handle.exited.then(() => {
        if (!intentionallyStoppedPreviewHandles.has(handle)) {
          input.onExit("dev_server_exited");
        }
      });
      return { readiness: "ready", reason: null };
    }
    await deps.sleep(PREVIEW_PROBE_INTERVAL_MS);
  }

  handle.kill();
  livePreviewHandles.delete(handle);
  input.onReadiness("failed", "preview_timeout");
  return { readiness: "failed", reason: "preview_timeout" };
}

/**
 * First port not already claimed by another surface and free on the host.
 * Persisted on the surface row so the preview URL stays stable across runs.
 */
export async function allocatePreviewPort(
  takenPorts: readonly number[],
  deps: PreviewSupervisorDeps = defaultPreviewSupervisorDeps
): Promise<number | null> {
  const taken = new Set(takenPorts);
  for (let offset = 0; offset < PREVIEW_PORT_RANGE; offset++) {
    const port = PREVIEW_PORT_BASE + offset;
    if (taken.has(port)) continue;
    if (await deps.isPortFree(port)) return port;
  }
  return null;
}

function shellCommand(root: string, command: string, port: number) {
  return spawn(command, {
    cwd: root,
    shell: true,
    stdio: "ignore",
    env: { ...process.env, PORT: String(port) }
  });
}

export const defaultPreviewSupervisorDeps: PreviewSupervisorDeps = {
  dependenciesInstalled(root) {
    return existsSync(path.join(root, "node_modules"));
  },
  installDependencies(root) {
    return new Promise((resolve) => {
      const child = spawn("npm", ["install"], {
        cwd: root,
        shell: true,
        stdio: "ignore"
      });
      child.on("error", () => resolve(false));
      child.on("exit", (code) => resolve(code === 0));
    });
  },
  startDevServer({ root, command, port }) {
    const child = shellCommand(root, command, port);
    const exited = new Promise<{ code: number | null; signal: string | null }>(
      (resolve) => {
        child.on("error", () => resolve({ code: null, signal: null }));
        child.on("exit", (code, signal) => resolve({ code, signal }));
      }
    );
    return {
      exited,
      kill() {
        try {
          child.kill();
        } catch {
          // Process already gone — nothing to supervise.
        }
      }
    };
  },
  async probeUrl(url) {
    try {
      const response = await fetch(url, { method: "GET" });
      return response.status > 0;
    } catch {
      return false;
    }
  },
  isPortFree(port) {
    return new Promise((resolve) => {
      const server = createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => {
        server.close(() => resolve(true));
      });
      server.listen(port, "127.0.0.1");
    });
  },
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },
  now() {
    return Date.now();
  }
};
