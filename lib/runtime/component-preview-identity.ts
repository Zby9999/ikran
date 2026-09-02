import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export interface ComponentPreviewIdentityInput {
  modulePath: string;
  registrationDigest: string;
  providerRecipeJson?: string | null;
  adapterArtifactPath: string;
  manifestArtifactPath: string;
  prototypeRoot: string;
}

function digestParts(parts: readonly string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(String(Buffer.byteLength(part)));
    hash.update(":");
    hash.update(part);
    hash.update("|");
  }
  return hash.digest("hex");
}

function file(projectPath: string, relativePath: string): string {
  try {
    return readFileSync(path.join(projectPath, relativePath), "utf8");
  } catch {
    return "<missing>";
  }
}

const SOURCE_EXTENSIONS = [
  "", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".scss",
  ".sass", ".less", ".json", ".svg", ".png", ".jpg", ".jpeg", ".gif",
  ".woff", ".woff2", ".ttf", ".otf"
];

const RENDER_ASSET_EXTENSIONS = new Set([
  ".css", ".scss", ".sass", ".less", ".woff", ".woff2", ".ttf", ".otf"
]);

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (
    relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
  );
}

function resolveLocalImport(
  prototypeRoot: string,
  importer: string,
  specifier: string
): string | null {
  const clean = specifier.split("?")[0]!.split("#")[0]!;
  let base: string;
  if (clean.startsWith("./") || clean.startsWith("../")) {
    base = path.resolve(path.dirname(importer), clean);
  } else if (clean.startsWith("@/") || clean.startsWith("~/")) {
    base = path.resolve(prototypeRoot, clean.slice(2));
  } else if (clean.startsWith("/")) {
    base = path.resolve(prototypeRoot, `.${clean}`);
  } else {
    return null;
  }
  if (!inside(prototypeRoot, base)) return null;
  for (const extension of SOURCE_EXTENSIONS) {
    for (const candidate of [base + extension, path.join(base, `index${extension}`)]) {
      try {
        if (statSync(candidate).isFile() && inside(prototypeRoot, candidate)) return candidate;
      } catch {
        // Try the next supported resolution shape.
      }
    }
  }
  return null;
}

function localSpecifiers(source: string, extension: string): string[] {
  const found: string[] = [];
  const add = (pattern: RegExp) => {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) found.push(match[1]);
    }
  };
  add(/(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g);
  add(/(?:require|import)\(\s*["']([^"']+)["']\s*\)/g);
  if ([".css", ".scss", ".sass", ".less"].includes(extension)) {
    add(/@import\s+(?:url\(\s*)?["']([^"']+)["']/g);
    add(/url\(\s*["']?([^"')]+)["']?\s*\)/g);
  }
  return found;
}

function sharedRenderAssets(projectPath: string, prototypeRoot: string): string[] {
  const pending = [prototypeRoot];
  const parts: string[] = [];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && new Set(["node_modules", ".next", ".git", ".ikran"]).has(entry.name)) {
        continue;
      }
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolute);
      } else if (entry.isFile() && RENDER_ASSET_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        const relative = path.relative(projectPath, absolute).split(path.sep).join("/");
        parts.push(`${relative}:${createHash("sha256").update(readFileSync(absolute)).digest("hex")}`);
      }
    }
  }
  return parts.sort();
}

/** Hash the local render graph, including stylesheets and font/image assets. */
function renderGraph(projectPath: string, input: ComponentPreviewIdentityInput): string[] {
  const prototypeRoot = path.resolve(projectPath, input.prototypeRoot);
  const entry = path.resolve(projectPath, input.modulePath);
  const pending = [entry];
  const visited = new Set<string>();
  const parts: string[] = [];
  while (pending.length > 0) {
    const absolute = pending.pop()!;
    if (visited.has(absolute) || !inside(prototypeRoot, absolute)) continue;
    visited.add(absolute);
    let bytes: Buffer;
    try {
      bytes = readFileSync(absolute);
    } catch {
      parts.push(`${path.relative(projectPath, absolute)}:<missing>`);
      continue;
    }
    const relative = path.relative(projectPath, absolute).split(path.sep).join("/");
    parts.push(`${relative}:${createHash("sha256").update(bytes).digest("hex")}`);
    const extension = path.extname(absolute).toLowerCase();
    if ([".woff", ".woff2", ".ttf", ".otf", ".png", ".jpg", ".jpeg", ".gif"].includes(extension)) {
      continue;
    }
    const source = bytes.toString("utf8");
    for (const specifier of localSpecifiers(source, extension)) {
      const resolved = resolveLocalImport(prototypeRoot, absolute, specifier);
      if (resolved && !visited.has(resolved)) pending.push(resolved);
    }
  }
  return [...new Set([...parts, ...sharedRenderAssets(projectPath, prototypeRoot)])].sort();
}

/** Deterministic, project-local identity for every input that can change a render. */
export function componentPreviewVerificationIdentity(
  projectPath: string,
  input: ComponentPreviewIdentityInput
): string {
  const dependencyFiles = [
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lock",
    "bun.lockb"
  ];
  const dependencies = dependencyFiles.flatMap((name) => {
    const relative = path.join(input.prototypeRoot, name);
    return existsSync(path.join(projectPath, relative))
      ? [`${name}:${file(projectPath, relative)}`]
      : [];
  });
  return digestParts([
    input.registrationDigest,
    ...renderGraph(projectPath, input).map((part) => `render:${part}`),
    `provider:${input.providerRecipeJson ?? ""}`,
    `adapter:${file(projectPath, input.adapterArtifactPath)}`,
    // The full shared registry contains unrelated components. The current
    // registration's normalized manifest entry is already represented by
    // registrationDigest; hashing the whole file would invalidate every
    // component whenever one sibling is added or edited.
    "manifest-contract:1",
    ...dependencies
  ]);
}
