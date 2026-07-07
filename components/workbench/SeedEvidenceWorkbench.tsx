"use client";

import "./seed-evidence-workbench.css";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  ReactFlow
} from "@xyflow/react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { SmallIconButton } from "./small-icon-button";
import { EnterPanel, type EnterPanelState } from "./enter-panel";
import { SquircleChrome } from "./squircle-chrome";
import {
  figmaEvidenceNodeTypes,
  type FigmaEvidenceSurfaceNode
} from "./figma-evidence-surface-node";
import { useSeedEvidenceTask } from "./use-seed-evidence-task";

// Issue 04 — seed evidence workbench.
//
// Shown after Start Building. The React Flow canvas is strictly locked until
// the first Figma seed import completes: no pan / zoom / edit, only the
// centered Enter Panel. Once the Runtime/AgentAdapter returns a seed evidence
// package, the Figma Evidence Surface renders and the canvas unlocks.
//
// This component owns layout + lock state + the Enter Panel state machine. The
// task round-trip lives in useSeedEvidenceTask; the surface node lives in
// figma-evidence-surface-node. No annotations / question cards / region
// selections (those are Issue 05).

// Where the Evidence Surface node first appears inside React Flow. Arbitrary
// on-canvas placement; React Flow fitView frames it once it exists.
const SURFACE_POSITION = { x: 420, y: 230 } as const;

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
  const validatingRef = useRef(false);
  const validationRequestRef = useRef(0);

  const task = useSeedEvidenceTask(session);
  const result = task.state.result;
  const locked = result === null;
  const showEnterMask = locked;

  const nodes = useMemo<FigmaEvidenceSurfaceNode[]>(() => {
    if (!result) return [];
    return [
      {
        id: result.evidenceSurface.id,
        type: "figmaEvidenceSurface",
        position: SURFACE_POSITION,
        draggable: false,
        selectable: false,
        data: result.evidenceSurface
      }
    ];
  }, [result]);

  // Failed import → drop back to the editable description state so the user
  // can retry (inputs retained). We deliberately do NOT invent a Figma-less
  // error surface here (per AGENTS.md, a designed error state needs a Figma
  // reference first); the Runtime already records failed/invalid_output.
  useEffect(() => {
    if (task.state.status === "error") {
      setPanelState("description");
    }
  }, [task.state.status]);

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
    const requestId = validationRequestRef.current + 1;
    validationRequestRef.current = requestId;
    setPanelState("validating");

    const ok = await validateFigmaSeedReference(reference, session);
    validatingRef.current = false;
    if (validationRequestRef.current !== requestId) return;

    if (ok) {
      setPanelState("description");
    } else {
      setPanelState("address");
    }
  }

  function handleClearFigmaSeedReference() {
    validatingRef.current = false;
    validationRequestRef.current += 1;
    setFigmaSeedReference("");
    setOriginalDesignIntent("");
    setPanelState("default");
  }

  function handleOriginalDesignIntentChange(value: string) {
    setOriginalDesignIntent(value);
  }

  function resetEnterPanel() {
    validatingRef.current = false;
    validationRequestRef.current += 1;
    task.reset();
    setPanelState("default");
    setFigmaSeedReference("");
    setOriginalDesignIntent("");
  }

  function handleBackdropClick() {
    if (panelState === "default" || panelState === "loading") return;
    resetEnterPanel();
  }

  async function handleSubmit() {
    if (!figmaSeedReference.trim() || !originalDesignIntent.trim()) return;
    setPanelState("loading");
    await task.submit(
      {
        figmaSeedReference: figmaSeedReference.trim(),
        originalDesignIntent: originalDesignIntent.trim()
      },
      { progressTicks: 6, delayMs: 80 }
    );
  }

  const enterPanelInteractive =
    locked && panelState !== "default" && panelState !== "loading";

  return (
    <main
      className="seed-workbench"
      data-testid="seed-workbench"
      data-canvas-locked={locked ? "true" : "false"}
      data-enter-masked={showEnterMask ? "true" : "false"}
      data-pan-enabled={locked ? "false" : "true"}
      data-zoom-enabled={locked ? "false" : "true"}
    >
      <SquircleChrome
        className="seed-workbench__folder"
        surfaceClassName="seed-workbench__folder-body"
      >
        <SmallIconButton icon={ArrowLeft01Icon} label="Back to setup" onClick={onBack} />
        <span className="seed-workbench__folder-name">{folderName || "Folder Name"}</span>
      </SquircleChrome>

      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={figmaEvidenceNodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={!locked}
        edgesFocusable={false}
        elementsSelectable={false}
        selectNodesOnDrag={false}
        selectionOnDrag={false}
        panOnDrag={!locked}
        panOnScroll={false}
        zoomOnScroll={!locked}
        zoomOnPinch={!locked}
        zoomOnDoubleClick={!locked}
        preventScrolling
        fitView={nodes.length > 0}
        minZoom={0.2}
        maxZoom={2}
        className="seed-workbench__flow"
      >
        <Background
          variant={BackgroundVariant.Lines}
          gap={100}
          color="rgba(0, 0, 0, 0.05)"
          bgColor="#DCDCDC"
          lineWidth={1}
        />
      </ReactFlow>

      {locked ? (
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
            progress={task.state.progress}
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

async function validateFigmaSeedReference(
  figmaSeedReference: string,
  session: string
): Promise<boolean> {
  try {
    const response = await fetch("/api/figma/validate", {
      method: "POST",
      headers: {
        "x-ikran-session": session,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ figmaSeedReference })
    });
    const data = (await response.json().catch(() => ({}))) as { ok?: boolean };
    return response.ok && data.ok === true;
  } catch {
    return false;
  }
}
