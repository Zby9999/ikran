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
    `Alpha evaluation build for macOS on Apple Silicon. This release adds a Claude Code-native plugin adapter to the Product Test Kit.\n\n` +
    `## Download one Kit\n\n` +
    `- **Product Test Kit** — run Ikran with production dependencies and no automated test corpus. The Kit root is an Agent Plugin 1.0 package (\`plugin.json\`, \`mcp.json\`, \`skills/\`) and a Claude Code plugin (\`.claude-plugin/plugin.json\`, \`.mcp.json\`, the same \`skills/\`). Install the extracted directory, not the GitHub source clone.\n` +
    `- **Contributor Verification Kit** — includes the allowlisted typecheck, Vitest, and Playwright verification surface.\n\n` +
    `Both archives exclude local state, credentials, real Figma data, build caches, and internal research/R&D archives. Read the included README before setup.\n\n` +
    `## Claude Code\n\n` +
    `Prepare the extracted Product Test Kit first. \`--prod\` requires that production build; Claude Code's bounded \`npm ci --ignore-scripts\` does not replace it. Then load the Kit from the designer's project directory so \`\${CLAUDE_PROJECT_DIR}\` is the project, not the Kit:\n\n` +
    "```bash\n" +
    "cd /absolute/path/to/extracted-ikran\n" +
    "npm run setup:product\n\n" +
    "cd /absolute/path/to/your-project\n" +
    "claude --plugin-dir /absolute/path/to/extracted-ikran\n" +
    "```\n\n" +
    "That adapter starts `ikran-mcp --prod` and exposes `skills/design-system-governance`. Ask Claude to open Ikran, then open the returned localhost Workbench URL in the system browser.\n\n" +
    "If you only need the MCP tools without the plugin Skill, register the same stdio entry at Claude's local scope. Do not commit another machine's Kit path into a shared project `.mcp.json`:\n\n" +
    "```bash\n" +
    "claude mcp add --transport stdio --scope local \\\n" +
    "  --env IKRAN_CWD=/absolute/path/to/your-project \\\n" +
    "  --env IKRAN_STATE_DIR=/absolute/path/to/your-project/.ikran \\\n" +
    "  ikran -- node /absolute/path/to/extracted-ikran/bin/ikran-mcp.mjs --prod\n\n" +
    "claude mcp get ikran\n" +
    "```\n\n" +
    `Do not publish this repository as a Claude marketplace plugin yet. The Runtime still needs \`npm run setup:product\` (production build and Chromium).\n\n` +
    `## Cursor and Codex\n\n` +
    `After \`npm run setup:product\`, register the extracted Kit as a local Agent Plugin 1.0 package, or launch the same stdio entry:\n\n` +
    "```text\n" +
    "node /absolute/path/to/ikran/bin/ikran-mcp.mjs --prod\n" +
    "```\n\n" +
    "Set both of these values when the host working directory is the designer's project:\n\n" +
    "```text\n" +
    "IKRAN_CWD=/absolute/path/to/your-project\n" +
    "IKRAN_STATE_DIR=/absolute/path/to/your-project/.ikran\n" +
    "```\n\n" +
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
