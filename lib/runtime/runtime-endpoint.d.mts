// Type declarations for lib/runtime/runtime-endpoint.mjs so TypeScript tests
// can import its real implementations (e.g. composeWorkbenchUrl) instead of
// local copies. The .mjs is plain JS (allowJs:false ignores it at typecheck);
// this .d.mts mirrors its exports. Keep in sync with the .mjs.
//
// Issue 02/01: Workbench URL + session shell, two-process coordinator +
// env-token bridge (see ADR 0001 + docs/issue02-01-handoff.md).

import type { ChildProcess } from "node:child_process";

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

export interface RuntimeEndpoint {
  host: string;
  port: number;
  token: string;
  pid: number;
  startedAt: string;
}

/** Read the reuse state; returns null if missing or corrupt. */
export function readRuntimeEndpoint(stateDir: string): RuntimeEndpoint | null;

/** Write the reuse state with user-only permissions (mode 0o600). */
export function writeRuntimeEndpoint(
  stateDir: string,
  info: { host: string; port: number; token: string; pid: number; startedAt?: string }
): RuntimeEndpoint;

/** Remove the reuse state file (best-effort). */
export function removeRuntimeEndpoint(stateDir: string): void;

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

/** Locate the Next.js CLI (runnable via `node <path>`). Throws if missing. */
export function resolveNextBin(cwd: string): string;

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
}

export interface OpenWorkbenchResult {
  url: string;
  host: string;
  port: number;
  token: string;
  pid: number;
  /** true if a NEW Runtime was spawned (caller owns `child` and must tear it
   *  down); false if a live Runtime was reused (caller must NOT kill it). */
  spawned: boolean;
  child: ChildProcess | null;
}

/**
 * Reuse-or-spawn the local Ikran Runtime HTTP surface. When a live Runtime is
 * recorded in the reuse state, reuses it (unless the caller pinned a conflicting
 * port); otherwise spawns a Next HTTP surface as a child on an auto free port,
 * waits for readiness, writes the reuse state, and returns the Workbench URL.
 */
export function openWorkbench(
  options: OpenWorkbenchOptions
): Promise<OpenWorkbenchResult>;