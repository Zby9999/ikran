"use client";

// tldraw custom shape: a Prototype Evidence Surface PROJECTION (Figma 729:1640).
//
// Same boundary as the seed frame: the shape is only a projection of a Runtime
// `prototype_surfaces` row. Geometry is local-only; readiness, preview URL and
// stale state all come from Runtime and are never invented here.
//
// Visual (729:1640): grey frame chrome with a "Prototype" label on the left and
// WebProgrammingIcon on the right, then the running site filling the body. The
// body embeds the Runtime-owned preview URL once readiness is `ready`; before
// that (and when the surface is stale) it shows a placeholder describing the
// lifecycle state instead of a blank white rectangle. Once Runtime has captured
// a screenshot of the ready preview, a non-live surface shows that bitmap with
// a hint overlay instead of the text-only placeholder (Issue 30 screenshot
// placeholder).
//
// The live preview lays out at a fixed virtual viewport width
// (PROTOTYPE_SURFACE_LIVE_VIEWPORT_W) and is CSS-scaled down to the body, so a
// desktop page always fits the frame instead of being cropped 1:1 — the same
// zoomed-out read the seed reference frames get from bitmap downscaling.
//
// Interaction (Issue 30 "focus 后 live iframe 可交互"): the live iframe keeps
// pointer events on at all times, so the page is clickable / scrollable without
// selecting the frame first. The iframe swallows pointer and wheel events, so
// canvas selection, drag and zoom over the body no longer reach tldraw — the
// header chrome stays the drag/selection handle. (The `tl-stop-scroll-and-zoom`
// class suggested in Issue 30 does not exist in this tldraw version; an iframe
// already isolates its wheel events from the canvas.)

import { WebProgrammingIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  TLShape,
  useEditor,
  useValue
} from "tldraw";

import { planPrototypeSurfaceLiveShapeId } from "./projection/prototype-surface-live-policy";

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    "prototype-surface-projection": {
      w: number;
      h: number;
      /** Runtime-owned stable preview URL (http://127.0.0.1:<port>). */
      previewUrl: string;
      /** Runtime dev-server lifecycle state. */
      readiness: "installing" | "starting" | "ready" | "failed";
      /** Why a lifecycle state was reached (install_failed, port_conflict, …). */
      readinessReason: string;
      /** Dev server exited or the prototype code changed — never auto-restarted. */
      stale: boolean;
      staleReason: string;
      /** Surface name from Runtime; the header label stays "Prototype". */
      surfaceName: string;
      /** Runtime-captured bitmap shown when this surface is not the live one. */
      screenshotSrc: string;
    };
  }
}

export type PrototypeSurfaceProjectionMeta = {
  canvasRecordId: string;
  /** `prototype_surfaces.id`. */
  runtimeRecordId: string;
  kind: "prototype_surface";
  /** Run grouping marker shared with designer feedback aggregation. */
  runId: string;
  surfaceKey: string;
};

export interface PrototypeSurfaceProjectionShape
  extends TLShape<"prototype-surface-projection"> {
  meta: PrototypeSurfaceProjectionMeta;
}

export const PROTOTYPE_SURFACE_PROJECTION_TYPE =
  "prototype-surface-projection" as const;

/** Desktop-page proportions from Figma 729:1640 (719×848). */
export const PROTOTYPE_SURFACE_PROJECTION_DEFAULT_W = 720;
export const PROTOTYPE_SURFACE_PROJECTION_DEFAULT_H = 848;

/** Virtual viewport width the live preview lays out at before CSS downscaling. */
export const PROTOTYPE_SURFACE_LIVE_VIEWPORT_W = 1440;

/**
 * Live-preview sizing: render the iframe at the virtual viewport width and
 * CSS-scale it into the body so the full page width always fits. Frames wider
 * than the virtual viewport are treated as a deliberate enlarge — scale locks
 * at 1 and the page gets a genuinely wider viewport instead of a blurry
 * upscale. Returns zero sizes until the body has been measured.
 */
export function prototypeSurfaceLiveViewport(
  bodyWidth: number,
  bodyHeight: number
): { scale: number; width: number; height: number } {
  if (bodyWidth <= 0 || bodyHeight <= 0) {
    return { scale: 1, width: 0, height: 0 };
  }
  const scale =
    bodyWidth >= PROTOTYPE_SURFACE_LIVE_VIEWPORT_W
      ? 1
      : bodyWidth / PROTOTYPE_SURFACE_LIVE_VIEWPORT_W;
  return {
    scale,
    width: Math.round(bodyWidth / scale),
    height: Math.round(bodyHeight / scale)
  };
}

const READINESS_LABEL: Record<
  PrototypeSurfaceProjectionShape["props"]["readiness"],
  string
> = {
  installing: "Installing prototype dependencies",
  starting: "Starting the prototype dev server",
  ready: "Prototype is running",
  failed: "Prototype dev server failed"
};

