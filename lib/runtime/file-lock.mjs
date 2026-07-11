// Cross-process exclusive file lock (O_EXCL + ownerId compare-and-delete).
//
// Shared by Runtime start (`runtime-endpoint.mjs`) and project bind
// (`project.ts`) so both stay on the same hardened model:
//   - random ownerId in lock payload
//   - release only when ownerId still matches (ABA-safe)
//   - empty/unparseable locks get a corrupt grace window (not stolen mid-write)

import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

/** Empty/unparseable locks younger than this are not treated as stale. */
export const CORRUPT_LOCK_GRACE_MS = 5_000;

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function lockFileAgeMs(lockFile) {
  try {
    return Date.now() - statSync(lockFile).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Absolute path for a named lock under `stateDir`.
 * @param {string} stateDir
 * @param {string} fileName e.g. "runtime-start.lock"
 */
export function fileLockPath(stateDir, fileName) {
  return path.join(stateDir, fileName);
}

/**
 * Atomically claim a lock file (O_CREAT|O_EXCL) with a random owner id.
 * @param {string} lockFile absolute path
 * @returns {string|null} ownerId on success, null if lock already held
 */
export function tryAcquireFileLock(lockFile) {
  mkdirSync(path.dirname(lockFile), { recursive: true });
  const ownerId = randomBytes(16).toString("hex");
  const payload = JSON.stringify({
    pid: process.pid,
    ownerId,
    at: new Date().toISOString()
  });
  try {
    // flag "wx" = O_CREAT|O_EXCL: atomic create across processes.
    writeFileSync(lockFile, payload, { flag: "wx", mode: 0o600 });
    return ownerId;
  } catch (err) {
    if (err && err.code === "EEXIST") return null;
    throw err;
  }
}

/**
 * Release only if `ownerId` still owns the lock (compare-and-delete).
 * Prevents ABA where a late finally deletes a newer holder's lock.
 * @param {string} lockFile
 * @param {string} ownerId
 */
export function releaseFileLock(lockFile, ownerId) {
  if (typeof ownerId !== "string" || ownerId.length === 0) return;
  try {
    if (!existsSync(lockFile)) return;
    const parsed = JSON.parse(readFileSync(lockFile, "utf-8"));
    if (!parsed || parsed.ownerId !== ownerId) return;
    unlinkSync(lockFile);
  } catch (err) {
    if (!err || err.code === "ENOENT") return;
    // Unparseable / foreign in-progress lock: never delete on release.
    if (err instanceof SyntaxError) return;
    throw err;
  }
}

/**
 * Clear a dead-pid lock, or a corrupt lock older than CORRUPT_LOCK_GRACE_MS.
 * Empty/unparseable locks are NOT immediately stale (create→write race).
 * @param {string} lockFile
 * @returns {boolean} true if a stale lock was cleared
 */
export function breakStaleFileLock(lockFile) {
  if (!existsSync(lockFile)) return false;

  let raw;
  try {
    raw = readFileSync(lockFile, "utf-8");
  } catch (err) {
    if (!err || err.code !== "ENOENT") throw err;
    return false;
  }

  let parsed = null;
  let parseOk = false;
  try {
    if (raw.trim().length > 0) {
      parsed = JSON.parse(raw);
      parseOk = true;
    }
  } catch {
    parseOk = false;
  }

  if (!parseOk || !parsed || typeof parsed.pid !== "number") {
    if (lockFileAgeMs(lockFile) < CORRUPT_LOCK_GRACE_MS) return false;
  } else if (isPidAlive(parsed.pid)) {
    return false;
  }

  try {
    unlinkSync(lockFile);
  } catch (err) {
    if (!err || err.code !== "ENOENT") throw err;
    return false;
  }
  return true;
}

/**
 * Serialize `fn` across processes for one lock file.
 * @template T
 * @param {string} lockFile
 * @param {() => Promise<T>|T} fn
 * @param {{ timeoutMs?: number, pollMs?: number, label?: string }} [opts]
 * @returns {Promise<T>}
 */
export async function withFileLock(
  lockFile,
  fn,
  { timeoutMs = 60_000, pollMs = 50, label = "file" } = {}
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ownerId = tryAcquireFileLock(lockFile);
    if (ownerId) {
      try {
        return await fn();
      } finally {
        releaseFileLock(lockFile, ownerId);
      }
    }
    breakStaleFileLock(lockFile);
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for Ikran ${label} lock at ${lockFile}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
