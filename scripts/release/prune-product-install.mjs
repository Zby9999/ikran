#!/usr/bin/env node
import { rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Next declares @playwright/test as an optional peer. npm therefore materializes
// the root devDependency even during `npm ci --omit=dev`. Ikran Runtime imports
// playwright-core directly, so the test runner and wrapper are safe to remove
// after npm has validated the one shared lockfile.
const PRODUCT_OPTIONAL_PEER_ONLY_PACKAGES = Object.freeze([
  "@playwright/test",
  "playwright"
]);

export async function pruneProductInstall({ root }) {
  const removed = [];
  for (const packageName of PRODUCT_OPTIONAL_PEER_ONLY_PACKAGES) {
    const packagePath = path.join(root, "node_modules", ...packageName.split("/"));
    await rm(packagePath, { recursive: true, force: true });
    removed.push(packageName);
  }
  return Object.freeze({ removed, retained: ["playwright-core"] });
}

async function main() {
  const result = await pruneProductInstall({ root: process.cwd() });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
