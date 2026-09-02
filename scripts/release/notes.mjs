#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_RELEASE_KITS, getReleaseKit, normalizeReleaseVersion } from "./policy.mjs";

export async function writeDraftReleaseNotes({ outDir, version, outputPath }) {
  const safeVersion = normalizeReleaseVersion(version);
  const assets = [];
  for (const kitId of DEFAULT_RELEASE_KITS) {
    const kit = getReleaseKit(kitId);
    const archiveName = `${kit.assetStem}-${safeVersion}.tar.gz`;
    const checksum = await readFile(path.join(outDir, `${archiveName}.sha256`), "utf8");
    const match = checksum.match(/^([a-f0-9]{64})  /);
    if (!match) throw new Error(`Invalid checksum for ${archiveName}`);
    assets.push({ kit, archiveName, sha256: match[1] });
  }

  const notes = `# Ikran v${safeVersion}\n\n` +
    `Alpha evaluation build for macOS on Apple Silicon. Download one product Kit: the Agent Plugin Kit (Cursor, Codex, Agent Plugin 1.0) or the Claude Plugin Kit (Claude Code beta, 2KB MCP contract). They are not interchangeable.\n\n` +
    `## What's new\n\n` +
    `- Bundles the Playwright-matched Chromium runtime in both Study Kits and launches it during workspace activation, so a fresh machine fails before Alignment instead of during component registration.\n` +
    `- Preserves exact browser infrastructure errors, retries unchanged component declarations after transient infrastructure recovery, reuses a browser pool and verification results across runs, and invalidates verification when imported or global styles and fonts change.\n` +
    `- Makes an accepted Rule Update revision authoritative for its exact target, automatically binds canonical proposal evidence to the source declaration, and rejects semantic apply drift before ingest without forcing a new acceptance for provenance-only repair.\n` +
    `- Retains the optimized 16-card, multi-option Alignment checkpoint and canonical Figma reference in both Codex Study Kits.\n\n` +
    `## Download one Kit\n\n` +
    `- **Agent Plugin Kit** — production Runtime plus Agent Plugin 1.0 (\`plugin.json\`, \`mcp.json\`, \`skills/\`) and host-native Cursor/Codex adapters (\`.cursor-plugin/plugin.json\`, \`.codex-plugin/plugin.json\`). Does not include the Claude Code adapter.\n` +
    `- **Claude Plugin Kit** — the same production Runtime plus the Claude Code-native adapter (\`.claude-plugin/plugin.json\`, \`.mcp.json\`). Uses the 2KB-truncated MCP instruction budget. Does not include Cursor or Codex adapters.\n` +
    `- **Contributor Verification Kit** — includes the allowlisted typecheck, Vitest, and Playwright verification surface, plus both plugin layouts for maintainers.\n\n` +
    `All archives exclude local state, credentials, real Figma data, build caches, and internal research/R&D archives. Install the extracted directory, not the GitHub source clone. Read the included README before setup.\n\n` +
    `## Claude Code\n\n` +
    `Download the **Claude Plugin Kit**. Prepare it first. \`--prod\` requires that production build; Claude Code's bounded \`npm ci --ignore-scripts\` does not replace it. Then load the Kit from the designer's project directory so \`\${CLAUDE_PROJECT_DIR}\` is the project, not the Kit:\n\n` +
    "```bash\n" +
    "cd /absolute/path/to/extracted-ikran\n" +
    "npm run setup:product\n\n" +
    "cd /absolute/path/to/your-project\n" +
    "claude --plugin-dir /absolute/path/to/extracted-ikran\n" +
    "```\n\n" +
    "That adapter starts `ikran-mcp --prod` and exposes `skills/ikran-alignment`, `skills/ikran-extraction`, `skills/ikran-prototype`, and `skills/ikran-governance`. Ask Claude to open Ikran, then open the returned localhost Workbench URL in the system browser.\n\n" +
    "If you only need the MCP tools without the plugin Skill, register the same stdio entry at Claude's local scope. Do not commit another machine's Kit path into a shared project `.mcp.json`:\n\n" +
    "```bash\n" +
    "claude mcp add --transport stdio --scope local \\\n" +
    "  --env IKRAN_CWD=/absolute/path/to/your-project \\\n" +
    "  --env IKRAN_STATE_DIR=/absolute/path/to/your-project/.ikran \\\n" +
    "  --env IKRAN_MCP_HOST=claude \\\n" +
    "  ikran -- node /absolute/path/to/extracted-ikran/bin/ikran-mcp.mjs --prod\n\n" +
    "claude mcp get ikran\n" +
    "```\n\n" +
    `Do not publish this repository as a Claude marketplace plugin yet. The Runtime still needs \`npm run setup:product\` for its production build; Study Kits include their own matched Chromium runtime.\n\n` +
    `## Cursor\n\n` +
    `Download the **Agent Plugin Kit**. After \`npm run setup:product\`, symlink the extracted Kit into Cursor's local plugin directory and reload Cursor from the designer's project:\n\n` +
    "```bash\n" +
    "mkdir -p ~/.cursor/plugins/local\n" +
    "ln -sfn /absolute/path/to/extracted-ikran ~/.cursor/plugins/local/ikran\n" +
    "```\n\n" +
    `Cursor discovers \`skills/\` and starts \`ikran-mcp --prod\` from the Agent Plugin \`mcp.json\`. Do not publish this Kit as a Cursor marketplace plugin yet.\n\n` +
    `## Codex\n\n` +
    `Download the **Agent Plugin Kit**. After \`npm run setup:product\`, symlink the extracted Kit next to a personal marketplace entry. Codex inlines MCP launch in \`.codex-plugin/plugin.json\` (\`cwd: "."\`):\n\n` +
    "```bash\n" +
    "mkdir -p ~/.agents/plugins\n" +
    "ln -sfn /absolute/path/to/extracted-ikran ~/.agents/plugins/ikran\n" +
    "```\n\n" +
    "Write `~/.agents/plugins/marketplace.json`:\n\n" +
    "```json\n" +
    "{\n" +
    "  \"name\": \"local-ikran\",\n" +
    "  \"interface\": { \"displayName\": \"Local Ikran\" },\n" +
    "  \"plugins\": [\n" +
    "    {\n" +
    "      \"name\": \"ikran\",\n" +
    "      \"source\": { \"source\": \"local\", \"path\": \"./ikran\" },\n" +
    "      \"policy\": {\n" +
    "        \"installation\": \"AVAILABLE\",\n" +
    "        \"authentication\": \"ON_INSTALL\"\n" +
    "      },\n" +
    "      \"category\": \"Productivity\"\n" +
    "    }\n" +
    "  ]\n" +
    "}\n" +
    "```\n\n" +
    `Restart Codex or the ChatGPT desktop app, then install Ikran from that local marketplace. The stdio fallback remains \`codex mcp add\`.\n\n` +
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
