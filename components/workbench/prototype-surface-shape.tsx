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
// lifecycle state instead of a blank white rectangle.
//
// The iframe is pointer-events: none on purpose — Issue 30 explicitly excludes
// hover / DOM inspection, and it keeps canvas drag and selection working.

import { WebProgrammingIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  TLShape,
  useEditor,
  useValue
} from "tldraw";

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

const READINESS_LABEL: Record<
  PrototypeSurfaceProjectionShape["props"]["readiness"],
  string
> = {
  installing: "Installing prototype dependencies",
  starting: "Starting the prototype dev server",
  ready: "Prototype is running",
  failed: "Prototype dev server failed"
};

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
    surfaceName
  } = shape.props;
  const { canvasRecordId, runtimeRecordId, runId, surfaceKey } = shape.meta;
  const editor = useEditor();
  const isSelected = useValue(
    "prototype-surface-selected",
    () => editor.getSelectedShapeIds().includes(shape.id),
    [editor, shape.id]
  );
  // Single-live: only the selected ready surface mounts an iframe. If nothing
  // is selected, the sole ready surface may stay live so a one-surface demo
  // still shows the site without an extra click.
  const isSoleLiveCandidate = useValue(
    "prototype-surface-sole-live",
    () => {
      const readyIds = editor
        .getCurrentPageShapes()
        .filter(
          (candidate) =>
            candidate.type === PROTOTYPE_SURFACE_PROJECTION_TYPE &&
            candidate.props.readiness === "ready" &&
            !candidate.props.stale &&
            String(candidate.props.previewUrl ?? "").trim().length > 0
        )
        .map((candidate) => candidate.id);
      return readyIds.length === 1 && readyIds[0] === shape.id;
    },
    [editor, shape.id]
  );
  const url = previewUrl.trim();
  // A stale surface still points at a URL nothing is serving — showing the
  // placeholder is the warning, an empty iframe would read as a broken site.
  const canLive = readiness === "ready" && !stale && url.length > 0;
  const showLive = canLive && (isSelected || isSoleLiveCandidate);
  const status = canLive && !showLive
    ? "Select this surface to show the live preview"
    : prototypeSurfaceStatusText({
        readiness,
        readinessReason,
        stale,
        staleReason
      });

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
        <HugeiconsIcon
          className="prototype-surface-frame__icon"
          icon={WebProgrammingIcon}
          size={14}
          color="currentColor"
          strokeWidth={1.5}
        />
      </div>
      <div
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
          />
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
    surfaceName: T.string
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
      surfaceName: ""
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

  override getIndicatorPath(_shape: PrototypeSurfaceProjectionShape) {
    return undefined;
  }
}
