import path from "node:path";

export const RELEASE_LICENSE = "Apache-2.0";

const SHARED_FILES = Object.freeze([
  ".node-version",
  ".npmrc",
  "LICENSE",
  "README.md",
  "package.json",
  "package-lock.json",
  "plugin.json",
  "mcp.json",
  ".mcp.json",
  ".claude-plugin/plugin.json",
  "next.config.ts",
  "next-env.d.ts",
  "postcss.config.mjs",
  "scripts/release/prune-product-install.mjs",
  "tsconfig.json"
]);

const SHARED_TREES = Object.freeze([
  "app",
  "bin",
  "components",
  "lib",
  "public",
  "skills"
]);

const SHARED_EXCLUDED_TREES = Object.freeze([
  // Designer-only route prototypes are tracked for R&D continuity, but are not
  // part of the Ikran Runtime or either external verification surface.
  "app/prototypes"
]);

const SHARED_ANCHORS = Object.freeze([
  "app/layout.tsx",
  "app/page.tsx",
  "bin/ikran.mjs",
  "bin/ikran-mcp.mjs",
  "bin/ikran-runtime.mjs",
  "lib/mcp/register-tools.ts",
  "lib/runtime/http-server.mjs",
  "plugin.json",
  "mcp.json",
  ".mcp.json",
  ".claude-plugin/plugin.json",
  "skills/design-system-governance/SKILL.md"
]);

const OPTIONAL_RELEASE_DOCS = Object.freeze([
  "LICENSE.md",
  "SECURITY.md",
  "CHANGELOG.md"
]);

export const RELEASE_KITS = deepFreeze({
  product: {
    id: "product",
    title: "Ikran Product Test Kit",
    assetStem: "ikran-product-test-kit",
    files: SHARED_FILES,
    trees: SHARED_TREES,
    excludedTrees: SHARED_EXCLUDED_TREES,
    requiredAnchors: SHARED_ANCHORS,
    optionalFiles: OPTIONAL_RELEASE_DOCS,
    profile: {
      setup: "npm run setup:product",
      installStrategy: "npm ci --omit=dev",
      browserStrategy: "npx --no-install playwright-core install chromium",
      build: null,
      start: "npm run start:prod",
      test: null
    }
  },
  contributor: {
    id: "contributor",
    title: "Ikran Contributor Verification Kit",
    assetStem: "ikran-contributor-verification-kit",
    files: [
      ...SHARED_FILES,
      "components.json",
      "playwright.config.ts",
      "vitest.config.ts"
    ],
    trees: [...SHARED_TREES, "tests", "scripts/release"],
    excludedTrees: SHARED_EXCLUDED_TREES,
    requiredAnchors: [
      ...SHARED_ANCHORS,
      "tests/global-setup.ts",
      "tests/fixtures.ts",
      "scripts/release/build.mjs"
    ],
    optionalFiles: OPTIONAL_RELEASE_DOCS,
    profile: {
      setup: "npm run setup:contributor",
      installStrategy: "npm ci",
      browserStrategy: "npx --no-install playwright install chromium",
      build: "npm run build",
      start: "npm start",
      test: "npm run check"
    }
  }
});

const FORBIDDEN_SEGMENTS = new Set([
  ".git",
  ".ikran",
  ".scratch",
  ".cursor",
  "attempts",
  "design issue",
  "issues 02",
  "research",
  "workflow",
  "node_modules",
  "private",
  "test-results",
  "playwright-report"
]);

const SENSITIVE_FILENAMES = new Set([
  ".npmrc",
  "auth.json",
  "credentials.json",
  "secrets.json",
  "id_rsa",
  "id_ed25519"
]);

const SENSITIVE_SUFFIXES = [
  ".db",
  ".sqlite",
  ".sqlite3",
  ".pem",
  ".p12",
  ".pfx",
  ".keychain-db"
];

const TEXT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml"
]);

