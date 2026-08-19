#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createDeterministicTarGz } from "./deterministic-tar.mjs";
import {
  ReleasePolicyError,
  getReleaseKit,
  DEFAULT_RELEASE_KITS,
  normalizeReleaseVersion
} from "./policy.mjs";
import { assertCleanReleaseSource, selectReleaseFiles } from "./selection.mjs";

export async function buildReleaseKit({
  repoRoot,
  outDir,
  kit: kitId,
  version,
  sourceDateEpoch = sourceDateEpochFromEnvironment()
}) {
  await assertCleanReleaseSource(repoRoot);
  return buildReleaseKitFromSource({
    repoRoot,
    outDir,
    kit: kitId,
    version,
    source: "git",
    sourceDateEpoch
  });
}

/** Test-only filesystem seam for synthetic repositories and extracted Kits. */
export async function buildReleaseKitForTests(options) {
  if (process.env.NODE_ENV !== "test") {
    throw new ReleasePolicyError(
      "test_only_release_builder",
      "The filesystem release builder is available only under the test runner"
    );
  }
  return buildReleaseKitFromSource({ ...options, source: "filesystem" });
}

async function buildReleaseKitFromSource({
  repoRoot,
  outDir,
  kit: kitId,
  version,
  source,
  sourceDateEpoch = sourceDateEpochFromEnvironment()
}) {
  const kit = getReleaseKit(kitId);
  const safeVersion = normalizeReleaseVersion(version);
  const files = await selectReleaseFiles({ repoRoot, kit: kit.id, source });
  const packageFile = files.find((file) => file.path === "package.json");
  const packageVersion = JSON.parse(packageFile.content.toString("utf8")).version;
  if (packageVersion !== safeVersion) {
    throw new ReleasePolicyError(
      "release_version_mismatch",
      `Release version ${safeVersion} does not match package version ${String(packageVersion)}`,
      { releaseVersion: safeVersion, packageVersion }
    );
  }
  const archiveRoot = `${kit.assetStem}-${safeVersion}`;
  const manifest = createManifest({ kit, version: safeVersion, archiveRoot, files, sourceDateEpoch });
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);

  const archiveEntries = files.map((file) => ({
    path: `${archiveRoot}/${file.path}`,
    content: file.content,
    mode: file.mode
  }));
  archiveEntries.push({
    path: `${archiveRoot}/RELEASE-MANIFEST.json`,
    content: manifestBytes,
    mode: 0o644
  });

  const archiveBytes = createDeterministicTarGz(archiveEntries, { mtime: sourceDateEpoch });
  const archiveName = `${archiveRoot}.tar.gz`;
  const manifestName = `${archiveRoot}.manifest.json`;
  const checksumName = `${archiveName}.sha256`;
  const archiveSha256 = sha256(archiveBytes);
  const checksumBytes = Buffer.from(`${archiveSha256}  ${archiveName}\n`);

  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(outDir, archiveName), archiveBytes),
    writeFile(path.join(outDir, manifestName), manifestBytes),
    writeFile(path.join(outDir, checksumName), checksumBytes)
  ]);

  return Object.freeze({
    kit: kit.id,
    archiveName,
    archivePath: path.join(outDir, archiveName),
    manifestName,
    manifestPath: path.join(outDir, manifestName),
    checksumName,
    checksumPath: path.join(outDir, checksumName),
    sha256: archiveSha256,
    fileCount: files.length,
    totalSourceBytes: files.reduce((sum, file) => sum + file.size, 0),
    archiveBytes: archiveBytes.length
  });
}

export async function buildReleaseKits(options) {
  const kitIds = options.kits ?? DEFAULT_RELEASE_KITS;
  const results = [];
  for (const kit of kitIds) results.push(await buildReleaseKit({ ...options, kit }));
  return Object.freeze(results);
}

function createManifest({ kit, version, archiveRoot, files, sourceDateEpoch }) {
  return {
    schemaVersion: 1,
    kit: kit.id,
    title: kit.title,
    version,
    archiveRoot,
    sourceDateEpoch,
    createdAt: new Date(sourceDateEpoch * 1000).toISOString(),
    profile: kit.profile,
    fileCount: files.length,
    totalSourceBytes: files.reduce((sum, file) => sum + file.size, 0),
    files: files.map((file) => ({
      path: file.path,
      size: file.size,
      sha256: file.sha256,
      mode: file.mode.toString(8).padStart(4, "0")
    }))
  };
}

function sourceDateEpochFromEnvironment() {
  const raw = process.env.SOURCE_DATE_EPOCH;
  if (raw === undefined || raw === "") return 0;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ReleasePolicyError("invalid_source_date_epoch", `Invalid SOURCE_DATE_EPOCH: ${raw}`);
  }
  return value;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function main(argv) {
  const args = parseArgs(argv);
  const repoRoot = path.resolve(args["repo-root"] ?? process.cwd());
  const outDir = path.resolve(repoRoot, args["out-dir"] ?? "dist/release");
  const packageJson = JSON.parse(await import("node:fs/promises").then(({ readFile }) => readFile(path.join(repoRoot, "package.json"), "utf8")));
  const version = args.version ?? packageJson.version;
  const kits = args.kit && args.kit !== "all" ? [args.kit] : [...DEFAULT_RELEASE_KITS];
  const results = await buildReleaseKits({ repoRoot, outDir, version, kits });
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
    result[key] = value;
    index += 1;
  }
  return result;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
