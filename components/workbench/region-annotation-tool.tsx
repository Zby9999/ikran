"use client";

// Issue 06 — custom Annotate tool for the tldraw Workbench.
//
// Not the default tldraw toolbar: FolderChrome toggles annotate mode, which
// switches the editor to this tool (and back to `select` when off).
//
// Pointer contract (media box only — coordinate space A):
//   - click → tiny page-square marker (normalized w=POINT_SIDE; h from media aspect)
//   - press-drag → rectangle clamped to the Evidence Surface media area
// On pointer up: commit via the per-editor injected create handler (no module
// global) with normalized rect + surfaceArtifactId from the hit surface meta.
//
// The tool never invents Runtime records — it only commits via the injected
// Runtime mutation; projection sync rebuilds shapes from authoritative GET.

import { useEffect, useRef, type MutableRefObject } from "react";
import {
  StateNode,
  createShapeId,
  useEditor,
  type Editor,
  type TLPointerEventInfo,
  type TLShape,
  type TLStateNodeConstructor
} from "tldraw";
import {
  SEED_REFERENCE_PROJECTION_TYPE,
  type SeedReferenceProjectionMeta,
  type SeedReferenceProjectionShape
} from "./seed-reference-projection-shape";
import {
  REGION_ANNOTATION_TYPE,
  type RegionAnnotationShape
} from "./region-annotation-shape";
import {
  clampPageRectToMediaBox,
  expandNormalizedPointToRect,
  mediaBoxInPage,
  pageRectToNormalized,
  type NormalizedRect,
  type PageRect
} from "./region-annotation-geometry";

export const REGION_ANNOTATION_TOOL_ID = "region-annotation" as const;

/** Drag distance (page px) below which a gesture is treated as a point-click. */
const CLICK_DRAG_THRESHOLD_PX = 4;

export type RegionAnnotationCreatePayload = {
  surfaceArtifactId: string;
  rect: NormalizedRect;
};

type CreateHandler = (payload: RegionAnnotationCreatePayload) => void;

type DraftSession = {
  surfaceShapeId: string;
  surfaceArtifactId: string;
  mediaBox: PageRect;
  originPage: { x: number; y: number };
  draftShapeId: string;
};

function isEvidenceSurfaceShape(
  shape: TLShape | undefined
): shape is SeedReferenceProjectionShape {
  if (!shape || shape.type !== SEED_REFERENCE_PROJECTION_TYPE) return false;
  const meta = shape.meta as SeedReferenceProjectionMeta;
  return (
    meta.kind === "figma_evidence_surface" &&
    typeof meta.surfaceRecordId === "string" &&
    meta.surfaceRecordId.length > 0
  );
}

function pageBoundsForShape(
  editor: Editor,
  shape: SeedReferenceProjectionShape
): PageRect | null {
  const bounds = editor.getShapePageBounds(shape);
  if (!bounds) return null;
  return { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h };
}

function hitMediaSurface(
  editor: Editor,
  pagePoint: { x: number; y: number }
): {
  shape: SeedReferenceProjectionShape;
  mediaBox: PageRect;
  surfaceArtifactId: string;
} | null {
  // Prefer getShapesAtPoint so existing annotation markers (drawn above the
  // surface) do not block new annotate gestures on the media box.
  const hits = editor
    .getShapesAtPoint(pagePoint, { hitInside: true })
    .filter((s) => s.type === SEED_REFERENCE_PROJECTION_TYPE);
  const hit = hits.find((s) => isEvidenceSurfaceShape(s));
  if (!hit || !isEvidenceSurfaceShape(hit)) return null;

  const page = pageBoundsForShape(editor, hit);
  if (!page) return null;
  const mediaBox = mediaBoxInPage(page.x, page.y, page.w, page.h);
  if (mediaBox.w <= 0 || mediaBox.h <= 0) return null;

  const inside =
    pagePoint.x >= mediaBox.x &&
    pagePoint.x <= mediaBox.x + mediaBox.w &&
    pagePoint.y >= mediaBox.y &&
    pagePoint.y <= mediaBox.y + mediaBox.h;
  if (!inside) return null;

  const surfaceArtifactId = (hit.meta as SeedReferenceProjectionMeta)
    .surfaceRecordId!;
  return { shape: hit, mediaBox, surfaceArtifactId };
}

