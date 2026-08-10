import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, test } from "vitest";

// These modules are intentionally plain Node ESM so GitHub Actions can build
// a release before installing project dependencies.
// @ts-expect-error release scripts do not require the TypeScript toolchain
import { buildReleaseKit, buildReleaseKitForTests } from "../../scripts/release/build.mjs";
// @ts-expect-error release scripts do not require the TypeScript toolchain
import { createDeterministicTarGz } from "../../scripts/release/deterministic-tar.mjs";
// @ts-expect-error release scripts do not require the TypeScript toolchain
import { normalizeReleasePath } from "../../scripts/release/policy.mjs";
// @ts-expect-error release scripts do not require the TypeScript toolchain
import { pruneProductInstall } from "../../scripts/release/prune-product-install.mjs";
// @ts-expect-error release scripts do not require the TypeScript toolchain
import { assertCleanReleaseSource, selectReleaseFiles } from "../../scripts/release/selection.mjs";
// @ts-expect-error release scripts do not require the TypeScript toolchain
import { verifyInstalledProfile } from "../../scripts/release/verify-install.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("release selection policy", () => {
  test("selects the runtime/build surface for Product without test or R&D trees", async () => {
    const files = await selectReleaseFiles({ repoRoot: ROOT, kit: "product", source: "filesystem" });
    const paths = files.map((file: { path: string }) => file.path);

    expect(paths).toContain("README.md");
    expect(paths).toContain("LICENSE");
    expect(paths).toContain(".node-version");
    expect(paths).toContain(".npmrc");
    expect(paths).toContain("app/page.tsx");
    expect(paths).toContain("bin/ikran-runtime.mjs");
    expect(paths).toContain("lib/mcp/register-tools.ts");
    expect(paths).toContain("scripts/release/prune-product-install.mjs");
    expect(paths.some((file: string) => file.startsWith("app/prototypes/"))).toBe(false);
    expect(paths.some((file: string) => file.startsWith("tests/"))).toBe(false);
    expect(paths.some(isForbidden)).toBe(false);

    const packageJson = JSON.parse(
      files.find((file: { path: string }) => file.path === "package.json").content.toString("utf8")
    );
    expect(packageJson.private).toBe(true);
    expect(packageJson.dependencies["playwright-core"]).toBeTruthy();
    expect(packageJson.dependencies.typescript).toBeTruthy();
    expect(packageJson.dependencies["@playwright/test"]).toBeUndefined();
    expect(packageJson.devDependencies["@playwright/test"]).toBeTruthy();
    expect(packageJson.scripts["setup:product"]).toContain("npm ci --omit=dev");
    expect(packageJson.license).toBe("Apache-2.0");
    const packageLock = JSON.parse(
      files.find((file: { path: string }) => file.path === "package-lock.json").content.toString("utf8")
    );
    expect(packageLock.packages[""].license).toBe(packageJson.license);
  });

  test("adds the complete verification surface only for Contributor", async () => {
    const files = await selectReleaseFiles({ repoRoot: ROOT, kit: "contributor", source: "filesystem" });
    const paths = files.map((file: { path: string }) => file.path);

    expect(paths).toContain("playwright.config.ts");
    expect(paths).toContain("vitest.config.ts");
    expect(paths).toContain("LICENSE");
    expect(paths).toContain("tests/global-setup.ts");
    expect(paths).toContain("tests/unit/release-selection.test.ts");
    expect(paths).toContain("scripts/release/build.mjs");
    expect(paths.some((file: string) => file.startsWith("app/prototypes/"))).toBe(false);
    expect(paths.some(isForbidden)).toBe(false);
  });

  test("fails closed when a required runtime file is missing", async () => {
    const fixture = makeRepositoryFixture();
    unlinkSync(path.join(fixture, "bin/ikran.mjs"));

    await expect(selectReleaseFiles({ repoRoot: fixture, kit: "product" })).rejects.toMatchObject({
      code: "missing_required_path"
    });
  });

  test("fails closed when the distribution license is missing", async () => {
    const fixture = makeRepositoryFixture();
    unlinkSync(path.join(fixture, "LICENSE"));

    await expect(selectReleaseFiles({ repoRoot: fixture, kit: "product" })).rejects.toMatchObject({
      code: "missing_required_path",
      details: { path: "LICENSE" }
    });
  });

  test("fails closed when package metadata drifts from the distribution license", async () => {
    const fixture = makeRepositoryFixture();
    const manifestPath = path.join(fixture, "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.license = "MIT";
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);

    await expect(selectReleaseFiles({ repoRoot: fixture, kit: "product" })).rejects.toMatchObject({
      code: "release_license_mismatch",
      details: {
        expected: "Apache-2.0",
        packageJson: "MIT",
        packageLock: "Apache-2.0"
      }
    });
  });

  test("Git inventory excludes untracked files and the release CLI rejects a dirty source", async () => {
    const fixture = makeRepositoryFixture();
    execFileSync("git", ["init", "--quiet"], { cwd: fixture });
    execFileSync("git", ["add", "."], { cwd: fixture });
    write(fixture, "app/untracked-local-output.ts", "export const leaked = true;\n");

    const files = await selectReleaseFiles({ repoRoot: fixture, kit: "product", source: "git" });
    expect(files.some((file: { path: string }) => file.path === "app/untracked-local-output.ts")).toBe(false);
    await expect(assertCleanReleaseSource(fixture)).rejects.toMatchObject({
      code: "dirty_release_source"
    });
    await expect(
      buildReleaseKit({
        repoRoot: fixture,
        outDir: makeTemporaryDirectory("ikran-dirty-release-output-"),
        kit: "product",
        version: "0.1.0-alpha.1"
      })
    ).rejects.toMatchObject({ code: "dirty_release_source" });
  });

  test("rejects forbidden local state and credential-shaped content inside an allowed tree", async () => {
    const stateFixture = makeRepositoryFixture();
    write(stateFixture, "app/.env.local", "FIGMA_PAT=not-even-a-real-token\n");
    await expect(selectReleaseFiles({ repoRoot: stateFixture, kit: "product" })).rejects.toMatchObject({
      code: "forbidden_path"
    });

    const secretFixture = makeRepositoryFixture();
    write(secretFixture, "app/leaked-token.ts", `export const token = "figd_${"A".repeat(40)}";\n`);
    await expect(selectReleaseFiles({ repoRoot: secretFixture, kit: "product" })).rejects.toMatchObject({
      code: "sensitive_content"
    });
  });

  test("rejects symlink escape and path traversal identities", async () => {
    const fixture = makeRepositoryFixture();
    symlinkSync(tmpdir(), path.join(fixture, "app/escape"));
    await expect(selectReleaseFiles({ repoRoot: fixture, kit: "product" })).rejects.toMatchObject({
      code: "symlink_not_allowed"
    });

    for (const unsafe of ["../escape", "/absolute", "app/../../escape", "app\\escape"] as const) {
      expect(() => normalizeReleasePath(unsafe)).toThrowError(expect.objectContaining({ code: "path_traversal" }));
      expect(() => createDeterministicTarGz([{ path: unsafe, content: Buffer.alloc(0) }])).toThrowError(
        expect.objectContaining({ code: "path_traversal" })
      );
    }
  });
});

