// Architecture / behavior guard: Workbench is Agent-first for seed registration.
// SeedEvidenceWorkbench must not expose EnterPanel / register.
// Production Workbench must not import enter-panel. Keep patterns narrow so
// future unrelated forms are not blocked.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test, expect } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

const WORKBENCH_DIR = path.join(ROOT, "components/workbench");
const RUNTIME_UI = path.join(ROOT, "components/runtime");
const SEED_WORKBENCH = path.join(WORKBENCH_DIR, "SeedEvidenceWorkbench.tsx");
const USE_WORKBENCH_RUNTIME = path.join(RUNTIME_UI, "use-workbench-runtime.ts");
const RUNTIME_CLIENT = path.join(RUNTIME_UI, "runtime-client.ts");
const ENTER_PANEL = path.join(WORKBENCH_DIR, "enter-panel.tsx");

test.describe("architecture — Workbench seed write entry removed", () => {
  test("enter-panel.tsx is deleted", () => {
    expect(existsSync(ENTER_PANEL)).toBe(false);
  });

  test("SeedEvidenceWorkbench does not import EnterPanel or call register", () => {
    const text = readFileSync(SEED_WORKBENCH, "utf8");
    expect(text).not.toMatch(/\bEnterPanel\b/);
    expect(text).not.toMatch(/from\s+["']\.\/enter-panel["']/);
    expect(text).not.toMatch(/\bregister\s*\(/);
  });

  test("useWorkbenchRuntime exposes authoritative GET reload + mutations (no legacy seed POST)", () => {
    const hookText = readFileSync(USE_WORKBENCH_RUNTIME, "utf8");
    const clientText = readFileSync(RUNTIME_CLIENT, "utf8");
    const text = `${hookText}\n${clientText}`;
    expect(text).not.toMatch(/\bSeedReferenceRegisterInput\b/);
    expect(text).not.toMatch(/\bSeedReferenceRegisterResult\b/);
    // Seed list is GET-only; Issue 05A paste uses /api/seed-capture, not seed-reference POST.
    expect(clientText).toMatch(/fetchJson\(fetcher,\s*"\/api\/seed-reference"/);
    expect(clientText).not.toMatch(
      /fetchJson\(\s*fetcher,\s*"\/api\/seed-reference"[\s\S]{0,180}method:\s*["']POST["']/
    );
    expect(clientText).toMatch(/\/api\/seed-capture/);
    expect(clientText).toMatch(/\/api\/figma-connection/);
    expect(hookText).toMatch(/\breload\b/);
    expect(hookText).toMatch(/\bcreateAnnotation\b/);
    expect(hookText).toMatch(/\bdeleteAnnotation\b/);
    expect(hookText).toMatch(/\bcaptureSeedReference\b/);
  });

  test("production Workbench sources do not import enter-panel", () => {
    const hits: string[] = [];
    // Narrow: only module imports of enter-panel — not comments or future forms.
    const ENTER_PANEL_IMPORT =
      /(?:\bfrom\s+|\bimport\s*(?:\(\s*)?)["']\.\/enter-panel["']/;
    for (const name of [
      "SeedEvidenceWorkbench.tsx",
      "workbench-canvas.tsx",
      "folder-chrome.tsx",
      "index.ts"
    ]) {
      const file = path.join(WORKBENCH_DIR, name);
      if (!existsSync(file)) continue;
      const text = readFileSync(file, "utf8");
      if (ENTER_PANEL_IMPORT.test(text)) {
        hits.push(name);
      }
    }
    expect(hits, `enter-panel still imported in:\n${hits.join("\n")}`).toEqual([]);
  });
});
