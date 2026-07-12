"use client";

import "./seed-evidence-workbench.css";
// Keep tldraw CSS outside the `next/dynamic` async boundary. Importing it from
// shape modules pulled in by workbench-canvas made Turbopack emit a separate
// CSS chunk; failing to load that chunk aborted the whole canvas (ChunkLoadError).
import "tldraw/tldraw.css";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
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
    error,
    createAnnotation,
    deleteAnnotation,
    deleteSeedReference,
    getFigmaConnection,
    connectFigma,
    captureSeedReference
  } = useWorkbenchRuntime(session);
  const [annotateMode, setAnnotateMode] = useState(false);
  const [gateStatus, setGateStatus] = useState<
    "loading" | "closed" | "open"
  >("loading");
  const [canvasEntered, setCanvasEntered] = useState(false);

  const showGate = gateStatus !== "open" || !canvasEntered;
  const canvasLocked = showGate;

  const { pasteError, inFlightCaptures, focusSeedId, clearFocusSeedId } =
    useFigmaPasteCapture({
      canvasLocked,
      gateOpen: gateStatus === "open",
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

  // Extraction chrome when at least one seed exists; empty project keeps the
  // single-row folder chip (no new empty-state copy).
  const showExtraction =
    (records.length > 0 || inFlightCaptures.length > 0) && !canvasLocked;

  return (
    <main
      className="seed-workbench"
      data-testid="seed-workbench"
      data-canvas-engine="tldraw"
      data-figma-gate={canvasLocked ? "closed" : "open"}
    >
      <FolderChrome
        folderName={folderName}
        onBack={onBack}
        extraction={
          showExtraction
            ? {
                stageRemaining: 3,
                stageTotal: 5,
                overallRemaining: 27,
                overallTotal: 32,
                onFollowAgent: () => {},
                annotateActive: annotateMode,
                onAnnotate: () => setAnnotateMode((v) => !v)
              }
            : null
        }
      />

      {error ? (
        <p
          role="alert"
          aria-live="polite"
          data-testid="workbench-runtime-error"
        >
          {error}
        </p>
      ) : null}

      {pasteError ? (
        <p
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
        <WorkbenchCanvas
          records={records}
          surfaces={surfaces}
          annotations={annotations}
          session={session}
          inFlightCaptures={inFlightCaptures}
          focusSeedId={focusSeedId}
          onFocusSeedApplied={clearFocusSeedId}
          annotateMode={annotateMode && !canvasLocked}
          onCreateAnnotation={createAnnotation}
          onDeleteAnnotation={deleteAnnotation}
          onDeleteSeedReference={deleteSeedReference}
        />
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
              }}
            />
          </div>
        </>
      ) : null}
    </main>
  );
}
