import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { resolveRuntimeStateDir } from "../../lib/runtime/runtime-state-dir.mjs";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function packageFixture(version: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), "ikran-state-version-"));
  directories.push(directory);
  writeFileSync(
    path.join(directory, "package.json"),
    JSON.stringify({ version }),
    "utf8"
  );
  return directory;
}

describe("resolveRuntimeStateDir", () => {
  test("isolates the default Runtime control plane by installed version", () => {
    const appDir = packageFixture("0.1.0-alpha.15");
    expect(
      resolveRuntimeStateDir({ appDir, env: {}, homeDir: "/tmp/ikran-home" })
    ).toBe("/tmp/ikran-home/.ikran/runtimes/0.1.0-alpha.15");
  });

  test("preserves an explicit project-local IKRAN_STATE_DIR", () => {
    const appDir = packageFixture("0.1.0-alpha.15");
    expect(
      resolveRuntimeStateDir({
        appDir,
        env: { IKRAN_STATE_DIR: " /tmp/project/.ikran " },
        homeDir: "/tmp/ikran-home"
      })
    ).toBe("/tmp/project/.ikran");
  });
});
