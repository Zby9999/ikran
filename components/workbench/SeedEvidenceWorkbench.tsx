"use client";

import "./seed-evidence-workbench.css";
// Keep tldraw CSS outside the `next/dynamic` async boundary. Importing it from
// shape modules pulled in by workbench-canvas made Turbopack emit a separate
// CSS chunk; failing to load that chunk aborted the whole canvas (ChunkLoadError).
import "tldraw/tldraw.css";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkbenchRuntime } from "@/components/runtime/use-workbench-runtime";
import { FolderChrome } from "./folder-chrome";
import { FigmaVerificationPanelController } from "./figma-verification-panel";
import { useFigmaPasteCapture } from "./use-figma-paste-capture";

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
  const {
    seeds: records,
    surfaces,
    annotations,
    layout,
    designLanguageDescription,
    status: runtimeStatus,
    error,
    createAnnotation,
    deleteAnnotation,
    deleteSeedReference,
    putWorkbenchLayout,
    flushWorkbenchLayout,
    updateSeedReferenceNote,
    updateDesignLanguageDescription,
    getFigmaConnection,
    connectFigma,
    captureSeedReference
  } = useWorkbenchRuntime(session);
  const [annotateMode, setAnnotateMode] = useState(false);
  const [followAgentMode, setFollowAgentMode] = useState(false);
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
  /** After Enter Canvas: Sign Seed Design → Next Phase → Extraction (Figma 329:429). */
  const [canvasStage, setCanvasStage] = useState<"sign-seed" | "extraction">(
    "sign-seed"
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

  // F → Annotate, V → select (Design-tool conventions). Skip while gated or typing.
  useEffect(() => {
    if (canvasLocked) return;

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
  }, [canvasLocked]);

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
        setCanvasStage("sign-seed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getFigmaConnection]);

  const seedCount = records.length + inFlightCaptures.length;
  const folderPhase = canvasLocked ? null : canvasStage;

  return (
    <main
      className="seed-workbench"
      data-testid="seed-workbench"
      data-canvas-engine="tldraw"
      data-figma-gate={canvasLocked ? "closed" : "open"}
      data-canvas-stage={canvasLocked ? undefined : canvasStage}
    >
      <div className="seed-workbench__folder-stack">
        <FolderChrome
          folderName={folderName}
          onBack={onBack}
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
            setCanvasStage("extraction");
          }}
          onFollowAgent={() => setFollowAgentMode((v) => !v)}
          followAgentActive={followAgentMode}
          annotateActive={annotateMode}
          onAnnotate={() => setAnnotateMode((v) => !v)}
          extraction={
            canvasStage === "extraction"
              ? {
                  stageRemaining: 3,
                  stageTotal: 5,
                  overallRemaining: 27,
                  overallTotal: 32
                }
              : null
          }
        />
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

      {error ? (
        <p
          className="seed-workbench__toast-error"
          role="alert"
          aria-live="polite"
          data-testid="workbench-runtime-error"
        >
          {error}
        </p>
      ) : null}

      {pasteError ? (
        <p
          className="seed-workbench__toast-error"
          role="alert"
          aria-live="polite"
          data-testid="workbench-paste-error"
        >
          {/* No Figma error-state node yet (05A) — plain alert copy only. */}
          {pasteError}
        </p>
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
            annotations={annotations}
            session={session}
            inFlightCaptures={inFlightCaptures}
            savedFrames={layout.frames}
            savedCamera={layout.camera}
            designLanguageDescription={designLanguageDescription}
            onPutWorkbenchLayout={putWorkbenchLayout}
            onFlushWorkbenchLayout={flushWorkbenchLayout}
            onUpdateSeedReferenceNote={updateSeedReferenceNote}
            onUpdateDesignLanguageDescription={updateDesignLanguageDescription}
            focusSeedId={focusSeedId}
            onFocusSeedApplied={clearFocusSeedId}
            annotateMode={annotateMode && !canvasLocked}
            onCreateAnnotation={createAnnotation}
            onDeleteAnnotation={deleteAnnotation}
            onDeleteSeedReference={deleteSeedReference}
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
                setGateStatus("open");
                setCanvasEntered(true);
                setCanvasStage("sign-seed");
              }}
            />
          </div>
        </>
      ) : null}
    </main>
  );
}
