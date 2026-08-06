"use client";

import "./seed-evidence-workbench.css";
// Keep tldraw CSS outside the `next/dynamic` async boundary. Importing it from
// shape modules pulled in by workbench-canvas made Turbopack emit a separate
// CSS chunk; failing to load that chunk aborted the whole canvas (ChunkLoadError).
import "tldraw/tldraw.css";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkbenchRuntime } from "@/components/runtime/use-workbench-runtime";
import { FolderChrome } from "./folder-chrome";
import { FigmaVerificationPanelController } from "./figma-verification-panel";
import { useFigmaPasteCapture } from "./use-figma-paste-capture";
import {
  announceWorkbenchSemanticActivity,
  useWorkbenchPresence
} from "./use-workbench-presence";
import { staleAnnotationWarning } from "./annotation-stale-warning";
import { WorkbenchToastAlert } from "./workbench-toast-alert";
import { RuntimeShutdownControl } from "./runtime-shutdown-control";
import {
  ALIGNMENT_STAGES,
  DEFAULT_ALIGNMENT_STAGE,
  AlignmentStagePanel,
  getAlignmentQuestionSegments,
  type AlignmentCoverage,
  type AlignmentStageId
} from "./alignment-stage-panel";
import {
  DesignSystemBrowser,
  DesignSystemEntryButton,
  designSystemSheetExitMs
} from "./design-system-browser";
import { canOpenDesignSystemBrowser } from "./design-system-view-model";
import { buildFolderPageItems } from "./folder-page-list";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion";

// tldraw touches the DOM during render, so the canvas shell is loaded with
// `next/dynamic({ ssr: false })` to keep Next.js SSR happy.
const WorkbenchCanvas = dynamic(
  () => import("./workbench-canvas").then((m) => m.WorkbenchCanvas),
  { ssr: false }
);

// Issue 02/05A — Figma Connection Gate + Runtime paste capture.
//
// Gate closed: show designer Connection Panel, lock canvas, reject paste.
// Gate open: paste Figma selection links → optimistic loading frame → Runtime
// atomic capture → Ikran Figma frame (never a tldraw Figma iframe embed).

