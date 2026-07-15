// Task 10 architecture guard: MCP must call the shared command kernel
// directly — no localhost HTTP proxy helpers, no stale-route branches.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

const PROD_SCAN = ["bin", "lib/mcp", "lib/runtime/commands"] as const;

const FORBIDDEN_SYMBOLS: RegExp[] = [
  /\bapiGet\b/,
  /\bapiPost\b/,
  /\broute_not_found\b/,
  /\baudit_warning\b/,
  /\bconnected_agent\b/
];

function walkFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkFiles(full, out);
    else if (/\.(mjs|js|ts)$/.test(name)) out.push(full);
  }
  return out;
}

describe("architecture — MCP no HTTP loopback (Task 10)", () => {
  test("shared command kernel and MCP register-tools exist", () => {
    expect(existsSync(path.join(ROOT, "lib/mcp/register-tools.ts"))).toBe(
      true
    );
    expect(
      existsSync(path.join(ROOT, "lib/runtime/commands/index.ts"))
    ).toBe(true);
    for (const file of [
      "project-workspace-tools.ts",
      "seed-evidence-tools.ts",
      "region-tools.ts",
      "shared.ts"
    ]) {
      expect(existsSync(path.join(ROOT, "lib/mcp", file)), file).toBe(true);
    }
  });

  test("production MCP/command surface has no apiGet/apiPost proxy symbols", () => {
    const hits: string[] = [];
    for (const dir of PROD_SCAN) {
      const abs = path.join(ROOT, dir);
      if (!existsSync(abs)) {
        hits.push(`missing scan dir: ${dir}`);
        continue;
      }
      for (const file of walkFiles(abs)) {
        const rel = path.relative(ROOT, file);
        const text = readFileSync(file, "utf8");
        for (const re of FORBIDDEN_SYMBOLS) {
          if (re.test(text)) {
            hits.push(`${rel} matches ${re}`);
          }
        }
        // Semantic tools must not loopback to app/api via fetch.
        if (
          /fetch\s*\(\s*[`'"]http:\/\/\$\{/.test(text) ||
          /fetch\s*\(\s*[`'"]http:\/\/127\.0\.0\.1/.test(text) ||
          /\/api\/seed-reference/.test(text) ||
          /\/api\/evidence-package/.test(text) ||
          /\/api\/region-annotation/.test(text) ||
          /\/api\/pending-seed-evidence/.test(text) ||
          /\/api\/project\/bind/.test(text)
        ) {
          // Allow comments that mention historical HTTP routes only if they
          // do not also call fetch — still flag path literals in code.
          if (!rel.endsWith(".md") && /fetch\s*\(/.test(text)) {
            hits.push(`${rel} still fetches localhost /api`);
          } else if (
            /[`'"]\/api\/(seed-reference|evidence-package|region-annotation|pending-seed-evidence|project\/bind)/.test(
              text
            )
          ) {
            hits.push(`${rel} still references HTTP /api route strings`);
          }
        }
      }
    }
    expect(
      hits,
      `MCP still proxies via HTTP:\n${hits.join("\n")}`
    ).toEqual([]);
  });

  test("persistent Runtime uses the official tsx entry; stdio bridge stays thin", () => {
    const text = readFileSync(path.join(ROOT, "bin/ikran-runtime.mjs"), "utf8");
    expect(text).toMatch(/import\s+["']tsx["']/);
    expect(text).not.toMatch(/tsx\/(?:esm|cjs)\/api/);
    expect(text).toMatch(/register-tools/);
    const bridge = readFileSync(path.join(ROOT, "bin/ikran-mcp.mjs"), "utf8");
    expect(bridge).toMatch(/process\.stdin\.pipe\(socket\)/);
    expect(bridge.split("\n").length).toBeLessThan(100);
  });

  test("top-level register-tools is composition-only and small", () => {
    const text = readFileSync(
      path.join(ROOT, "lib/mcp/register-tools.ts"),
      "utf8"
    );
    expect(text.split("\n").length).toBeLessThan(200);
    expect(text).toMatch(/registerProjectWorkspaceTools/);
    expect(text).toMatch(/registerSeedEvidenceTools/);
    expect(text).toMatch(/registerRegionTools/);
  });

  test("package.json lists tsx as a production dependency", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(ROOT, "package.json"), "utf8")
    ) as { dependencies?: Record<string, string> };
    expect(pkg.dependencies?.tsx).toBeTruthy();
  });
});
