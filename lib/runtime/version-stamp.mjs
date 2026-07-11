// Prod MCP↔HTTP version guard.
//
// Under `--prod`, MCP loads current TypeScript (tsx) while HTTP serves the
// existing `.next` bundle. If source advances (e.g. schema migrations) without
// a rebuild, MCP can migrate the DB while stale HTTP still expects the old
// schema — split-brain. This module stamps critical runtime source at build
// time and fail-closes on prod startup when the stamp no longer matches.
//
// Dev mode (`prod: false`) skips the check entirely.

import { createHash } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const STAMP_FILENAME = "ikran-runtime-stamp.json";
export const PROD_BUILD_STALE_CODE = "IKRAN_PROD_BUILD_STALE";

/**
 * Source paths that must stay in lockstep between MCP (tsx) and prod HTTP
 * (`.next`). Covers every plane that participates in the HTTP/MCP contract:
 * API routes, MCP tool surface, Runtime kernel (incl. custom server / endpoint),
 * and the Workbench Runtime client. Directories are walked for `.ts` / `.js` /
 * `.mjs` files.
 */
export const CRITICAL_RUNTIME_PATHS = Object.freeze([
  "app/api",
  "lib/mcp",
  "lib/runtime",
  "components/runtime"
]);

export function resolveDistDir(appDir, nextDistDir) {
  const rel =
    typeof nextDistDir === "string" && nextDistDir.length > 0
      ? nextDistDir
      : process.env.IKRAN_NEXT_DIST_DIR || ".next";
  return path.resolve(appDir, rel);
}

export function stampFilePath(appDir, nextDistDir) {
  return path.join(resolveDistDir(appDir, nextDistDir), STAMP_FILENAME);
}

/**
 * Parse `CURRENT_SCHEMA_VERSION` from migrations.ts without importing TS.
 * @param {string} appDir
 * @returns {number}
 */
export function readSchemaVersion(appDir) {
  const file = path.join(appDir, "lib/runtime/migrations.ts");
  if (!existsSync(file)) {
    throw new Error(
      `Cannot read schema version: missing ${path.relative(appDir, file) || file}`
    );
  }
  const text = readFileSync(file, "utf8");
  const match = text.match(
    /export\s+const\s+CURRENT_SCHEMA_VERSION\s*=\s*(\d+)\s*;/
  );
  if (!match) {
    throw new Error(
      "Could not parse CURRENT_SCHEMA_VERSION from lib/runtime/migrations.ts"
    );
  }
  return Number(match[1]);
}

function collectSourceFiles(absPath, out) {
  if (!existsSync(absPath)) return;
  const st = statSync(absPath);
  if (st.isDirectory()) {
    for (const name of readdirSync(absPath).sort()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      collectSourceFiles(path.join(absPath, name), out);
    }
    return;
  }
  if (st.isFile() && /\.(ts|js|mjs)$/.test(absPath)) {
    out.push(absPath);
  }
}

/**
 * Stable content hash of critical runtime modules (relative path + bytes).
 * @param {string} appDir
 * @param {readonly string[]} [paths]
 * @returns {string} 16-char hex prefix of sha256
 */
