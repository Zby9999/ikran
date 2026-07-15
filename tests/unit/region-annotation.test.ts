// Unit tests for Region Annotation Runtime foundation (Issue 06).
// Pure Node — no MCP/Next. Runtime never contacts Figma.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, expect } from "vitest";
import {
  validateRegionAnnotationInput,
  createRegionAnnotation,
  confirmAnnotationPrimaryNode,
  deleteRegionAnnotation,
  listRegionAnnotations,
  expandPointToRect,
  POINT_SIDE
} from "../../lib/runtime/region-annotation";
import {
  AGENT_REGION_MARGIN,
  displayRectForRegionAnnotation,
  expandAgentRegionRect
} from "../../lib/runtime/region-annotation-display";
import { recordEvidencePackage } from "../../lib/runtime/evidence-package";
import { registerSeedReference } from "../../lib/runtime/seed-reference";
import { listEvents } from "../../lib/runtime/events";
import {
  closeProjectDb,
  initializeProjectDb,
  openProjectDb
} from "../../lib/runtime/db";

const VALID_FIGMA = "https://www.figma.com/design/AbCdEf/Checkout?node-id=1:2";

function minimalPackage(overrides: Record<string, unknown> = {}) {
  return {
    figmaSeedReference: VALID_FIGMA,
    frame: { nodeId: "1:2", name: "Checkout" },
    evidenceViews: { rawData: "available", screenshot: "missing" },
    ...overrides
  };
}