/**
 * Surfaces the designer explicitly exited (deselected after a live session).
 * Module-level and session-only: auto-live is a default, and an explicit exit
 * must stick for the rest of the session without persisting anywhere.
 */
const autoLiveExitedShapeIds = new Set<string>();

function getAutoLiveExitedShapeIds(): Set<string> {
  return autoLiveExitedShapeIds;
}

/** Designer-facing sentence for the Runtime lifecycle / stale state. */
export function prototypeSurfaceStatusText(props: {
  readiness: PrototypeSurfaceProjectionShape["props"]["readiness"];
  readinessReason: string;
  stale: boolean;
  staleReason: string;
}): string {
  if (props.stale) {
    const reason = props.staleReason.trim();
    return reason === "code_changed"
      ? "Prototype code changed — this preview is out of date"
      : "The prototype dev server stopped — this preview is out of date";
  }
  const base = READINESS_LABEL[props.readiness];
  const reason = props.readinessReason.trim();
  return reason ? `${base} (${reason})` : base;
}

function PrototypeSurfaceFrame({
  shape
}: {
  shape: PrototypeSurfaceProjectionShape;
}) {
  const {
    w,
    h,
    previewUrl,
    readiness,
    readinessReason,
    stale,
    staleReason,
    surfaceName,
    screenshotSrc
  } = shape.props;
  const { canvasRecordId, runtimeRecordId, runId, surfaceKey } = shape.meta;
  const editor = useEditor();
  const isSelected = useValue(
    "prototype-surface-selected",
    () => editor.getSelectedShapeIds().includes(shape.id),
    [editor, shape.id]
  );
  // Exit stickiness: deselecting the auto-live sole surface marks it as
  // explicitly exited, so auto-live does not resurrect on the next render.
  // Selecting it again clears the mark. Session-only, never persisted.
  const exitedShapeIdsRef = useRef<Set<string>>(getAutoLiveExitedShapeIds());
  const [exitVersion, setExitVersion] = useState(0);
  const wasSelectedRef = useRef(isSelected);
  useEffect(() => {
    const wasSelected = wasSelectedRef.current;
    wasSelectedRef.current = isSelected;
    if (wasSelected === isSelected) return;
    const exited = exitedShapeIdsRef.current;
    if (isSelected) {
      if (exited.delete(shape.id)) setExitVersion((v) => v + 1);
    } else {
      exited.add(shape.id);
      setExitVersion((v) => v + 1);
    }
  }, [isSelected, shape.id]);
  // Single-live: the policy decides which ready surface (if any) mounts an
  // iframe — selected focus wins; the sole ready surface defaults to live
  // unless the designer explicitly exited it.
  const liveShapeId = useValue(
    "prototype-surface-live",
    () => {
      const surfaces = editor
        .getCurrentPageShapes()
        .filter(
          (candidate) =>
            candidate.type === PROTOTYPE_SURFACE_PROJECTION_TYPE
        )
        .map((candidate) => ({
          shapeId: candidate.id,
          readiness: String(candidate.props.readiness ?? ""),
          stale: Boolean(candidate.props.stale),
          previewUrl: String(candidate.props.previewUrl ?? "")
        }));
      return planPrototypeSurfaceLiveShapeId({
        surfaces,
        selectedShapeIds: [...editor.getSelectedShapeIds()],
        autoLiveExitedShapeIds: exitedShapeIdsRef.current
      });
    },
    [editor, exitVersion]
  );
  const url = previewUrl.trim();
  // A stale surface still points at a URL nothing is serving — showing the
  // placeholder is the warning, an empty iframe would read as a broken site.
  const canLive = readiness === "ready" && !stale && url.length > 0;
  const showLive = canLive && liveShapeId === shape.id;
  const status = canLive && !showLive
    ? "Select this surface to show the live preview"
    : prototypeSurfaceStatusText({
        readiness,
        readinessReason,
        stale,
        staleReason
      });
  // Measure the body (layout pixels — ResizeObserver ignores the camera
  // transform) so the live iframe can lay out at the virtual viewport and be
  // CSS-scaled to fit. Re-measures on frame resize.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [bodySize, setBodySize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = bodyRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setBodySize((previous) =>
        previous.width === rect.width && previous.height === rect.height
          ? previous
          : { width: rect.width, height: rect.height }
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const liveViewport = prototypeSurfaceLiveViewport(
    bodySize.width,
    bodySize.height
  );
  // Header action: open the running site in a real browser tab (D05 focus mode
  // entry — the canvas frame stays the overview, the tab is the full
  // experience). Pointer events stop here so the click never reads as a canvas
  // selection or drag.
  const stopShapePointer = (event: SyntheticEvent) => {
    event.stopPropagation();
  };
  const openPreviewInTab = (event: SyntheticEvent) => {
    stopShapePointer(event);
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <HTMLContainer
      data-testid="prototype-surface-projection"
      data-canvas-record-id={canvasRecordId}
      data-runtime-record-id={runtimeRecordId}
      data-kind="prototype_surface"
      data-run-id={runId}
      data-surface-key={surfaceKey}
      data-surface-name={surfaceName || undefined}
      data-readiness={readiness}
      data-stale={stale ? "true" : "false"}
      data-selected={isSelected ? "true" : "false"}
      className={
        isSelected
          ? "prototype-surface-frame prototype-surface-frame--selected"
          : "prototype-surface-frame"
      }
      style={{ width: w, height: h, pointerEvents: "all" }}
    >
      <div className="prototype-surface-frame__header">
        <p
          className="prototype-surface-frame__title"
          data-testid="prototype-surface-projection-title"
        >
          Prototype
        </p>
        <button
          type="button"
          className="prototype-surface-frame__icon-button"
          data-testid="prototype-surface-projection-open"
          aria-label="Open prototype in a browser tab"
          disabled={!url}
          onPointerDown={stopShapePointer}
          onMouseDown={stopShapePointer}
          onClick={openPreviewInTab}
        >
          <HugeiconsIcon
            className="prototype-surface-frame__icon"
            icon={WebProgrammingIcon}
            size={14}
            color="currentColor"
            strokeWidth={1.5}
          />
        </button>
      </div>
      <div
        ref={bodyRef}
        className="prototype-surface-frame__body"
        data-testid="prototype-surface-projection-body"
        data-live={showLive ? "true" : "false"}
      >
        {showLive ? (
          <iframe
            className="prototype-surface-frame__live"
            data-testid="prototype-surface-projection-live"
            src={url}
            title={surfaceName || "Prototype preview"}
            loading="lazy"
            sandbox="allow-scripts allow-same-origin"
            style={
              liveViewport.width > 0
                ? {
                    width: liveViewport.width,
                    height: liveViewport.height,
                    transform: `scale(${liveViewport.scale})`
                  }
                : { visibility: "hidden" }
            }
          />
        ) : canLive && screenshotSrc ? (
          // Not the live surface but a bitmap was captured (Issue 30): show
          // the page itself with a hint overlay instead of a text-only
          // placeholder. The img is pointer-transparent so the non-live frame
          // stays canvas-selectable like the placeholder.
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- same-origin /api/artifacts bitmap */}
            <img
              className="prototype-surface-frame__screenshot"
              data-testid="prototype-surface-projection-screenshot"
              src={screenshotSrc}
              alt=""
            />
            <p
              className="prototype-surface-frame__screenshot-hint"
              role="status"
            >
              {status}
            </p>
          </>
        ) : (
          <div
            className="prototype-surface-frame__placeholder"
            data-testid="prototype-surface-projection-placeholder"
            role="status"
          >
            {readiness === "failed" || stale || canLive ? null : (
              <span
                className="prototype-surface-frame__spinner"
                aria-hidden="true"
              />
            )}
            <p className="prototype-surface-frame__placeholder-text">{status}</p>
            {url ? (
              <p className="prototype-surface-frame__placeholder-url">{url}</p>
            ) : null}
          </div>
        )}
      </div>
    </HTMLContainer>
  );
}

