import { afterEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

import { POST } from "../../app/api/runtime/stop/route";
import {
  createRuntimeLifecycle,
  registerRuntimeControl
} from "../../lib/runtime/runtime-lifecycle";
import { getSessionToken } from "../../lib/runtime/session";

describe("POST /api/runtime/stop", () => {
  let unregister: (() => void) | undefined;

  afterEach(() => unregister?.());

  test("authorized Workbench request acknowledges before requesting shutdown", async () => {
    vi.useFakeTimers();
    const requestShutdown = vi.fn();
    const lifecycle = createRuntimeLifecycle({ idleMs: 1_000, onIdle: vi.fn() });
    unregister = registerRuntimeControl({ lifecycle, requestShutdown });
    const token = getSessionToken();
    const request = new NextRequest("http://127.0.0.1:3000/api/runtime/stop", {
      method: "POST",
      headers: { host: "127.0.0.1:3000", "x-ikran-session": token }
    });

    const response = await POST(request);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true, status: "stopping" });
    expect(requestShutdown).not.toHaveBeenCalled();
    vi.advanceTimersByTime(99);
    expect(requestShutdown).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(requestShutdown).toHaveBeenCalledWith("user");
    vi.useRealTimers();
  });

  test("invalid session cannot stop Runtime", async () => {
    const request = new NextRequest("http://127.0.0.1:3000/api/runtime/stop", {
      method: "POST",
      headers: { host: "127.0.0.1:3000", "x-ikran-session": "wrong" }
    });
    expect((await POST(request)).status).toBe(403);
  });
});
