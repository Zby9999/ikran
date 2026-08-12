#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import {
  ReleasePolicyError,
  assertSafeReleasePath,
  getReleaseKit,
  normalizeReleasePath,
  normalizeReleaseVersion
} from "./policy.mjs";

const TAR_BLOCK_SIZE = 512;

/**
 * Verify a release asset against both sidecars and, optionally, extract it.
 * The archive is parsed here rather than delegated to the host `tar` command so
 * the same path, type, checksum, content, and mode policy guards every adapter.
 */
export async function verifyReleaseArtifact({
  archivePath,
  manifestPath,
  checksumPath,
  kit: kitId,
  destination
}) {
  const kit = getReleaseKit(kitId);
  const [archiveBytes, manifestBytes, checksumText] = await Promise.all([
    readFile(archivePath),
    readFile(manifestPath),
    readFile(checksumPath, "utf8")
  ]);
  const archiveName = path.basename(archivePath);
  const archiveSha256 = sha256(archiveBytes);
  const checksumMatch = checksumText.match(/^([a-f0-9]{64})  ([^\r\n]+)\r?\n$/);
  if (!checksumMatch || checksumMatch[2] !== archiveName) {
    throw new ReleasePolicyError(
      "invalid_checksum_sidecar",
      `Checksum sidecar does not identify ${archiveName}`
    );
  }
  if (checksumMatch[1] !== archiveSha256) {
    throw new ReleasePolicyError(
      "checksum_mismatch",
      `Archive checksum does not match ${archiveName}`,
      { expected: checksumMatch[1], actual: archiveSha256 }
    );
  }

  const manifest = parseManifest(manifestBytes, manifestPath);
  if (manifest.kit !== kit.id) {
    throw new ReleasePolicyError(
      "manifest_kit_mismatch",
      `Expected ${kit.id} manifest, received ${String(manifest.kit)}`
    );
  }
  const manifestVersion = normalizeReleaseVersion(manifest.version);
  if (manifest.version !== manifestVersion) {
    throw new ReleasePolicyError(
      "invalid_manifest_version",
      `Manifest version must not include aliases or prefixes: ${String(manifest.version)}`
    );
  }
  const expectedArchiveRoot = `${kit.assetStem}-${manifestVersion}`;
  if (manifest.archiveRoot !== expectedArchiveRoot) {
    throw new ReleasePolicyError(
      "manifest_root_mismatch",
      `Unexpected archive root: ${String(manifest.archiveRoot)}`
    );
  }
  if (archiveName !== `${expectedArchiveRoot}.tar.gz`) {
    throw new ReleasePolicyError(
      "archive_name_mismatch",
      `Archive name does not match its manifest: ${archiveName}`
    );
  }

  const entries = readTarEntries(archiveBytes);
  const entryByPath = new Map(entries.map((entry) => [entry.path, entry]));
  const embeddedManifestPath = `${expectedArchiveRoot}/RELEASE-MANIFEST.json`;
  const embeddedManifest = entryByPath.get(embeddedManifestPath);
  if (!embeddedManifest || !embeddedManifest.content.equals(manifestBytes)) {
    throw new ReleasePolicyError(
      "embedded_manifest_mismatch",
      "Embedded RELEASE-MANIFEST.json differs from its sidecar"
    );
  }

  if (!Array.isArray(manifest.files) || manifest.fileCount !== manifest.files.length) {
    throw new ReleasePolicyError(
      "invalid_manifest_files",
      "Release manifest has an invalid file list or count"
    );
  }
  if (entries.length !== manifest.files.length + 1) {
    throw new ReleasePolicyError(
      "unexpected_archive_entry",
      "Archive entry count does not match the release manifest"
    );
  }

  const verifiedFiles = [];
  const seen = new Set();
  for (const declared of manifest.files) {
    const relativePath = assertSafeReleasePath(declared.path);
    if (seen.has(relativePath)) {
      throw new ReleasePolicyError(
        "duplicate_manifest_path",
        `Duplicate manifest path: ${relativePath}`
      );
    }
    seen.add(relativePath);
    const archivePathForFile = `${expectedArchiveRoot}/${relativePath}`;
    const entry = entryByPath.get(archivePathForFile);
    if (!entry) {
      throw new ReleasePolicyError(
        "missing_archive_entry",
        `Archive is missing ${relativePath}`
      );
    }
    const expectedMode = parseMode(declared.mode, relativePath);
    if (
      declared.size !== entry.content.length ||
      declared.sha256 !== sha256(entry.content) ||
      expectedMode !== entry.mode
    ) {
      throw new ReleasePolicyError(
        "archive_entry_mismatch",
        `Archive content or metadata differs for ${relativePath}`,
        { path: relativePath }
      );
    }
    verifiedFiles.push({ path: relativePath, content: entry.content, mode: entry.mode });
  }
  const totalSourceBytes = verifiedFiles.reduce((sum, file) => sum + file.content.length, 0);
  if (manifest.totalSourceBytes !== totalSourceBytes) {
    throw new ReleasePolicyError(
      "manifest_size_mismatch",
      "Release manifest totalSourceBytes does not match its declared files"
    );
  }

  let extractedRoot = null;
  if (destination) {
    const destinationRoot = path.resolve(destination);
    await mkdir(destinationRoot, { recursive: true, mode: 0o755 });
    if ((await readdir(destinationRoot)).length !== 0) {
      throw new ReleasePolicyError(
        "nonempty_extraction_destination",
        `Extraction destination must be empty: ${destinationRoot}`
      );
    }
    extractedRoot = path.join(destinationRoot, expectedArchiveRoot);
    await mkdir(extractedRoot, { recursive: true, mode: 0o755 });
    for (const file of verifiedFiles) {
      const outputPath = resolveInside(extractedRoot, file.path);
      await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o755 });
      await writeFile(outputPath, file.content, { mode: file.mode, flag: "wx" });
      await chmod(outputPath, file.mode);
    }
    const outputManifest = path.join(extractedRoot, "RELEASE-MANIFEST.json");
    await writeFile(outputManifest, manifestBytes, { mode: 0o644, flag: "wx" });
  }

  return Object.freeze({
    kit: kit.id,
    version: manifestVersion,
    archiveName,
    sha256: archiveSha256,
    fileCount: verifiedFiles.length,
    totalSourceBytes,
    extractedRoot
  });
}