describe("deterministic release build", () => {
  test("refuses to label source with a different release version", async () => {
    const fixture = makeRepositoryFixture();
    const output = makeTemporaryDirectory("ikran-release-version-");

    await expect(
      buildReleaseKitForTests({
        repoRoot: fixture,
        outDir: output,
        kit: "product",
        version: "0.2.0",
        sourceDateEpoch: 1_700_000_000
      })
    ).rejects.toMatchObject({
      code: "release_version_mismatch",
      details: { releaseVersion: "0.2.0", packageVersion: "0.1.0-alpha.1" }
    });

    await expect(
      buildReleaseKitForTests({
        repoRoot: fixture,
        outDir: output,
        kit: "product",
        version: "../0.1.0",
        sourceDateEpoch: 1_700_000_000
      })
    ).rejects.toMatchObject({ code: "invalid_version" });
  });

  test("emits identical tar.gz, manifest, and checksum sidecars", async () => {
    const fixture = makeRepositoryFixture();
    const firstOut = makeTemporaryDirectory("ikran-release-out-a-");
    const secondOut = makeTemporaryDirectory("ikran-release-out-b-");
    const options = {
      repoRoot: fixture,
      kit: "product",
      version: "0.1.0-alpha.1",
      sourceDateEpoch: 1_700_000_000
    } as const;

    const first = await buildReleaseKitForTests({ ...options, outDir: firstOut });
    const second = await buildReleaseKitForTests({ ...options, outDir: secondOut });
    const firstArchive = readFileSync(first.archivePath);
    const secondArchive = readFileSync(second.archivePath);

    expect(firstArchive).toEqual(secondArchive);
    expect(readFileSync(first.manifestPath)).toEqual(readFileSync(second.manifestPath));
    expect(readFileSync(first.checksumPath)).toEqual(readFileSync(second.checksumPath));
    expect(first.sha256).toBe(createHash("sha256").update(firstArchive).digest("hex"));
    expect(readFileSync(first.checksumPath, "utf8")).toBe(
      `${first.sha256}  ${first.archiveName}\n`
    );

    const manifest = JSON.parse(readFileSync(first.manifestPath, "utf8"));
    expect(manifest.profile.setup).toBe("npm run setup:product");
    expect(manifest.profile.installStrategy).toBe("npm ci --omit=dev");
    expect(manifest.profile.start).toBe("npm run start:prod");
    expect(manifest.files.some((file: { path: string }) => file.path === "tests/global-setup.ts")).toBe(false);
    const manifestModes = new Map(
      manifest.files.map((file: { path: string; mode: string }) => [file.path, file.mode])
    );
    for (const executable of ["bin/ikran.mjs", "bin/ikran-mcp.mjs", "bin/ikran-runtime.mjs"]) {
      expect(manifestModes.get(executable), executable).toBe("0755");
    }
    expect(manifestModes.get("package.json")).toBe("0644");

    const tarEntries = listTarEntries(firstArchive);
    const tarPaths = tarEntries.map((entry) => entry.path);
    expect(tarPaths).toContain(
      "ikran-product-test-kit-0.1.0-alpha.1/RELEASE-MANIFEST.json"
    );
    expect(tarPaths).toContain("ikran-product-test-kit-0.1.0-alpha.1/package.json");
    expect(tarPaths).toContain("ikran-product-test-kit-0.1.0-alpha.1/LICENSE");
    expect(tarPaths.some(isForbidden)).toBe(false);
    const tarModes = new Map(tarEntries.map((entry) => [entry.path, entry.mode]));
    for (const executable of ["bin/ikran.mjs", "bin/ikran-mcp.mjs", "bin/ikran-runtime.mjs"]) {
      expect(
        tarModes.get(`ikran-product-test-kit-0.1.0-alpha.1/${executable}`),
        executable
      ).toBe(0o755);
    }
    expect(tarModes.get("ikran-product-test-kit-0.1.0-alpha.1/package.json")).toBe(0o644);
  });
});

