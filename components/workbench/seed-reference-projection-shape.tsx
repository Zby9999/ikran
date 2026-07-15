"use client";

// tldraw custom shape: a single seed-reference / Evidence Surface PROJECTION as
// a Figma Frame surface (Figma 230:297). Visual only — never a source of truth.
//
// Issue 02/04 + 05 boundary: a tldraw shape is ONLY a projection of Runtime
// records (`seed_references` and/or `figma_evidence_surfaces`). It carries
// Runtime ids in `meta` (and as data-* attributes) so tests / UI can tie the
// canvas shape back to the semantic record, but geometry (x/y/w/h) is local-only
// and never written back. On refresh the shape is rebuilt from records; create
// packing uses a reserved footprint, then screenshot onLoad reflows unlocked
// frames so large natural sizes do not stay stacked from the placeholder stride.
//
// Meta id convention (Issue 05):
//   - Seed-only: kind = "seed_reference_projection", runtimeRecordId = seed.id
//   - With Evidence Surface: kind = "figma_evidence_surface",
//     runtimeRecordId = surface.id (stable for surface-linked tests),
//     seedRecordId = seed.id when linked, surfaceRecordId = surface.id
//
// Visual (230:297): purple-bordered frame with header title + info tip
// (227:130 Description). Media shows a screenshot when the surface supplies
// `screenshotDataUrl` (inline data URL or authenticated /api/artifacts URL).
// Until then, seed-only projections show awaiting UX in the media area:
// Agent-registered seeds keep a loading spinner; UI-registered seeds show
// guidance to ask Agents for a Figma screenshot (no spinner).
// The stored URL is exposed as a read-only "Open in Figma" action; Workbench
// still has no seed URL / intent write entry.
//
// Default size: 380×520 — readable tall placeholder on the workbench canvas
// (not the full Figma page aspect 695:1851, which would be ~380×1013).
// Resize is aspect-ratio locked. With a screenshot, import display fits the
// longer edge to ≤1080 (full-res bitmap unchanged); corner resize can grow up
// to natural pixels + chrome (≤4096). Shrink is free. Without a screenshot,
// resize is unconstrained. Blue selection bounds stay
// hidden; corner resize hit targets stay active (visual corner squares
// suppressed via SeedSelectionForegroundOverlayUtil — do NOT use
// hideResizeHandles, which also removes hit geometry). Unselected strokes are
// #B980B9; selected deepens both to #731b73 (`.seed-ref-frame--selected`).
// Unselected chrome background is #EEE1EE; selected keeps the purple wash.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type SyntheticEvent
} from "react";
import { NoteIcon, RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  TLShape,
  TLCreateShapePartial,
  TLResizeInfo,
  resizeBox,
  useEditor,
  useValue
} from "tldraw";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SeedReferenceDescriptionPanel } from "./seed-reference-description-panel";
import { SeedReferenceNotesPanel } from "./seed-reference-notes-panel";
import { SeedRefFrameActionHint } from "./seed-ref-frame-action-hint";
import { SeedRefFrameFigmaIcon } from "./seed-ref-frame-figma-icon";
import {
  SEED_REF_FRAME_CHROME_H,
  SEED_REF_FRAME_CHROME_W,
  clampSeedReferenceResizeToNaturalSize,
  defaultDisplaySizeFromNaturalPixels,
  fitSeedReferenceFrameToScreenshot,
  maxDisplaySizeFromNaturalPixels,
  sizeFromNaturalPixels
} from "./seed-reference-resize-clamp";
import { applySeedProjectionReflow } from "./projection/seed-projection-reflow";
import { useWorkbenchSeedActions } from "./workbench-seed-actions";
import { annotationChromeForMediaWidth } from "./annotation-chrome";
import {
  buildStructuralOverlayFrames,
  fitStructuralImageBox,
  findStructuralOverlayFrameAtPoint,
  parentStructuralOverlayFrame,
  structuralHoverDisplayRect
} from "./structural-overlay";
import { setStructuralSelection } from "./structural-selection-session";
import { FocusTargetMask } from "./focus-target-mask";
import { useWorkbenchFocusMode } from "./focus-mode-context";

