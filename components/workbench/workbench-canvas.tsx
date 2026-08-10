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

import { useEffect, useMemo, useRef, type PropsWithChildren } from "react";
import { Tldraw, type TLStateNodeConstructor, type TLUiOverrides } from "tldraw";
import { SeedReferenceProjectionShapeUtil } from "./seed-reference-projection-shape";
import { PrototypeSurfaceProjectionShapeUtil } from "./prototype-surface-shape";
import { RegionAnnotationShapeUtil } from "./region-annotation-shape";
import {
  createRegionAnnotationToolClass,
  RegionAnnotationToolController,
  type RegionAnnotationCreatePayload
} from "./region-annotation-tool";
import {
  DesignerAnnotationEntryProvider,
  type DesignerAnnotationCreateRequest
} from "./designer-annotation-entry-context";
import {
  DesignerAnnotationCardActionsProvider,
  DesignerAnnotationCardShapeUtil
} from "./designer-annotation-card-shape";
import { DesignerAnnotationConnectorShapeUtil } from "./designer-annotation-connector-shape";
import { RegionAnnotationDeleteController } from "./region-annotation-delete";
import { SeedReferenceDeleteController } from "./seed-reference-delete";
import { SeedSelectionForegroundOverlayUtil } from "./seed-selection-foreground-overlay";
import { WORKBENCH_CANVAS_COMPONENTS } from "./workbench-canvas-grid";
import { SeedProjectionSync } from "./projection/seed-projection-sync";
import { PrototypeSurfaceProjectionSync } from "./projection/prototype-surface-projection-sync";
import { RegionAnnotationProjectionSync } from "./projection/region-annotation-projection-sync";
import { DesignerAnnotationCardSync } from "./projection/designer-annotation-card-sync";
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
import type { PrototypeSurfaceRecord } from "@/lib/runtime/prototype-surface";
import type {
  WorkbenchCameraLayout,
  WorkbenchLayoutDocument
} from "@/lib/runtime/workbench-layout-shared";
import type { DesignIntentAlignmentSnapshot } from "@/lib/runtime/design-intent-alignment";
import {
  AlignmentCardInteractionController,
  AlignmentCardProjectionProvider,
  AlignmentCardShapeUtil
} from "./alignment-card-shape";
import { ExclusiveDialogProvider } from "./exclusive-dialog-context";
import { ExclusiveDialogController } from "./exclusive-dialog-controller";
import type { AlignmentAnswerMutationResult } from "./alignment-cards";
import { AlignmentTargetShapeUtil } from "./alignment-target-shape";
import { AlignmentConnectorShapeUtil } from "./alignment-connector-shape";
import { AlignmentProjectionSync } from "./projection/alignment-projection-sync";
import {
  DEFAULT_ALIGNMENT_STAGE,
  type AlignmentStageId
} from "./alignment-stage-panel";
import {
  useWorkbenchFocusMode,
  WorkbenchFocusModeProvider
} from "./focus-mode-context";

export { artifactScreenshotUrl };

