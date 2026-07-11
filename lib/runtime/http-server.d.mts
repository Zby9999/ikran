// Type declarations for lib/runtime/http-server.mjs so TypeScript tests
// can import its real implementations. The .mjs is plain JS (allowJs:false
// ignores it at typecheck); this .d.mts mirrors its exports. Keep in sync
// with the .mjs.
//
// Task 9: in-process Next.js custom HTTP host (no Next child spawn).

import type { Server } from "node:http";

/** Strip RFC 3986 IPv6 brackets (`[::1]` → `::1`). */
export function stripHostBrackets(host: string): string;

/**
 * Canonical bind/listen host for localhost allowlist.
 * Accepts `::1` or `[::1]`; rejects anything else.
 */
export function canonicalizeLocalhostHost(host: string): string;

export function isLocalhostHost(host: string): boolean;

/** Host authority for URL composition / Host headers (IPv6 bracketed). */
export function formatHostForUrl(host: string): string;

export function composeHostHeader(host: string, port: number): string;

/** Pick a free TCP port on 127.0.0.1 by listening on port 0 and closing. */
export function pickFreePort(): Promise<number>;

/** Compose the canonical Workbench URL `http://{host}:{port}/?session={token}`. */
export function composeWorkbenchUrl(
  host: string,
  port: number,
  token: string
): string;

export interface HttpServerHandle {
  server: Server;
  nextApp: { close(): Promise<void>; getRequestHandler(): unknown } | null;
  host: string;
  port: number;
  token: string;
  url: string;
  pid: number;
  close(): Promise<void>;
}

/** Currently published in-process HTTP handle, or null. */
export function getActiveHttpServer(): HttpServerHandle | null;

/**
 * Patch console.* to stderr for MCP stdout discipline.
 * Does not touch process.stdout.write (MCP JSON-RPC needs it).
 */
export function installStdoutDiscipline(): void;

/** Poll the public HTML shell (`/`) until 2xx. Rejects on timeout. */
export function waitForReady(
  host: string,
  port: number,
  timeoutMs: number
): Promise<void>;

export interface StartHttpServerOptions {
  host: string;
  prod: boolean;
  /** Package root (contains app/). */
  dir: string;
  nextDistDir?: string;
  /** e.g. IKRAN_CWD */
  extraEnv?: Record<string, string>;
  port?: number;
  /** Startup session token; generated if omitted. */
  token?: string;
  timeoutMs?: number;
  /** MCP mode: quiet + console→stderr */
  stdoutDiscipline?: boolean;
}

export type StartHttpServerResult = HttpServerHandle & { reused: boolean };

/** Start (or reuse) the in-process Next HTTP surface. */
export function startHttpServer(
  opts: StartHttpServerOptions
): Promise<StartHttpServerResult>;

/** Close the active in-process HTTP surface (if any). Safe to call repeatedly. */
export function closeHttpServer(): Promise<void>;
