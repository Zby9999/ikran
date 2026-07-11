// Type declarations for lib/runtime/runtime-endpoint.mjs so TypeScript tests
// can import its real implementations (e.g. composeWorkbenchUrl) instead of
// local copies. The .mjs is plain JS (allowJs:false ignores it at typecheck);
// this .d.mts mirrors its exports. Keep in sync with the .mjs.
//
// Task 9: in-process HTTP host + owner-mode discovery (no Next child spawn).

export function isLocalhostHost(host: string): boolean;

/** Pick a free TCP port on 127.0.0.1 by listening on port 0 and closing. */
export function pickFreePort(): Promise<number>;

/** Compose the canonical Workbench URL `http://{host}:{port}/?session={token}`. */
export function composeWorkbenchUrl(
  host: string,
  port: number,
  token: string
): string;

/** Path of the user-only reuse state file inside `stateDir`. */
export function endpointFilePath(stateDir: string): string;

export type RuntimeOwner = "mcp" | "standalone";

export interface RuntimeEndpoint {
  host: string;
  port: number;
  token: string;
  pid: number;
  owner?: RuntimeOwner | string;
  startedAt: string;
}

/** Read the reuse state; returns null if missing or corrupt. */
export function readRuntimeEndpoint(stateDir: string): RuntimeEndpoint | null;

/** Write the reuse state with user-only permissions (mode 0o600). */
export function writeRuntimeEndpoint(
  stateDir: string,
  info: {
    host: string;
    port: number;
    token: string;
    pid: number;
    owner: RuntimeOwner;
    startedAt?: string;
  }
): RuntimeEndpoint;

/** Remove the reuse state file (best-effort). */
export function removeRuntimeEndpoint(stateDir: string): void;

/** Path of the cross-process first-start lock file inside `stateDir`. */
export function startLockPath(stateDir: string): string;

/**
 * Atomically claim the start lock. Returns a random owner id on success, or
 * null if another holder already owns the lock.
 */
export function tryAcquireStartLock(stateDir: string): string | null;

/**
 * Release the start lock only when `ownerId` still matches the on-disk lock
 * (compare-and-delete; avoids ABA deletion of a newer holder's lock).
 */
export function releaseStartLock(stateDir: string, ownerId: string): void;

/**
 * Serialize discover → start → write across processes for one stateDir.
 * Used by `openWorkbench` first-start claim; exported for tests.
 */
export function withRuntimeStartLock<T>(
  stateDir: string,
  fn: () => Promise<T> | T,
  opts?: { timeoutMs?: number; pollMs?: number }
): Promise<T>;

/**
 * Probe whether a Runtime recorded in the reuse state is still alive AND still
 * answers with the same startup token (GET /api/health → 200 + service string).
 */
export function probeRuntimeAlive(
  host: string,
  port: number,
  token: string,
  timeoutMs?: number
): Promise<boolean>;

/** Poll the public HTML shell (`/`) until 2xx. Rejects on timeout. */
export function waitForReady(
  host: string,
  port: number,
  timeoutMs: number
): Promise<void>;

export interface OpenWorkbenchOptions {
  stateDir: string;
  host: string;
  prod: boolean;
  cwd: string;
  nextDistDir?: string;
  extraEnv?: Record<string, string>;
  timeoutMs?: number;
  /** Optional explicit port (--port / IKRAN_PORT). When set, a live endpoint on
   * a different port is treated as a conflict instead of being reused. */
  port?: number;
  /** Who is requesting the surface. MCP fails closed on live standalone. */
  owner: RuntimeOwner;
}

export interface OpenWorkbenchResult {
  url: string;
  host: string;
  port: number;
  token: string;
  pid: number;
  /** true if THIS call started HTTP in-process; false if reused. */
  spawned: boolean;
  /** true if caller owns lifecycle (close HTTP + clear endpoint on exit). */
  owned: boolean;
  close: (() => Promise<void>) | null;
  /** Always null after Task 9 (no Next child). Kept for call-site compat. */
  child: null;
}

/**
 * Reuse-or-start the local Ikran Runtime HTTP surface in-process.
 * Never spawns a Next child.
 */
export function openWorkbench(
  options: OpenWorkbenchOptions
): Promise<OpenWorkbenchResult>;

export function closeHttpServer(): Promise<void>;
export function getActiveHttpServer(): unknown;
export function startHttpServer(opts: unknown): Promise<unknown>;
