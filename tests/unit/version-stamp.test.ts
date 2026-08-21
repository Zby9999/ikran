// Unit tests for prod MCP↔HTTP version stamp guard (lib/runtime/version-stamp.mjs).

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  assertProdBuildMatchesSource,
  computeSourceStamp,
  CRITICAL_RUNTIME_PATHS,
  hashCriticalModules,
  PROD_BUILD_STALE_CODE,
  readSchemaVersion,
  STAMP_FILENAME,
  writeVersionStamp
} from "../../lib/runtime/version-stamp.mjs";

const ROOT = path.resolve(__dirname, "../..");

const tempDirs: string[] = [];

function makeTempApp(opts?: {
  schemaVersion?: number;
  extraMigrationLine?: string;
}): string {
  const root = mkdtempSync(path.join(tmpdir(), "ikran-stamp-"));
  tempDirs.push(root);

  const runtime = path.join(root, "lib", "runtime");
  const commands = path.join(runtime, "commands");
  const mcp = path.join(root, "lib", "mcp");
  const api = path.join(root, "app", "api", "health");
  const workbenchRuntime = path.join(root, "components", "runtime");
  mkdirSync(commands, { recursive: true });
  mkdirSync(mcp, { recursive: true });
  mkdirSync(api, { recursive: true });
  mkdirSync(workbenchRuntime, { recursive: true });

  const schemaVersion = opts?.schemaVersion ?? 4;
  writeFileSync(
    path.join(runtime, "migrations.ts"),
    `export const CURRENT_SCHEMA_VERSION = ${schemaVersion};\n` +
      (opts?.extraMigrationLine ?? "")
  );
  writeFileSync(path.join(commands, "index.ts"), "// commands\n");
  writeFileSync(path.join(runtime, "http-server.mjs"), "// http-server\n");
  writeFileSync(path.join(mcp, "register-tools.ts"), "// mcp\n");
  writeFileSync(path.join(api, "route.ts"), "// api\n");
  writeFileSync(path.join(workbenchRuntime, "runtime-client.ts"), "// client\n");
  return root;
}