export {
  SEED_REF_FRAME_CHROME_H,
  SEED_REF_FRAME_CHROME_W,
  defaultDisplaySizeFromNaturalPixels,
  maxDisplaySizeFromNaturalPixels,
  sizeFromNaturalPixels
};

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    "seed-reference-projection": {
      w: number;
      h: number;
      figmaSeedReference: string;
      /** Per-seed Reference Note (historical column name). */
      originalDesignIntent: string;
      /** Project-level Design Language Description (Info tip). */
      designLanguageDescription: string;
      /** Source frame / node name when known; empty → title falls back to "Figma seed". */
      frameName: string;
      /** Captured absolute bounds of the screenshot root Frame. */
      frameBoundsJson: string;
      /** Captured positional node index for ephemeral structural overlays. */
      positionalNodesJson: string;
      /** Screenshot <img src>: data URL or /api/artifacts?... URL. */
      screenshotDataUrl: string;
      /**
       * True when src is served from screenshot_artifact_path via /api/artifacts
       * (vs an inline data URL). Used for diagnostics; media still renders <img>.
       */
      hasScreenshotArtifact: boolean;
      /**
       * True when a seed/surface is projected but there is not yet a screenshot
       * src — media shows awaiting UX until Evidence Surface arrives.
       */
      awaitingEvidence: boolean;
      /**
       * Awaiting presentation: `spinner` for an in-flight Runtime capture,
       * `guide` for an incomplete historical row.
       */
      awaitingUx: "spinner" | "guide";
      /**
       * Screenshot intrinsic pixel size (0 when unknown / no screenshot).
       * Used to clamp corner resize so the frame cannot grow past natural
       * media size + chrome while object-fit: scale-down is in effect.
       */
      naturalMediaW: number;
      naturalMediaH: number;
      /**
       * When true, the designer has moved/resized this frame — post-load
       * collision reflow must leave its page position alone.
       */
      layoutLocked: boolean;
    };
  }
}

export type SeedReferenceProjectionMeta = {
  canvasRecordId: string;
  /**
   * Primary Runtime id for this projection.
   * Seed-only → seed id; with Evidence Surface → surface id.
   */
  runtimeRecordId: string;
  /** Discriminator: seed-only vs upgraded / surface-only Evidence Surface. */
  kind: "seed_reference_projection" | "figma_evidence_surface";
  /** Seed id when linked (kept when runtimeRecordId is the surface id). */
  seedRecordId?: string;
  /** Surface id when an Evidence Surface is projected. */
  surfaceRecordId?: string;
};

export interface SeedReferenceProjectionShape extends TLShape<"seed-reference-projection"> {
  meta: SeedReferenceProjectionMeta;
}

export const SEED_REFERENCE_PROJECTION_TYPE = "seed-reference-projection" as const;

/** Readable default for a tall frame placeholder on the workbench canvas. */
export const SEED_REFERENCE_PROJECTION_DEFAULT_W = 380;
export const SEED_REFERENCE_PROJECTION_DEFAULT_H = 520;

const FALLBACK_TITLE = "Figma seed";

const seedRefFrameHeaderButtonClass = cn(
  "size-5 min-h-0 min-w-0 shrink-0 rounded-[4px] border-0 bg-transparent p-0 shadow-none",
  "focus-visible:border-0 focus-visible:ring-0 focus-visible:ring-offset-0",
  "disabled:opacity-40"
);

