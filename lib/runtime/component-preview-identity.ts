import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
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
    `module:${file(projectPath, input.modulePath)}`,
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
