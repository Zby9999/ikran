"use client";

import "./seed-evidence-workbench.css";
// Keep tldraw CSS outside the `next/dynamic` async boundary. Importing it from
// shape modules pulled in by workbench-canvas made Turbopack emit a separate
// CSS chunk; failing to load that chunk aborted the whole canvas (ChunkLoadError).
import "tldraw/tldraw.css";
import dynamic from "next/dynamic";
import { useState } from "react";
import { useWorkbenchRuntime } from "@/components/runtime/use-workbench-runtime";
import { FolderChrome } from "./folder-chrome";

// tldraw touches the DOM during render, so the canvas shell is loaded with
// `next/dynamic({ ssr: false })` to keep Next.js SSR happy.
const WorkbenchCanvas = dynamic(
  () => import("./workbench-canvas").then((m) => m.WorkbenchCanvas),
  { ssr: false }
);

// Issue 02/04 + 02/04A — tldraw Workbench shell (Agent-first seed).
//
// Seed write path is Agent/MCP only (register_seed_reference → Runtime record).
// Workbench is a read/projection surface: FolderChrome + tldraw canvas.
// Empty records → empty canvas (no seed URL/intent write UI).
// Agent-written seeds appear via SSE record invalidation → authoritative GET.

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
    deleteAnnotation
  } = useWorkbenchRuntime(session);
  const [annotateMode, setAnnotateMode] = useState(false);

  // Extraction chrome when at least one seed exists; empty project keeps the
  // single-row folder chip (no new empty-state copy).
  const showExtraction = records.length > 0;

  return (
    <main
      className="seed-workbench"
      data-testid="seed-workbench"
      data-canvas-engine="tldraw"
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

      <div className="seed-workbench__canvas" data-testid="workbench-canvas">
        <WorkbenchCanvas
          records={records}
          surfaces={surfaces}
          annotations={annotations}
          session={session}
          annotateMode={annotateMode}
          onCreateAnnotation={createAnnotation}
          onDeleteAnnotation={deleteAnnotation}
        />
      </div>
    </main>
  );
}
