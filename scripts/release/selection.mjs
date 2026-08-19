import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  ReleasePolicyError,
  RELEASE_LICENSE,
  assertSafeReleasePath,
  getReleaseKit,
  sensitiveContentReason
} from "./policy.mjs";

const PRODUCT_BUILD_DEPENDENCIES = Object.freeze([
  "@types/node",
  "@types/react",
  "@types/react-dom",
  "playwright-core",
  "typescript"
]);

const PRODUCT_TEST_ONLY_DEPENDENCIES = Object.freeze([
  "@playwright/test",
  "shadcn",
  "vitest"
]);

const execFileAsync = promisify(execFile);

export async function selectReleaseFiles({ repoRoot, kit: kitId, source = "auto" }) {
  const kit = getReleaseKit(kitId);
  const root = await realpath(path.resolve(repoRoot));
  const selected = new Map();
  const inventory = source === "filesystem" ? null : await gitTrackedInventory(root, source);
  const excludedTrees = new Set(kit.excludedTrees ?? []);

  for (const relativePath of kit.files) {
    await addFile(root, relativePath, selected, true, inventory);
  }
  for (const relativePath of kit.optionalFiles) {
    await addFile(root, relativePath, selected, false, inventory);
  }
  for (const relativePath of kit.trees) {
    if (inventory) {
      const prefix = `${relativePath}/`;
      for (const trackedPath of inventory) {
        if (!trackedPath.startsWith(prefix) || isExcluded(trackedPath, excludedTrees)) continue;
        await addFile(root, trackedPath, selected, true, inventory);
      }
    } else {
      await addTree(root, relativePath, selected, excludedTrees);
    }
  }
  for (const relativePath of kit.requiredAnchors) {
    if (!selected.has(relativePath)) {
      throw new ReleasePolicyError(
        "missing_required_path",
        `Required release path is missing: ${relativePath}`,
        { path: relativePath, kit: kit.id }
      );
    }
  }

  const files = [...selected.values()].sort((left, right) => compareText(left.path, right.path));
  validatePackageBoundary(files, kit);
  return Object.freeze(files);
}

function validateHostPluginMetadata(byPath, packageJson) {
  const plugin = parseJsonFile(byPath.get("plugin.json"), "plugin.json");
  const claudePlugin = parseJsonFile(
    byPath.get(".claude-plugin/plugin.json"),
    ".claude-plugin/plugin.json"
  );
  const claudeMcp = parseJsonFile(byPath.get(".mcp.json"), ".mcp.json");

  if (plugin.version !== packageJson.version) {
    throw new ReleasePolicyError(
      "plugin_version_mismatch",
      "Agent Plugin version must match package.json",
      {
        packageVersion: packageJson.version,
        pluginVersion: plugin.version ?? null
      }
    );
  }
  if (claudePlugin.version !== packageJson.version || claudePlugin.name !== plugin.name) {
    throw new ReleasePolicyError(
      "claude_plugin_metadata_mismatch",
      "Claude plugin metadata must match package.json version and Agent Plugin name",
      {
        packageVersion: packageJson.version,
        pluginName: plugin.name ?? null,
        claudeVersion: claudePlugin.version ?? null,
        claudeName: claudePlugin.name ?? null
      }
    );
  }

  const server = claudeMcp.mcpServers?.ikran;
  const args = Array.isArray(server?.args) ? server.args : [];
  if (
    server?.command !== "node" ||
    !args.includes("${CLAUDE_PLUGIN_ROOT}/bin/ikran-mcp.mjs") ||
    !args.includes("--prod") ||
    server?.env?.IKRAN_CWD !== "${CLAUDE_PROJECT_DIR}" ||
    server?.env?.IKRAN_STATE_DIR !== "${CLAUDE_PROJECT_DIR}/.ikran"
  ) {
    throw new ReleasePolicyError(
      "claude_mcp_adapter_invalid",
      "Claude .mcp.json must invoke ikran-mcp --prod with CLAUDE_PLUGIN_ROOT and project-local IKRAN paths",
      { server: server ?? null }
    );
  }
}

