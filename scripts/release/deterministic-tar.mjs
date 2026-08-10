import { gzipSync } from "node:zlib";
import { ReleasePolicyError, normalizeReleasePath } from "./policy.mjs";

const BLOCK_SIZE = 512;

/** Build a ustar archive using normalized metadata and a stable input order. */
export function createDeterministicTarGz(entries, { mtime = 0 } = {}) {
  if (!Number.isSafeInteger(mtime) || mtime < 0) {
    throw new ReleasePolicyError("invalid_mtime", "Archive mtime must be a non-negative integer");
  }

  const normalized = [...entries]
    .map((entry) => ({
      path: normalizeReleasePath(entry.path),
      content: Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content),
      mode: entry.mode ?? 0o644
    }))
    .sort((left, right) => compareText(left.path, right.path));

  const seen = new Set();
  const blocks = [];
  for (const entry of normalized) {
    if (seen.has(entry.path)) {
      throw new ReleasePolicyError("duplicate_archive_path", `Duplicate archive path: ${entry.path}`);
    }
    seen.add(entry.path);
    blocks.push(createHeader(entry, mtime), entry.content);
    const padding = paddingFor(entry.content.length);
    if (padding) blocks.push(Buffer.alloc(padding));
  }
  blocks.push(Buffer.alloc(BLOCK_SIZE * 2));

  const gzip = gzipSync(Buffer.concat(blocks), { level: 9 });
  // zlib currently emits zero here, but enforcing it makes determinism explicit
  // across supported Node patch releases. Gzip header mtime is not checksummed.
  gzip.fill(0, 4, 8);
  return gzip;
}

function createHeader(entry, mtime) {
  const header = Buffer.alloc(BLOCK_SIZE);
  const { name, prefix } = splitUstarPath(entry.path);
  writeText(header, name, 0, 100, "archive name");
  writeOctal(header, entry.mode, 100, 8, "mode");
  writeOctal(header, 0, 108, 8, "uid");
  writeOctal(header, 0, 116, 8, "gid");
  writeOctal(header, entry.content.length, 124, 12, "size");
  writeOctal(header, mtime, 136, 12, "mtime");
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeText(header, "ustar\0", 257, 6, "magic");
  writeText(header, "00", 263, 2, "version");
  writeText(header, prefix, 345, 155, "archive prefix");

  let checksum = 0;
  for (const byte of header) checksum += byte;
  const checksumText = checksum.toString(8).padStart(6, "0");
  writeText(header, checksumText, 148, 6, "checksum");
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function splitUstarPath(relativePath) {
  if (Buffer.byteLength(relativePath) <= 100) return { name: relativePath, prefix: "" };
  const slashIndexes = [];
  for (let index = 0; index < relativePath.length; index += 1) {
    if (relativePath[index] === "/") slashIndexes.push(index);
  }
  for (const slash of slashIndexes.reverse()) {
    const prefix = relativePath.slice(0, slash);
    const name = relativePath.slice(slash + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) {
      return { name, prefix };
    }
  }
  throw new ReleasePolicyError("tar_path_too_long", `Path cannot fit in ustar: ${relativePath}`);
}

function writeText(buffer, text, offset, length, label) {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length > length) {
    throw new ReleasePolicyError("tar_field_too_long", `${label} exceeds ${length} bytes`);
  }
  bytes.copy(buffer, offset);
}

function writeOctal(buffer, number, offset, length, label) {
  const digits = number.toString(8);
  if (digits.length > length - 1) {
    throw new ReleasePolicyError("tar_number_too_large", `${label} does not fit in tar header`);
  }
  writeText(buffer, digits.padStart(length - 1, "0"), offset, length - 1, label);
  buffer[offset + length - 1] = 0;
}

function paddingFor(size) {
  return (BLOCK_SIZE - (size % BLOCK_SIZE)) % BLOCK_SIZE;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
