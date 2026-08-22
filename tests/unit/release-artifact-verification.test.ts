import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

// @ts-expect-error release scripts deliberately run without TypeScript compilation
import { buildReleaseKitForTests } from "../../scripts/release/build.mjs";
// @ts-expect-error release scripts deliberately run without TypeScript compilation
import { verifyReleaseArtifact } from "../../scripts/release/verify-artifact.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const PACKAGE_VERSION = JSON.parse(
  readFileSync(path.join(ROOT, "package.json"), "utf8")
).version as string;
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("release artifact verification", () => {
  test("checks every sidecar and safely extracts the declared file modes", async () => {
    const output = temporaryDirectory("ikran-artifact-output-");
    const destination = temporaryDirectory("ikran-artifact-extract-");
    const built = await buildReleaseKitForTests({
      repoRoot: ROOT,
      outDir: output,
      kit: "agent-plugin",
      version: PACKAGE_VERSION,
      sourceDateEpoch: 1_700_000_000
    });

    const verified = await verifyReleaseArtifact({
      archivePath: built.archivePath,
      manifestPath: built.manifestPath,
      checksumPath: built.checksumPath,
      kit: "agent-plugin",
      destination
    });

    expect(verified).toMatchObject({
      kit: "agent-plugin",
      version: PACKAGE_VERSION,
      fileCount: built.fileCount,
      sha256: built.sha256
    });
    expect(statSync(path.join(verified.extractedRoot, "bin/ikran.mjs")).mode & 0o777).toBe(0o755);
    expect(statSync(path.join(verified.extractedRoot, "package.json")).mode & 0o777).toBe(0o644);
    expect(readFileSync(path.join(verified.extractedRoot, "RELEASE-MANIFEST.json"))).toEqual(
      readFileSync(built.manifestPath)
    );
  });

  test("rejects checksum tampering and a divergent manifest sidecar", async () => {
    const output = temporaryDirectory("ikran-artifact-tamper-");
    const built = await buildReleaseKitForTests({
      repoRoot: ROOT,
      outDir: output,
      kit: "agent-plugin",
      version: PACKAGE_VERSION,
      sourceDateEpoch: 1_700_000_000
    });
    const originalChecksum = readFileSync(built.checksumPath);
    const originalManifest = readFileSync(built.manifestPath);

    writeFileSync(built.checksumPath, `${"0".repeat(64)}  ${built.archiveName}\n`);
    await expect(
      verifyReleaseArtifact({
        archivePath: built.archivePath,
        manifestPath: built.manifestPath,
        checksumPath: built.checksumPath,
        kit: "agent-plugin"
      })
    ).rejects.toMatchObject({ code: "checksum_mismatch" });

    writeFileSync(built.checksumPath, originalChecksum);
    const changedManifest = JSON.parse(originalManifest.toString("utf8"));
    changedManifest.title = "tampered";
    writeFileSync(built.manifestPath, `${JSON.stringify(changedManifest, null, 2)}\n`);
    await expect(
      verifyReleaseArtifact({
        archivePath: built.archivePath,
        manifestPath: built.manifestPath,
        checksumPath: built.checksumPath,
        kit: "agent-plugin"
      })
    ).rejects.toMatchObject({ code: "embedded_manifest_mismatch" });
  });
});

function temporaryDirectory(prefix: string) {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}
