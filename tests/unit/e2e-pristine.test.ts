import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  NEXT_ENV_D_TS_BASELINE,
  beginE2eWorkspaceGuard,
  nextEnvHasE2eBuildRef,
  restoreWorkspaceFiles,
  sanitizeNextEnvIfPolluted,
  snapshotWorkspaceFiles
} from "../e2e-pristine";

describe("e2e workspace guard", () => {
  test("next-env baseline uses .next/dev routes, not e2e-build", () => {
    expect(NEXT_ENV_D_TS_BASELINE).toContain(
      'import "./.next/dev/types/routes.d.ts"'
    );
    expect(NEXT_ENV_D_TS_BASELINE).not.toContain("e2e-build");
  });

  test("sanitizeNextEnvIfPolluted rewrites e2e-build ref only", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "ikran-e2e-sanitize-"));
    try {
      const polluted = `/// <reference types="next" />\nimport "./.next/e2e-build/types/routes.d.ts";\n`;
      writeFileSync(path.join(cwd, "next-env.d.ts"), polluted, "utf-8");
      writeFileSync(path.join(cwd, "tsconfig.json"), '{"keep":true}\n', "utf-8");

      expect(nextEnvHasE2eBuildRef(polluted)).toBe(true);
      expect(sanitizeNextEnvIfPolluted(cwd)).toBe(true);
      expect(readFileSync(path.join(cwd, "next-env.d.ts"), "utf-8")).toBe(
        NEXT_ENV_D_TS_BASELINE
      );
      // tsconfig must not be touched by sanitize
      expect(readFileSync(path.join(cwd, "tsconfig.json"), "utf-8")).toBe(
        '{"keep":true}\n'
      );
      expect(sanitizeNextEnvIfPolluted(cwd)).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("beginE2eWorkspaceGuard snapshots real tsconfig; restore preserves edits", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "ikran-e2e-snap-"));
    try {
      writeFileSync(
        path.join(cwd, "next-env.d.ts"),
        `/// <reference types="next" />\nimport "./.next/e2e-build/types/routes.d.ts";\n`,
        "utf-8"
      );
      const customTsconfig = '{\n  "compilerOptions": { "strict": true },\n  "include": ["src"]\n}\n';
      writeFileSync(path.join(cwd, "tsconfig.json"), customTsconfig, "utf-8");

      const { snapshots, sanitizedNextEnv } = beginE2eWorkspaceGuard(cwd);
      expect(sanitizedNextEnv).toBe(true);

      // Simulate next build rewriting both files
      writeFileSync(
        path.join(cwd, "next-env.d.ts"),
        'import "./.next/e2e-build/types/routes.d.ts";\n',
        "utf-8"
      );
      writeFileSync(path.join(cwd, "tsconfig.json"), '{"polluted":true}\n', "utf-8");

      restoreWorkspaceFiles(snapshots);

      expect(readFileSync(path.join(cwd, "next-env.d.ts"), "utf-8")).toBe(
        NEXT_ENV_D_TS_BASELINE
      );
      expect(readFileSync(path.join(cwd, "tsconfig.json"), "utf-8")).toBe(
        customTsconfig
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("snapshotWorkspaceFiles captures missing files as null content", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "ikran-e2e-missing-"));
    try {
      const snaps = snapshotWorkspaceFiles(cwd);
      expect(snaps).toHaveLength(2);
      expect(snaps.every((s) => s.content === null)).toBe(true);
      restoreWorkspaceFiles(snaps);
      expect(existsSync(path.join(cwd, "next-env.d.ts"))).toBe(false);
      expect(existsSync(path.join(cwd, "tsconfig.json"))).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