function rectFromOriginCurrent(
  origin: { x: number; y: number },
  current: { x: number; y: number }
): PageRect {
  const x = Math.min(origin.x, current.x);
  const y = Math.min(origin.y, current.y);
  const w = Math.abs(current.x - origin.x);
  const h = Math.abs(current.y - origin.y);
  return { x, y, w, h };
}

type RegionAnnotationToolParent = StateNode & {
  commitCreate: (payload: RegionAnnotationCreatePayload) => void;
};

/**
 * Per-editor tool class factory. Closes over `getCreateHandler` so two Canvas
 * instances never share a module-global handler registry.
 */
export function createRegionAnnotationToolClass(
  getCreateHandler: () => CreateHandler | null
): TLStateNodeConstructor {
  class RegionAnnotationIdle extends StateNode {
    static override id = "idle";

    override onEnter() {
      this.editor.setCursor({ type: "cross", rotation: 0 });
    }

    override onPointerDown(info: TLPointerEventInfo) {
      if (info.button !== 0) return;
      this.parent.transition("pointing", info);
    }

    override onCancel() {
      this.editor.setCurrentTool("select");
    }
  }

  class RegionAnnotationPointing extends StateNode {
    static override id = "pointing";

    private session: DraftSession | null = null;

    override onEnter(_info: TLPointerEventInfo) {
      const editor = this.editor;
      const pagePoint = editor.inputs.getCurrentPagePoint();
      const hit = hitMediaSurface(editor, pagePoint);
      if (!hit) {
        this.parent.transition("idle");
        return;
      }

      const draftShapeId = createShapeId();
      const origin = { x: pagePoint.x, y: pagePoint.y };
      // Start as a 1×1 draft; click completion expands via geometry helpers.
      editor.createShape<RegionAnnotationShape>({
        id: draftShapeId,
        type: REGION_ANNOTATION_TYPE,
        x: origin.x,
        y: origin.y,
        props: {
          w: 1,
          h: 1,
          author: "designer",
          label: ""
        },
        meta: {
          canvasRecordId: "region-annotation:draft",
          runtimeRecordId: "draft",
          surfaceRecordId: hit.surfaceArtifactId
        }
      });

      this.session = {
        surfaceShapeId: String(hit.shape.id),
        surfaceArtifactId: hit.surfaceArtifactId,
        mediaBox: hit.mediaBox,
        originPage: origin,
        draftShapeId: String(draftShapeId)
      };
    }

    override onPointerMove(_info: TLPointerEventInfo) {
      const session = this.session;
      if (!session) return;
      const editor = this.editor;
      const current = editor.inputs.getCurrentPagePoint();
      const raw = rectFromOriginCurrent(session.originPage, current);
      const clamped = clampPageRectToMediaBox(session.mediaBox, raw);
      editor.updateShape<RegionAnnotationShape>({
        id: session.draftShapeId as RegionAnnotationShape["id"],
        type: REGION_ANNOTATION_TYPE,
        x: clamped.x,
        y: clamped.y,
        props: { w: Math.max(1, clamped.w), h: Math.max(1, clamped.h) }
      });
    }

    override onPointerUp(_info: TLPointerEventInfo) {
      this.complete();
    }

    override onCancel() {
      this.cancel();
    }

    override onInterrupt() {
      this.cancel();
    }

    private cancel() {
      const session = this.session;
      this.session = null;
      if (session) {
        this.editor.deleteShape(
          session.draftShapeId as RegionAnnotationShape["id"]
        );
      }
      this.parent.transition("idle");
    }

    private complete() {
      const session = this.session;
      this.session = null;
      if (!session) {
        this.parent.transition("idle");
        return;
      }

      const editor = this.editor;
      const current = editor.inputs.getCurrentPagePoint();
      const dx = current.x - session.originPage.x;
      const dy = current.y - session.originPage.y;
      const isClick = Math.hypot(dx, dy) < CLICK_DRAG_THRESHOLD_PX;

      let normalized: NormalizedRect;
      if (isClick) {
        const nx =
          session.mediaBox.w > 0
            ? (session.originPage.x - session.mediaBox.x) / session.mediaBox.w
            : 0;
        const ny =
          session.mediaBox.h > 0
            ? (session.originPage.y - session.mediaBox.y) / session.mediaBox.h
            : 0;
        normalized = expandNormalizedPointToRect(
          { x: nx, y: ny },
          session.mediaBox
        );
      } else {
        const raw = rectFromOriginCurrent(session.originPage, current);
        const clamped = clampPageRectToMediaBox(session.mediaBox, raw);
        normalized = pageRectToNormalized(session.mediaBox, clamped);
        // Degenerate drag → treat as point at origin.
        if (normalized.w <= 0 || normalized.h <= 0) {
          const nx =
            session.mediaBox.w > 0
              ? (session.originPage.x - session.mediaBox.x) / session.mediaBox.w
              : 0;
          const ny =
            session.mediaBox.h > 0
              ? (session.originPage.y - session.mediaBox.y) / session.mediaBox.h
              : 0;
          normalized = expandNormalizedPointToRect(
            { x: nx, y: ny },
            session.mediaBox
          );
        }
      }

      // Drop the local draft — Runtime record → projection sync owns the shape.
      editor.deleteShape(session.draftShapeId as RegionAnnotationShape["id"]);

      (this.parent as RegionAnnotationToolParent).commitCreate({
        surfaceArtifactId: session.surfaceArtifactId,
        rect: normalized
      });

      this.parent.transition("idle");
    }
  }

  class RegionAnnotationTool extends StateNode {
    static override id = REGION_ANNOTATION_TOOL_ID;
    static override initial = "idle";
    static override children(): TLStateNodeConstructor[] {
      return [RegionAnnotationIdle, RegionAnnotationPointing];
    }

    /** Pointing state commits through this instance method (per-editor closure). */
    commitCreate(payload: RegionAnnotationCreatePayload): void {
      getCreateHandler()?.(payload);
    }
  }

  return RegionAnnotationTool;
}

