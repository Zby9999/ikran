"use client";

import "./seed-evidence-workbench.css";
// Keep tldraw CSS outside the `next/dynamic` async boundary. Importing it from
// shape modules pulled in by workbench-canvas made Turbopack emit a separate
// CSS chunk; failing to load that chunk aborted the whole canvas (ChunkLoadError).
import "tldraw/tldraw.css";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { EnterPanel, type EnterPanelState } from "./enter-panel";
import { FolderChrome } from "./folder-chrome";
import { useSeedReferences } from "./use-seed-references";
import { useFigmaEvidenceSurfaces } from "./use-figma-evidence-surfaces";
import { useRegionAnnotations } from "./use-region-annotations";

// tldraw touches the DOM during render, so the canvas shell is loaded with
// `next/dynamic({ ssr: false })` to keep Next.js SSR happy.
const WorkbenchCanvas = dynamic(
  () => import("./workbench-canvas").then((m) => m.WorkbenchCanvas),
  { ssr: false }
);

// Issue 02/04 + 02/04A — tldraw Workbench shell.
//
// Seed entry path:
//
//   EnterPanel -> POST /api/seed-reference -> seed_references record
//               -> tldraw projection
//
// The tldraw canvas is the 底座. The Runtime `seed_references` records are the
// source of truth; tldraw shapes are one-way projections (see
// workbench-canvas.tsx). The EnterPanel is reused (Figma-referenced) as the
// seed entry surface. It is shown as an overlay only while there are no
// records yet; once a record exists (registered here, restored on refresh, or
// written by a real Agent via the `register_seed_reference` MCP tool and picked
// up by the hook's light polling), the overlay is dismissed and the canvas
// shows the projections.

// Local-only Figma URL format hint. This mirrors the Runtime's
// `validateSeedReferenceInput` URL rules (https, figma.com / www.figma.com,
// /design/ or /file/ path). It is a UX affordance for the address -> description
// step ONLY; the Runtime is the authority and re-checks at POST time. It never
// accesses the network.
function looksLikeFigmaSeedReference(raw: string): boolean {
  if (typeof raw !== "string" || raw.trim().length === 0) return false;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.hostname !== "figma.com" && url.hostname !== "www.figma.com") return false;
  const parts = url.pathname.split("/").filter(Boolean);
  return parts.length >= 2 && (parts[0] === "design" || parts[0] === "file");
}

