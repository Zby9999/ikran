import fs from "node:fs";
import path from "node:path";

import { buildSync } from "esbuild";

const STUDY_RUNTIME_BUNDLE = path.join(
  "lib",
  "runtime",
  "study-runtime-bundle.mjs"
);

const STUDY_RUNTIME_ENTRY = `
export { registerIkranTools, resolveMcpInstructions } from "./lib/mcp/register-tools.ts";
export { resolveWorkingFolder } from "./lib/mcp/discover-working-folder.ts";
export { createRuntimeLifecycle, registerRuntimeControl } from "./lib/runtime/runtime-lifecycle.ts";
export { killAllPreviewServers } from "./lib/runtime/preview-server.ts";
export { markPrototypeSurfacesStaleForShutdown } from "./lib/runtime/prototype-surface.ts";
export { getActiveProject } from "./lib/runtime/project.ts";
`;

/**
 * Build the Study Kit's MCP/runtime TypeScript graph ahead of time. The
 * downloaded plugin can then start without executing tsx/esbuild, which macOS
 * Gatekeeper blocks when a browser-downloaded archive propagates quarantine to
 * the embedded esbuild binary.
 */
export function buildStudyRuntime({ sourceRoot, destinationRoot }) {
  const runtimeEntry = path.join(destinationRoot, "bin", "ikran-runtime.mjs");
  const bundleFile = path.join(destinationRoot, STUDY_RUNTIME_BUNDLE);

  assertFile(path.join(sourceRoot, "lib", "mcp", "register-tools.ts"));
  assertFile(runtimeEntry);
  fs.mkdirSync(path.dirname(bundleFile), { recursive: true });

  const build = buildSync({
    absWorkingDir: sourceRoot,
    stdin: {
      contents: STUDY_RUNTIME_ENTRY,
      loader: "ts",
      resolveDir: sourceRoot,
      sourcefile: "study-runtime-entry.ts"
    },
    outfile: path.join(
      sourceRoot,
      ".ikran-study-build",
      "study-runtime-bundle.mjs"
    ),
    write: false,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    packages: "external",
    sourcemap: false,
    legalComments: "none",
    logLevel: "silent"
  });
  const bundleOutput = build.outputFiles?.find((output) =>
    output.path.endsWith("study-runtime-bundle.mjs")
  );
  if (!bundleOutput) throw new Error("Study Runtime bundler produced no output");
  const localSourceRoots = new Set([sourceRoot, fs.realpathSync(sourceRoot)]);
  let bundleSource = Buffer.from(bundleOutput.contents).toString("utf8");
  for (const localSourceRoot of localSourceRoots) {
    bundleSource = bundleSource.replaceAll(localSourceRoot, "plugin-source");
  }
  if (
    [...localSourceRoots].some((localSourceRoot) =>
      bundleSource.includes(localSourceRoot)
    )
  ) {
    throw new Error("Study Runtime bundle contains its local source path");
  }
  fs.writeFileSync(bundleFile, bundleSource, "utf8");

  const original = fs.readFileSync(runtimeEntry, "utf8");
  const patched = patchRuntimeEntry(original, runtimeEntry);
  fs.writeFileSync(runtimeEntry, patched, "utf8");
  precompileNextConfig(destinationRoot);

  const removedRuntimeTranspilers = [
    path.join(destinationRoot, "node_modules", "tsx"),
    path.join(destinationRoot, "node_modules", "esbuild"),
    path.join(destinationRoot, "node_modules", "@esbuild")
  ];
  for (const packagePath of removedRuntimeTranspilers) {
    fs.rmSync(packagePath, { recursive: true, force: true });
  }
  for (const executable of ["tsx", "esbuild"]) {
    const binPath = path.join(destinationRoot, "node_modules", ".bin", executable);
    if (fs.lstatSync(binPath, { throwIfNoEntry: false })) fs.unlinkSync(binPath);
  }

  return Object.freeze({
    bundle: STUDY_RUNTIME_BUNDLE.split(path.sep).join("/"),
    bytes: fs.statSync(bundleFile).size,
    runtimeTranspiler: "precompiled",
    nextConfig: "precompiled-esm",
    embeddedEsbuildExecutables: 0
  });
}

