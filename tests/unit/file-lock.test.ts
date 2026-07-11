// Shared file-lock model: ownerId compare-and-delete + corrupt grace.
// Covers both direct API and project-bind / start-lock wrappers.

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  CORRUPT_LOCK_GRACE_MS,
  breakStaleFileLock,
  fileLockPath,
  releaseFileLock,
  tryAcquireFileLock,
  withFileLock
} from "../../lib/runtime/file-lock.mjs";

function tempDir(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

describe("file-lock owner + corrupt grace", () => {
  test("releaseFileLock deletes only when ownerId matches", () => {
    const stateDir = tempDir("ikran-flock-owner-");
    const lockFile = fileLockPath(stateDir, "t.lock");
    try {
      const ownerId = tryAcquireFileLock(lockFile);
      expect(ownerId).toBeTruthy();
      expect(existsSync(lockFile)).toBe(true);

      releaseFileLock(lockFile, "not-the-owner");
      expect(existsSync(lockFile)).toBe(true);

      releaseFileLock(lockFile, ownerId!);
      expect(existsSync(lockFile)).toBe(false);
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("late release does not delete a foreign lock (ABA)", () => {
    const stateDir = tempDir("ikran-flock-aba-");
    const lockFile = fileLockPath(stateDir, "t.lock");
    try {
      const first = tryAcquireFileLock(lockFile);
      expect(first).toBeTruthy();

      writeFileSync(
        lockFile,
        JSON.stringify({
          pid: process.pid,
          ownerId: "second-holder",
          at: new Date().toISOString()
        }),
        { mode: 0o600 }
      );

      releaseFileLock(lockFile, first!);
      expect(existsSync(lockFile)).toBe(true);
      const left = JSON.parse(readFileSync(lockFile, "utf-8"));
      expect(left.ownerId).toBe("second-holder");
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("empty lock is not immediately stolen", async () => {
    const stateDir = tempDir("ikran-flock-empty-");
    const lockFile = fileLockPath(stateDir, "t.lock");
    try {
      writeFileSync(lockFile, "", { mode: 0o600 });
      expect(breakStaleFileLock(lockFile)).toBe(false);
      await expect(
        withFileLock(lockFile, async () => "stolen", {
          timeoutMs: 400,
          pollMs: 40,
          label: "test"
        })
      ).rejects.toThrow(/Timed out waiting for Ikran test lock/);
      expect(existsSync(lockFile)).toBe(true);
      expect(readFileSync(lockFile, "utf-8")).toBe("");
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  test("CORRUPT_LOCK_GRACE_MS is 5s", () => {
    expect(CORRUPT_LOCK_GRACE_MS).toBe(5_000);
  });
});

describe("project-bind lock uses shared file-lock model", () => {
  test("empty bind lock is not immediately stolen", async () => {
    const stateDir = tempDir("ikran-bind-empty-");
    process.env.IKRAN_STATE_DIR = stateDir;
    try {
      const { withProjectBindLock, bindLockPath } = await import(
        "../../lib/runtime/project"
      );
      writeFileSync(bindLockPath(stateDir), "", { mode: 0o600 });
      await expect(
        withProjectBindLock(async () => "stolen", {
          stateDir,
          timeoutMs: 400,
          pollMs: 40
        })
      ).rejects.toThrow(/Timed out waiting for Ikran project bind lock/);
      expect(existsSync(bindLockPath(stateDir))).toBe(true);
      expect(readFileSync(bindLockPath(stateDir), "utf-8")).toBe("");
    } finally {
      delete process.env.IKRAN_STATE_DIR;
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