/** Stable across renders — do not rebuild inline in WorkbenchCanvas. */
const SHAPE_UTILS = [
  SeedReferenceProjectionShapeUtil,
  PrototypeSurfaceProjectionShapeUtil,
  RegionAnnotationShapeUtil,
  AlignmentCardShapeUtil,
  AlignmentTargetShapeUtil,
  AlignmentConnectorShapeUtil,
  DesignerAnnotationCardShapeUtil,
  DesignerAnnotationConnectorShapeUtil
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
  prototypeSurfaces = [],
  annotations = [],
  alignment = null,
  alignmentStage = DEFAULT_ALIGNMENT_STAGE,
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
  onUpdateAnnotationBody,
  onDeleteAnnotation,
  onRestoreAnnotation,
  onDeleteSeedReference,
  onRecordDesignerAnswer,
  onAppendAgentAnnotationInformation
}: {
  records: SeedReferenceRecord[];
  surfaces?: FigmaEvidenceSurfaceRecord[];
  /** Runtime Prototype Evidence Surfaces — live preview frames (Issue 30). */
  prototypeSurfaces?: PrototypeSurfaceRecord[];
  /** Runtime Region Annotation records — one-way projected to marker shapes. */
  annotations?: RegionAnnotationRecord[];
  alignment?: DesignIntentAlignmentSnapshot | null;
  alignmentStage?: AlignmentStageId;
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
  /** Designer POST create via Runtime client — entry form submits body+section (08A). */
  onCreateAnnotation?: (
    payload: DesignerAnnotationCreateRequest
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Designer PATCH body edit via Runtime client — card click-to-edit (08A). */
  onUpdateAnnotationBody?: (
    annotationId: string,
    body: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Designer DELETE via Runtime client — only remove after HTTP success. */
  onDeleteAnnotation?: (
    annotationId: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Restore the exact Runtime record after a designer Command-Z. */
  onRestoreAnnotation?: (
    annotationId: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Designer DELETE seed frame via Runtime — only remove after HTTP success. */
  onDeleteSeedReference?: (
    seedId: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  onRecordDesignerAnswer?: (
    questionCardId: string,
    finalAnswer: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  onAppendAgentAnnotationInformation?: (
    annotationId: string,
    information: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const createHandlerRef = useRef<
    ((payload: RegionAnnotationCreatePayload) => void) | null
  >(null);
  const cancelEntryHandlerRef = useRef<(() => void) | null>(null);

  const RegionAnnotationTool = useMemo(
    () =>
      createRegionAnnotationToolClass(
        () => createHandlerRef.current,
        () => cancelEntryHandlerRef.current
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
    <WorkbenchFocusModeProvider>
    <DesignerAnnotationEntryProvider
      currentSection={alignmentStage}
      onCreate={onCreateAnnotation}
    >
    <DesignerAnnotationCardActionsProvider onUpdateBody={onUpdateAnnotationBody}>
    <ExclusiveDialogProvider>
    <AlignmentActionsBridge
      onRecordDesignerAnswer={onRecordDesignerAnswer}
      onAppendAgentAnnotationInformation={onAppendAgentAnnotationInformation}
    >
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
      <PrototypeSurfaceProjectionSync
        prototypeSurfaces={prototypeSurfaces}
        session={session}
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
        projectionEpoch={
          records.length + surfaces.length + prototypeSurfaces.length
        }
        onFocused={onFocusSeedApplied}
      />
      <RegionAnnotationProjectionSync
        annotations={annotations}
        currentStage={alignmentStage}
      />
      <DesignerAnnotationCardSync
        annotations={annotations}
        currentStage={alignmentStage}
      />
      {/* Keep the projector mounted when an attempt is abandoned. Its empty
          authoritative input removes the previous attempt's tldraw shapes;
          unmounting it here would leave those shapes in the shared store. */}
      <AlignmentProjectionSync
        currentStage={alignmentStage}
        readOnly={
          alignment?.preparation.workflow.stage !== "alignment-answering"
        }
        questions={alignment?.question_cards ?? []}
        annotations={alignment?.annotations ?? []}
      />
      <AlignmentCardInteractionController />
      <ExclusiveDialogController />
      <RegionAnnotationToolController
        annotateMode={annotateMode}
        createHandlerRef={createHandlerRef}
        cancelEntryHandlerRef={cancelEntryHandlerRef}
      />
      <RegionAnnotationDeleteController
        annotateMode={annotateMode}
        onDelete={onDeleteAnnotation}
        onRestore={onRestoreAnnotation}
      />
      <SeedReferenceDeleteController onDelete={onDeleteSeedReference} />
    </Tldraw>
    </WorkbenchSeedActionsProvider>
    </AlignmentActionsBridge>
    </ExclusiveDialogProvider>
    </DesignerAnnotationCardActionsProvider>
    </DesignerAnnotationEntryProvider>
    </WorkbenchFocusModeProvider>
  );
}

function AlignmentActionsBridge({
  children,
  onRecordDesignerAnswer,
  onAppendAgentAnnotationInformation
}: PropsWithChildren<{
  onRecordDesignerAnswer?: (
    id: string,
    answer: string
  ) => Promise<AlignmentAnswerMutationResult>;
  onAppendAgentAnnotationInformation?: (
    id: string,
    information: string
  ) => Promise<unknown>;
}>) {
  const focusMode = useWorkbenchFocusMode();
  return (
    <AlignmentCardProjectionProvider
      onSubmitAnswer={(id, answer) =>
        onRecordDesignerAnswer?.(id, answer) ??
        Promise.resolve({
          ok: false as const,
          error: "record_designer_answer_unavailable"
        })
      }
      onAppendAnnotationInformation={(id, information) => {
        void onAppendAgentAnnotationInformation?.(id, information);
      }}
      onFocusCardSelection={focusMode.selectFocusCard}
      onFocusCardPreviewEnd={focusMode.requestExit}
    >
      {children}
    </AlignmentCardProjectionProvider>
  );
}
