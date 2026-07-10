"use client";

// Issue 06 — custom Annotate tool for the tldraw Workbench.
//
// Not the default tldraw toolbar: FolderChrome toggles annotate mode, which
// switches the editor to this tool (and back to `select` when off).
//
// Pointer contract (media box only — coordinate space A):
//   - click → tiny page-square marker (normalized w=POINT_SIDE; h from media aspect)
//   - press-drag → rectangle clamped to the Evidence Surface media area
// On pointer up: POST /api/region-annotation with normalized rect +
// author "designer" + surfaceArtifactId from the hit surface shape meta.
//
// The tool never invents Runtime records — it only POSTs; projection sync
// rebuilds shapes from GET poll / reload.

import { useEffect, useRef } from "react";
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

/**
 * Bridge from the StateNode tool (no React closure) to the Workbench session
 * POST. Set while annotate mode is active; cleared on unmount / mode off.
 */
let createHandler: CreateHandler | null = null;

export function setRegionAnnotationCreateHandler(
  handler: CreateHandler | null
): void {
  createHandler = handler;
}

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
    const isClick =
      Math.hypot(dx, dy) < CLICK_DRAG_THRESHOLD_PX;

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

    createHandler?.({
      surfaceArtifactId: session.surfaceArtifactId,
      rect: normalized
    });

    this.parent.transition("idle");
  }
}

/** tldraw StateNode tool — register via `<Tldraw tools={[...]} />`. */
export class RegionAnnotationTool extends StateNode {
  static override id = REGION_ANNOTATION_TOOL_ID;
  static override initial = "idle";
  static override children(): TLStateNodeConstructor[] {
    return [RegionAnnotationIdle, RegionAnnotationPointing];
  }
}

/**
 * Keeps the editor on the annotate tool while `annotateMode` is true, and
 * wires the POST create handler for pointer-up commits.
 */
export function RegionAnnotationToolController({
  annotateMode,
  session,
  onCreated
}: {
  annotateMode: boolean;
  session: string;
  /** Called after a successful POST so the poll hook can reload immediately. */
  onCreated?: () => void;
}) {
  const editor = useEditor();
  const onCreatedRef = useRef(onCreated);
  onCreatedRef.current = onCreated;
  const sessionRef = useRef(session);
  sessionRef.current = session;

  useEffect(() => {
    if (!annotateMode) {
      setRegionAnnotationCreateHandler(null);
      if (editor.getCurrentToolId() === REGION_ANNOTATION_TOOL_ID) {
        editor.setCurrentTool("select");
      }
      return;
    }

    setRegionAnnotationCreateHandler((payload) => {
      void (async () => {
        try {
          const response = await fetch("/api/region-annotation", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-ikran-session": sessionRef.current
            },
            body: JSON.stringify({
              surfaceArtifactId: payload.surfaceArtifactId,
              author: "designer",
              body: "Placeholder annotation",
              rect: payload.rect
              // type omitted — Runtime defaults designer → explanatory
            })
          });
          const data = (await response.json().catch(() => ({}))) as {
            ok?: boolean;
          };
          if (response.ok && data.ok) {
            onCreatedRef.current?.();
          }
        } catch {
          // Swallow — poll will not show a failed create; designer can retry.
        }
      })();
    });

    if (editor.getCurrentToolId() !== REGION_ANNOTATION_TOOL_ID) {
      editor.setCurrentTool(REGION_ANNOTATION_TOOL_ID);
    }

    return () => {
      setRegionAnnotationCreateHandler(null);
    };
  }, [annotateMode, editor]);

  return null;
}