/**
 * Keeps the editor on the annotate tool while `annotateMode` is true, and
 * wires the create handler ref for pointer-up commits (Runtime client mutation).
 */
export function RegionAnnotationToolController({
  annotateMode,
  onCreate,
  createHandlerRef
}: {
  annotateMode: boolean;
  /** Injected Runtime mutation — must not fetch directly here. */
  onCreate?: (payload: RegionAnnotationCreatePayload) => Promise<
    { ok: true } | { ok: false; error: string }
  >;
  /** Per-Canvas ref closed over by the tool class factory. */
  createHandlerRef: MutableRefObject<CreateHandler | null>;
}) {
  const editor = useEditor();
  const onCreateRef = useRef(onCreate);
  onCreateRef.current = onCreate;

  useEffect(() => {
    if (!annotateMode) {
      createHandlerRef.current = null;
      if (editor.getCurrentToolId() === REGION_ANNOTATION_TOOL_ID) {
        editor.setCurrentTool("select");
      }
      return;
    }

    createHandlerRef.current = (payload) => {
      void (async () => {
        const mutate = onCreateRef.current;
        if (!mutate) return;
        await mutate(payload);
      })();
    };

    if (editor.getCurrentToolId() !== REGION_ANNOTATION_TOOL_ID) {
      editor.setCurrentTool(REGION_ANNOTATION_TOOL_ID);
    }

    return () => {
      createHandlerRef.current = null;
    };
  }, [annotateMode, editor, createHandlerRef]);

  return null;
}
