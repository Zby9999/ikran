#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ReleasePolicyError, getReleaseKit } from "./policy.mjs";

/**
 * Post-install gate for an extracted kit. Product must contain every direct
 * production dependency and none of its dev-only direct dependencies.
 */
export async function verifyInstalledProfile({ root, kit: kitId }) {
  const kit = getReleaseKit(kitId);
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const production = Object.keys(packageJson.dependencies ?? {}).sort(compareText);
  const devOnly = Object.keys(packageJson.devDependencies ?? {})
    .filter((dependency) => !packageJson.dependencies?.[dependency])
    .sort(compareText);

  const missing = [];
  for (const dependency of production) {
    if (!(await packageIsInstalled(root, dependency))) missing.push(dependency);
  }
  if (missing.length) {
    throw new ReleasePolicyError(
      "missing_installed_dependency",
      `Missing ${kit.id} dependencies: ${missing.join(", ")}`,
      { missing }
    );
  }

  if (kit.id === "product") {
    const leaked = [];
    for (const dependency of devOnly) {
      if (await packageIsInstalled(root, dependency)) leaked.push(dependency);
    }
    if (leaked.length) {
      throw new ReleasePolicyError(
        "dev_dependency_installed",
        `Product install contains dev-only dependencies: ${leaked.join(", ")}`,
        { leaked }
      );
    }
  }

  return Object.freeze({
    kit: kit.id,
    productionDependencies: production.length,
    omittedDevDependencies: kit.id === "product" ? devOnly.length : 0
  });
}

async function packageIsInstalled(root, packageName) {
  const packagePath = path.join(root, "node_modules", ...packageName.split("/"), "package.json");
  try {
    await access(packagePath);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw error;
  }
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function main(argv) {
  const args = Object.fromEntries(
    argv.map((token) => {
      const separator = token.indexOf("=");
      if (!token.startsWith("--") || separator < 3) {
        throw new Error(`Expected --key=value, received: ${token}`);
      }
      return [token.slice(2, separator), token.slice(separator + 1)];
    })
  );
  const result = await verifyInstalledProfile({
    root: path.resolve(args.root ?? process.cwd()),
    kit: args.kit ?? "product"
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
