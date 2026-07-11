/** Empty/unparseable locks younger than this are not treated as stale. */
export const CORRUPT_LOCK_GRACE_MS: number;

/** Absolute path for a named lock under `stateDir`. */
export function fileLockPath(stateDir: string, fileName: string): string;

/**
 * Atomically claim a lock file. Returns a random owner id on success, or
 * null if another holder already owns the lock.
 */
export function tryAcquireFileLock(lockFile: string): string | null;

/**
 * Release only when `ownerId` still matches the on-disk lock
 * (compare-and-delete; avoids ABA deletion of a newer holder's lock).
 */
export function releaseFileLock(lockFile: string, ownerId: string): void;

/**
 * Clear a dead-pid lock, or a corrupt lock older than CORRUPT_LOCK_GRACE_MS.
 * @returns true if a stale lock was cleared
 */
export function breakStaleFileLock(lockFile: string): boolean;

/**
 * Serialize `fn` across processes for one lock file.
 */
export function withFileLock<T>(
  lockFile: string,
  fn: () => Promise<T> | T,
  opts?: { timeoutMs?: number; pollMs?: number; label?: string }
): Promise<T>;