const SECRET_PATTERNS = Object.freeze([
  ["private_key", /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/],
  ["aws_access_key", /\bAKIA[0-9A-Z]{16}\b/],
  ["github_token", /\bgh(?:p|o|u|s|r)_[A-Za-z0-9]{30,}\b/],
  ["figma_pat", /\bfigd_[A-Za-z0-9_-]{32,}\b/],
  ["openai_api_key", /\bsk-[A-Za-z0-9_-]{32,}\b/]
]);

export function getReleaseKit(kitId) {
  const kit = RELEASE_KITS[kitId];
  if (!kit) {
    throw new ReleasePolicyError(
      "unknown_kit",
      `Unknown release kit: ${String(kitId)}`
    );
  }
  return kit;
}

export function normalizeReleaseVersion(version) {
  const text = String(version ?? "").replace(/^v/, "");
  if (!/^[0-9][0-9A-Za-z.+-]{0,79}$/.test(text)) {
    throw new ReleasePolicyError(
      "invalid_version",
      `Unsafe or missing release version: ${String(version)}`
    );
  }
  return text;
}

/**
 * Release paths are deliberately POSIX-only, even on Windows. Rejecting rather
 * than normalizing ambiguous input keeps the same path identity in manifests,
 * tar headers, checksum verification, and extraction guards.
 */
export function normalizeReleasePath(input) {
  if (typeof input !== "string" || input.length === 0 || input.includes("\0")) {
    throw new ReleasePolicyError("invalid_path", "Release path must be non-empty text");
  }
  if (input.includes("\\") || path.posix.isAbsolute(input)) {
    throw new ReleasePolicyError("path_traversal", `Unsafe release path: ${input}`);
  }

  const normalized = path.posix.normalize(input);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized !== input.replace(/\/$/, "")
  ) {
    throw new ReleasePolicyError("path_traversal", `Unsafe release path: ${input}`);
  }
  return normalized;
}

export function forbiddenReleasePathReason(input) {
  const relativePath = normalizeReleasePath(input);
  const segments = relativePath.split("/");

  for (const segment of segments) {
    const lower = segment.toLowerCase();
    if (FORBIDDEN_SEGMENTS.has(lower)) return `forbidden_segment:${segment}`;
    if (lower === ".next" || lower.startsWith(".next-")) {
      return `build_output:${segment}`;
    }
    if (lower === ".env" || lower.startsWith(".env.")) {
      return `environment_file:${segment}`;
    }
  }

  const filename = segments.at(-1).toLowerCase();
  // The root .npmrc is an explicit, validated release input containing only
  // engine-strict=true. Any nested .npmrc remains a credential leak.
  if (SENSITIVE_FILENAMES.has(filename) && relativePath !== ".npmrc") {
    return `credential_file:${filename}`;
  }
  if (SENSITIVE_SUFFIXES.some((suffix) => filename.endsWith(suffix))) {
    return `state_or_credential_file:${filename}`;
  }
  if (/\.db(?:\.bak|\.backup)(?:\.\d+)?$/.test(filename)) {
    return `database_backup:${filename}`;
  }
  return null;
}

export function assertSafeReleasePath(input) {
  const relativePath = normalizeReleasePath(input);
  const reason = forbiddenReleasePathReason(relativePath);
  if (reason) {
    throw new ReleasePolicyError(
      "forbidden_path",
      `Forbidden release path ${relativePath} (${reason})`,
      { path: relativePath, reason }
    );
  }
  return relativePath;
}

export function sensitiveContentReason(relativePath, bytes) {
  const extension = path.posix.extname(relativePath).toLowerCase();
  if (!TEXT_EXTENSIONS.has(extension) || bytes.length > 10 * 1024 * 1024) return null;
  const text = bytes.toString("utf8");
  for (const [reason, pattern] of SECRET_PATTERNS) {
    if (pattern.test(text)) return reason;
  }
  return null;
}

export class ReleasePolicyError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "ReleasePolicyError";
    this.code = code;
    this.details = details;
  }
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
