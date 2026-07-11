// Session token cache must track the live HTTP host token across same-process
// close→restart (env rewrite + globalThis invalidation).

import { afterEach, describe, expect, test } from "vitest";
import {
  adoptSessionToken,
  getSessionToken,
  invalidateSessionTokenCache,
  isValidSession
} from "../../lib/runtime/session";

const GLOBAL = globalThis as unknown as { __IKRAN_SESSION_TOKEN?: string };

afterEach(() => {
  invalidateSessionTokenCache();
  delete process.env.IKRAN_SESSION_TOKEN;
});

describe("session token cache vs live HTTP host token", () => {
  test("env token wins over a stale globalThis cache", () => {
    const stale = "a".repeat(64);
    const live = "b".repeat(64);
    GLOBAL.__IKRAN_SESSION_TOKEN = stale;
    process.env.IKRAN_SESSION_TOKEN = live;

    expect(getSessionToken()).toBe(live);
    expect(GLOBAL.__IKRAN_SESSION_TOKEN).toBe(live);
    expect(isValidSession(live)).toBe(true);
    expect(isValidSession(stale)).toBe(false);
  });

  test("adoptSessionToken refreshes env + cache together", () => {
    adoptSessionToken("c".repeat(64));
    expect(process.env.IKRAN_SESSION_TOKEN).toBe("c".repeat(64));
    expect(getSessionToken()).toBe("c".repeat(64));

    adoptSessionToken("d".repeat(64));
    expect(getSessionToken()).toBe("d".repeat(64));
    expect(isValidSession("c".repeat(64))).toBe(false);
    expect(isValidSession("d".repeat(64))).toBe(true);
  });

  test("invalidateSessionTokenCache drops cache; next env adopt is authoritative", () => {
    adoptSessionToken("e".repeat(64));
    invalidateSessionTokenCache();
    expect(GLOBAL.__IKRAN_SESSION_TOKEN).toBeUndefined();

    // Env still set (host may clear cache before rewriting env on restart).
    expect(getSessionToken()).toBe("e".repeat(64));

    process.env.IKRAN_SESSION_TOKEN = "f".repeat(64);
    expect(getSessionToken()).toBe("f".repeat(64));
    expect(isValidSession("e".repeat(64))).toBe(false);
  });

  test("simulates close→restart: old URL token rejected, new token accepted", () => {
    const first = "1".repeat(64);
    const second = "2".repeat(64);

    adoptSessionToken(first);
    expect(isValidSession(first)).toBe(true);

    // Close: drop cache (http-server.mjs invalidateSessionTokenCache).
    invalidateSessionTokenCache();

    // Restart: host mints a new token and adopts it.
    adoptSessionToken(second);

    expect(getSessionToken()).toBe(second);
    expect(isValidSession(second)).toBe(true);
    expect(isValidSession(first)).toBe(false);
  });
});
