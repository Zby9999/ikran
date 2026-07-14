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

import { useEffect, useMemo, useRef } from "react";
import { Tldraw, type TLStateNodeConstructor, type TLUiOverrides } from "tldraw";
import { SeedReferenceProjectionShapeUtil } from "./seed-reference-projection-shape";
import { RegionAnnotationShapeUtil } from "./region-annotation-shape";
import {
  createRegionAnnotationToolClass,
  RegionAnnotationToolController,
  type RegionAnnotationCreatePayload
} from "./region-annotation-tool";
import { RegionAnnotationDeleteController } from "./region-annotation-delete";
import { SeedReferenceDeleteController } from "./seed-reference-delete";
import { SeedSelectionForegroundOverlayUtil } from "./seed-selection-foreground-overlay";
import { WORKBENCH_CANVAS_COMPONENTS } from "./workbench-canvas-grid";
import { SeedProjectionSync } from "./projection/seed-projection-sync";
import { RegionAnnotationProjectionSync } from "./projection/region-annotation-projection-sync";
import { WorkbenchLayoutPersistence } from "./projection/workbench-layout-persistence";
import { WorkbenchSeedActionsProvider } from "./workbench-seed-actions";
import {
  artifactScreenshotUrl,
  type InFlightSeedCapture,
  type SeedProjectionSavedFrame
} from "./projection/seed-projection";
import { WORKBENCH_EMBED_DEFINITIONS } from "./workbench-embeds";
import { FigmaEmbedPasteGuard } from "./figma-embed-paste-guard";
import { FocusSeedProjectionController } from "./focus-seed-projection-controller";
import type { SeedReferenceRecord } from "@/lib/runtime/seed-reference";
import type { FigmaEvidenceSurfaceRecord } from "@/lib/runtime/evidence-package";
import type { RegionAnnotationRecord } from "@/lib/runtime/region-annotation";
import type {
  WorkbenchCameraLayout,
  WorkbenchLayoutDocument
} from "@/lib/runtime/workbench-layout-shared";
import type { NormalizedRect } from "./region-annotation-geometry";

export { artifactScreenshotUrl };

/** Stable across renders — do not rebuild inline in WorkbenchCanvas. */
const SHAPE_UTILS = [
  SeedReferenceProjectionShapeUtil,
  RegionAnnotationShapeUtil
];

const OVERLAY_UTILS = [SeedSelectionForegroundOverlayUtil];

/** Unbind tldraw Frame's F shortcut — Workbench uses F for Annotate. */
const WORKBENCH_UI_OVERRIDES: TLUiOverrides = {
  tools(_editor, tools) {
    if (tools.frame) {
      tools.frame = { ...tools.frame, kbd: undefined };
    }
    return tools;
  }
};

export function WorkbenchCanvas({
  records,
  surfaces = [],
  annotations = [],
  session,
  inFlightCaptures = [],
  savedFrames = {},
  savedCamera = null,
  designLanguageDescription = "",
  onPutWorkbenchLayout,
  onFlushWorkbenchLayout,
  onUpdateSeedReferenceNote,
  onRefreshSeedReference,
  onUpdateDesignLanguageDescription,
  focusSeedId = null,
  onFocusSeedApplied,
  annotateMode = false,
  onCreateAnnotation,
  onDeleteAnnotation,
  onDeleteSeedReference
}: {
  records: SeedReferenceRecord[];
  surfaces?: FigmaEvidenceSurfaceRecord[];
  /** Runtime Region Annotation records — one-way projected to marker shapes. */
  annotations?: RegionAnnotationRecord[];
  /** Startup session token — required to load artifactPath screenshots via /api/artifacts. */
  session: string;
  /** In-flight paste captures — spinner frames until Runtime responds. */
  inFlightCaptures?: InFlightSeedCapture[];
  /** UX layout frames from `.ikran/workbench-layout.json` (seed id → geometry). */
  savedFrames?: Record<string, SeedProjectionSavedFrame>;
  /** UX camera from workbench-layout — applied once on mount. */
  savedCamera?: WorkbenchCameraLayout | null;
  /** Project-level Design Language Description (Info panel; shared across Frames). */
  designLanguageDescription?: string;
  onPutWorkbenchLayout?: (
    layout: WorkbenchLayoutDocument
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  onFlushWorkbenchLayout?: (
    layout: WorkbenchLayoutDocument
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  onUpdateSeedReferenceNote?: (
    seedId: string,
    referenceNote: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  onRefreshSeedReference?: (
    seedId: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  onUpdateDesignLanguageDescription?: (
    designLanguageDescription: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Duplicate paste: focus existing Frame for this Seed Reference id. */
  focusSeedId?: string | null;
  onFocusSeedApplied?: () => void;
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
  /** Designer DELETE seed frame via Runtime — only remove after HTTP success. */
  onDeleteSeedReference?: (
    seedId: string
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

  const seedActions = useMemo(
    () => ({
      refreshSeedReference:
        onRefreshSeedReference ??
        (async () =>
          ({
            ok: false as const,
            error: "refresh_seed_unavailable"
          }) as const),
      updateSeedReferenceNote:
        onUpdateSeedReferenceNote ??
        (async () =>
          ({
            ok: false as const,
            error: "update_seed_note_unavailable"
          }) as const),
      updateDesignLanguageDescription:
        onUpdateDesignLanguageDescription ??
        (async () =>
          ({
            ok: false as const,
            error: "update_description_unavailable"
          }) as const)
    }),
    [
      onRefreshSeedReference,
      onUpdateDesignLanguageDescription,
      onUpdateSeedReferenceNote
    ]
  );

  return (
    <WorkbenchSeedActionsProvider value={seedActions}>
    <Tldraw
      hideUi
      embeds={WORKBENCH_EMBED_DEFINITIONS}
      shapeUtils={SHAPE_UTILS}
      tools={tools}
      components={WORKBENCH_CANVAS_COMPONENTS}
      overlayUtils={OVERLAY_UTILS}
      overrides={WORKBENCH_UI_OVERRIDES}
      // Persisted region annotations are isLocked (not user-draggable). Still
      // allow left-click selection so Delete can target designer markers.
      options={{ selectLockedShapes: true }}
    >
      <FigmaEmbedPasteGuard />
      <SeedProjectionSync
        records={records}
        surfaces={surfaces}
        session={session}
        inFlightCaptures={inFlightCaptures}
        savedFrames={savedFrames}
        designLanguageDescription={designLanguageDescription}
      />
      {onPutWorkbenchLayout && onFlushWorkbenchLayout ? (
        <WorkbenchLayoutPersistence
          session={session}
          savedCamera={savedCamera}
          onPutLayout={onPutWorkbenchLayout}
          onFlushLayout={onFlushWorkbenchLayout}
        />
      ) : null}
      <FocusSeedProjectionController
        seedId={focusSeedId}
        projectionEpoch={records.length + surfaces.length}
        onFocused={onFocusSeedApplied}
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
      <SeedReferenceDeleteController onDelete={onDeleteSeedReference} />
    </Tldraw>
    </WorkbenchSeedActionsProvider>
  );
}