describe("profile installation gate", () => {
  test("removes Next's optional test peer but preserves Runtime browser control", async () => {
    const fixture = makeRepositoryFixture();
    write(fixture, "node_modules/@playwright/test/package.json", "{\"name\":\"@playwright/test\"}\n");
    write(fixture, "node_modules/playwright/package.json", "{\"name\":\"playwright\"}\n");
    write(fixture, "node_modules/playwright-core/package.json", "{\"name\":\"playwright-core\"}\n");

    await expect(pruneProductInstall({ root: fixture })).resolves.toEqual({
      removed: ["@playwright/test", "playwright"],
      retained: ["playwright-core"]
    });
    expect(() => readFileSync(path.join(fixture, "node_modules/playwright-core/package.json"))).not.toThrow();
    expect(() => readFileSync(path.join(fixture, "node_modules/@playwright/test/package.json"))).toThrow();
    expect(() => readFileSync(path.join(fixture, "node_modules/playwright/package.json"))).toThrow();
  });

  test("requires production packages and rejects dev-only packages in Product", async () => {
    const fixture = makeRepositoryFixture();
    const packageJson = JSON.parse(readFileSync(path.join(fixture, "package.json"), "utf8"));
    for (const dependency of Object.keys(packageJson.dependencies)) {
      write(fixture, `node_modules/${dependency}/package.json`, `${JSON.stringify({ name: dependency })}\n`);
    }

    await expect(verifyInstalledProfile({ root: fixture, kit: "product" })).resolves.toMatchObject({
      productionDependencies: 5,
      omittedDevDependencies: 3
    });

    write(fixture, "node_modules/vitest/package.json", "{\"name\":\"vitest\"}\n");
    await expect(verifyInstalledProfile({ root: fixture, kit: "product" })).rejects.toMatchObject({
      code: "dev_dependency_installed",
      details: { leaked: ["vitest"] }
    });

    rmSync(path.join(fixture, "node_modules/vitest"), { recursive: true, force: true });
    rmSync(path.join(fixture, "node_modules/playwright-core"), { recursive: true, force: true });
    await expect(verifyInstalledProfile({ root: fixture, kit: "product" })).rejects.toMatchObject({
      code: "missing_installed_dependency",
      details: { missing: ["playwright-core"] }
    });
  });
});

