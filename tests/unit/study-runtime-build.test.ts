import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import { buildStudyRuntime } from "../../scripts/release/build-study-runtime.mjs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

test("Study Runtime precompiles the TypeScript graph and removes runtime esbuild", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "ikran-study-runtime-"));
  temporaryDirectories.push(root);
  const sourceRoot = path.join(root, "source");
  const destinationRoot = path.join(root, "destination");

  writeSourceGraph(sourceRoot);
  writeRuntimeEntry(destinationRoot);
  writeNextConfig(destinationRoot);
  for (const packageName of ["tsx", "esbuild", "@esbuild/darwin-arm64"]) {
    write(path.join(destinationRoot, "node_modules", packageName, "sentinel"), "present\n");
  }
  for (const executable of ["tsx", "esbuild"]) {
    write(path.join(destinationRoot, "node_modules", ".bin", executable), "#!/bin/sh\n");
  }

  const result = buildStudyRuntime({ sourceRoot, destinationRoot });
  const runtime = readFileSync(path.join(destinationRoot, "bin", "ikran-runtime.mjs"), "utf8");
  const bundle = readFileSync(path.join(destinationRoot, result.bundle), "utf8");

  expect(result).toMatchObject({
    runtimeTranspiler: "precompiled",
    nextConfig: "precompiled-esm",
    embeddedEsbuildExecutables: 0
  });
  expect(runtime).not.toMatch(/importTsxModule|pathToFileURL|import ["']tsx["']/);
  expect(runtime).toContain('import("../lib/runtime/study-runtime-bundle.mjs")');
  expect(bundle).toContain("registerIkranTools");
  expect(bundle).not.toContain(sourceRoot);
  expect(readFileSync(path.join(destinationRoot, "next.config.mjs"), "utf8")).not.toContain("NextConfig");
  expect(() => readFileSync(path.join(destinationRoot, "next.config.ts"))).toThrow();
  expect(readFileSync(path.join(destinationRoot, ".next", "required-server-files.json"), "utf8")).toContain("next.config.mjs");
  expect(() => readFileSync(path.join(destinationRoot, "node_modules", "esbuild", "sentinel"))).toThrow();
  expect(() => readFileSync(path.join(destinationRoot, "node_modules", "@esbuild", "darwin-arm64", "sentinel"))).toThrow();
  expect(() => readFileSync(path.join(destinationRoot, "node_modules", "tsx", "sentinel"))).toThrow();
  expect(() => readFileSync(path.join(destinationRoot, "node_modules", ".bin", "tsx"))).toThrow();
  expect(() => readFileSync(path.join(destinationRoot, "node_modules", ".bin", "esbuild"))).toThrow();
});

function writeSourceGraph(root: string) {
  const modules: Record<string, string> = {
    "lib/mcp/register-tools.ts": "export function registerIkranTools() {}\nexport const resolveMcpInstructions = () => 'ok';\n",
    "lib/mcp/discover-working-folder.ts": "export const resolveWorkingFolder = () => '.';\n",
    "lib/runtime/runtime-lifecycle.ts": "export const createRuntimeLifecycle = () => ({});\nexport function registerRuntimeControl() {}\n",
    "lib/runtime/preview-server.ts": "export function killAllPreviewServers() {}\n",
    "lib/runtime/prototype-surface.ts": "export function markPrototypeSurfacesStaleForShutdown() {}\n",
    "lib/runtime/project.ts": "export const getActiveProject = () => null;\n"
  };
  for (const [relativePath, content] of Object.entries(modules)) {
    write(path.join(root, relativePath), content);
  }
}

function writeNextConfig(root: string) {
  write(
    path.join(root, "next.config.ts"),
    'import type { NextConfig } from "next";\n\nconst nextConfig: NextConfig = { devIndicators: false };\n\nexport default nextConfig;\n'
  );
  write(
    path.join(root, ".next", "required-server-files.json"),
    '{"config":{"configFileName":"next.config.ts","configOrigin":"next.config.ts"}}\n'
  );
  write(
    path.join(root, ".next", "required-server-files.js"),
    'module.exports = {"configFileName":"next.config.ts"};\n'
  );
}

function writeRuntimeEntry(root: string) {
  write(
    path.join(root, "bin", "ikran-runtime.mjs"),
    `#!/usr/bin/env node
import "tsx";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { importTsxModule } from "../lib/runtime/tsx-module-interop.mjs";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mcpLibDir = path.join(appDir, "lib/mcp");
const { registerIkranTools, resolveMcpInstructions } = await importTsxModule(
  pathToFileURL(path.join(mcpLibDir, "register-tools.ts")).href
);
const { resolveWorkingFolder } = await importTsxModule(
  pathToFileURL(path.join(mcpLibDir, "discover-working-folder.ts")).href
);
const { createRuntimeLifecycle, registerRuntimeControl } = await importTsxModule(
  pathToFileURL(path.join(appDir, "lib/runtime/runtime-lifecycle.ts")).href
);

async function shutdown() {
  try {
    const { killAllPreviewServers } = await importTsxModule(
      pathToFileURL(path.join(appDir, "lib/runtime/preview-server.ts")).href
    );
    const { markPrototypeSurfacesStaleForShutdown } = await importTsxModule(
      pathToFileURL(path.join(appDir, "lib/runtime/prototype-surface.ts")).href
    );
    const { getActiveProject } = await importTsxModule(
      pathToFileURL(path.join(appDir, "lib/runtime/project.ts")).href
    );
    killAllPreviewServers();
    markPrototypeSurfacesStaleForShutdown(getActiveProject());
  } catch {}
}

void [registerIkranTools, resolveMcpInstructions, resolveWorkingFolder, createRuntimeLifecycle, registerRuntimeControl, shutdown];
`
  );
}

function write(file: string, content: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
}