function precompileNextConfig(destinationRoot) {
  const tsConfig = path.join(destinationRoot, "next.config.ts");
  const mjsConfig = path.join(destinationRoot, "next.config.mjs");
  assertFile(tsConfig);
  let source = fs.readFileSync(tsConfig, "utf8");
  source = replaceExactlyOnce(
    source,
    'import type { NextConfig } from "next";\n\n',
    "",
    tsConfig
  );
  source = replaceExactlyOnce(
    source,
    "const nextConfig: NextConfig =",
    "const nextConfig =",
    tsConfig
  );
  fs.writeFileSync(mjsConfig, source, "utf8");
  fs.unlinkSync(tsConfig);

  for (const relativePath of [
    path.join(".next", "required-server-files.json"),
    path.join(".next", "required-server-files.js")
  ]) {
    const file = path.join(destinationRoot, relativePath);
    assertFile(file);
    const before = fs.readFileSync(file, "utf8");
    const after = before.replaceAll("next.config.ts", "next.config.mjs");
    if (after === before) {
      throw new Error(`Production build did not reference next.config.ts: ${file}`);
    }
    fs.writeFileSync(file, after, "utf8");
  }
}

export function patchRuntimeEntry(input, file = "bin/ikran-runtime.mjs") {
  let source = input;
  source = replaceExactlyOnce(source, 'import "tsx";\n', "", file);
  source = replaceExactlyOnce(
    source,
    'import { fileURLToPath, pathToFileURL } from "node:url";',
    'import { fileURLToPath } from "node:url";',
    file
  );
  source = replaceExactlyOnce(
    source,
    'import { importTsxModule } from "../lib/runtime/tsx-module-interop.mjs";\n',
    "",
    file
  );
  source = replaceExactlyOnce(
    source,
    `const mcpLibDir = path.join(appDir, "lib/mcp");
const { registerIkranTools, resolveMcpInstructions } = await importTsxModule(
  pathToFileURL(path.join(mcpLibDir, "register-tools.ts")).href
);
const { resolveWorkingFolder } = await importTsxModule(
  pathToFileURL(path.join(mcpLibDir, "discover-working-folder.ts")).href
);
const { createRuntimeLifecycle, registerRuntimeControl } = await importTsxModule(
  pathToFileURL(path.join(appDir, "lib/runtime/runtime-lifecycle.ts")).href
);`,
    `const {
  createRuntimeLifecycle,
  getActiveProject,
  killAllPreviewServers,
  markPrototypeSurfacesStaleForShutdown,
  registerIkranTools,
  registerRuntimeControl,
  resolveMcpInstructions,
  resolveWorkingFolder
} = await import("../lib/runtime/study-runtime-bundle.mjs");`,
    file
  );
  source = replaceExactlyOnce(
    source,
    `    const { killAllPreviewServers } = await importTsxModule(
      pathToFileURL(path.join(appDir, "lib/runtime/preview-server.ts")).href
    );
    const { markPrototypeSurfacesStaleForShutdown } = await importTsxModule(
      pathToFileURL(path.join(appDir, "lib/runtime/prototype-surface.ts")).href
    );
    const { getActiveProject } = await importTsxModule(
      pathToFileURL(path.join(appDir, "lib/runtime/project.ts")).href
    );
`,
    "",
    file
  );
  if (/importTsxModule|pathToFileURL|import ["']tsx["']/.test(source)) {
    throw new Error(`Study Runtime still contains a runtime TypeScript loader: ${file}`);
  }
  return source;
}

function replaceExactlyOnce(source, before, after, file) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Expected exactly one Study Runtime patch target in ${file}: ${before}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function assertFile(file) {
  if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Missing Study Runtime source file: ${file}`);
  }
}
