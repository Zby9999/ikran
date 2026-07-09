"use client";

// tldraw Workbench canvas shell (Issue 02/04 + 05).
//
// Replaces the React Flow seed surface. This is a MINIMAL canvas 底座:
//   - `<Tldraw hideUi>` renders only the drawing surface (no default
//     toolbar / panels / page menu). The Issue 02/04 brief explicitly says do not
//     add complex toolbars or side panels.
//   - The custom `seed-reference-projection` shape (Figma Frame surface 230:297)
//     projects seed references and, when present, Figma Evidence Surfaces
//     (frameName + screenshot data URL in media).
//   - `SeedProjectionSync` does a one-way reconciliation: Runtime records ->
//     tldraw shapes. It never reads geometry back. tldraw positions are local
//     only; the default `<Tldraw>` store is in-memory (no persistence), so a
//     refresh resets shapes and they are rebuilt from the records.
//   - Decorative camera-aware 100px page-space grid (Figma 133:129) via
//     Background — visual only, no snap-to-grid.
//
// This file is imported via `next/dynamic({ ssr: false })` from
// SeedEvidenceWorkbench because `<Tldraw>` touches the DOM during render.

import { useEffect } from "react";
import {
  Tldraw,
  useEditor,
  createShapeId,
  type TLShapeId
} from "tldraw";
import {
  SeedReferenceProjectionShapeUtil,
  SEED_REFERENCE_PROJECTION_TYPE,
  SEED_REFERENCE_PROJECTION_DEFAULT_W,
  SEED_REFERENCE_PROJECTION_DEFAULT_H,
  type SeedReferenceProjectionShape,
  type SeedReferenceProjectionMeta
} from "./seed-reference-projection-shape";
import { SeedSelectionForegroundOverlayUtil } from "./seed-selection-foreground-overlay";
import { WORKBENCH_CANVAS_COMPONENTS } from "./workbench-canvas-grid";
import type { SeedReferenceRecord } from "@/lib/runtime/seed-reference";
import type { FigmaEvidenceSurfaceRecord } from "@/lib/runtime/evidence-package";

export function WorkbenchCanvas({
  records,
  surfaces = []
}: {
  records: SeedReferenceRecord[];
  surfaces?: FigmaEvidenceSurfaceRecord[];
}) {
  return (
    <Tldraw
      hideUi
      shapeUtils={[SeedReferenceProjectionShapeUtil]}
      components={WORKBENCH_CANVAS_COMPONENTS}
      overlayUtils={[SeedSelectionForegroundOverlayUtil]}
    >
      <SeedProjectionSync records={records} surfaces={surfaces} />
    </Tldraw>
  );
}

type ProjectionTarget = {
  /** Stable tldraw shape id key (seed id preferred when linked). */
  shapeKey: string;
  canvasRecordId: string;
  figmaSeedReference: string;
  originalDesignIntent: string;
  frameName: string;
  screenshotDataUrl: string;
  hasScreenshotArtifact: boolean;
  meta: SeedReferenceProjectionMeta;
  /** Optional size from surface_bounds / frame.bounds; else defaults. */
  w: number;
  h: number;
};

function parsePositiveSize(
  json: string | null
): { width: number; height: number } | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const width = parsed.width;
    const height = parsed.height;
    if (
      typeof width === "number" &&
      typeof height === "number" &&
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
    ) {
      return { width, height };
    }
  } catch {
    // ignore malformed bounds
  }
  return null;
}

/** Default 380×520, or aspect-locked height from surface/frame bounds. */
function projectionSize(surface: FigmaEvidenceSurfaceRecord | null): {
  w: number;
  h: number;
} {
  const w = SEED_REFERENCE_PROJECTION_DEFAULT_W;
  const bounds =
    (surface && parsePositiveSize(surface.surface_bounds_json)) ||
    (surface && parsePositiveSize(surface.frame_bounds_json));
  if (!bounds) {
    return { w, h: SEED_REFERENCE_PROJECTION_DEFAULT_H };
  }
  const aspect = bounds.height / bounds.width;
  if (!Number.isFinite(aspect) || aspect <= 0) {
    return { w, h: SEED_REFERENCE_PROJECTION_DEFAULT_H };
  }
  return { w, h: Math.round(w * aspect) };
}