function SeedReferenceProjectionFrame({
  shape
}: {
  shape: SeedReferenceProjectionShape;
}) {
  const {
    w,
    h,
    figmaSeedReference,
    originalDesignIntent,
    designLanguageDescription,
    frameName,
    frameBoundsJson,
    positionalNodesJson,
    screenshotDataUrl,
    hasScreenshotArtifact,
    awaitingEvidence,
    awaitingUx
  } = shape.props;
  const { canvasRecordId, runtimeRecordId, kind, seedRecordId, surfaceRecordId } =
    shape.meta;
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hoveredStructuralNodeId, setHoveredStructuralNodeId] = useState<
    string | null
  >(null);
  const [imageBox, setImageBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const mediaRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const lastStructuralPointerRef = useRef<{ x: number; y: number } | null>(null);
  const structuralDrilledRef = useRef(false);
  const seedActions = useWorkbenchSeedActions();
  const focusMode = useWorkbenchFocusMode();
  const editor = useEditor();
  const isSelected = useValue(
    "seed-ref-selected",
    () => editor.getSelectedShapeIds().includes(shape.id),
    [editor, shape.id]
  );
  const currentToolId = useValue(
    "seed-ref-current-tool",
    () => editor.getCurrentToolId(),
    [editor]
  );
  const title = frameName.trim() || FALLBACK_TITLE;
  const description = designLanguageDescription;
  const referenceNote = originalDesignIntent;
  const noteSeedId =
    typeof seedRecordId === "string" && seedRecordId.length > 0
      ? seedRecordId
      : kind === "seed_reference_projection"
        ? runtimeRecordId
        : null;
  const screenshotSrc = screenshotDataUrl.trim();
  const hasScreenshot = screenshotSrc.length > 0;
  const structuralFrames = useMemo(
    () =>
      buildStructuralOverlayFrames({
        frameBoundsJson,
        positionalNodesJson
      }),
    [frameBoundsJson, positionalNodesJson]
  );
  const structuralEnabled =
    hasScreenshot &&
    structuralFrames.length > 0 &&
    currentToolId === "region-annotation";
  const hoveredStructuralFrame = structuralFrames.find(
    (frame) => frame.nodeId === hoveredStructuralNodeId
  );
  const mediaSize = {
    w: mediaRef.current?.clientWidth ?? imageBox?.width ?? 0,
    h: mediaRef.current?.clientHeight ?? imageBox?.height ?? 0
  };
  const hoveredStructuralDisplayRect =
    hoveredStructuralFrame && imageBox
      ? structuralHoverDisplayRect({
          rect: hoveredStructuralFrame.rect,
          imageBox: {
            x: imageBox.left,
            y: imageBox.top,
            w: imageBox.width,
            h: imageBox.height
          },
          mediaSize
        })
      : null;
  const showAwaiting = awaitingEvidence && !hasScreenshot;
  const showGuide = showAwaiting && awaitingUx === "guide";
  const showSpinner = showAwaiting && awaitingUx !== "guide";

  const measureImageBox = useCallback(() => {
    const media = mediaRef.current;
    const img = imageRef.current;
    if (!media || !img || !img.naturalWidth || !img.naturalHeight) {
      setImageBox(null);
      return;
    }
    const width = media.clientWidth;
    const height = media.clientHeight;
    const fitted = fitStructuralImageBox(
      { x: 0, y: 0, w: width, h: height },
      { width: img.naturalWidth, height: img.naturalHeight }
    );
    if (!fitted) {
      setImageBox(null);
      return;
    }
    const next = {
      left: fitted.x,
      top: fitted.y,
      width: fitted.w,
      height: fitted.h
    };
    setImageBox((current) =>
      current &&
      Math.abs(current.left - next.left) < 0.1 &&
      Math.abs(current.top - next.top) < 0.1 &&
      Math.abs(current.width - next.width) < 0.1 &&
      Math.abs(current.height - next.height) < 0.1
        ? current
        : next
    );
  }, []);

  useEffect(() => {
    setHoveredStructuralNodeId(null);
  }, [structuralFrames, surfaceRecordId]);

  useEffect(() => {
    if (!hasScreenshot) {
      setImageBox(null);
      return;
    }
    const media = mediaRef.current;
    if (!media) return;
    measureImageBox();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measureImageBox);
    observer.observe(media);
    return () => observer.disconnect();
  }, [hasScreenshot, measureImageBox, screenshotSrc]);

  useEffect(() => {
    if (structuralEnabled) return;
    setHoveredStructuralNodeId(null);
    setStructuralSelection(editor, String(shape.id), null);
  }, [editor, shape.id, structuralEnabled]);

  useEffect(
    () => () => setStructuralSelection(editor, String(shape.id), null),
    [editor, shape.id]
  );

  const structuralPoint = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const media = mediaRef.current;
      if (!media || !imageBox || imageBox.width <= 0 || imageBox.height <= 0) {
        return null;
      }
      const bounds = media.getBoundingClientRect();
      const scaleX = media.clientWidth > 0 ? bounds.width / media.clientWidth : 1;
      const scaleY = media.clientHeight > 0 ? bounds.height / media.clientHeight : 1;
      const localX = (event.clientX - bounds.left) / scaleX - imageBox.left;
      const localY = (event.clientY - bounds.top) / scaleY - imageBox.top;
      if (
        localX < 0 ||
        localY < 0 ||
        localX > imageBox.width ||
        localY > imageBox.height
      ) {
        return null;
      }
      return { x: localX / imageBox.width, y: localY / imageBox.height };
    },
    [imageBox]
  );

  const structuralFrameFromEvent = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const point = structuralPoint(event);
      return point
        ? findStructuralOverlayFrameAtPoint(structuralFrames, point)
        : null;
    },
    [structuralFrames, structuralPoint]
  );

  const handleStructuralPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!structuralEnabled) return;
    const last = lastStructuralPointerRef.current;
    const samePoint =
      last != null &&
      Math.abs(last.x - event.clientX) < 0.5 &&
      Math.abs(last.y - event.clientY) < 0.5;
    if (structuralDrilledRef.current && samePoint) return;
    lastStructuralPointerRef.current = { x: event.clientX, y: event.clientY };
    structuralDrilledRef.current = false;
    const frame = structuralFrameFromEvent(event);
    const nodeId = frame?.nodeId ?? null;
    setHoveredStructuralNodeId(nodeId);
    setStructuralSelection(editor, String(shape.id), nodeId);
  };

  useEffect(() => {
    if (!structuralEnabled || !hoveredStructuralNodeId) return;
    const handleTabParent = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.shiftKey) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const parent = parentStructuralOverlayFrame(
        structuralFrames,
        hoveredStructuralNodeId
      );
      if (!parent) return;
      structuralDrilledRef.current = true;
      setHoveredStructuralNodeId(parent.nodeId);
      setStructuralSelection(editor, String(shape.id), parent.nodeId);
    };
    window.addEventListener("keydown", handleTabParent, true);
    return () => window.removeEventListener("keydown", handleTabParent, true);
  }, [
    editor,
    hoveredStructuralNodeId,
    shape.id,
    structuralEnabled,
    structuralFrames
  ]);

  const stopShapePointer = (event: SyntheticEvent) => {
    event.stopPropagation();
  };

  const figmaUrl = figmaSeedReference.trim();

  const openFigmaLink = (event: SyntheticEvent) => {
    stopShapePointer(event);
    if (!figmaUrl) return;
    window.open(figmaUrl, "_blank", "noopener,noreferrer");
  };

  const toggleNotes = (event: SyntheticEvent) => {
    stopShapePointer(event);
    if (!noteSeedId) return;
    setDescriptionOpen(false);
    setNotesOpen((open) => !open);
  };

  const toggleDescription = (event: SyntheticEvent) => {
    stopShapePointer(event);
    setNotesOpen(false);
    setDescriptionOpen((open) => !open);
  };

  const refreshEvidence = async (event: SyntheticEvent) => {
    stopShapePointer(event);
    if (!noteSeedId || !seedActions || refreshing) return;
    setRefreshing(true);
    try {
      await seedActions.refreshSeedReference(noteSeedId);
    } finally {
      setRefreshing(false);
    }
  };

  const handleScreenshotLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    requestAnimationFrame(measureImageBox);
    // Ignore tiny fixtures / broken loads — keep the default placeholder size.
    if (!nw || !nh || Math.max(nw, nh) < 32) return;
    const naturalUnchanged =
      shape.props.naturalMediaW === nw && shape.props.naturalMediaH === nh;

    const next = fitSeedReferenceFrameToScreenshot({
      frameW: shape.props.w,
      frameH: shape.props.h,
      nextNaturalW: nw,
      nextNaturalH: nh,
      layoutLocked: shape.props.layoutLocked
    });
    const sizeUnchanged =
      Math.abs(shape.props.w - next.w) < 1 &&
      Math.abs(shape.props.h - next.h) < 1;
    if (sizeUnchanged && naturalUnchanged) return;
    // Local geometry + natural size for resize clamp. Display defaults to
    // ≤1080 long edge; full-res bitmap stays in <img>. May later persist to
    // `.ikran/workbench-layout.json` (UX only).
    editor.updateShape<SeedReferenceProjectionShape>({
      id: shape.id,
      type: SEED_REFERENCE_PROJECTION_TYPE,
      props: {
        w: next.w,
        h: next.h,
        naturalMediaW: nw,
        naturalMediaH: nh
      }
    });
    // Batch create on refresh packs with a placeholder reserve; after natural
    // size is known, unlock overlap by reflowing auto-laid-out siblings.
    applySeedProjectionReflow(editor);
  };

  return (
    <HTMLContainer
      data-testid="seed-reference-projection"
      data-canvas-record-id={canvasRecordId}
      data-runtime-record-id={runtimeRecordId}
      data-kind={kind}
      data-seed-record-id={seedRecordId ?? undefined}
      data-surface-record-id={surfaceRecordId ?? undefined}
      data-selected={isSelected ? "true" : "false"}
      className={
        isSelected ? "seed-ref-frame seed-ref-frame--selected" : "seed-ref-frame"
      }
      style={{ width: w, height: h, pointerEvents: "all" }}
    >
      <div className="seed-ref-frame__header">
        <p
          className="seed-ref-frame__title"
          data-testid="seed-reference-projection-title"
        >
          {title}
        </p>
        <div className="seed-ref-frame__header-actions">
          <div className="seed-ref-frame__action-wrap">
            <div className="seed-ref-frame__action-hint-anchor" aria-hidden="true">
              <SeedRefFrameActionHint
                label="Refresh"
                testId="seed-reference-projection-refresh-hint"
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              className={cn(
                seedRefFrameHeaderButtonClass,
                "seed-ref-frame__refresh",
                refreshing && "seed-ref-frame__refresh--active"
              )}
              data-testid="seed-reference-projection-refresh"
              aria-label="Refresh"
              aria-busy={refreshing}
              disabled={!noteSeedId || !seedActions || refreshing}
              onPointerDown={stopShapePointer}
              onMouseDown={stopShapePointer}
              onClick={refreshEvidence}
            >
              {refreshing ? (
                <span
                  className="seed-ref-frame__refresh-spinner"
                  aria-hidden="true"
                />
              ) : (
                <HugeiconsIcon
                  className="seed-ref-frame__refresh-icon"
                  icon={RefreshIcon}
                  size={14}
                  color="currentColor"
                  strokeWidth={1.5}
                />
              )}
            </Button>
          </div>
          <div className="seed-ref-frame__action-wrap">
            <div className="seed-ref-frame__action-hint-anchor" aria-hidden="true">
              <SeedRefFrameActionHint
                label="Figma Address"
                testId="seed-reference-projection-figma-hint"
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              className={cn(seedRefFrameHeaderButtonClass, "seed-ref-frame__figma-link")}
              data-testid="seed-reference-projection-figma-link"
              aria-label="Open in Figma"
              disabled={!figmaUrl}
              onPointerDown={stopShapePointer}
              onMouseDown={stopShapePointer}
              onClick={openFigmaLink}
            >
              <SeedRefFrameFigmaIcon />
            </Button>
          </div>
          <div className="seed-ref-frame__action-wrap">
            <div className="seed-ref-frame__action-hint-anchor" aria-hidden="true">
              <SeedRefFrameActionHint
                label="Notes"
                testId="seed-reference-projection-notes-hint"
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              className={cn(
                seedRefFrameHeaderButtonClass,
                "seed-ref-frame__notes",
                notesOpen && "seed-ref-frame__notes--open"
              )}
              data-testid="seed-reference-projection-notes"
              aria-label="Notes"
              aria-expanded={notesOpen}
              disabled={!noteSeedId}
              onPointerDown={stopShapePointer}
              onMouseDown={stopShapePointer}
              onClick={toggleNotes}
            >
              <HugeiconsIcon
                className="seed-ref-frame__notes-icon"
                icon={NoteIcon}
                size={14}
                color="currentColor"
                strokeWidth={1.5}
              />
            </Button>
          </div>
          <div className="seed-ref-frame__action-wrap">
            <div className="seed-ref-frame__action-hint-anchor" aria-hidden="true">
              <SeedRefFrameActionHint
                label="Description"
                testId="seed-reference-projection-info-hint"
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              className={cn(
                seedRefFrameHeaderButtonClass,
                "seed-ref-frame__info",
                descriptionOpen && "seed-ref-frame__info--open"
              )}
              data-testid="seed-reference-projection-info"
              aria-label="Design language description"
              aria-expanded={descriptionOpen}
              onPointerDown={stopShapePointer}
              onMouseDown={stopShapePointer}
              onClick={toggleDescription}
            >
              <svg
                className="seed-ref-frame__info-icon"
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                aria-hidden="true"
              >
                <circle
                  cx="7"
                  cy="7"
                  r="5.5625"
                  stroke="#731b73"
                  strokeWidth="0.875"
                />
                <path
                  d="M7 6.25V9.5"
                  stroke="#731b73"
                  strokeWidth="0.875"
                  strokeLinecap="round"
                />
                <circle cx="7" cy="4.5" r="0.7" fill="#731b73" />
              </svg>
            </Button>
          </div>
          {descriptionOpen ? (
            <SeedReferenceDescriptionPanel
              description={description}
              onClose={() => setDescriptionOpen(false)}
            />
          ) : null}
          {notesOpen && noteSeedId ? (
            <SeedReferenceNotesPanel
              seedId={noteSeedId}
              note={referenceNote}
              onClose={() => setNotesOpen(false)}
            />
          ) : null}
        </div>
      </div>
      <div
        ref={mediaRef}
        className="seed-ref-frame__media"
        data-testid="seed-reference-projection-media"
        data-has-screenshot={hasScreenshot ? "true" : "false"}
        data-screenshot-from-artifact={
          hasScreenshot && hasScreenshotArtifact ? "true" : "false"
        }
        data-awaiting-evidence={showAwaiting ? "true" : "false"}
        data-awaiting-ux={showAwaiting ? awaitingUx : undefined}
        aria-hidden={hasScreenshot || showAwaiting ? undefined : "true"}
        data-structural-overlay={structuralFrames.length > 0 ? "true" : "false"}
        data-hovered-structural-node-id={hoveredStructuralNodeId ?? undefined}
        onPointerMove={handleStructuralPointerMove}
        onPointerLeave={() => {
          lastStructuralPointerRef.current = null;
          structuralDrilledRef.current = false;
          setHoveredStructuralNodeId(null);
          setStructuralSelection(editor, String(shape.id), null);
        }}
      >
        {hasScreenshot ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- Runtime data URL or same-origin /api/artifacts */}
            <img
              ref={imageRef}
              className="seed-ref-frame__media-img"
              data-testid="seed-reference-projection-screenshot"
              src={screenshotSrc}
              alt=""
              draggable={false}
              onLoad={handleScreenshotLoad}
            />
            {focusMode.state.phase !== "idle" && surfaceRecordId && imageBox ? (
              <FocusTargetMask
                phase={focusMode.state.phase}
                surfaceArtifactId={surfaceRecordId}
                evidenceVersionId={surfaceRecordId}
                targets={focusMode.state.targets}
                onFadeOutComplete={focusMode.finishExit}
                style={{
                  inset: "auto",
                  left: imageBox.left,
                  top: imageBox.top,
                  width: imageBox.width,
                  height: imageBox.height
                }}
              />
            ) : null}
          </>
        ) : showGuide ? (
          <div
            className="seed-ref-frame__awaiting seed-ref-frame__awaiting--guide"
            data-testid="seed-reference-projection-awaiting"
            data-awaiting-evidence="true"
            data-awaiting-ux="guide"
            role="status"
            aria-label="No captured Figma evidence is available"
          >
            <p
              className="seed-ref-frame__awaiting-hint"
              data-testid="seed-reference-projection-awaiting-hint"
            >
              No captured Figma evidence is available for this historical seed
            </p>
          </div>
        ) : showSpinner ? (
          <div
            className="seed-ref-frame__awaiting seed-ref-frame__awaiting--spinner"
            data-testid="seed-reference-projection-awaiting"
            data-awaiting-evidence="true"
            data-awaiting-ux="spinner"
            role="status"
            aria-label="Capturing Figma evidence"
          >
            <span className="seed-ref-frame__awaiting-spinner" aria-hidden="true" />
            <p
              className="seed-ref-frame__awaiting-hint"
              data-testid="seed-reference-projection-awaiting-hint"
            >
              Capturing Figma evidence
            </p>
          </div>
        ) : null}
        {structuralEnabled && imageBox ? (
          <div
            className="seed-ref-frame__structural-overlay"
            data-testid="seed-reference-structural-overlay"
            aria-hidden="true"
            style={imageBox}
          >
            {hoveredStructuralFrame && hoveredStructuralDisplayRect ? (
              <div
                className="seed-ref-frame__structural-highlight seed-ref-frame__structural-highlight--hovered"
                data-testid="seed-reference-structural-highlight-hovered"
                data-node-id={hoveredStructuralFrame.nodeId}
                style={{
                  left: `${hoveredStructuralDisplayRect.x * 100}%`,
                  top: `${hoveredStructuralDisplayRect.y * 100}%`,
                  width: `${hoveredStructuralDisplayRect.w * 100}%`,
                  height: `${hoveredStructuralDisplayRect.h * 100}%`,
                  borderRadius: annotationChromeForMediaWidth(mediaSize.w).radius
                }}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </HTMLContainer>
  );
}

export class SeedReferenceProjectionShapeUtil extends BaseBoxShapeUtil<SeedReferenceProjectionShape> {
  static override type = SEED_REFERENCE_PROJECTION_TYPE;

  static override props = {
    w: T.number,
    h: T.number,
    figmaSeedReference: T.string,
    originalDesignIntent: T.string,
    designLanguageDescription: T.string,
    frameName: T.string,
    frameBoundsJson: T.string,
    positionalNodesJson: T.string,
    screenshotDataUrl: T.string,
    hasScreenshotArtifact: T.boolean,
    awaitingEvidence: T.boolean,
    awaitingUx: T.literalEnum("spinner", "guide"),
    naturalMediaW: T.number,
    naturalMediaH: T.number,
    layoutLocked: T.boolean
  };

  getDefaultProps(): SeedReferenceProjectionShape["props"] {
    return {
      w: SEED_REFERENCE_PROJECTION_DEFAULT_W,
      h: SEED_REFERENCE_PROJECTION_DEFAULT_H,
      figmaSeedReference: "",
      originalDesignIntent: "",
      designLanguageDescription: "",
      frameName: "",
      frameBoundsJson: "",
      positionalNodesJson: "",
      screenshotDataUrl: "",
      hasScreenshotArtifact: false,
      awaitingEvidence: false,
      awaitingUx: "spinner",
      naturalMediaW: 0,
      naturalMediaH: 0,
      layoutLocked: false
    };
  }

  override isAspectRatioLocked(_shape: SeedReferenceProjectionShape) {
    return true;
  }

  // Keep resize handles enabled so corner hit targets work. Visual corner
  // squares are suppressed by SeedSelectionForegroundOverlayUtil.
  override hideResizeHandles(_shape: SeedReferenceProjectionShape) {
    return false;
  }

  override hideRotateHandle(_shape: SeedReferenceProjectionShape) {
    return true;
  }

  override hideSelectionBoundsBg(_shape: SeedReferenceProjectionShape) {
    return true;
  }

  override hideSelectionBoundsFg(_shape: SeedReferenceProjectionShape) {
    return true;
  }

  /**
   * Corner resize: allow shrink below default display size; clamp grow at
   * natural pixels + frame chrome (≤4096 long edge). No screenshot / unknown
   * natural → free resize.
   */
  override onResize(
    shape: SeedReferenceProjectionShape,
    info: TLResizeInfo<SeedReferenceProjectionShape>
  ) {
    const resized = resizeBox(shape, info);
    const { naturalMediaW, naturalMediaH, screenshotDataUrl } =
      info.initialShape.props;
    const hasScreenshot = screenshotDataUrl.trim().length > 0;
    if (!hasScreenshot || naturalMediaW <= 0 || naturalMediaH <= 0) {
      return resized;
    }

    const max = maxDisplaySizeFromNaturalPixels(naturalMediaW, naturalMediaH);
    const clamped = clampSeedReferenceResizeToNaturalSize({
      x: resized.x,
      y: resized.y,
      rotation: resized.rotation,
      handle: info.handle,
      w: resized.props.w,
      h: resized.props.h,
      maxW: max.w,
      maxH: max.h
    });

    return {
      ...resized,
      x: clamped.x,
      y: clamped.y,
      props: {
        ...resized.props,
        w: clamped.w,
        h: clamped.h
      }
    };
  }

  /** Designer drag — freeze auto reflow for this frame. */
  override onTranslateEnd(
    _initial: SeedReferenceProjectionShape,
    current: SeedReferenceProjectionShape
  ) {
    if (current.props.layoutLocked) return;
    return {
      id: current.id,
      type: SEED_REFERENCE_PROJECTION_TYPE,
      props: { layoutLocked: true }
    };
  }

  /** Designer corner resize — freeze auto reflow for this frame. */
  override onResizeEnd(
    _initial: SeedReferenceProjectionShape,
    current: SeedReferenceProjectionShape
  ) {
    if (current.props.layoutLocked) return;
    return {
      id: current.id,
      type: SEED_REFERENCE_PROJECTION_TYPE,
      props: { layoutLocked: true }
    };
  }

  override component(shape: SeedReferenceProjectionShape) {
    return <SeedReferenceProjectionFrame shape={shape} />;
  }

  // No selection indicator path — hides the blue selection stroke.
  override getIndicatorPath(_shape: SeedReferenceProjectionShape) {
    return undefined;
  }
}

export type { TLCreateShapePartial };
