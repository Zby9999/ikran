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

// tldraw touches the DOM during render, so the canvas shell is loaded with
// `next/dynamic({ ssr: false })` to keep Next.js SSR happy.
const WorkbenchCanvas = dynamic(
  () => import("./workbench-canvas").then((m) => m.WorkbenchCanvas),
  { ssr: false }
);

const FIGMA_URL_RE =
  /https:\/\/(?:www\.)?figma\.com\/(?:design|file)\/[^\s]+/i;

function extractFigmaUrl(text: string): string | null {
  const match = text.match(FIGMA_URL_RE);
  return match ? match[0] : null;
}

// Issue 02/05A — Figma Connection Gate + Runtime paste capture.
//
// Gate closed: show designer Connection Panel, lock canvas, reject paste.
// Gate open: paste Figma selection links → Runtime atomic capture.

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
    getFigmaConnection,
    connectFigma,
    captureSeedReference
  } = useWorkbenchRuntime(session);
  const [annotateMode, setAnnotateMode] = useState(false);
  const [gateStatus, setGateStatus] = useState<
    "loading" | "closed" | "open"
  >("loading");
  const [canvasEntered, setCanvasEntered] = useState(false);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const pasteErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showGate = gateStatus !== "open" || !canvasEntered;
  const canvasLocked = showGate;

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

  useEffect(() => {
    return () => {
      if (pasteErrorTimer.current) clearTimeout(pasteErrorTimer.current);
    };
  }, []);

  const showPasteError = useCallback((message: string) => {
    setPasteError(message);
    if (pasteErrorTimer.current) clearTimeout(pasteErrorTimer.current);
    pasteErrorTimer.current = setTimeout(() => setPasteError(null), 4000);
  }, []);

  const handlePaste = useCallback(
    async (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData("text/plain") ?? "";
      const url = extractFigmaUrl(text);
      if (!url) return;

      event.preventDefault();

      if (canvasLocked || gateStatus !== "open") {
        showPasteError(
          "Connect Figma before pasting a design link into the canvas."
        );
        return;
      }

      const result = await captureSeedReference(url);
      if (!result.ok) {
        const messageByReason: Record<string, string> = {
          figma_connection_required:
            "Connect Figma before pasting a design link into the canvas.",
          missing_node_id:
            "Paste a Figma selection link that includes a node-id.",
          invalid_figma_url: "That does not look like a valid Figma design URL.",
          not_figma_host: "Paste a link from figma.com.",
          not_figma_design_path: "Paste a Figma design or file selection link.",
          forbidden: "Figma denied access to that file with the current token.",
          not_found: "Figma could not find that file or node.",
          rate_limited: "Figma rate-limited the request. Try again shortly.",
          screenshot_missing: "Figma did not return a screenshot for that node.",
          malformed_figma_response: "Figma returned an unexpected response.",
          invalid_token: "The Figma Connection is no longer valid. Reconnect."
        };
        showPasteError(
          messageByReason[result.error] ??
            "Could not capture that Figma link. Check the URL and try again."
        );
      }
    },
    [canvasLocked, gateStatus, captureSeedReference, showPasteError]
  );

  useEffect(() => {
    const onPaste = (event: Event) => {
      void handlePaste(event as ClipboardEvent);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [handlePaste]);

  // Extraction chrome when at least one seed exists; empty project keeps the
  // single-row folder chip (no new empty-state copy).
  const showExtraction = records.length > 0 && !canvasLocked;

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
          className="seed-workbench__paste-error"
          data-testid="workbench-paste-error"
        >
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
          annotateMode={annotateMode && !canvasLocked}
          onCreateAnnotation={createAnnotation}
          onDeleteAnnotation={deleteAnnotation}
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