function findSurfaceForSeed(
  seed: SeedReferenceRecord,
  surfaces: FigmaEvidenceSurfaceRecord[],
  claimedSurfaceIds: Set<string>
): FigmaEvidenceSurfaceRecord | null {
  // Prefer explicit seed_reference_id link, then same figma URL.
  const byId = surfaces.find(
    (s) =>
      !claimedSurfaceIds.has(s.id) && s.seed_reference_id === seed.id
  );
  if (byId) return byId;
  const byUrl = surfaces.find(
    (s) =>
      !claimedSurfaceIds.has(s.id) &&
      s.figma_seed_reference === seed.figma_seed_reference
  );
  return byUrl ?? null;
}

function buildProjectionTargets(
  seeds: SeedReferenceRecord[],
  surfaces: FigmaEvidenceSurfaceRecord[]
): ProjectionTarget[] {
  const targets: ProjectionTarget[] = [];
  const claimedSurfaceIds = new Set<string>();

  for (const seed of seeds) {
    const surface = findSurfaceForSeed(seed, surfaces, claimedSurfaceIds);
    if (surface) claimedSurfaceIds.add(surface.id);

    const size = projectionSize(surface);
    if (surface) {
      // Shape stays keyed by seed id so in-session drag survives surface arrival.
      // runtimeRecordId becomes surface.id; seed id kept in seedRecordId + data-*.
      targets.push({
        shapeKey: seed.id,
        canvasRecordId: `seed-reference:${seed.id}`,
        figmaSeedReference: seed.figma_seed_reference,
        originalDesignIntent: seed.original_design_intent,
        frameName: surface.frame_name,
        screenshotDataUrl: surface.screenshot_data_url ?? "",
        hasScreenshotArtifact: Boolean(
          surface.screenshot_artifact_path && !surface.screenshot_data_url
        ),
        w: size.w,
        h: size.h,
        meta: {
          canvasRecordId: `seed-reference:${seed.id}`,
          runtimeRecordId: surface.id,
          kind: "figma_evidence_surface",
          seedRecordId: seed.id,
          surfaceRecordId: surface.id
        }
      });
    } else {
      targets.push({
        shapeKey: seed.id,
        canvasRecordId: `seed-reference:${seed.id}`,
        figmaSeedReference: seed.figma_seed_reference,
        originalDesignIntent: seed.original_design_intent,
        frameName: "",
        screenshotDataUrl: "",
        hasScreenshotArtifact: false,
        w: size.w,
        h: size.h,
        meta: {
          canvasRecordId: `seed-reference:${seed.id}`,
          runtimeRecordId: seed.id,
          kind: "seed_reference_projection"
        }
      });
    }
  }

  // Surfaces with no matching seed shape yet — project alone.
  for (const surface of surfaces) {
    if (claimedSurfaceIds.has(surface.id)) continue;
    const size = projectionSize(surface);
    targets.push({
      shapeKey: `surface:${surface.id}`,
      canvasRecordId: `figma-evidence-surface:${surface.id}`,
      figmaSeedReference: surface.figma_seed_reference,
      originalDesignIntent: "",
      frameName: surface.frame_name,
      screenshotDataUrl: surface.screenshot_data_url ?? "",
      hasScreenshotArtifact: Boolean(
        surface.screenshot_artifact_path && !surface.screenshot_data_url
      ),
      w: size.w,
      h: size.h,
      meta: {
        canvasRecordId: `figma-evidence-surface:${surface.id}`,
        runtimeRecordId: surface.id,
        kind: "figma_evidence_surface",
        seedRecordId: surface.seed_reference_id ?? undefined,
        surfaceRecordId: surface.id
      }
    });
  }

  return targets;
}