function readTarEntries(gzipBytes) {
  let tar;
  try {
    tar = gunzipSync(gzipBytes);
  } catch (error) {
    throw new ReleasePolicyError(
      "invalid_gzip",
      `Release archive is not valid gzip: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const entries = [];
  const seen = new Set();
  let offset = 0;
  let foundEnd = false;
  while (offset + TAR_BLOCK_SIZE <= tar.length) {
    const header = tar.subarray(offset, offset + TAR_BLOCK_SIZE);
    if (header.every((byte) => byte === 0)) {
      if (offset + TAR_BLOCK_SIZE * 2 > tar.length) {
        throw new ReleasePolicyError("invalid_tar_end", "Tar archive has a truncated end marker");
      }
      const second = tar.subarray(offset + TAR_BLOCK_SIZE, offset + TAR_BLOCK_SIZE * 2);
      if (!second.every((byte) => byte === 0)) {
        throw new ReleasePolicyError("invalid_tar_end", "Tar archive has only one zero end block");
      }
      if (!tar.subarray(offset + TAR_BLOCK_SIZE * 2).every((byte) => byte === 0)) {
        throw new ReleasePolicyError("trailing_tar_data", "Tar archive contains trailing data");
      }
      foundEnd = true;
      break;
    }

    verifyTarHeaderChecksum(header);
    if (readTarText(header, 257, 6) !== "ustar") {
      throw new ReleasePolicyError("invalid_tar_format", "Release archive must use ustar headers");
    }
    const typeFlag = header[156];
    if (typeFlag !== 0 && typeFlag !== "0".charCodeAt(0)) {
      throw new ReleasePolicyError(
        "unsupported_tar_entry",
        `Release archive may contain only regular files (type ${String.fromCharCode(typeFlag)})`
      );
    }
    const name = readTarText(header, 0, 100);
    const prefix = readTarText(header, 345, 155);
    const entryPath = normalizeReleasePath(prefix ? `${prefix}/${name}` : name);
    if (seen.has(entryPath)) {
      throw new ReleasePolicyError("duplicate_archive_path", `Duplicate archive path: ${entryPath}`);
    }
    seen.add(entryPath);
    const size = readTarOctal(header, 124, 12, "size");
    const mode = readTarOctal(header, 100, 8, "mode") & 0o777;
    if (mode !== 0o644 && mode !== 0o755) {
      throw new ReleasePolicyError("unsafe_archive_mode", `Unsafe mode for ${entryPath}`);
    }
    const contentStart = offset + TAR_BLOCK_SIZE;
    const contentEnd = contentStart + size;
    if (contentEnd > tar.length) {
      throw new ReleasePolicyError("truncated_tar_entry", `Truncated archive entry: ${entryPath}`);
    }
    entries.push({ path: entryPath, mode, content: Buffer.from(tar.subarray(contentStart, contentEnd)) });
    offset = contentStart + Math.ceil(size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
  }
  if (!foundEnd) {
    throw new ReleasePolicyError("invalid_tar_end", "Tar archive has no end marker");
  }
  return entries;
}

function verifyTarHeaderChecksum(header) {
  const declared = readTarOctal(header, 148, 8, "checksum");
  const copy = Buffer.from(header);
  copy.fill(0x20, 148, 156);
  let actual = 0;
  for (const byte of copy) actual += byte;
  if (declared !== actual) {
    throw new ReleasePolicyError("tar_checksum_mismatch", "Tar header checksum mismatch");
  }
}

function readTarOctal(buffer, offset, length, label) {
  const text = buffer
    .subarray(offset, offset + length)
    .toString("ascii")
    .replace(/\0.*$/, "")
    .trim();
  if (!/^[0-7]+$/.test(text)) {
    throw new ReleasePolicyError("invalid_tar_number", `Invalid tar ${label}`);
  }
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ReleasePolicyError("invalid_tar_number", `Unsafe tar ${label}`);
  }
  return value;
}

function readTarText(buffer, offset, length) {
  return buffer
    .subarray(offset, offset + length)
    .toString("utf8")
    .replace(/\0.*$/, "");
}

function parseManifest(bytes, manifestPath) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new ReleasePolicyError(
      "invalid_release_manifest",
      `Invalid release manifest ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function parseMode(value, relativePath) {
  if (typeof value !== "string" || !/^0[0-7]{3}$/.test(value)) {
    throw new ReleasePolicyError("invalid_manifest_mode", `Invalid mode for ${relativePath}`);
  }
  const mode = Number.parseInt(value, 8);
  if (mode !== 0o644 && mode !== 0o755) {
    throw new ReleasePolicyError("unsafe_archive_mode", `Unsafe mode for ${relativePath}`);
  }
  return mode;
}

function resolveInside(root, relativePath) {
  const absolutePath = path.resolve(root, ...relativePath.split("/"));
  if (!absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new ReleasePolicyError("path_traversal", `Path escapes extraction root: ${relativePath}`);
  }
  return absolutePath;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseArgs(argv) {
  const args = {};
  for (const token of argv) {
    const separator = token.indexOf("=");
    if (!token.startsWith("--") || separator < 3) {
      throw new Error(`Expected --key=value, received: ${token}`);
    }
    args[token.slice(2, separator)] = token.slice(separator + 1);
  }
  return args;
}

async function main(argv) {
  const args = parseArgs(argv);
  const result = await verifyReleaseArtifact({
    archivePath: path.resolve(args.archive),
    manifestPath: path.resolve(args.manifest),
    checksumPath: path.resolve(args.checksum),
    kit: args.kit,
    destination: args.destination ? path.resolve(args.destination) : undefined
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
