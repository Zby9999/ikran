// Pure unit test for the client-requested timeout clamp (Issue 3A, P3 follow-up).
//
// Guards against an authorized client keeping a real CLI subprocess alive
// indefinitely: clampTimeoutMs() MUST cap any positive input at MAX_TIMEOUT_MS
// and fall back to DEFAULT_TIMEOUT_MS for non-positive / non-finite / non-number
// input. The clamp is extracted as a pure function (lib/runtime/task-runner.ts)
// so the route layer (app/api/tasks/route.ts) and this test share exactly ONE
// definition of the bound — no 5-minute wait needed to prove the cap. (Observing
// the clamped timeout FIRE end-to-end would take MAX_TIMEOUT_MS = 5 min, so the
// regression guard is a direct unit test of the function instead.)
//
// This is a pure unit test: it imports @playwright/test directly (no `runtime`
// fixture, no spawned server) so it does NOT trigger a worker Runtime spawn.

import { test, expect } from "@playwright/test";
import {
  clampTimeoutMs,
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS
} from "../lib/runtime/task-runner";

test.describe("Issue 3A — timeout clamp (route-side bound)", () => {
  test("caps an absurdly large timeoutMs at MAX_TIMEOUT_MS", () => {
    // The exact regression guard: a value far above the cap must NOT pass
    // through. If someone removes the clamp, this assertion fails.
    expect(clampTimeoutMs(999_999_999)).toBe(MAX_TIMEOUT_MS);
  });

  test("passes through values at or below the cap unchanged", () => {
    expect(clampTimeoutMs(1)).toBe(1);
    expect(clampTimeoutMs(1_000)).toBe(1_000);
    expect(clampTimeoutMs(MAX_TIMEOUT_MS)).toBe(MAX_TIMEOUT_MS);
  });

  test("clamps the boundary just above the cap", () => {
    expect(clampTimeoutMs(MAX_TIMEOUT_MS + 1)).toBe(MAX_TIMEOUT_MS);
  });

  test("falls back to DEFAULT_TIMEOUT_MS for non-positive / non-number input", () => {
    expect(clampTimeoutMs(undefined)).toBe(DEFAULT_TIMEOUT_MS);
    expect(clampTimeoutMs(null)).toBe(DEFAULT_TIMEOUT_MS);
    expect(clampTimeoutMs(0)).toBe(DEFAULT_TIMEOUT_MS);
    expect(clampTimeoutMs(-1)).toBe(DEFAULT_TIMEOUT_MS);
    expect(clampTimeoutMs(NaN)).toBe(DEFAULT_TIMEOUT_MS);
    expect(clampTimeoutMs(Infinity)).toBe(DEFAULT_TIMEOUT_MS);
  });
});
