// Type declarations for lib/runtime/version-stamp.mjs so TypeScript tests
// can import its real implementations. The .mjs is plain JS (allowJs:false
// ignores it at typecheck); this .d.mts mirrors its exports. Keep in sync
// with the .mjs.
//
// Prod MCP↔HTTP version guard: stamp critical runtime source at build time
// and fail-close on --prod startup when the stamp no longer matches.

export const STAMP_FILENAME: "ikran-runtime-stamp.json";
export const PROD_BUILD_STALE_CODE: "IKRAN_PROD_BUILD_STALE";

/**
 * Source paths that must stay in lockstep between MCP (tsx) and prod HTTP
 * (`.next`). Directories are walked for `.ts` / `.js` / `.mjs` files.
 */
export const CRITICAL_RUNTIME_PATHS: readonly string[];

export function resolveDistDir(appDir: string, nextDistDir?: string): string;

export function stampFilePath(appDir: string, nextDistDir?: string): string;

/** Parse `CURRENT_SCHEMA_VERSION` from migrations.ts without importing TS. */
export function readSchemaVersion(appDir: string): number;

/**
 * Stable content hash of critical runtime modules (relative path + bytes).
 * @returns 16-char hex prefix of sha256
 */
export function hashCriticalModules(
  appDir: string,
  paths?: readonly string[]
): string;

export function computeSourceStamp(appDir: string): {
  schemaVersion: number;
  contentHash: string;
  stamp: string;
};

export interface VersionStampPayload {
  schemaVersion: number;
  contentHash: string;
  stamp: string;
  buildId?: string | null;
  writtenAt?: string;
}

/** Write stamp into the Next dist dir after a successful `next build`. */
export function writeVersionStamp(
  appDir: string,
  nextDistDir?: string
): VersionStampPayload;

export function readVersionStamp(
  appDir: string,
  nextDistDir?: string
): VersionStampPayload | null;

export function formatProdVersionMismatchError(args: {
  expected: string;
  found: string | null | undefined;
  distDir: string;
}): string;

/**
 * Fail closed when `--prod` would serve a stale `.next` against current source.
 * No-op when `prod` is false (dev / `npm run dev`).
 */
export function assertProdBuildMatchesSource(opts: {
  appDir: string;
  prod: boolean;
  nextDistDir?: string;
}):
  | { skipped: true }
  | { ok: true; stamp: string; buildId: string };
