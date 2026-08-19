#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getReleaseKit, normalizeReleaseVersion } from "./policy.mjs";

export async function writeDraftReleaseNotes({ outDir, version, outputPath }) {
  const safeVersion = normalizeReleaseVersion(version);
  const assets = [];
  for (const kitId of ["product", "contributor"]) {
    const kit = getReleaseKit(kitId);
    const archiveName = `${kit.assetStem}-${safeVersion}.tar.gz`;
    const checksum = await readFile(path.join(outDir, `${archiveName}.sha256`), "utf8");
    const match = checksum.match(/^([a-f0-9]{64})  /);
    if (!match) throw new Error(`Invalid checksum for ${archiveName}`);
    assets.push({ kit, archiveName, sha256: match[1] });
  }

  const notes = `# Ikran v${safeVersion}\n\n` +
    `Alpha evaluation build for macOS on Apple Silicon. Download one Kit:\n\n` +
    `- **Product Test Kit** — run Ikran with production dependencies and no automated test corpus. The Kit root is an Agent Plugin 1.0 package (\`plugin.json\`, \`mcp.json\`, \`skills/\`). Install the extracted directory, not the GitHub source clone.\n` +
    `- **Contributor Verification Kit** — includes the allowlisted typecheck, Vitest, and Playwright verification surface.\n\n` +
    `Both archives exclude local state, credentials, real Figma data, build caches, and internal research/R&D archives. ` +
    `Read the included README before setup.\n\n` +
    `## SHA-256\n\n` +
    assets.map(({ archiveName, sha256 }) => `- \`${archiveName}\`: \`${sha256}\``).join("\n") +
    `\n`;
  await writeFile(outputPath, notes);
  return Object.freeze({ outputPath, assets });
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
  const outDir = path.resolve(args["out-dir"] ?? "dist/release");
  const outputPath = path.resolve(args.output ?? path.join(outDir, "draft-release-notes.md"));
  const result = await writeDraftReleaseNotes({ outDir, version: args.version, outputPath });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