export class PrototypeSurfaceProjectionShapeUtil extends BaseBoxShapeUtil<PrototypeSurfaceProjectionShape> {
  static override type = PROTOTYPE_SURFACE_PROJECTION_TYPE;

  static override props = {
    w: T.number,
    h: T.number,
    previewUrl: T.string,
    readiness: T.literalEnum("installing", "starting", "ready", "failed"),
    readinessReason: T.string,
    stale: T.boolean,
    staleReason: T.string,
    surfaceName: T.string,
    screenshotSrc: T.string
  };

  getDefaultProps(): PrototypeSurfaceProjectionShape["props"] {
    return {
      w: PROTOTYPE_SURFACE_PROJECTION_DEFAULT_W,
      h: PROTOTYPE_SURFACE_PROJECTION_DEFAULT_H,
      previewUrl: "",
      readiness: "starting",
      readinessReason: "",
      stale: false,
      staleReason: "",
      surfaceName: "",
      screenshotSrc: ""
    };
  }

  override hideRotateHandle(_shape: PrototypeSurfaceProjectionShape) {
    return true;
  }

  override hideSelectionBoundsBg(_shape: PrototypeSurfaceProjectionShape) {
    return true;
  }

  override hideSelectionBoundsFg(_shape: PrototypeSurfaceProjectionShape) {
    return true;
  }

  override component(shape: PrototypeSurfaceProjectionShape) {
    return <PrototypeSurfaceFrame shape={shape} />;
  }

  // The workbench suppresses tldraw's native indicators on every custom shape;
  // the selected state reads through the frame chrome (--selected ring).
  override getIndicatorPath(_shape: PrototypeSurfaceProjectionShape) {
    return undefined;
  }
}
