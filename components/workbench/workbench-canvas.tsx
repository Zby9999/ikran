"use client";

// tldraw Workbench canvas shell (Issue 02/04 + 05).
//
// Replaces the React Flow seed surface. This is a MINIMAL canvas 底座:
//   - `<Tldraw hideUi>` renders only the drawing surface (no default
//     toolbar / panels / page menu). The Issue 02/04 brief explicitly says do not
//     add complex toolbars or side panels.
//   - The custom `seed-reference-projection` shape (Figma Frame surface 230:297)
//     projects seed references and, when present, Figma Evidence Surfaces
//     (frameName + screenshot via data URL or authenticated /api/artifacts).
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
import { findSurfaceForSeed } from "./find-surface-for-seed";

/** Build a same-origin Workbench URL for a project-relative artifact path. */
export function artifactScreenshotUrl(
  relativePath: string,
  session: string
): string {
  const segments = relativePath
    .split(/[/\\]/)
    .filter((s) => s.length > 0)
    .map((s) => encodeURIComponent(s));
  return `/api/artifacts/${segments.join("/")}?session=${encodeURIComponent(session)}`;
}

function screenshotSrcForSurface(
  surface: FigmaEvidenceSurfaceRecord,
  session: string
): { src: string; hasArtifactOnly: boolean } {
  const dataUrl = surface.screenshot_data_url?.trim() ?? "";
  if (dataUrl) return { src: dataUrl, hasArtifactOnly: false };
  const artifactPath = surface.screenshot_artifact_path?.trim() ?? "";
  if (artifactPath && session) {
    return {
      src: artifactScreenshotUrl(artifactPath, session),
      hasArtifactOnly: true
    };
  }
  return { src: "", hasArtifactOnly: false };
}

export function WorkbenchCanvas({
  records,
  surfaces = [],
  session
}: {
  records: SeedReferenceRecord[];
  surfaces?: FigmaEvidenceSurfaceRecord[];
  /** Startup session token — required to load artifactPath screenshots via /api/artifacts. */
  session: string;
}) {
  return (
    <Tldraw
      hideUi
      shapeUtils={[SeedReferenceProjectionShapeUtil]}
      components={WORKBENCH_CANVAS_COMPONENTS}
      overlayUtils={[SeedSelectionForegroundOverlayUtil]}
    >
      <SeedProjectionSync
        records={records}
        surfaces={surfaces}
        session={session}
      />
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
  /** <img src>: data URL or authenticated /api/artifacts URL. */
  screenshotDataUrl: string;
  /** True when src comes from artifactPath (not an inline data URL). */
  hasScreenshotArtifact: boolean;
  /**
   * Seed (or surface) is projected but there is not yet a screenshot src to
   * show — Workbench media shows awaiting UX until Evidence Surface screenshot
   * arrives.
   */
  awaitingEvidence: boolean;
  /**
   * How to present awaiting state:
   * - `spinner` — Agent-registered seed (loading while Agent continues)
   * - `guide` — UI-registered seed (tell designer to ask Agents for screenshot)
   */
  awaitingUx: "spinner" | "guide";
  meta: SeedReferenceProjectionMeta;
  /** Placeholder size until screenshot onLoad resizes to natural pixels. */
  w: number;
  h: number;
};

/** Default 380×520 placeholder.
 *  Do NOT size from Figma design-unit bounds (e.g. 1280×3408) — those are not
 *  screenshot pixels. Figma MCP screenshots are often capped (default
 *  maxDimension=1024); sizing the shape to design aspect upscales a small PNG
 *  and looks soft. When a screenshot loads, the shape util resizes to the
 *  image's natural pixel size (+ frame chrome). */
function projectionSize(_surface: FigmaEvidenceSurfaceRecord | null): {
  w: number;
  h: number;
} {
  return {
    w: SEED_REFERENCE_PROJECTION_DEFAULT_W,
    h: SEED_REFERENCE_PROJECTION_DEFAULT_H
  };
}

function buildProjectionTargets(
  seeds: SeedReferenceRecord[],
  surfaces: FigmaEvidenceSurfaceRecord[],
  session: string
): ProjectionTarget[] {
  const targets: ProjectionTarget[] = [];
  const claimedSurfaceIds = new Set<string>();

  for (const seed of seeds) {
    const { surface, claimIds } = findSurfaceForSeed(
      seed,
      surfaces,
      claimedSurfaceIds
    );
    for (const id of claimIds) claimedSurfaceIds.add(id);

    const size = projectionSize(surface);
    const awaitingUx: "spinner" | "guide" =
      seed.registered_via === "ui" ? "guide" : "spinner";
    if (surface) {
      const shot = screenshotSrcForSurface(surface, session);
      // Shape stays keyed by seed id so in-session drag survives surface arrival.
      // runtimeRecordId becomes surface.id; seed id kept in seedRecordId + data-*.
      targets.push({
        shapeKey: seed.id,
        canvasRecordId: `seed-reference:${seed.id}`,
        figmaSeedReference: seed.figma_seed_reference,
        originalDesignIntent: seed.original_design_intent,
        frameName: surface.frame_name,
        screenshotDataUrl: shot.src,
        hasScreenshotArtifact: shot.hasArtifactOnly,
        awaitingEvidence: !shot.src,
        awaitingUx,
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
        awaitingEvidence: true,
        awaitingUx,
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
    const shot = screenshotSrcForSurface(surface, session);
    targets.push({
      shapeKey: `surface:${surface.id}`,
      canvasRecordId: `figma-evidence-surface:${surface.id}`,
      figmaSeedReference: surface.figma_seed_reference,
      originalDesignIntent: "",
      frameName: surface.frame_name,
      screenshotDataUrl: shot.src,
      hasScreenshotArtifact: shot.hasArtifactOnly,
      awaitingEvidence: !shot.src,
      // Orphan surfaces have no seed registration path — treat as agent spinner.
      awaitingUx: "spinner",
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
    a.hasScreenshotArtifact === b.hasScreenshotArtifact &&
    a.awaitingEvidence === b.awaitingEvidence &&
    a.awaitingUx === b.awaitingUx
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
  surfaces,
  session
}: {
  records: SeedReferenceRecord[];
  surfaces: FigmaEvidenceSurfaceRecord[];
  session: string;
}) {
  const editor = useEditor();

  useEffect(() => {
    if (!editor) return;

    const targets = buildProjectionTargets(records, surfaces, session);
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
        // Reset natural media size when screenshot src changes or clears so
        // resize stays free until the next img onLoad; preserve when unchanged.
        const screenshotChanged =
          existing.props.screenshotDataUrl !== target.screenshotDataUrl;
        const clearNatural =
          screenshotChanged || target.screenshotDataUrl.trim().length === 0;
        const nextProps = {
          figmaSeedReference: target.figmaSeedReference,
          originalDesignIntent: target.originalDesignIntent,
          frameName: target.frameName,
          screenshotDataUrl: target.screenshotDataUrl,
          hasScreenshotArtifact: target.hasScreenshotArtifact,
          awaitingEvidence: target.awaitingEvidence,
          awaitingUx: target.awaitingUx,
          ...(clearNatural ? { naturalMediaW: 0, naturalMediaH: 0 } : {})
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
            ...(propsChanged ? { props: nextProps } : {}),
            ...(metaChanged ? { meta: target.meta } : {})
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
          hasScreenshotArtifact: target.hasScreenshotArtifact,
          awaitingEvidence: target.awaitingEvidence,
          awaitingUx: target.awaitingUx,
          naturalMediaW: 0,
          naturalMediaH: 0
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
  }, [editor, records, surfaces, session]);

  return null;
}
