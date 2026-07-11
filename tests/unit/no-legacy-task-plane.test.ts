// Architecture guard: the legacy HTTP task plane (/api/tasks + AgentAdapter
// + task-runner/task-bus/schemas) must be gone. Production source must not
// re-expose those modules or routes.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test, expect } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

const FORBIDDEN_PATHS = [
  "app/api/tasks/route.ts",
  "app/api/tasks/[id]/route.ts",
  "lib/runtime/adapter.ts",
  "lib/runtime/adapters/mock-adapter.ts",
  "lib/runtime/adapters/cli-adapter.ts",
  "lib/runtime/task-runner.ts",
  "lib/runtime/task-bus.ts",
  "lib/runtime/schemas.ts"
] as const;

/** Directories scanned for leftover production references (not docs/plans/tests). */
const PROD_SCAN_DIRS = ["app", "lib", "components", "bin"] as const;

const FORBIDDEN_IMPORT_TARGETS = new Set(
  FORBIDDEN_PATHS.filter((rel) => rel.startsWith("lib/")).map((rel) =>
    path.resolve(ROOT, rel.replace(/\.ts$/, ""))
  )
);

const FORBIDDEN_SOURCE_PATTERNS: RegExp[] = [
  /["']\/api\/tasks(?:\/|["'?])/,
  /\bAgentAdapter\b/,
  /\bfamilySchemas\b/,
  /\breal_agent_smoke\b/,
  /\bonTaskEvent\b/,
  /\bemitTaskEvent\b/
];

const MODULE_SPECIFIER_PATTERN =
  /(?:\bfrom\s+|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)["']([^"']+)["']/g;

function resolveLocalImport(importer: string, specifier: string): string | null {
  if (specifier.startsWith("@/")) {
    return path.resolve(ROOT, specifier.slice(2));
  }
  if (specifier.startsWith(".")) {
    return path.resolve(path.dirname(importer), specifier);
  }
  return null;
}

function walkFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkFiles(full, out);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(name)) out.push(full);
  }
  return out;
}

test.describe("architecture — legacy task plane removed", () => {
  test("allows unrelated shared schema modules", () => {
    const importer = path.join(ROOT, "app/example.ts");
    const futureSchemaImports = [
      "../lib/runtime/domain/schemas",
      "@/lib/mcp/schemas"
    ];

    for (const specifier of futureSchemaImports) {
      const target = resolveLocalImport(importer, specifier);
      expect(target && FORBIDDEN_IMPORT_TARGETS.has(target)).toBe(false);
    }
  });

  test("forbidden route and module files do not exist", () => {
    const stillPresent = FORBIDDEN_PATHS.filter((rel) =>
      existsSync(path.join(ROOT, rel))
    );
    expect(
      stillPresent,
      `legacy task-plane files still present:\n${stillPresent.join("\n")}`
    ).toEqual([]);
  });

  test("production source does not expose the old task plane", () => {
    const hits: string[] = [];
    for (const dir of PROD_SCAN_DIRS) {
      for (const file of walkFiles(path.join(ROOT, dir))) {
        const rel = path.relative(ROOT, file);
        // Skip the files we already assert are deleted (avoid double-noise
        // while they still exist during RED).
        if (
          FORBIDDEN_PATHS.some(
            (p) => rel === p || rel.startsWith("lib/runtime/adapters/")
          )
        ) {
          continue;
        }
        const text = readFileSync(file, "utf8");
        for (const match of text.matchAll(MODULE_SPECIFIER_PATTERN)) {
          const target = resolveLocalImport(file, match[1]);
          if (target && FORBIDDEN_IMPORT_TARGETS.has(target)) {
            hits.push(`${rel} imports retired module ${match[1]}`);
            break;
          }
        }
        for (const re of FORBIDDEN_SOURCE_PATTERNS) {
          if (re.test(text)) {
            hits.push(`${rel} matches ${re}`);
            break;
          }
        }
      }
    }
    expect(
      hits,
      `production source still references legacy task plane:\n${hits.join("\n")}`
    ).toEqual([]);
  });
});