export function SeedEvidenceWorkbench({
  session,
  folderName,
  onBack
}: {
  session: string;
  folderName: string;
  onBack: () => void;
}) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const designSystemExitMs = designSystemSheetExitMs(prefersReducedMotion);
  useWorkbenchPresence(session);
  const {
    seeds: records,
    surfaces,
    prototypeSurfaces,
    annotations,
    layout,
    designLanguageDescription,
    projectPhase,
    alignment,
    status: runtimeStatus,
    error,
    createAnnotation,
    updateAnnotationBody,
    deleteAnnotation,
    restoreAnnotation,
    deleteSeedReference,
    refreshSeedReference,
    putWorkbenchLayout,
    flushWorkbenchLayout,
    updateSeedReferenceNote,
    updateDesignLanguageDescription,
    prepareDesignIntentAlignment,
    returnToSeedReference,
    recordDesignerAnswer,
    appendAgentAnnotationInformation,
    completeDesignIntentAlignment,
    getFigmaConnection,
    connectFigma,
    captureSeedReference
  } = useWorkbenchRuntime(session);
  const [annotateMode, setAnnotateMode] = useState(false);
  const [followAgentMode, setFollowAgentMode] = useState(false);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [pageFocusRequestId, setPageFocusRequestId] = useState<string | null>(
    null
  );
  const [phaseError, setPhaseError] = useState<string | null>(null);
  const [phaseErrorExiting, setPhaseErrorExiting] = useState(false);
  const phaseErrorDismissRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const phaseErrorFadeRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPhaseErrorTimers = useCallback(() => {
    if (phaseErrorDismissRef.current) {
      clearTimeout(phaseErrorDismissRef.current);
      phaseErrorDismissRef.current = null;
    }
    if (phaseErrorFadeRef.current) {
      clearTimeout(phaseErrorFadeRef.current);
      phaseErrorFadeRef.current = null;
    }
  }, []);

  const showPhaseError = useCallback(
    (message: string) => {
      clearPhaseErrorTimers();
      setPhaseErrorExiting(false);
      setPhaseError(message);
      phaseErrorDismissRef.current = setTimeout(() => {
        setPhaseErrorExiting(true);
        phaseErrorFadeRef.current = setTimeout(() => {
          setPhaseError(null);
          setPhaseErrorExiting(false);
        }, 300);
      }, 1000);
    },
    [clearPhaseErrorTimers]
  );

  useEffect(() => () => clearPhaseErrorTimers(), [clearPhaseErrorTimers]);
  const [gateStatus, setGateStatus] = useState<
    "loading" | "closed" | "open"
  >("loading");
  const [canvasEntered, setCanvasEntered] = useState(false);
  /** Runtime-owned: Seed Reference registration → Alignment preparation. */
  const workflowStage =
    alignment?.preparation.workflow.stage ?? "seed-reference-registration";
  const canvasStage: "sign-seed" | "extraction" =
    workflowStage === "seed-reference-registration"
      ? "sign-seed"
      : "extraction";
  const nextAgentCommandStatus =
    alignment?.preparation.commands.find(
      (command) => command.command_type === "prepare_initial_design_system"
    )?.status ?? "none";
  const [alignmentStage, setAlignmentStage] =
    useState<AlignmentStageId>(DEFAULT_ALIGNMENT_STAGE);
  // Issue 09A — Design System Browser bottom sheet. The entry button and the
  // sheet exist only after the six-part alignment completes (09A d.9).
  const [designSystemBrowserOpen, setDesignSystemBrowserOpen] =
    useState(false);
  // The sheet stays mounted for its exit transition after close; the canvas
  // keyboard stays owned for the same window (Esc must not leak to tldraw).
  const [designSystemSheetClosing, setDesignSystemSheetClosing] =
    useState(false);
  const designSystemExitTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const designSystemEntryVisible = canOpenDesignSystemBrowser(alignment);
  const designSystemKeyboardOwned =
    designSystemBrowserOpen || designSystemSheetClosing;
  const closeDesignSystemBrowser = useCallback(() => {
    setDesignSystemBrowserOpen(false);
    setDesignSystemSheetClosing(true);
    if (designSystemExitTimerRef.current) {
      clearTimeout(designSystemExitTimerRef.current);
    }
    designSystemExitTimerRef.current = setTimeout(() => {
      designSystemExitTimerRef.current = null;
      setDesignSystemSheetClosing(false);
    }, designSystemExitMs);
  }, [designSystemExitMs]);
  useEffect(
    () => () => {
      if (designSystemExitTimerRef.current) {
        clearTimeout(designSystemExitTimerRef.current);
      }
    },
    []
  );

  const alignmentCoverage = useMemo(() => {
    const byStage = new Map(
      (alignment?.coverage.sections ?? []).map((section) => [
        section.section,
        section.complete
      ])
    );
    return Object.fromEntries(
      ALIGNMENT_STAGES.map(({ id }) => [id, byStage.get(id) === true])
    ) as AlignmentCoverage;
  }, [alignment]);
  const alignmentQuestionSegments = useMemo(
    () =>
      alignment
        ? getAlignmentQuestionSegments(alignment.question_cards)
        : [],
    [alignment]
  );

  const showGate = gateStatus !== "open" || !canvasEntered;
  const canvasLocked = showGate;

  useEffect(() => {
    if (designLanguageDescription.trim()) {
      clearPhaseErrorTimers();
      setPhaseErrorExiting(false);
      setPhaseError(null);
    }
  }, [clearPhaseErrorTimers, designLanguageDescription]);

  // F → Annotate, V → select (Design-tool conventions). Skip while gated,
  // typing, or while the Design System Browser sheet owns the keyboard
  // (including its exit window — the sheet is still mounted then).
  useEffect(() => {
    if (canvasLocked || designSystemKeyboardOwned) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.repeat) return;

      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }

      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (key === "f") {
        // Must stopPropagation: tldraw binds F → Frame on body, and
        // preventDefault alone does not block that listener.
        event.preventDefault();
        event.stopPropagation();
        setAnnotateMode(true);
        return;
      }
      if (key === "v") {
        event.preventDefault();
        event.stopPropagation();
        setAnnotateMode(false);
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [canvasLocked, designSystemKeyboardOwned]);

  const { pasteError, inFlightCaptures, focusSeedId, clearFocusSeedId } =
    useFigmaPasteCapture({
      canvasLocked,
      gateOpen: gateStatus === "open",
      seeds: records,
      captureSeedReference
    });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const status = await getFigmaConnection();
      if (cancelled) return;
      if (status.ok && status.connected) {
        setGateStatus("open");
        setCanvasEntered(true);
      } else {
        setGateStatus("closed");
        setCanvasEntered(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getFigmaConnection]);

  const seedCount = records.length + inFlightCaptures.length;
  // Issue 30 — once the draft design system is confirmed, the panel follows the
  // Runtime project phase instead of the alignment workflow stage: prototype
  // validation waits for the designer, and every later phase is Build.
  const folderPhase = canvasLocked
    ? null
    : projectPhase === "prototype_validation"
      ? "prototype"
      : projectPhase === "design_system_formal" ||
          projectPhase === "ready_for_new_design"
        ? "build"
        : canvasStage;
  const pages = useMemo(
    () => buildFolderPageItems({ seeds: records, surfaces, prototypeSurfaces }),
    [records, surfaces, prototypeSurfaces]
  );
  // The first page reads as current until the designer picks another; only an
  // explicit pick asks the canvas to move (a standing selection must not yank
  // the camera every time a Runtime record changes).
  const currentPageId = selectedPageId ?? pages[0]?.id ?? null;
  const focusTargetId = focusSeedId ?? pageFocusRequestId;
  const staleWarning = staleAnnotationWarning(annotations);
  const toast = error
    ? { message: error, testId: "workbench-runtime-error" }
    : pasteError
      ? { message: pasteError, testId: "workbench-paste-error" }
      : staleWarning
        ? {
            message: staleWarning,
            testId: "workbench-stale-annotation-warning"
          }
        : { message: null, testId: "workbench-toast" };

  return (
    <main
      className="seed-workbench"
      data-testid="seed-workbench"
      data-canvas-engine="tldraw"
      data-figma-gate={canvasLocked ? "closed" : "open"}
      data-canvas-stage={canvasLocked ? undefined : canvasStage}
      data-alignment-workflow-stage={workflowStage}
      data-project-phase={projectPhase}
      data-agent-command-status={nextAgentCommandStatus}
    >
      <div className="seed-workbench__folder-stack">
        <FolderChrome
          folderName={folderName}
          backLabel={
            canvasStage === "extraction"
              ? "Back to Seed Reference"
              : "Back to setup"
          }
          onBack={
            canvasStage === "extraction"
              ? () => {
                  announceWorkbenchSemanticActivity();
                  void returnToSeedReference().then((result) => {
                    if (!result.ok) showPhaseError(result.error);
                  });
                }
              : onBack
          }
          phase={folderPhase}
          seedCount={seedCount}
          onNextPhase={() => {
            if (!designLanguageDescription.trim()) {
              showPhaseError("Add Description first.");
              return;
            }
            clearPhaseErrorTimers();
            setPhaseErrorExiting(false);
            setPhaseError(null);
            announceWorkbenchSemanticActivity();
            void prepareDesignIntentAlignment().then((result) => {
              if (!result.ok) showPhaseError(result.error);
            });
          }}
          onFollowAgent={() => setFollowAgentMode((v) => !v)}
          followAgentActive={followAgentMode}
          selectActive={!annotateMode}
          onSelect={() => setAnnotateMode(false)}
          annotateActive={annotateMode}
          onAnnotate={() => setAnnotateMode((v) => !v)}
          extraction={
            folderPhase === "extraction"
              ? { segments: alignmentQuestionSegments }
              : null
          }
          pages={pages}
          selectedPageId={currentPageId}
          onSelectPage={(pageId) => {
            setSelectedPageId(pageId);
            setPageFocusRequestId(pageId);
          }}
          onOpenDesignSystem={() => setDesignSystemBrowserOpen(true)}
        />
        {(folderPhase === "extraction" || folderPhase === "prototype") &&
        designSystemEntryVisible ? (
          <DesignSystemEntryButton
            onOpen={() => setDesignSystemBrowserOpen(true)}
          />
        ) : null}
        {phaseError ? (
          <p
            className={
              phaseErrorExiting
                ? "seed-workbench__phase-error seed-workbench__phase-error--exiting"
                : "seed-workbench__phase-error"
            }
            role="alert"
            aria-live="polite"
            data-testid="workbench-phase-error"
          >
            {phaseError}
          </p>
        ) : null}
      </div>

      <WorkbenchToastAlert message={toast.message} testId={toast.testId} />
      <RuntimeShutdownControl session={session} />

      {canvasStage === "extraction" && alignment ? (
        <div className="seed-workbench__alignment-stages">
          <AlignmentStagePanel
            completed={alignment.alignment.status === "completed"}
            completionEnabled={alignment.coverage.can_complete}
            coverage={alignmentCoverage}
            currentStage={alignmentStage}
            onComplete={() => {
              announceWorkbenchSemanticActivity();
              void completeDesignIntentAlignment().then((result) => {
                if (!result.ok) showPhaseError(result.error);
              });
            }}
            onStageChange={setAlignmentStage}
          />
        </div>
      ) : null}

      {designSystemEntryVisible ? (
        <DesignSystemBrowser
          session={session}
          open={designSystemBrowserOpen}
          readOnly={nextAgentCommandStatus !== "completed"}
          onClose={closeDesignSystemBrowser}
        />
      ) : null}

      <div
        className={
          canvasLocked
            ? "seed-workbench__canvas seed-workbench__canvas--locked"
            : "seed-workbench__canvas"
        }
        data-testid="workbench-canvas"
        aria-hidden={canvasLocked ? true : undefined}
      >
        {runtimeStatus === "ready" ? (
          <WorkbenchCanvas
            records={records}
            surfaces={surfaces}
            prototypeSurfaces={prototypeSurfaces}
            annotations={annotations}
            alignment={canvasStage === "extraction" ? alignment : null}
            alignmentStage={alignmentStage}
            session={session}
            inFlightCaptures={inFlightCaptures}
            savedFrames={layout.frames}
            savedCamera={layout.camera}
            designLanguageDescription={designLanguageDescription}
            onPutWorkbenchLayout={putWorkbenchLayout}
            onFlushWorkbenchLayout={flushWorkbenchLayout}
            onUpdateSeedReferenceNote={updateSeedReferenceNote}
            onRefreshSeedReference={refreshSeedReference}
            onUpdateDesignLanguageDescription={updateDesignLanguageDescription}
            focusSeedId={focusTargetId}
            onFocusSeedApplied={() => {
              clearFocusSeedId();
              setPageFocusRequestId(null);
            }}
            annotateMode={annotateMode && !canvasLocked}
            onCreateAnnotation={createAnnotation}
            onUpdateAnnotationBody={(annotationId, body) =>
              updateAnnotationBody({ annotationId, body })
            }
            onDeleteAnnotation={deleteAnnotation}
            onRestoreAnnotation={restoreAnnotation}
            onDeleteSeedReference={deleteSeedReference}
            onRecordDesignerAnswer={recordDesignerAnswer}
            onAppendAgentAnnotationInformation={appendAgentAnnotationInformation}
          />
        ) : null}
      </div>

      {showGate && gateStatus !== "loading" ? (
        <>
          <div className="seed-workbench__gate-dim" aria-hidden="true" />
          <div className="seed-workbench__gate-panel">
            <FigmaVerificationPanelController
              connect={connectFigma}
              onVerifiedEnter={() => {
                announceWorkbenchSemanticActivity();
                setGateStatus("open");
                setCanvasEntered(true);
              }}
            />
          </div>
        </>
      ) : null}
    </main>
  );
}
