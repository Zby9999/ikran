// Startup-level local session token + same-origin authorization.
//
// The token is generated once per Runtime process startup and is exposed only
// to the same-origin Browser UI (the page injects it into the document).
// Cross-origin pages cannot read the document, so they cannot steal the token.
// Privileged `/api/*` endpoints require a valid session (header
// `x-ikran-session` or `?session=` query for SSE) AND a localhost Host AND,
// when an `Origin` header is present, a same-origin Origin. Anything else fails
// closed with 403.
//
// The token lives on `globalThis` so it stays stable across Next.js dev HMR
// module reloads within one process, while a fresh process (a new Runtime
// startup) always gets a fresh token — matching the PRD's "startup-level"
// intent without writing to the filesystem.
//
// Env override (startup injection): when `IKRAN_SESSION_TOKEN` is set before
// the Runtime HTTP surface prepares, that token is used instead of generating
// one. The in-process host (`lib/runtime/http-server.mjs`) sets this in the
// same Node process so it can compose the Workbench URL
// `http://127.0.0.1:{port}/?session={token}`. This is NOT a cross-process
// env-token bridge — Task 9 hosts MCP stdio and HTTP in one process. The env
// override remains for test/harness compatibility (e.g. fixtures that start
// Next without going through http-server.mjs). When unset, a token is generated
// as before.
//
// Same-process close→restart: the HTTP host may mint a new token and rewrite
// `IKRAN_SESSION_TOKEN`. The live env token always wins over a stale
// `globalThis` cache; `invalidateSessionTokenCache()` / host close clears the
// cache so validation matches the new Workbench URL.

import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { isLocalhostHostname } from "./config";

const GLOBAL = globalThis as unknown as { __IKRAN_SESSION_TOKEN?: string };

/** Clear the in-memory session token cache (e.g. HTTP host close). */
export function invalidateSessionTokenCache(): void {
  delete GLOBAL.__IKRAN_SESSION_TOKEN;
}

/**
 * Adopt the live HTTP host token into env + cache. Called when the in-process
 * host starts (or restarts) so `getSessionToken` / `isValidSession` match the
 * Workbench URL immediately.
 */
export function adoptSessionToken(token: string): void {
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("session token must be a non-empty string");
  }
  process.env.IKRAN_SESSION_TOKEN = token;
  GLOBAL.__IKRAN_SESSION_TOKEN = token;
}

function readOrCreateToken(): string {
  // Live HTTP host token (env) wins over a stale globalThis cache so
  // same-process close→restart stays consistent with the Workbench URL.
  const envToken = process.env.IKRAN_SESSION_TOKEN;
  if (typeof envToken === "string" && envToken.length > 0) {
    if (GLOBAL.__IKRAN_SESSION_TOKEN !== envToken) {
      GLOBAL.__IKRAN_SESSION_TOKEN = envToken;
    }
    return envToken;
  }
  if (GLOBAL.__IKRAN_SESSION_TOKEN) {
    return GLOBAL.__IKRAN_SESSION_TOKEN;
  }
  GLOBAL.__IKRAN_SESSION_TOKEN = randomBytes(32).toString("hex");
  return GLOBAL.__IKRAN_SESSION_TOKEN;
}

export function getSessionToken(): string {
  return readOrCreateToken();
}

export function isValidSession(value: string | null | undefined): boolean {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  return value === readOrCreateToken();
}

export type AuthResult =
  | { ok: true }
  | { ok: false; status: number; reason: string };

// Enforce localhost Host, same-origin Origin (when present), and a valid
// session token. Returns a 403 result on any failure so the caller can respond
// without inventing semantic content.
export function authorize(request: NextRequest): AuthResult {
  const host = request.headers.get("host");
  if (!host) {
    return { ok: false, status: 403, reason: "missing_host" };
  }

  let requestOrigin: string;
  let hostname: string;
  try {
    const parsed = new URL(`http://${host}`);
    hostname = parsed.hostname;
    requestOrigin = parsed.origin;
  } catch {
    return { ok: false, status: 403, reason: "invalid_host" };
  }

  if (!isLocalhostHostname(hostname)) {
    return { ok: false, status: 403, reason: "nonlocal_host" };
  }

  const origin = request.headers.get("origin");
  if (origin) {
    let originString: string;
    try {
      originString = new URL(origin).origin;
    } catch {
      return { ok: false, status: 403, reason: "invalid_origin" };
    }
    if (originString !== requestOrigin) {
      return { ok: false, status: 403, reason: "cross_origin" };
    }
  }

  const headerSession = request.headers.get("x-ikran-session");
  const querySession = request.nextUrl.searchParams.get("session");
  if (!isValidSession(headerSession) && !isValidSession(querySession)) {
    return { ok: false, status: 403, reason: "invalid_session" };
  }

  return { ok: true };
}