export async function assertCleanReleaseSource(repoRoot) {
  const root = await realpath(path.resolve(repoRoot));
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      "git",
      ["-C", root, "status", "--porcelain=v1", "--untracked-files=all"],
      { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }
    ));
  } catch (error) {
    throw new ReleasePolicyError(
      "release_requires_git",
      `Release source is not a Git worktree: ${root}`,
      { cause: error instanceof Error ? error.message : String(error) }
    );
  }
  const changes = stdout.split(/\r?\n/).filter(Boolean);
  if (changes.length) {
    throw new ReleasePolicyError(
      "dirty_release_source",
      "Release commands require a clean Git worktree so assets correspond to one commit",
      { changes: changes.slice(0, 20), omitted: Math.max(0, changes.length - 20) }
    );
  }
  return root;
}

async function addTree(root, relativePath, selected, excludedTrees) {
  const safePath = assertSafeReleasePath(relativePath);
  if (isExcluded(safePath, excludedTrees)) return;
  const absolutePath = resolveInside(root, safePath);
  const stat = await safeLstat(absolutePath, safePath, true);
  if (!stat.isDirectory()) {
    throw new ReleasePolicyError(
      "wrong_path_type",
      `Release tree is not a directory: ${safePath}`,
      { path: safePath }
    );
  }

  const children = (await readdir(absolutePath)).sort(compareText);
  for (const child of children) {
    const childPath = `${safePath}/${child}`;
    if (isExcluded(childPath, excludedTrees)) continue;
    assertSafeReleasePath(childPath);
    const childStat = await safeLstat(resolveInside(root, childPath), childPath, true);
    if (childStat.isDirectory()) {
      await addTree(root, childPath, selected, excludedTrees);
    } else if (childStat.isFile()) {
      await addFile(root, childPath, selected, true, null);
    } else {
      throw new ReleasePolicyError(
        "unsupported_path_type",
        `Unsupported release path type: ${childPath}`,
        { path: childPath }
      );
    }
  }
}

async function addFile(root, relativePath, selected, required, inventory) {
  const safePath = assertSafeReleasePath(relativePath);
  if (inventory && !inventory.has(safePath)) {
    if (!required) return;
    throw new ReleasePolicyError(
      "untracked_required_path",
      `Required release path is not tracked by Git: ${safePath}`,
      { path: safePath }
    );
  }
  const absolutePath = resolveInside(root, safePath);
  const stat = await safeLstat(absolutePath, safePath, required);
  if (!stat) return;
  if (!stat.isFile()) {
    throw new ReleasePolicyError(
      "wrong_path_type",
      `Release file is not a regular file: ${safePath}`,
      { path: safePath }
    );
  }

  const content = await readFile(absolutePath);
  const secretReason = sensitiveContentReason(safePath, content);
  if (secretReason) {
    throw new ReleasePolicyError(
      "sensitive_content",
      `Sensitive content detected in ${safePath} (${secretReason})`,
      { path: safePath, reason: secretReason }
    );
  }

  selected.set(
    safePath,
    Object.freeze({
      path: safePath,
      size: content.length,
      sha256: sha256(content),
      mode: releaseFileMode(stat, content),
      content
    })
  );
}

async function gitTrackedInventory(root, source) {
  if (source !== "auto" && source !== "git") {
    throw new ReleasePolicyError("invalid_release_source", `Unknown release source: ${source}`);
  }
  let topLevel;
  try {
    ({ stdout: topLevel } = await execFileAsync(
      "git",
      ["-C", root, "rev-parse", "--show-toplevel"],
      { encoding: "utf8" }
    ));
  } catch (error) {
    if (source === "auto") return null;
    throw new ReleasePolicyError(
      "release_requires_git",
      `Release source is not a Git worktree: ${root}`,
      { cause: error instanceof Error ? error.message : String(error) }
    );
  }
  const gitRoot = await realpath(topLevel.trim());
  if (gitRoot !== root) {
    throw new ReleasePolicyError(
      "release_requires_repo_root",
      `Release source must be the Git worktree root: ${root}`,
      { gitRoot }
    );
  }
  const { stdout } = await execFileAsync(
    "git",
    ["-C", root, "ls-files", "-z", "--cached"],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }
  );
  return new Set(stdout.split("\0").filter(Boolean));
}

function isExcluded(relativePath, excludedTrees) {
  for (const excluded of excludedTrees) {
    if (relativePath === excluded || relativePath.startsWith(`${excluded}/`)) return true;
  }
  return false;
}

function releaseFileMode(stat, content) {
  const sourceIsExecutable = (stat.mode & 0o111) !== 0 || content.subarray(0, 2).toString("utf8") === "#!";
  return sourceIsExecutable ? 0o755 : 0o644;
}