export function SeedEvidenceWorkbench({
  session,
  folderName,
  onBack
}: {
  session: string;
  folderName: string;
  onBack: () => void;
}) {
  const [panelState, setPanelState] = useState<EnterPanelState>("default");
  const [figmaSeedReference, setFigmaSeedReference] = useState("");
  const [originalDesignIntent, setOriginalDesignIntent] = useState("");
  const [progress, setProgress] = useState(0);

  const validatingRef = useRef(false);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { records, register } = useSeedReferences(session);
  const { records: surfaces } = useFigmaEvidenceSurfaces(session);
  const {
    records: annotations,
    reload: reloadAnnotations,
    removeLocal: removeAnnotationLocal
  } = useRegionAnnotations(session);
  const [annotateMode, setAnnotateMode] = useState(false);

  // EnterPanel overlay is the seed entry surface, shown only while there are
  // no Runtime records yet (first seed, or a fresh project). Once a record
  // exists the overlay is dismissed and the tldraw projection takes over.
  const showEnterPanel = records.length === 0;

  useEffect(() => {
    return () => {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    };
  }, []);

  function handleStart() {
    setPanelState("address");
  }

  function handleFigmaSeedReferenceChange(value: string) {
    setFigmaSeedReference(value);
  }

  async function handleConfirmReference() {
    // Guard against a second confirm (blur firing as the address input
    // unmounts after Enter).
    if (panelState !== "address") return;
    if (validatingRef.current) return;
    const reference = figmaSeedReference.trim();
    if (!reference) return;

    validatingRef.current = true;
    setPanelState("validating");

    // Brief async so the Figma-referenced validating spinner animates. The
    // check itself is a local format hint; the Runtime re-validates at POST.
    await new Promise((resolve) => setTimeout(resolve, 120));
    validatingRef.current = false;

    setPanelState(looksLikeFigmaSeedReference(reference) ? "description" : "address");
  }

  function handleClearFigmaSeedReference() {
    validatingRef.current = false;
    setFigmaSeedReference("");
    setOriginalDesignIntent("");
    setPanelState("default");
  }

  function handleOriginalDesignIntentChange(value: string) {
    setOriginalDesignIntent(value);
  }

  function resetEnterPanel() {
    validatingRef.current = false;
    stopProgress();
    setProgress(0);
    setPanelState("default");
    setFigmaSeedReference("");
    setOriginalDesignIntent("");
  }

  function handleBackdropClick() {
    if (panelState === "default" || panelState === "loading") return;
    resetEnterPanel();
  }

  function startProgress() {
    stopProgress();
    setProgress(0);
    let p = 0;
    progressTimerRef.current = setInterval(() => {
      p = Math.min(90, p + 10);
      setProgress(p);
    }, 60);
  }

  function stopProgress() {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }

  // Semantic record-write: POST /api/seed-reference. On success the hook
  // refreshes records from the Runtime source of truth, so `records` becomes
  // non-empty and the EnterPanel overlay is dismissed (see `showEnterPanel`),
  // revealing the tldraw projection built from the committed record. On a
  // Runtime validation failure we drop back to the editable description state so
  // the user can retry (inputs retained) — no record is written by the Runtime on
  // validation failure, so no projection appears.
  async function handleSubmit() {
    if (!figmaSeedReference.trim() || !originalDesignIntent.trim()) return;
    setPanelState("loading");
    startProgress();

    const result = await register({
      figmaSeedReference: figmaSeedReference.trim(),
      originalDesignIntent: originalDesignIntent.trim(),
      registeredVia: "ui"
    });

    if (result.ok) {
      stopProgress();
      setProgress(100);
      // records refreshed by the hook -> showEnterPanel becomes false and the
      // overlay is dismissed; the tldraw projection renders from the record.
      return;
    }

    stopProgress();
    setProgress(0);
    setPanelState("description");
  }

  const enterPanelInteractive =
    showEnterPanel && panelState !== "default" && panelState !== "loading";

  return (
    <main
      className="seed-workbench"
      data-testid="seed-workbench"
      data-canvas-engine="tldraw"
      data-enter-masked={showEnterPanel ? "true" : "false"}
    >
      <FolderChrome
        folderName={folderName}
        onBack={onBack}
        extraction={
          showEnterPanel
            ? null
            : {
                stageRemaining: 3,
                stageTotal: 5,
                overallRemaining: 27,
                overallTotal: 32,
                onFollowAgent: () => {},
                annotateActive: annotateMode,
                onAnnotate: () => setAnnotateMode((v) => !v)
              }
        }
      />

      <div className="seed-workbench__canvas" data-testid="workbench-canvas">
        <WorkbenchCanvas
          records={records}
          surfaces={surfaces}
          annotations={annotations}
          session={session}
          annotateMode={annotateMode}
          onAnnotationCreated={() => {
            void reloadAnnotations();
          }}
          onAnnotationDeleted={(annotationId) => {
            if (annotationId) removeAnnotationLocal(annotationId);
          }}
        />
      </div>

      {showEnterPanel ? (
        <div
          className={
            enterPanelInteractive
              ? "seed-workbench__enter-panel seed-workbench__enter-panel--interactive"
              : "seed-workbench__enter-panel"
          }
          data-testid={enterPanelInteractive ? "enter-panel-backdrop" : undefined}
          onClick={enterPanelInteractive ? handleBackdropClick : undefined}
        >
          <EnterPanel
            state={panelState}
            figmaSeedReference={figmaSeedReference}
            originalDesignIntent={originalDesignIntent}
            progress={progress}
            onStart={handleStart}
            onFigmaSeedReferenceChange={handleFigmaSeedReferenceChange}
            onFigmaSeedReferenceConfirm={() => void handleConfirmReference()}
            onFigmaSeedReferenceClear={handleClearFigmaSeedReference}
            onOriginalDesignIntentChange={handleOriginalDesignIntentChange}
            onSubmit={() => void handleSubmit()}
          />
        </div>
      ) : null}
    </main>
  );
}