function seedDist(appDir: string, distRel = ".next", buildId = "test-build"): string {
  const dist = path.join(appDir, distRel);
  mkdirSync(dist, { recursive: true });
  writeFileSync(path.join(dist, "BUILD_ID"), buildId);
  return dist;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("version-stamp helper", () => {
  test("CRITICAL_RUNTIME_PATHS covers HTTP/MCP contract planes", () => {
    expect([...CRITICAL_RUNTIME_PATHS]).toEqual([
      "app/api",
      "lib/mcp",
      "lib/runtime",
      "components/runtime"
    ]);
    for (const rel of CRITICAL_RUNTIME_PATHS) {
      expect(existsSync(path.join(ROOT, rel))).toBe(true);
    }
  });

  test("readSchemaVersion parses CURRENT_SCHEMA_VERSION from real migrations.ts", () => {
    expect(readSchemaVersion(ROOT)).toBe(37);
  });

  test("computeSourceStamp is stable for unchanged critical modules", () => {
    const a = computeSourceStamp(ROOT);
    const b = computeSourceStamp(ROOT);
    expect(a.stamp).toBe(b.stamp);
    expect(a.schemaVersion).toBe(37);
    expect(a.contentHash).toMatch(/^[a-f0-9]{16}$/);
    expect(a.stamp).toBe(`schema:${a.schemaVersion}|hash:${a.contentHash}`);
  });

  test("hash changes when a critical module changes", () => {
    const app = makeTempApp();
    const before = hashCriticalModules(app);
    writeFileSync(
      path.join(app, "lib/runtime/migrations.ts"),
      "export const CURRENT_SCHEMA_VERSION = 4;\nexport const bumped = 1;\n"
    );
    const after = hashCriticalModules(app);
    expect(after).not.toBe(before);
  });

  test("hash changes when API, MCP, server, or Workbench client sources change", () => {
    const app = makeTempApp();
    const before = hashCriticalModules(app);

    writeFileSync(path.join(app, "app/api/health/route.ts"), "// api\nbumped\n");
    expect(hashCriticalModules(app)).not.toBe(before);

    const afterApi = hashCriticalModules(app);
    writeFileSync(path.join(app, "lib/mcp/register-tools.ts"), "// mcp\nbumped\n");
    expect(hashCriticalModules(app)).not.toBe(afterApi);

    const afterMcp = hashCriticalModules(app);
    writeFileSync(
      path.join(app, "lib/runtime/http-server.mjs"),
      "// http-server\nbumped\n"
    );
    expect(hashCriticalModules(app)).not.toBe(afterMcp);

    const afterServer = hashCriticalModules(app);
    writeFileSync(
      path.join(app, "components/runtime/runtime-client.ts"),
      "// client\nbumped\n"
    );
    expect(hashCriticalModules(app)).not.toBe(afterServer);
  });

  test("assertProdBuildMatchesSource is a no-op when prod is false", () => {
    const app = makeTempApp();
    expect(
      assertProdBuildMatchesSource({ appDir: app, prod: false })
    ).toEqual({ skipped: true });
  });

  test("assertProdBuildMatchesSource fails closed when BUILD_ID is missing", () => {
    const app = makeTempApp();
    expect(() =>
      assertProdBuildMatchesSource({ appDir: app, prod: true })
    ).toThrow(/npm run build/i);
    try {
      assertProdBuildMatchesSource({ appDir: app, prod: true });
    } catch (err) {
      expect((err as { code?: string }).code).toBe(PROD_BUILD_STALE_CODE);
    }
  });

  test("assertProdBuildMatchesSource fails closed when stamp is missing", () => {
    const app = makeTempApp();
    seedDist(app);
    expect(() =>
      assertProdBuildMatchesSource({ appDir: app, prod: true })
    ).toThrow(new RegExp(STAMP_FILENAME));
  });

  test("writeVersionStamp + assert round-trip passes", () => {
    const app = makeTempApp({ schemaVersion: 7 });
    seedDist(app, ".next", "abc123");
    const written = writeVersionStamp(app);
    expect(written.stamp).toMatch(/^schema:7\|hash:[a-f0-9]{16}$/);
    expect(written.buildId).toBe("abc123");
    expect(existsSync(path.join(app, ".next", STAMP_FILENAME))).toBe(true);

    const result = assertProdBuildMatchesSource({ appDir: app, prod: true });
    expect(result).toMatchObject({ ok: true, stamp: written.stamp, buildId: "abc123" });
  });

  test("assertProdBuildMatchesSource fails when source advances after stamp", () => {
    const app = makeTempApp({ schemaVersion: 4 });
    seedDist(app);
    writeVersionStamp(app);

    writeFileSync(
      path.join(app, "lib/runtime/migrations.ts"),
      "export const CURRENT_SCHEMA_VERSION = 5;\n"
    );

    expect(() =>
      assertProdBuildMatchesSource({ appDir: app, prod: true })
    ).toThrow(/out of date|stamp mismatch|npm run build/i);
  });

  test("assertProdBuildMatchesSource respects custom nextDistDir", () => {
    const app = makeTempApp();
    seedDist(app, ".next/e2e-build", "e2e-id");
    writeVersionStamp(app, ".next/e2e-build");
    const stampPath = path.join(app, ".next/e2e-build", STAMP_FILENAME);
    expect(JSON.parse(readFileSync(stampPath, "utf8")).buildId).toBe("e2e-id");

    expect(
      assertProdBuildMatchesSource({
        appDir: app,
        prod: true,
        nextDistDir: ".next/e2e-build"
      })
    ).toMatchObject({ ok: true, buildId: "e2e-id" });

    // Default .next has no stamp → fail.
    expect(() =>
      assertProdBuildMatchesSource({ appDir: app, prod: true })
    ).toThrow(/BUILD_ID|stamp/i);
  });
});