function propsEqual(
  a: SeedReferenceProjectionShape["props"],
  b: ProjectionTarget
): boolean {
  // Geometry (w/h) is local-only — compare semantic projection fields only.
  return (
    a.figmaSeedReference === b.figmaSeedReference &&
    a.originalDesignIntent === b.originalDesignIntent &&
    a.frameName === b.frameName &&
    a.screenshotDataUrl === b.screenshotDataUrl &&
    a.hasScreenshotArtifact === b.hasScreenshotArtifact
  );
}

function metaEqual(
  a: SeedReferenceProjectionMeta,
  b: SeedReferenceProjectionMeta
): boolean {
  return (
    a.canvasRecordId === b.canvasRecordId &&
    a.runtimeRecordId === b.runtimeRecordId &&
    a.kind === b.kind &&
    (a.seedRecordId ?? "") === (b.seedRecordId ?? "") &&
    (a.surfaceRecordId ?? "") === (b.surfaceRecordId ?? "")
  );
}

// One-way projection: merge seed + Evidence Surface records into shapes.
// Geometry is chosen here and NEVER written back to the Runtime.
function SeedProjectionSync({
  records,
  surfaces
}: {
  records: SeedReferenceRecord[];
  surfaces: FigmaEvidenceSurfaceRecord[];
}) {
  const editor = useEditor();

  useEffect(() => {
    if (!editor) return;

    const targets = buildProjectionTargets(records, surfaces);
    const wantIds = new Set<string>();

    targets.forEach((target, index) => {
      const shapeId = createShapeId(target.shapeKey) as TLShapeId;
      wantIds.add(String(shapeId));

      const existing = editor.getShape(shapeId) as
        | SeedReferenceProjectionShape
        | undefined;

      if (existing) {
        // Update semantic props / meta when a surface arrives or changes;
        // keep in-session x/y/w/h (never write geometry back).
        const nextProps = {
          figmaSeedReference: target.figmaSeedReference,
          originalDesignIntent: target.originalDesignIntent,
          frameName: target.frameName,
          screenshotDataUrl: target.screenshotDataUrl,
          hasScreenshotArtifact: target.hasScreenshotArtifact
        };
        const propsChanged = !propsEqual(existing.props, target);
        const metaChanged = !metaEqual(
          existing.meta as SeedReferenceProjectionMeta,
          target.meta
        );
        if (propsChanged || metaChanged) {
          editor.updateShape<SeedReferenceProjectionShape>({
            id: shapeId,
            type: SEED_REFERENCE_PROJECTION_TYPE,
            props: propsChanged ? nextProps : undefined,
            meta: metaChanged ? target.meta : undefined
          });
        }
        return;
      }

      const column = index % 4;
      const row = Math.floor(index / 4);
      editor.createShape<SeedReferenceProjectionShape>({
        id: shapeId,
        type: SEED_REFERENCE_PROJECTION_TYPE,
        x: 120 + column * 420,
        y: 140 + row * 560,
        props: {
          w: target.w,
          h: target.h,
          figmaSeedReference: target.figmaSeedReference,
          originalDesignIntent: target.originalDesignIntent,
          frameName: target.frameName,
          screenshotDataUrl: target.screenshotDataUrl,
          hasScreenshotArtifact: target.hasScreenshotArtifact
        },
        meta: target.meta
      });
    });

    const projected = editor
      .getCurrentPageShapes()
      .filter((s) => s.type === SEED_REFERENCE_PROJECTION_TYPE);
    for (const shape of projected) {
      if (!wantIds.has(String(shape.id))) {
        editor.deleteShape(shape.id);
      }
    }
  }, [editor, records, surfaces]);

  return null;
}