function validatePackageBoundary(files, kit) {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const packageJson = parseJsonFile(byPath.get("package.json"), "package.json");
  const packageLock = parseJsonFile(byPath.get("package-lock.json"), "package-lock.json");

  if (packageJson.private !== true) {
    throw new ReleasePolicyError(
      "package_must_remain_private",
      "Release source package must keep private:true; Ikran is not an npm publish artifact"
    );
  }
  if (!packageLock.packages || !packageLock.packages[""]) {
    throw new ReleasePolicyError("invalid_package_lock", "package-lock.json has no root package");
  }
  const lockRoot = packageLock.packages[""];
  if (
    packageJson.license !== RELEASE_LICENSE ||
    lockRoot.license !== RELEASE_LICENSE
  ) {
    throw new ReleasePolicyError(
      "release_license_mismatch",
      `Release package metadata must declare ${RELEASE_LICENSE} consistently`,
      {
        expected: RELEASE_LICENSE,
        packageJson: packageJson.license ?? null,
        packageLock: lockRoot.license ?? null
      }
    );
  }

  const npmrc = byPath.get(".npmrc").content.toString("utf8");
  const npmrcDirectives = npmrc
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith(";"));
  if (
    npmrcDirectives.length !== 1 ||
    npmrcDirectives[0].toLowerCase() !== "engine-strict=true"
  ) {
    throw new ReleasePolicyError(
      "unsafe_npmrc",
      "Release .npmrc may contain only engine-strict=true"
    );
  }

  validateHostPluginMetadata(byPath, packageJson);

  if (kit.id !== "product") return;
  const dependencies = packageJson.dependencies ?? {};
  const devDependencies = packageJson.devDependencies ?? {};
  for (const dependency of PRODUCT_BUILD_DEPENDENCIES) {
    if (!dependencies[dependency]) {
      throw new ReleasePolicyError(
        "missing_product_dependency",
        `Product Kit requires ${dependency} in dependencies for npm ci --omit=dev`,
        { dependency }
      );
    }
    if (lockRoot.dependencies?.[dependency] !== dependencies[dependency]) {
      throw new ReleasePolicyError(
        "package_lock_mismatch",
        `Product dependency ${dependency} is not synchronized in package-lock.json`,
        { dependency }
      );
    }
  }

  for (const dependency of PRODUCT_TEST_ONLY_DEPENDENCIES) {
    if (dependencies[dependency]) {
      throw new ReleasePolicyError(
        "test_dependency_in_product_install",
        `${dependency} must remain dev-only so Product Kit can omit it`,
        { dependency }
      );
    }
    if (devDependencies[dependency] && lockRoot.devDependencies?.[dependency] !== devDependencies[dependency]) {
      throw new ReleasePolicyError(
        "package_lock_mismatch",
        `Dev dependency ${dependency} is not synchronized in package-lock.json`,
        { dependency }
      );
    }
  }

  if (packageJson.scripts?.["setup:product"] !== "npm ci --omit=dev && node scripts/release/prune-product-install.mjs && npx --no-install playwright-core install chromium && npm run build") {
    throw new ReleasePolicyError(
      "unsafe_product_setup",
      "setup:product must omit dev dependencies, prune Next's optional test peer, install Chromium through playwright-core, and build"
    );
  }
}

function parseJsonFile(file, relativePath) {
  try {
    return JSON.parse(file.content.toString("utf8"));
  } catch (error) {
    throw new ReleasePolicyError(
      "invalid_json",
      `Invalid ${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
      { path: relativePath }
    );
  }
}

async function safeLstat(absolutePath, relativePath, required) {
  let stat;
  try {
    stat = await lstat(absolutePath);
  } catch (error) {
    if (!required && error && error.code === "ENOENT") return null;
    if (error && error.code === "ENOENT") {
      throw new ReleasePolicyError(
        "missing_required_path",
        `Required release path is missing: ${relativePath}`,
        { path: relativePath }
      );
    }
    throw error;
  }
  if (stat.isSymbolicLink()) {
    throw new ReleasePolicyError(
      "symlink_not_allowed",
      `Symlinks are not allowed in release assets: ${relativePath}`,
      { path: relativePath }
    );
  }
  return stat;
}

function resolveInside(root, relativePath) {
  const absolutePath = path.resolve(root, ...relativePath.split("/"));
  if (absolutePath === root || !absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new ReleasePolicyError("path_traversal", `Path escapes repository: ${relativePath}`);
  }
  return absolutePath;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
