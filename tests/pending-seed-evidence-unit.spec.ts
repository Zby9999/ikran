// Unit tests for listPendingSeedEvidence (UI-initiated Agent evidence capture).
// Pure Node — no MCP/Next. Runtime never contacts Figma.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { initializeProjectDb } from "../lib/runtime/db";
import { registerSeedReference } from "../lib/runtime/seed-reference";
import { recordEvidencePackage } from "../lib/runtime/evidence-package";
import { listPendingSeedEvidence } from "../lib/runtime/pending-seed-evidence";

const VALID_FIGMA = "https://www.figma.com/design/AbCdEf/Checkout?node-id=1:2";
const INTENT = "checkout trust signals";

function withTempProject(fn: (dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), "ikran-pending-seed-unit-"));
  try {
    initializeProjectDb(dir);
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test.describe("listPendingSeedEvidence (unit)", () => {
  test("seed only → pending", () => {
    withTempProject((dir) => {
      const seed = registerSeedReference(dir, {
        figmaSeedReference: VALID_FIGMA,
        originalDesignIntent: INTENT
      });
      expect(seed.ok).toBe(true);
      if (!seed.ok) return;

      const pending = listPendingSeedEvidence(dir);
      expect(pending.length).toBe(1);
      expect(pending[0]).toEqual({
        id: seed.record.id,
        figma_seed_reference: VALID_FIGMA,
        original_design_intent: INTENT,
        created_at: seed.record.created_at
      });
    });
  });

  test("after surface with artifactPath → not pending", () => {
    withTempProject((dir) => {
      const seed = registerSeedReference(dir, {
        figmaSeedReference: VALID_FIGMA,
        originalDesignIntent: INTENT
      });
      expect(seed.ok).toBe(true);
      if (!seed.ok) return;

      const res = recordEvidencePackage(dir, {
        seedReferenceId: seed.record.id,
        frame: { nodeId: "1:2", name: "Checkout" },
        evidenceViews: { rawData: "available", screenshot: "available" },
        screenshot: { artifactPath: "artifacts/checkout.png" }
      });
      expect(res.ok).toBe(true);

      expect(listPendingSeedEvidence(dir)).toEqual([]);
    });
  });

  test("after surface with dataUrl → not pending", () => {
    withTempProject((dir) => {
      const seed = registerSeedReference(dir, {
        figmaSeedReference: VALID_FIGMA,
        originalDesignIntent: INTENT
      });
      expect(seed.ok).toBe(true);
      if (!seed.ok) return;

      const res = recordEvidencePackage(dir, {
        seedReferenceId: seed.record.id,
        frame: { nodeId: "1:2", name: "Checkout" },
        evidenceViews: { rawData: "available", screenshot: "available" },
        screenshot: { dataUrl: "data:image/png;base64,abc" }
      });
      expect(res.ok).toBe(true);

      expect(listPendingSeedEvidence(dir)).toEqual([]);
    });
  });

  test("surface without screenshot fields still pending", () => {
    withTempProject((dir) => {
      const seed = registerSeedReference(dir, {
        figmaSeedReference: VALID_FIGMA,
        originalDesignIntent: INTENT
      });
      expect(seed.ok).toBe(true);
      if (!seed.ok) return;

      // Valid package with screenshot: missing — inserts a surface row with
      // null screenshot fields; seed must remain pending.
      const res = recordEvidencePackage(dir, {
        seedReferenceId: seed.record.id,
        frame: { nodeId: "1:2", name: "Checkout" },
        evidenceViews: { rawData: "available", screenshot: "missing" }
      });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.record.screenshot_artifact_path).toBeNull();
      expect(res.record.screenshot_data_url).toBeNull();

      const pending = listPendingSeedEvidence(dir);
      expect(pending.length).toBe(1);
      expect(pending[0].id).toBe(seed.record.id);
    });
  });

  test("oldest-first when multiple pending seeds", () => {
    withTempProject((dir) => {
      const a = registerSeedReference(dir, {
        figmaSeedReference: VALID_FIGMA,
        originalDesignIntent: "first"
      });
      const b = registerSeedReference(dir, {
        figmaSeedReference:
          "https://www.figma.com/design/OtherFile/Other?node-id=9:9",
        originalDesignIntent: "second"
      });
      expect(a.ok && b.ok).toBe(true);
      if (!a.ok || !b.ok) return;

      const pending = listPendingSeedEvidence(dir);
      expect(pending.map((r) => r.original_design_intent)).toEqual([
        "first",
        "second"
      ]);
      expect(pending.map((r) => r.id)).toEqual([a.record.id, b.record.id]);
    });
  });

  test("surface matched by figma URL (no seed_reference_id) clears pending", () => {
    withTempProject((dir) => {
      const seed = registerSeedReference(dir, {
        figmaSeedReference: VALID_FIGMA,
        originalDesignIntent: INTENT
      });
      expect(seed.ok).toBe(true);
      if (!seed.ok) return;

      const res = recordEvidencePackage(dir, {
        figmaSeedReference: VALID_FIGMA,
        frame: { nodeId: "1:2", name: "Checkout" },
        evidenceViews: { rawData: "available", screenshot: "available" },
        screenshot: { artifactPath: "artifacts/by-url.png" }
      });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.record.seed_reference_id).toBeNull();

      expect(listPendingSeedEvidence(dir)).toEqual([]);
    });
  });
});