function withTempProject(fn: (dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), "ikran-region-ann-unit-"));
  try {
    initializeProjectDb(dir);
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function seedSurface(
  dir: string,
  overrides: Record<string, unknown> = {}
): string {
  const figmaUrl =
    typeof overrides.figmaSeedReference === "string"
      ? overrides.figmaSeedReference
      : VALID_FIGMA;
  const seed = registerSeedReference(dir, {
    figmaSeedReference: figmaUrl,
    originalDesignIntent: "region annotation fixture"
  });
  expect(seed.ok).toBe(true);
  if (!seed.ok) throw new Error(`registerSeed failed: ${seed.reason}`);

  const res = recordEvidencePackage(dir, minimalPackage(overrides));
  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error(`seedSurface failed: ${res.reason}`);
  return res.record.id;
}

function validRect() {
  return { x: 0.1, y: 0.2, w: 0.3, h: 0.25 };
}

function addPositionalFixture(
  dir: string,
  surfaceId: string,
  nodes: unknown[]
): void {
  const db = openProjectDb(dir);
  try {
    db.prepare(
      `UPDATE figma_evidence_surfaces
       SET frame_bounds_json = ?, positional_nodes_json = ?
       WHERE id = ?`
    ).run(
      JSON.stringify({ x: 100, y: 200, width: 400, height: 800 }),
      JSON.stringify(nodes),
      surfaceId
    );
  } finally {
    closeProjectDb(db);
  }
}

test.describe("validateRegionAnnotationInput (unit)", () => {
  test("accepts an explicit figma-region target and rejects the legacy top-level anchor", () => {
    const explicit = validateRegionAnnotationInput({
      target: {
        kind: "figma-region",
        surfaceArtifactId: "surf-1",
        rect: validRect()
      },
      author: "designer",
      body: "Explicit target"
    });
    expect(explicit.ok).toBe(true);
    if (explicit.ok) {
      expect(explicit.input.target).toEqual({
        kind: "figma-region",
        surfaceArtifactId: "surf-1",
        rect: validRect()
      });
    }

    const legacy = validateRegionAnnotationInput({
      surfaceArtifactId: "surf-1",
      author: "designer",
      body: "Legacy target",
      rect: validRect()
    });
    expect(legacy).toEqual({ ok: false, reason: "missing_target" });
  });

  test("accepts a whole figma-surface target with captured evidence identity", () => {
    const result = validateRegionAnnotationInput({
      target: {
        kind: "figma-surface",
        evidenceVersionId: "surface-v1"
      },
      author: "agent",
      body: "Whole captured surface"
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.target).toEqual({
      kind: "figma-surface",
      evidenceVersionId: "surface-v1"
    });
    expect(result.input.rect).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  test("figma-node target requires both captured evidence version and node id", () => {
    const valid = validateRegionAnnotationInput({
      target: {
        kind: "figma-node",
        evidenceVersionId: "surface-v1",
        nodeId: "12:34"
      },
      author: "designer",
      body: "Explicit source node"
    });
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.input.target).toEqual({
        kind: "figma-node",
        evidenceVersionId: "surface-v1",
        nodeId: "12:34"
      });
    }

    expect(
      validateRegionAnnotationInput({
        target: { kind: "figma-node", nodeId: "12:34" },
        author: "designer",
        body: "Missing captured version"
      })
    ).toEqual({ ok: false, reason: "invalid_target" });
  });

  test("missing surface anchor", () => {
    const res = validateRegionAnnotationInput({
      target: { kind: "figma-region", rect: validRect() },
      author: "designer",
      body: "Placeholder annotation"
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("missing_surface_anchor");
  });

  test("invalid rect: negative", () => {
    const res = validateRegionAnnotationInput({
      target: {
        kind: "figma-region",
        surfaceArtifactId: "surf-1",
        rect: { x: -0.1, y: 0.2, w: 0.3, h: 0.25 }
      },
      author: "designer",
      body: "x"
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("invalid_rect");
  });

  test("invalid rect: component > 1", () => {
    const res = validateRegionAnnotationInput({
      target: {
        kind: "figma-region",
        surfaceArtifactId: "surf-1",
        rect: { x: 0.1, y: 0.2, w: 1.5, h: 0.25 }
      },
      author: "designer",
      body: "x"
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("invalid_rect");
  });

  test("invalid rect: overflow past media box edge", () => {
    const res = validateRegionAnnotationInput({
      target: {
        kind: "figma-region",
        surfaceArtifactId: "surf-1",
        rect: { x: 0.8, y: 0.8, w: 0.3, h: 0.3 }
      },
      author: "designer",
      body: "x"
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("invalid_rect");
  });

  test("invalid rect: zero width only (not a point)", () => {
    const res = validateRegionAnnotationInput({
      target: {
        kind: "figma-region",
        surfaceArtifactId: "surf-1",
        rect: { x: 0.1, y: 0.2, w: 0, h: 0.25 }
      },
      author: "designer",
      body: "x"
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("invalid_rect");
  });

  test("zero-area rect expands to centered POINT_SIDE square", () => {
    const res = validateRegionAnnotationInput({
      target: {
        kind: "figma-region",
        surfaceArtifactId: "surf-1",
        rect: { x: 0.5, y: 0.5, w: 0, h: 0 }
      },
      author: "designer",
      body: "Placeholder annotation"
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.input.rect).toEqual(expandPointToRect({ x: 0.5, y: 0.5 }));
    expect(res.input.rect!.w).toBe(POINT_SIDE);
    expect(res.input.rect!.h).toBe(POINT_SIDE);
  });

  test("point expands to centered square, edge-shifted near corner", () => {
    const res = validateRegionAnnotationInput({
      target: {
        kind: "figma-region",
        surfaceNodeId: "1:2",
        point: { x: 0, y: 0 }
      },
      author: "agent",
      body: "click"
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.input.rect).toEqual({ x: 0, y: 0, w: POINT_SIDE, h: POINT_SIDE });
  });

  test("designer default type is explanatory", () => {
    const res = validateRegionAnnotationInput({
      target: {
        kind: "figma-region",
        surfaceArtifactId: "surf-1",
        rect: validRect()
      },
      author: "designer",
      body: "Placeholder annotation"
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.input.type).toBe("explanatory");
  });

  test("agent default type is assumption", () => {
    const res = validateRegionAnnotationInput({
      target: {
        kind: "figma-region",
        surfaceNodeId: "1:2",
        rect: validRect()
      },
      author: "agent",
      body: "maybe CTA"
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.input.type).toBe("assumption");
  });
});

test.describe("createRegionAnnotation / listRegionAnnotations (unit)", () => {
  test("figma-surface anchors the whole captured evidence version", () => {
    withTempProject((dir) => {
      const surfaceId = seedSurface(dir);
      const result = createRegionAnnotation(dir, {
        target: { kind: "figma-surface", evidenceVersionId: surfaceId },
        author: "agent",
        body: "Whole surface"
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.record.target_kind).toBe("figma-surface");
      expect(result.record.target_evidence_version_id).toBe(surfaceId);
      expect(result.record.target_node_id).toBeNull();
      expect({
        x: result.record.rect_x,
        y: result.record.rect_y,
        w: result.record.rect_w,
        h: result.record.rect_h
      }).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    });
  });

  test("Agent confirmation records the primary against annotation, evidence version, and source node", () => {
    withTempProject((dir) => {
      const surfaceId = seedSurface(dir);
      addPositionalFixture(dir, surfaceId, [
        {
          id: "12:34",
          parentId: "1:2",
          name: "CTA",
          type: "FRAME",
          depth: 1,
          visible: true,
          bounds: { x: 140, y: 400, width: 120, height: 160 }
        }
      ]);
      const created = createRegionAnnotation(dir, {
        target: {
          kind: "figma-region",
          surfaceArtifactId: surfaceId,
          rect: { x: 0.1, y: 0.25, w: 0.3, h: 0.2 }
        },
        author: "agent",
        body: "Likely CTA"
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.record.primary_node_id).toBeNull();
      expect(JSON.parse(created.record.candidates_json ?? "[]")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ nodeId: "12:34" })
        ])
      );

      const confirmed = confirmAnnotationPrimaryNode(dir, {
        annotationId: created.record.id,
        evidenceVersionId: surfaceId,
        sourceNodeId: "12:34"
      });
      expect(confirmed.ok).toBe(true);
      if (!confirmed.ok) return;
      expect(confirmed.confirmation.annotation_id).toBe(created.record.id);
      expect(confirmed.confirmation.evidence_version_id).toBe(surfaceId);
      expect(confirmed.confirmation.source_node_id).toBe("12:34");
      const listed = listRegionAnnotations(dir)[0];
      expect(listed.primary_node_id).toBe("12:34");
      expect(listed.current_node_id).toBe("12:34");
      expect(listed.correspondence_status).toBe("corresponding");
      expect(listed.stale).toBe(false);
    });
  });

  test("confirmed region becomes stale when its primary node is absent from the current evidence", () => {
    withTempProject((dir) => {
      const capturedSurfaceId = seedSurface(dir);
      addPositionalFixture(dir, capturedSurfaceId, [
        {
          id: "12:34",
          parentId: "1:2",
          name: "CTA",
          type: "FRAME",
          depth: 1,
          visible: true,
          bounds: { x: 140, y: 400, width: 120, height: 160 }
        }
      ]);
      const created = createRegionAnnotation(dir, {
        target: {
          kind: "figma-region",
          surfaceArtifactId: capturedSurfaceId,
          rect: { x: 0.1, y: 0.25, w: 0.3, h: 0.2 }
        },
        author: "agent",
        body: "Likely CTA"
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const confirmed = confirmAnnotationPrimaryNode(dir, {
        annotationId: created.record.id,
        evidenceVersionId: capturedSurfaceId,
        sourceNodeId: "12:34"
      });
      expect(confirmed.ok).toBe(true);

      const refreshed = recordEvidencePackage(
        dir,
        minimalPackage({ frame: { nodeId: "1:2", name: "Refreshed" } })
      );
      expect(refreshed.ok).toBe(true);
      if (!refreshed.ok) return;
      addPositionalFixture(dir, refreshed.record.id, []);

      const replayed = listRegionAnnotations(dir)[0];
      expect(replayed.primary_node_id).toBe("12:34");
      expect(replayed.current_evidence_version_id).toBe(refreshed.record.id);
      expect(replayed.correspondence_status).toBe("missing");
      expect(replayed.stale).toBe(true);
    });
  });

  test("figma-node persists captured target and derives geometry from that evidence version", () => {
    withTempProject((dir) => {
      const surfaceId = seedSurface(dir);
      addPositionalFixture(dir, surfaceId, [
        {
          id: "12:34",
          parentId: "1:2",
          name: "CTA",
          type: "FRAME",
          depth: 1,
          visible: true,
          bounds: { x: 140, y: 400, width: 120, height: 160 }
        }
      ]);

      const result = createRegionAnnotation(dir, {
        target: {
          kind: "figma-node",
          evidenceVersionId: surfaceId,
          nodeId: "12:34"
        },
        author: "designer",
        body: "Captured CTA"
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.record.target_kind).toBe("figma-node");
      expect(result.record.target_evidence_version_id).toBe(surfaceId);
      expect(result.record.target_node_id).toBe("12:34");
      expect(result.record.primary_node_id).toBeNull();
      expect({
        x: result.record.rect_x,
        y: result.record.rect_y,
        w: result.record.rect_w,
        h: result.record.rect_h
      }).toEqual({ x: 0.1, y: 0.25, w: 0.3, h: 0.2 });
    });
  });

  test("figma-node rejects a node absent from the captured evidence version", () => {
    withTempProject((dir) => {
      const surfaceId = seedSurface(dir);
      addPositionalFixture(dir, surfaceId, []);

      const result = createRegionAnnotation(dir, {
        target: {
          kind: "figma-node",
          evidenceVersionId: surfaceId,
          nodeId: "missing:1"
        },
        author: "designer",
        body: "Missing"
      });

      expect(result).toEqual({ ok: false, reason: "node_not_found" });
      expect(listRegionAnnotations(dir)).toEqual([]);
    });
  });

  test("figma-node remains replayable and becomes stale when refresh has no correspondence", () => {
    withTempProject((dir) => {
      const seed = registerSeedReference(dir, {
        figmaSeedReference: VALID_FIGMA,
        originalDesignIntent: "stale fixture"
      });
      expect(seed.ok).toBe(true);
      if (!seed.ok) return;
      const first = recordEvidencePackage(
        dir,
        minimalPackage({
          seedReferenceId: seed.record.id,
          figmaSeedReference: undefined,
          frame: { nodeId: "1:2", name: "First" }
        })
      );
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      addPositionalFixture(dir, first.record.id, [
        {
          id: "12:34",
          parentId: "1:2",
          name: "CTA",
          type: "FRAME",
          depth: 1,
          visible: true,
          bounds: { x: 140, y: 400, width: 120, height: 160 }
        }
      ]);
      const created = createRegionAnnotation(dir, {
        target: {
          kind: "figma-node",
          evidenceVersionId: first.record.id,
          nodeId: "12:34"
        },
        author: "designer",
        body: "Historical CTA"
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const second = recordEvidencePackage(
        dir,
        minimalPackage({
          seedReferenceId: seed.record.id,
          figmaSeedReference: undefined,
          frame: { nodeId: "1:2", name: "Second" }
        })
      );
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      addPositionalFixture(dir, second.record.id, [
        {
          id: "12:34",
          parentId: "1:2",
          name: "Hidden replacement",
          type: "FRAME",
          depth: 1,
          visible: false,
          bounds: { x: 180, y: 500, width: 100, height: 100 }
        }
      ]);

      const replayed = listRegionAnnotations(dir)[0];
      expect(replayed.target_evidence_version_id).toBe(first.record.id);
      expect(replayed.current_evidence_version_id).toBe(second.record.id);
      expect(replayed.correspondence_status).toBe("missing");
      expect(replayed.stale).toBe(true);
      expect(replayed.current_node_id).toBeNull();
      expect(replayed.current_rect_x).toBeNull();
      expect(replayed.rect_x).toBe(created.record.rect_x);
    });
  });

  test("fail-closed: missing surface anchor writes no row", () => {
    withTempProject((dir) => {
      seedSurface(dir);
      const res = createRegionAnnotation(dir, {
        target: { kind: "figma-region", rect: validRect() },
        author: "designer",
        body: "Placeholder annotation"
      });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("missing_surface_anchor");
      expect(listRegionAnnotations(dir)).toEqual([]);
      expect(listEvents(dir, "annotation_created")).toEqual([]);
    });
  });

  test("fail-closed: invalid rect writes no row", () => {
    withTempProject((dir) => {
      const surfaceId = seedSurface(dir);
      const res = createRegionAnnotation(dir, {
        target: {
          kind: "figma-region",
          surfaceArtifactId: surfaceId,
          rect: { x: -0.1, y: 0, w: 0.2, h: 0.2 }
        },
        author: "designer",
        body: "x"
      });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("invalid_rect");
      expect(listRegionAnnotations(dir)).toEqual([]);
    });
  });

  test("fail-closed: unknown surfaceArtifactId → surface_not_found", () => {
    withTempProject((dir) => {
      seedSurface(dir);
      const res = createRegionAnnotation(dir, {
        target: {
          kind: "figma-region",
          surfaceArtifactId: "does-not-exist",
          rect: validRect()
        },
        author: "designer",
        body: "x"
      });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("surface_not_found");
      expect(listRegionAnnotations(dir)).toEqual([]);
    });
  });

  test("fail-closed: unknown surfaceNodeId → surface_not_found", () => {
    withTempProject((dir) => {
      seedSurface(dir);
      const res = createRegionAnnotation(dir, {
        target: {
          kind: "figma-region",
          surfaceNodeId: "99:99",
          rect: validRect()
        },
        author: "agent",
        body: "x"
      });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("surface_not_found");
    });
  });

  test("fail-closed: ambiguous surfaceNodeId → surface_ambiguous", () => {
    withTempProject((dir) => {
      // Two distinct seeds (different file keys), each tip sharing frame_node_id.
      // frame.nodeId must match each seed's canonical node (frame_node_mismatch).
      seedSurface(dir, {
        figmaSeedReference:
          "https://www.figma.com/design/AbCdEf/Checkout?node-id=dup:1",
        frame: { nodeId: "dup:1", name: "A" }
      });
      seedSurface(dir, {
        figmaSeedReference:
          "https://www.figma.com/design/XyZaBc/Other?node-id=dup:1",
        frame: { nodeId: "dup:1", name: "B" }
      });
      const res = createRegionAnnotation(dir, {
        target: {
          kind: "figma-region",
          surfaceNodeId: "dup:1",
          rect: validRect()
        },
        author: "agent",
        body: "ambiguous"
      });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe("surface_ambiguous");
      expect(listRegionAnnotations(dir)).toEqual([]);
    });
  });

  test("node-only create resolves to current tip across lineage, not ambiguous", () => {
    withTempProject((dir) => {
      const seed = registerSeedReference(dir, {
        figmaSeedReference: VALID_FIGMA,
        originalDesignIntent: "lineage tip fixture"
      });
      expect(seed.ok).toBe(true);
      if (!seed.ok) throw new Error(`registerSeed failed: ${seed.reason}`);

      const first = recordEvidencePackage(
        dir,
        minimalPackage({
          seedReferenceId: seed.record.id,
          figmaSeedReference: undefined,
          frame: { nodeId: "1:2", name: "First" }
        })
      );
      expect(first.ok).toBe(true);
      if (!first.ok) throw new Error(`first package failed: ${first.reason}`);

      const second = recordEvidencePackage(
        dir,
        minimalPackage({
          seedReferenceId: seed.record.id,
          figmaSeedReference: undefined,
          frame: { nodeId: "1:2", name: "Second" },
          evidenceViews: { rawData: "available", screenshot: "available" },
          screenshot: { artifactPath: "artifacts/second.png" }
        })
      );
      expect(second.ok).toBe(true);
      if (!second.ok) throw new Error(`second package failed: ${second.reason}`);

      // Two surfaces share frame_node_id; only second is the seed tip.
      const res = createRegionAnnotation(dir, {
        target: {
          kind: "figma-region",
          surfaceNodeId: "1:2",
          rect: validRect()
        },
        author: "agent",
        body: "anchors tip after supersede"
      });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.record.surface_id).toBe(second.record.id);
      expect(res.record.surface_artifact_id).toBe(second.record.id);
      expect(res.record.surface_node_id).toBe("1:2");
    });
  });

  test("valid designer annotation via surfaceArtifactId", () => {
    withTempProject((dir) => {
      const surfaceId = seedSurface(dir);
      const res = createRegionAnnotation(dir, {
        target: {
          kind: "figma-region",
          surfaceArtifactId: surfaceId,
          rect: validRect()
        },
        author: "designer",
        body: "Placeholder annotation"
      });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(typeof res.event_id).toBe("string");
      expect(res.record.author).toBe("designer");
      expect(res.record.type).toBe("explanatory");
      expect(res.record.body).toBe("Placeholder annotation");
      expect(res.record.surface_id).toBe(surfaceId);
      expect(res.record.surface_artifact_id).toBe(surfaceId);
      expect(res.record.surface_node_id).toBe("1:2");
      expect(res.record.rect_x).toBe(0.1);
      expect(res.record.rect_w).toBe(0.3);

      const events = listEvents(dir, "annotation_created");
      expect(events.length).toBe(1);
    });
  });

  test("valid Agent region annotation is created without inferred primary", () => {
    withTempProject((dir) => {
      const surfaceId = seedSurface(dir);
      const res = createRegionAnnotation(dir, {
        target: {
          kind: "figma-region",
          surfaceNodeId: "1:2",
          rect: { x: 0.05, y: 0.05, w: 0.2, h: 0.1 }
        },
        author: "agent",
        body: "CTA may be primary action",
        type: "assumption"
      });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.record.author).toBe("agent");
      expect(res.record.type).toBe("assumption");
      expect(res.record.surface_id).toBe(surfaceId);
      expect(res.record.surface_artifact_id).toBe(surfaceId);
      expect(res.record.surface_node_id).toBe("1:2");
      expect(res.record.primary_node_id).toBeNull();
      // DB stores raw validated input; padding is display-time only.
      expect(res.record.rect_x).toBe(0.05);
      expect(res.record.rect_y).toBe(0.05);
      expect(res.record.rect_w).toBe(0.2);
      expect(res.record.rect_h).toBe(0.1);
      expect(res.record.geometry_version).toBe("v2_raw");
      expect(res.record.from_point).toBe(false);
      expect(AGENT_REGION_MARGIN).toBeGreaterThan(0);
    });
  });

  test("agent explicit: DB=raw input; display expands page-isotropically", () => {
    const tall = { w: 390, h: 1560 };
    const raw = { x: 0.2, y: 0.25, w: 0.6, h: 0.08 };

    withTempProject((dir) => {
      const surfaceId = seedSurface(dir, {
        frame: {
          nodeId: "1:2",
          name: "Checkout",
          bounds: { x: 0, y: 0, width: 390, height: 1560 }
        }
      });
      const res = createRegionAnnotation(dir, {
        target: {
          kind: "figma-region",
          surfaceArtifactId: surfaceId,
          rect: raw
        },
        author: "agent",
        body: "name box"
      });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.record.rect_x).toBe(raw.x);
      expect(res.record.rect_y).toBe(raw.y);
      expect(res.record.rect_w).toBe(raw.w);
      expect(res.record.rect_h).toBe(raw.h);
      expect(res.record.geometry_version).toBe("v2_raw");
      expect(res.record.from_point).toBe(false);

      const display = displayRectForRegionAnnotation({
        author: res.record.author,
        rect: {
          x: res.record.rect_x,
          y: res.record.rect_y,
          w: res.record.rect_w,
          h: res.record.rect_h
        },
        geometry_version: res.record.geometry_version,
        from_point: res.record.from_point,
        mediaSize: tall
      });
      const expected = expandAgentRegionRect(raw, tall);
      expect(display).toEqual(expected);
      expect(display.h - raw.h).toBeLessThan(display.w - raw.w);
    });
  });

  test("designer rect and agent point unchanged in DB and display", () => {
    withTempProject((dir) => {
      const surfaceId = seedSurface(dir);
      const designer = createRegionAnnotation(dir, {
        target: {
          kind: "figma-region",
          surfaceArtifactId: surfaceId,
          rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.15 }
        },
        author: "designer",
        body: "exact"
      });
      expect(designer.ok).toBe(true);
      if (!designer.ok) return;
      expect(designer.record.rect_x).toBe(0.1);
      expect(designer.record.rect_w).toBe(0.2);
      expect(designer.record.geometry_version).toBe("v2_raw");
      expect(designer.record.from_point).toBe(false);

      const point = createRegionAnnotation(dir, {
        target: {
          kind: "figma-region",
          surfaceArtifactId: surfaceId,
          point: { x: 0.5, y: 0.5 }
        },
        author: "agent",
        body: "click"
      });
      expect(point.ok).toBe(true);
      if (!point.ok) return;
      expect(point.record.from_point).toBe(true);
      expect(point.record.geometry_version).toBe("v2_raw");
      expect(point.record.rect_w).toBe(POINT_SIDE);
      const display = displayRectForRegionAnnotation({
        author: point.record.author,
        rect: {
          x: point.record.rect_x,
          y: point.record.rect_y,
          w: point.record.rect_w,
          h: point.record.rect_h
        },
        geometry_version: point.record.geometry_version,
        from_point: point.record.from_point,
        mediaSize: { w: 100, h: 400 }
      });
      expect(display.w).toBe(POINT_SIDE);
      expect(display.h).toBe(POINT_SIDE);
    });
  });

  test("list returns oldest-first", () => {
    withTempProject((dir) => {
      const surfaceId = seedSurface(dir);
      const first = createRegionAnnotation(dir, {
        target: {
          kind: "figma-region",
          surfaceArtifactId: surfaceId,
          rect: validRect()
        },
        author: "designer",
        body: "first"
      });
      const second = createRegionAnnotation(dir, {
        target: {
          kind: "figma-region",
          surfaceArtifactId: surfaceId,
          rect: { x: 0.4, y: 0.4, w: 0.1, h: 0.1 }
        },
        author: "agent",
        body: "second"
      });
      expect(first.ok && second.ok).toBe(true);
      if (!first.ok || !second.ok) return;

      const listed = listRegionAnnotations(dir);
      expect(listed.map((r) => r.body)).toEqual(["first", "second"]);
      expect(listed[0].created_at <= listed[1].created_at).toBe(true);
    });
  });

  test("deleteRegionAnnotation: designer ok; agent not_deletable; missing not_found", () => {
    withTempProject((dir) => {
      const surfaceId = seedSurface(dir);
      const designer = createRegionAnnotation(dir, {
        target: {
          kind: "figma-region",
          surfaceArtifactId: surfaceId,
          rect: validRect()
        },
        author: "designer",
        body: "to delete"
      });
      const agent = createRegionAnnotation(dir, {
        target: {
          kind: "figma-region",
          surfaceArtifactId: surfaceId,
          rect: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }
        },
        author: "agent",
        body: "keep"
      });
      expect(designer.ok && agent.ok).toBe(true);
      if (!designer.ok || !agent.ok) return;

      const blocked = deleteRegionAnnotation(dir, agent.record.id);
      expect(blocked).toEqual({ ok: false, reason: "not_deletable" });
      expect(listRegionAnnotations(dir).map((r) => r.id)).toContain(
        agent.record.id
      );

      const missing = deleteRegionAnnotation(dir, "no-such-id");
      expect(missing).toEqual({ ok: false, reason: "not_found" });

      const removed = deleteRegionAnnotation(dir, designer.record.id);
      expect(removed).toEqual({ ok: true, id: designer.record.id });
      expect(listRegionAnnotations(dir).map((r) => r.id)).toEqual([
        agent.record.id
      ]);
    });
  });
});
