// Architecture guard: the fake Browser↔Agent "connect" step
// (/api/agent/connect + connected_agent runtime state + AgentConnectorCard)
// must be gone. Production source must not re-expose those modules or routes.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test, expect } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

const FORBIDDEN_PATHS = [
  "app/api/agent/connect/route.ts",
  "lib/runtime/agent-connect.ts",
  "lib/runtime/agent-types.ts",
  "lib/runtime/agent-error-message.ts",
  "components/setup/AgentConnectorCard.tsx",
  "components/setup/AgentIcon.tsx"
] as const;

/** Directories scanned for leftover production references (not docs/plans/tests). */
const PROD_SCAN_DIRS = ["app", "lib", "components"] as const;

const FORBIDDEN_IMPORT_TARGETS = new Set(
  FORBIDDEN_PATHS.filter(
    (rel) => rel.startsWith("lib/") || rel.startsWith("components/")
  ).map((rel) => path.resolve(ROOT, rel.replace(/\.tsx?$/, "")))
);

const FORBIDDEN_SOURCE_PATTERNS: RegExp[] = [
  /["']\/api\/agent\/connect(?:\/|["'?])/,
  /\bgetRuntimeConnectedAgent\b/,
  /\bsetRuntimeConnectedAgent\b/,
  /\bconnected_agent\b/,
  /\bAgentConnectorCard\b/,
  /\bAgentConnectionState\b/,
  /\bagentErrorMessage\b/,
  /\bConnect Your Agent\b/
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

test.describe("architecture — fake agent connect removed", () => {
  test("forbidden route and module files do not exist", () => {
    const stillPresent = FORBIDDEN_PATHS.filter((rel) =>
      existsSync(path.join(ROOT, rel))
    );
    expect(
      stillPresent,
      `fake agent-connect files still present:\n${stillPresent.join("\n")}`
    ).toEqual([]);
  });

  test("production source does not expose fake agent connect", () => {
    const hits: string[] = [];
    for (const dir of PROD_SCAN_DIRS) {
      for (const file of walkFiles(path.join(ROOT, dir))) {
        const rel = path.relative(ROOT, file);
        if (FORBIDDEN_PATHS.some((p) => rel === p)) {
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
      `production source still references fake agent connect:\n${hits.join("\n")}`
    ).toEqual([]);
  });
});
