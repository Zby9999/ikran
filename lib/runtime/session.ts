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
// Env override (Issue 02/01): when `IKRAN_SESSION_TOKEN` is set in the
// environment, the Runtime uses THAT token instead of generating one. This is
// how a coordinator process (the `bin/ikran.mjs` launcher or the
// `bin/ikran-mcp.mjs` MCP server) supplies the startup-level session token so
// it can compose the canonical Workbench URL `http://127.0.0.1:{port}/?session={token}`
// and hand it back to the Agent / designer. The token is held in memory only
// (env -> process memory via this module); this module never persists it to
// disk. When the env is unset (e.g. the existing e2e harness spawns `next start`
// directly), a token is generated exactly as before, so existing tests are
// unchanged.
//
// Architecture note: this is the "two-process coordinator + env-token bridge"
// tracer bullet from ADR 0001. The one-process consolidation — where the MCP
// tool handlers share in-memory record state with the HTTP API in a single
// custom Next server — is deliberate follow-up work for Issue 02/03 (ADR
// "后续工作项 #2"). Do not collapse this into one process here.

import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { isLocalhostHostname } from "./config";

const GLOBAL = globalThis as unknown as { __IKRAN_SESSION_TOKEN?: string };

function readOrCreateToken(): string {
  if (GLOBAL.__IKRAN_SESSION_TOKEN) {
    return GLOBAL.__IKRAN_SESSION_TOKEN;
  }
  // A coordinator process (the launcher or the MCP server) may supply the
  // startup-level session token via env so it can compose the Workbench URL.
  // Honor it when present and non-empty; otherwise generate one (the existing
  // e2e path that spawns `next start` directly, with no env override).
  const envToken = process.env.IKRAN_SESSION_TOKEN;
  if (typeof envToken === "string" && envToken.length > 0) {
    GLOBAL.__IKRAN_SESSION_TOKEN = envToken;
    return envToken;
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