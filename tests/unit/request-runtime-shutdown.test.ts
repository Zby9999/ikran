import { describe, expect, test, vi } from "vitest";

import { requestRuntimeShutdown } from "../../lib/runtime/request-runtime-shutdown";

describe("requestRuntimeShutdown", () => {
  test("accepts only the Runtime's 202 acknowledgement", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));

    await expect(requestRuntimeShutdown("session", fetcher)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith("/api/runtime/stop", {
      method: "POST",
      headers: { "x-ikran-session": "session" }
    });
  });

  test("surfaces HTTP and network failures instead of reporting a stopped Runtime", async () => {
    const rejected = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    await expect(requestRuntimeShutdown("session", rejected)).rejects.toThrow("503");

    const offline = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(requestRuntimeShutdown("session", offline)).rejects.toThrow("Failed to fetch");
  });
});
