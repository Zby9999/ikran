"use client";

// tldraw Workbench canvas shell (Issue 02/04 + 05 + 06).
//
// Thin assembly only (Task 12):
//   - `<Tldraw hideUi>` + stable shapeUtils / tools / components / overlays
//   - Mount projection sync controllers + annotate tool / delete controllers
// Projection math lives under `./projection/`; annotate create handler is
// injected per editor instance (no module-global registry).
//
// This file is imported via `next/dynamic({ ssr: false })` from
// SeedEvidenceWorkbench because `<Tldraw>` touches the DOM during render.

import { useMemo, useRef } from "react";
import { Tldraw, type TLStateNodeConstructor } from "tldraw";
import { SeedReferenceProjectionShapeUtil } from "./seed-reference-projection-shape";
import { RegionAnnotationShapeUtil } from "./region-annotation-shape";
import {
  createRegionAnnotationToolClass,
  RegionAnnotationToolController,
  type RegionAnnotationCreatePayload
} from "./region-annotation-tool";
import { RegionAnnotationDeleteController } from "./region-annotation-delete";
import { SeedSelectionForegroundOverlayUtil } from "./seed-selection-foreground-overlay";
import { WORKBENCH_CANVAS_COMPONENTS } from "./workbench-canvas-grid";
import { SeedProjectionSync } from "./projection/seed-projection-sync";
import { RegionAnnotationProjectionSync } from "./projection/region-annotation-projection-sync";
import { artifactScreenshotUrl } from "./projection/seed-projection";
import type { SeedReferenceRecord } from "@/lib/runtime/seed-reference";
import type { FigmaEvidenceSurfaceRecord } from "@/lib/runtime/evidence-package";
import type { RegionAnnotationRecord } from "@/lib/runtime/region-annotation";
import type { NormalizedRect } from "./region-annotation-geometry";

export { artifactScreenshotUrl };

/** Stable across renders — do not rebuild inline in WorkbenchCanvas. */
const SHAPE_UTILS = [
  SeedReferenceProjectionShapeUtil,
  RegionAnnotationShapeUtil
];

const OVERLAY_UTILS = [SeedSelectionForegroundOverlayUtil];

export function WorkbenchCanvas({
  records,
  surfaces = [],
  annotations = [],
  session,
  annotateMode = false,
  onCreateAnnotation,
  onDeleteAnnotation
}: {
  records: SeedReferenceRecord[];
  surfaces?: FigmaEvidenceSurfaceRecord[];
  /** Runtime Region Annotation records — one-way projected to marker shapes. */
  annotations?: RegionAnnotationRecord[];
  /** Startup session token — required to load artifactPath screenshots via /api/artifacts. */
  session: string;
  /** FolderChrome Annotate toggle — switches the custom region-annotation tool. */
  annotateMode?: boolean;
  /** Designer POST create via Runtime client (no direct fetch in the tool). */
  onCreateAnnotation?: (payload: {
    surfaceArtifactId: string;
    rect: NormalizedRect;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Designer DELETE via Runtime client — only remove after HTTP success. */
  onDeleteAnnotation?: (
    annotationId: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const createHandlerRef = useRef<
    ((payload: RegionAnnotationCreatePayload) => void) | null
  >(null);

  const RegionAnnotationTool = useMemo(
    () =>
      createRegionAnnotationToolClass(
        () => createHandlerRef.current
      ) as TLStateNodeConstructor,
    []
  );

  const tools = useMemo(
    () => [RegionAnnotationTool],
    [RegionAnnotationTool]
  );

  return (
    <Tldraw
      hideUi
      shapeUtils={SHAPE_UTILS}
      tools={tools}
      components={WORKBENCH_CANVAS_COMPONENTS}
      overlayUtils={OVERLAY_UTILS}
    >
      <SeedProjectionSync
        records={records}
        surfaces={surfaces}
        session={session}
      />
      <RegionAnnotationProjectionSync annotations={annotations} />
      <RegionAnnotationToolController
        annotateMode={annotateMode}
        onCreate={onCreateAnnotation}
        createHandlerRef={createHandlerRef}
      />
      <RegionAnnotationDeleteController
        annotateMode={annotateMode}
        onDelete={onDeleteAnnotation}
      />
    </Tldraw>
  );
}