export function hashCriticalModules(appDir, paths = CRITICAL_RUNTIME_PATHS) {
  const files = [];
  for (const rel of paths) {
    const abs = path.join(appDir, rel);
    if (!existsSync(abs)) {
      throw new Error(
        `Critical runtime path missing for version stamp: ${rel}`
      );
    }
    collectSourceFiles(abs, files);
  }
  files.sort((a, b) => a.localeCompare(b));
  if (files.length === 0) {
    throw new Error("No critical runtime files found to hash for version stamp");
  }
  const hash = createHash("sha256");
  for (const file of files) {
    const rel = path.relative(appDir, file).split(path.sep).join("/");
    hash.update(rel);
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

/**
 * @param {string} appDir
 * @returns {{ schemaVersion: number, contentHash: string, stamp: string }}
 */
export function computeSourceStamp(appDir) {
  const schemaVersion = readSchemaVersion(appDir);
  const contentHash = hashCriticalModules(appDir);
  const stamp = `schema:${schemaVersion}|hash:${contentHash}`;
  return { schemaVersion, contentHash, stamp };
}

/**
 * Write stamp into the Next dist dir after a successful `next build`.
 * @param {string} appDir
 * @param {string} [nextDistDir]
 */
export function writeVersionStamp(appDir, nextDistDir) {
  const dist = resolveDistDir(appDir, nextDistDir);
  if (!existsSync(dist)) {
    throw new Error(
      `Cannot write Ikran version stamp: dist dir missing at ${dist}. Run next build first.`
    );
  }
  const buildIdPath = path.join(dist, "BUILD_ID");
  const buildId = existsSync(buildIdPath)
    ? readFileSync(buildIdPath, "utf8").trim()
    : null;
  const source = computeSourceStamp(appDir);
  const payload = {
    schemaVersion: source.schemaVersion,
    contentHash: source.contentHash,
    stamp: source.stamp,
    buildId,
    writtenAt: new Date().toISOString()
  };
  writeFileSync(
    stampFilePath(appDir, nextDistDir),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8"
  );
  return payload;
}

/**
 * @param {string} appDir
 * @param {string} [nextDistDir]
 * @returns {null | { schemaVersion: number, contentHash: string, stamp: string, buildId?: string | null, writtenAt?: string }}
 */
export function readVersionStamp(appDir, nextDistDir) {
  const file = stampFilePath(appDir, nextDistDir);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.stamp !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function formatProdVersionMismatchError({
  expected,
  found,
  distDir
}) {
  return (
    `Ikran --prod refused to start: the production build at ${distDir} is missing or out of date ` +
    `relative to current source (schema/runtime stamp mismatch).\n` +
    `  expected: ${expected}\n` +
    `  found:    ${found ?? `(no ${STAMP_FILENAME} — rebuild required)`}\n` +
    `Run \`npm run build\` (rebuild with the same IKRAN_NEXT_DIST_DIR if you use a custom dist), ` +
    `then restart Runtime/MCP. Or drop --prod for zero-build dev mode.`
  );
}

/**
 * Fail closed when `--prod` would serve a stale `.next` against current source.
 * No-op when `prod` is false (dev / `npm run dev`).
 *
 * @param {{ appDir: string, prod: boolean, nextDistDir?: string }} opts
 */
export function assertProdBuildMatchesSource({ appDir, prod, nextDistDir }) {
  if (!prod) {
    return { skipped: true };
  }

  const dist = resolveDistDir(appDir, nextDistDir);
  const buildIdPath = path.join(dist, "BUILD_ID");
  if (!existsSync(buildIdPath)) {
    const err = new Error(
      formatProdVersionMismatchError({
        expected: computeSourceStamp(appDir).stamp,
        found: `(no BUILD_ID under ${dist})`,
        distDir: dist
      })
    );
    err.code = PROD_BUILD_STALE_CODE;
    throw err;
  }

  const expected = computeSourceStamp(appDir);
  const found = readVersionStamp(appDir, nextDistDir);
  if (!found || found.stamp !== expected.stamp) {
    const err = new Error(
      formatProdVersionMismatchError({
        expected: expected.stamp,
        found: found?.stamp ?? null,
        distDir: dist
      })
    );
    err.code = PROD_BUILD_STALE_CODE;
    throw err;
  }

  const buildId = readFileSync(buildIdPath, "utf8").trim();
  if (
    typeof found.buildId === "string" &&
    found.buildId.length > 0 &&
    found.buildId !== buildId
  ) {
    const err = new Error(
      formatProdVersionMismatchError({
        expected: `${expected.stamp} (BUILD_ID ${buildId})`,
        found: `${found.stamp} (BUILD_ID ${found.buildId})`,
        distDir: dist
      })
    );
    err.code = PROD_BUILD_STALE_CODE;
    throw err;
  }

  return { ok: true, stamp: expected.stamp, buildId };
}

// CLI: `node lib/runtime/version-stamp.mjs` after `next build`.
const thisFile = fileURLToPath(import.meta.url);
const invokedAsMain =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === thisFile;

if (invokedAsMain) {
  const appDir = process.cwd();
  try {
    const written = writeVersionStamp(appDir);
    console.error(
      `[ikran] wrote ${STAMP_FILENAME} stamp=${written.stamp} buildId=${written.buildId ?? "none"}`
    );
  } catch (err) {
    console.error(`[ikran] failed to write version stamp: ${err?.message || err}`);
    process.exit(1);
  }
}
