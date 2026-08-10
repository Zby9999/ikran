#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildReleaseKits } from "./build.mjs";
import { ReleasePolicyError } from "./policy.mjs";
import { smokeProductKit } from "./smoke-product.mjs";
import { verifyReleaseArtifact } from "./verify-artifact.mjs";
import { verifyInstalledProfile } from "./verify-install.mjs";

/** Build both assets, verify them offline, and optionally test clean installs. */
export async function gateRelease({ repoRoot, outDir, version, clean = "none", keepExtracted = false }) {
  if (!new Set(["none", "product", "contributor", "all"]).has(clean)) {
    throw new ReleasePolicyError("invalid_clean_gate", `Unknown clean gate: ${clean}`);
  }
  const results = await buildReleaseKits({ repoRoot, outDir, version });
  const extracted = [];
  const reports = [];
  try {
    for (const result of results) {
      const destination = await mkdtemp(path.join(tmpdir(), `ikran-${result.kit}-gate-`));
      extracted.push(destination);
      const verified = await verifyReleaseArtifact({
        archivePath: result.archivePath,
        manifestPath: result.manifestPath,
        checksumPath: result.checksumPath,
        kit: result.kit,
        destination
      });
      const shouldClean = clean === "all" || clean === result.kit;
      let install = null;
      let smoke = null;
      if (shouldClean && result.kit === "product") {
        await run("npm", ["run", "setup:product"], verified.extractedRoot);
        install = await verifyInstalledProfile({ root: verified.extractedRoot, kit: "product" });
        smoke = await smokeProductKit({ root: verified.extractedRoot });
      }
      if (shouldClean && result.kit === "contributor") {
        await run("npm", ["run", "setup:contributor"], verified.extractedRoot);
        await run("npm", ["run", "check"], verified.extractedRoot);
        install = await verifyInstalledProfile({ root: verified.extractedRoot, kit: "contributor" });
      }
      reports.push({
        ...verified,
        extractedRoot: keepExtracted ? verified.extractedRoot : null,
        install,
        smoke
      });
    }
    return Object.freeze(reports);
  } finally {
    if (!keepExtracted) {
      await Promise.all(extracted.map((directory) => rm(directory, { recursive: true, force: true })));
    } else if (extracted.length) {
      process.stderr.write(`Extracted release gates retained:\n${extracted.join("\n")}\n`);
    }
  }
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: "inherit",
      shell: process.platform === "win32"
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed (${signal ?? `exit ${code}`})`));
    });
  });
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const separator = token.indexOf("=");
    if (separator >= 3) {
      args[token.slice(2, separator)] = token.slice(separator + 1);
      continue;
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
    args[key] = value;
    index += 1;
  }
  return args;
}

async function main(argv) {
  const args = parseArgs(argv);
  const repoRoot = path.resolve(args["repo-root"] ?? process.cwd());
  const outDir = path.resolve(repoRoot, args["out-dir"] ?? "dist/release");
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  const reports = await gateRelease({
    repoRoot,
    outDir,
    version: args.version ?? packageJson.version,
    clean: args.clean ?? "none",
    keepExtracted: args["keep-extracted"] === "true"
  });
  process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
