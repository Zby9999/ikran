// Designer Annotations are part of Design Intent Alignment (Issue 08A
// follow-up): the alignment snapshot carries them as `designer_annotations`
// so the semantic MCP read surface never needs a second channel. They are
// designer intent input, never coverage.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { getDesignIntentAlignment } from "../../lib/runtime/design-intent-alignment";
import { createRegionAnnotation } from "../../lib/runtime/region-annotation";
import { recordEvidencePackage } from "../../lib/runtime/evidence-package";
import { registerSeedReference } from "../../lib/runtime/seed-reference";
import { initializeProjectDb } from "../../lib/runtime/db";

const VALID_FIGMA = "https://www.figma.com/design/AbCdEf/Checkout?node-id=1:2";

function withTempProject(fn: (dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), "ikran-align-designer-ann-"));
  try {
    initializeProjectDb(dir);
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function seedSurface(dir: string): string {
  const seed = registerSeedReference(dir, {
    figmaSeedReference: VALID_FIGMA,
    originalDesignIntent: "alignment designer annotation fixture"
  });
  if (!seed.ok) throw new Error(`registerSeed failed: ${seed.reason}`);
  const res = recordEvidencePackage(dir, {
    figmaSeedReference: VALID_FIGMA,
    frame: { nodeId: "1:2", name: "Checkout" },
    evidenceViews: { rawData: "available", screenshot: "missing" }
  });
  if (!res.ok) throw new Error(`seedSurface failed: ${res.reason}`);
  return res.record.id;
}

describe("getDesignIntentAlignment designer_annotations", () => {
  test("empty project yields an empty designer_annotations list", () => {
    withTempProject((dir) => {
      const snapshot = getDesignIntentAlignment(dir);
      expect(snapshot.designer_annotations).toEqual([]);
    });
  });

  test("snapshot carries designer-authored annotations with body and section", () => {
    withTempProject((dir) => {
      const surfaceId = seedSurface(dir);
      const designer = createRegionAnnotation(dir, {
        target: { kind: "figma-surface", evidenceVersionId: surfaceId },
        author: "designer",
        body: "Keep the quiet neutral palette",
        section: "visual-language"
      });
      expect(designer.ok).toBe(true);
      const agent = createRegionAnnotation(dir, {
        target: { kind: "figma-surface", evidenceVersionId: surfaceId },
        author: "agent",
        body: "Assumed accent usage"
      });
      expect(agent.ok).toBe(true);

      const snapshot = getDesignIntentAlignment(dir);
      expect(snapshot.designer_annotations).toHaveLength(1);
      const record = snapshot.designer_annotations[0];
      expect(record.body).toBe("Keep the quiet neutral palette");
      expect(record.section).toBe("visual-language");
      expect(record.type).toBe("designer_annotation");
      expect(record.author).toBe("designer");
      // Agent annotations stay in their own channel, never here.
      expect(snapshot.designer_annotations.map((r) => r.id)).not.toContain(
        agent.ok ? agent.record.id : ""
      );
    });
  });

  test("designer annotations never count toward coverage or completion", () => {
    withTempProject((dir) => {
      const surfaceId = seedSurface(dir);
      const created = createRegionAnnotation(dir, {
        target: { kind: "figma-surface", evidenceVersionId: surfaceId },
        author: "designer",
        body: "Dense tables are fine",
        section: "layout"
      });
      expect(created.ok).toBe(true);

      const snapshot = getDesignIntentAlignment(dir);
      expect(snapshot.coverage.total_questions).toBe(0);
      expect(
        snapshot.coverage.sections.every(
          (section) => section.covered_count === 0 && !section.complete
        )
      ).toBe(true);
      expect(snapshot.coverage.can_complete).toBe(false);
    });
  });
});
