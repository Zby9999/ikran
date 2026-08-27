import path from "node:path";
import { describe, expect, test } from "vitest";
import { resolveRuntimeSocketPath } from "../../lib/runtime/runtime-socket-path.mjs";

describe("resolveRuntimeSocketPath", () => {
  test("keeps a short Unix socket inside the Runtime state directory", () => {
    expect(resolveRuntimeSocketPath("/tmp/ikran-state", { platform: "darwin" })).toBe(
      "/tmp/ikran-state/runtime-mcp.sock"
    );
  });

  test("uses a deterministic temp socket for a deeply nested plugin state path", () => {
    const stateDirectory = path.join("/tmp", "a".repeat(120));
    const first = resolveRuntimeSocketPath(stateDirectory, {
      platform: "darwin",
      tempDirectory: "/private/tmp",
      uid: 501
    });
    const second = resolveRuntimeSocketPath(stateDirectory, {
      platform: "darwin",
      tempDirectory: "/private/tmp",
      uid: 501
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^\/private\/tmp\/ikran-[a-f0-9]{24}\.sock$/);
    expect(Buffer.byteLength(first)).toBeLessThan(100);
  });

  test("falls back to a short absolute socket when the temp directory is also long", () => {
    const socketPath = resolveRuntimeSocketPath(path.join("/tmp", "a".repeat(120)), {
      platform: "darwin",
      tempDirectory: path.join("/tmp", "b".repeat(120)),
      uid: 501
    });

    expect(socketPath).toMatch(/^\/tmp\/ikran-501-[a-f0-9]{24}\.sock$/);
  });

  test("preserves the state-local path on Windows", () => {
    const stateDirectory = path.join("C:\\", "a".repeat(120));
    expect(resolveRuntimeSocketPath(stateDirectory, { platform: "win32" })).toBe(
      path.join(stateDirectory, "runtime-mcp.sock")
    );
  });
});
