// P2 audit: start-lock ABA / owner-only release + endpoint chmod / host validation.

import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  endpointFilePath,
  readRuntimeEndpoint,
  releaseStartLock,
  startLockPath,
  tryAcquireStartLock,
  withRuntimeStartLock,
  writeRuntimeEndpoint
} from "../../lib/runtime/runtime-endpoint.mjs";

function tempStateDir(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

describe("runtime-start lock owner-only release", () => {
  test("releaseStartLock deletes only when ownerId matches", () => {
    const stateDir = tempStateDir("ikran-lock-owner-");
    try {
      const ownerId = tryAcquireStartLock(stateDir);
      expect(ownerId).toBeTruthy();
      expect(existsSync(startLockPath(stateDir))).toBe(true);

      releaseStartLock(stateDir, "not-the-owner");
      expect(existsSync(startLockPath(stateDir))).toBe(true);

      releaseStartLock(stateDir, ownerId!);
      expect(existsSync(startLockPath(stateDir))).toBe(false);
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("late release does not delete a foreign lock (ABA)", () => {
    const stateDir = tempStateDir("ikran-lock-aba-");
    try {
      const first = tryAcquireStartLock(stateDir);
      expect(first).toBeTruthy();

      // Simulate: first holder's lock was replaced by a second acquirer.
      writeFileSync(
        startLockPath(stateDir),
        JSON.stringify({
          pid: process.pid,
          ownerId: "second-holder",
          at: new Date().toISOString()
        }),
        { mode: 0o600 }
      );

      releaseStartLock(stateDir, first!);
      expect(existsSync(startLockPath(stateDir))).toBe(true);
      const left = JSON.parse(readFileSync(startLockPath(stateDir), "utf-8"));
      expect(left.ownerId).toBe("second-holder");
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("empty lock is not immediately stolen", async () => {
    const stateDir = tempStateDir("ikran-lock-empty-");
    try {
      writeFileSync(startLockPath(stateDir), "", { mode: 0o600 });
      await expect(
        withRuntimeStartLock(stateDir, async () => "stolen", {
          timeoutMs: 400,
          pollMs: 40
        })
      ).rejects.toThrow(/Timed out waiting for Ikran Runtime start lock/);
      expect(existsSync(startLockPath(stateDir))).toBe(true);
      expect(readFileSync(startLockPath(stateDir), "utf-8")).toBe("");
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});

describe("runtime-endpoint file permissions + host validation", () => {
  test("writeRuntimeEndpoint ends as 0o600 even if pre-existing 0644", () => {
    const stateDir = tempStateDir("ikran-ep-mode-");
    try {
      const file = endpointFilePath(stateDir);
      writeFileSync(file, "{}", { mode: 0o644 });
      chmodSync(file, 0o644);
      expect(statSync(file).mode & 0o777).toBe(0o644);

      writeRuntimeEndpoint(stateDir, {
        host: "127.0.0.1",
        port: 34567,
        token: "b".repeat(64),
        pid: process.pid,
        owner: "mcp"
      });

      expect(statSync(file).mode & 0o777).toBe(0o600);
      const ep = readRuntimeEndpoint(stateDir);
      expect(ep?.host).toBe("127.0.0.1");
      expect(ep?.port).toBe(34567);
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("readRuntimeEndpoint rejects non-localhost host and bad ports", () => {
    const stateDir = tempStateDir("ikran-ep-host-");
    try {
      const file = endpointFilePath(stateDir);
      const base = {
        token: "c".repeat(64),
        pid: process.pid,
        owner: "mcp",
        startedAt: new Date().toISOString()
      };

      writeFileSync(
        file,
        JSON.stringify({ ...base, host: "8.8.8.8", port: 3000 })
      );
      expect(readRuntimeEndpoint(stateDir)).toBeNull();

      writeFileSync(
        file,
        JSON.stringify({ ...base, host: "example.com", port: 3000 })
      );
      expect(readRuntimeEndpoint(stateDir)).toBeNull();

      writeFileSync(
        file,
        JSON.stringify({ ...base, host: "0.0.0.0", port: 3000 })
      );
      expect(readRuntimeEndpoint(stateDir)).toBeNull();

      writeFileSync(
        file,
        JSON.stringify({ ...base, host: "127.0.0.1", port: 0 })
      );
      expect(readRuntimeEndpoint(stateDir)).toBeNull();

      writeFileSync(
        file,
        JSON.stringify({ ...base, host: "127.0.0.1", port: 65536 })
      );
      expect(readRuntimeEndpoint(stateDir)).toBeNull();

      writeFileSync(
        file,
        JSON.stringify({ ...base, host: "127.0.0.1", port: 3000.5 })
      );
      expect(readRuntimeEndpoint(stateDir)).toBeNull();

      writeFileSync(
        file,
        JSON.stringify({ ...base, host: "127.0.0.1", port: 3000 })
      );
      expect(readRuntimeEndpoint(stateDir)?.port).toBe(3000);

      writeFileSync(
        file,
        JSON.stringify({ ...base, host: "::1", port: 3000 })
      );
      expect(readRuntimeEndpoint(stateDir)?.host).toBe("::1");

      writeFileSync(
        file,
        JSON.stringify({ ...base, host: "localhost", port: 1 })
      );
      expect(readRuntimeEndpoint(stateDir)?.port).toBe(1);
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
