// Task 11 — Workbench must not poll records on a timer; SSE invalidation only.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const WORKBENCH = path.join(ROOT, "components/workbench");
const RUNTIME_UI = path.join(ROOT, "components/runtime");

function walkFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkFiles(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("architecture — no Workbench record polling", () => {
  test("production Workbench/runtime UI has no POLL_INTERVAL_MS", () => {
    const hits: string[] = [];
    for (const dir of [WORKBENCH, RUNTIME_UI]) {
      for (const file of walkFiles(dir)) {
        const text = readFileSync(file, "utf8");
        if (/\bPOLL_INTERVAL_MS\b/.test(text)) {
          hits.push(path.relative(ROOT, file));
        }
      }
    }
    expect(hits, `POLL_INTERVAL_MS still present:\n${hits.join("\n")}`).toEqual(
      []
    );
  });

  test("production Workbench hooks do not setInterval for record refresh", () => {
    const hits: string[] = [];
    for (const file of walkFiles(WORKBENCH)) {
      const base = path.basename(file);
      if (!/^use-/.test(base)) continue;
      const text = readFileSync(file, "utf8");
      if (/\bsetInterval\b/.test(text)) {
        hits.push(path.relative(ROOT, file));
      }
    }
    expect(
      hits,
      `setInterval still in Workbench hooks:\n${hits.join("\n")}`
    ).toEqual([]);
  });

  test("unified runtime client + workbench hook exist", () => {
    expect(
      existsSync(path.join(RUNTIME_UI, "runtime-client.ts"))
    ).toBe(true);
    expect(
      existsSync(path.join(RUNTIME_UI, "use-workbench-runtime.ts"))
    ).toBe(true);
  });
});