function makeRepositoryFixture() {
  const root = makeTemporaryDirectory("ikran-release-repo-");
  const dependencies = {
    "@types/node": "1.0.0",
    "@types/react": "1.0.0",
    "@types/react-dom": "1.0.0",
    "playwright-core": "1.0.0",
    typescript: "1.0.0"
  };
  const devDependencies = {
    "@playwright/test": "1.0.0",
    shadcn: "1.0.0",
    vitest: "1.0.0"
  };
  write(
    root,
    "package.json",
    `${JSON.stringify({
      name: "fixture",
      version: "0.1.0-alpha.1",
      license: "Apache-2.0",
      private: true,
      scripts: {
        "setup:product": "npm ci --omit=dev && node scripts/release/prune-product-install.mjs && npx --no-install playwright-core install chromium && npm run build"
      },
      dependencies,
      devDependencies
    })}\n`
  );
  write(
    root,
    "package-lock.json",
    `${JSON.stringify({
      name: "fixture",
      version: "0.1.0-alpha.1",
      lockfileVersion: 3,
      packages: {
        "": {
          name: "fixture",
          version: "0.1.0-alpha.1",
          license: "Apache-2.0",
          dependencies,
          devDependencies
        }
      }
    })}\n`
  );

  const files: Record<string, string> = {
    ".node-version": "22.13.1\n",
    ".npmrc": "engine-strict=true\n",
    "LICENSE": "Apache License\nVersion 2.0, January 2004\n",
    "README.md": "# Fixture\n",
    "next.config.ts": "export default {};\n",
    "next-env.d.ts": "/// <reference types=\"next\" />\n",
    "postcss.config.mjs": "export default {};\n",
    "tsconfig.json": "{}\n",
    "components.json": "{}\n",
    "playwright.config.ts": "export default {};\n",
    "vitest.config.ts": "export default {};\n",
    "app/layout.tsx": "export default function Layout() { return null; }\n",
    "app/page.tsx": "export default function Page() { return null; }\n",
    "bin/ikran.mjs": "#!/usr/bin/env node\nexport {};\n",
    "bin/ikran-mcp.mjs": "#!/usr/bin/env node\nexport {};\n",
    "bin/ikran-runtime.mjs": "#!/usr/bin/env node\nexport {};\n",
    "lib/mcp/register-tools.ts": "export {};\n",
    "lib/runtime/http-server.mjs": "export {};\n",
    "tests/global-setup.ts": "export default function setup() {}\n",
    "tests/fixtures.ts": "export {};\n",
    "scripts/release/build.mjs": "export {};\n",
    "scripts/release/prune-product-install.mjs": "export {};\n"
  };
  for (const [relativePath, content] of Object.entries(files)) write(root, relativePath, content);
  mkdirSync(path.join(root, "components"), { recursive: true });
  mkdirSync(path.join(root, "public"), { recursive: true });
  return root;
}

function write(root: string, relativePath: string, content: string) {
  const absolutePath = path.join(root, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

function makeTemporaryDirectory(prefix: string) {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function isForbidden(relativePath: string) {
  const lower = relativePath.toLowerCase();
  return [
    "attempts/",
    ".scratch/",
    "workflow/",
    "design issue/",
    "issues 02/",
    "research/",
    ".ikran/",
    ".next/",
    "node_modules/"
  ].some((segment) => lower.includes(segment));
}

function listTarEntries(gzip: Buffer) {
  const tar = gunzipSync(gzip);
  const entries: Array<{ path: string; mode: number }> = [];
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = readTarText(header, 0, 100);
    const prefix = readTarText(header, 345, 155);
    entries.push({
      path: prefix ? `${prefix}/${name}` : name,
      mode: Number.parseInt(readTarText(header, 100, 8).replace(/\0.*$/, "").trim() || "0", 8)
    });
    const size = Number.parseInt(readTarText(header, 124, 12).replace(/\0.*$/, "").trim() || "0", 8);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function readTarText(buffer: Buffer, offset: number, length: number) {
  return buffer.subarray(offset, offset + length).toString("utf8").replace(/\0.*$/, "");
}
