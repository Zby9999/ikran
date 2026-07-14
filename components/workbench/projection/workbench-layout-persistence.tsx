"use client";

// Persist Workbench frame geometry + camera to `.ikran/workbench-layout.json`
// via Runtime PUT. User-sourced tldraw changes only (projection sync is remote).

import { useEffect, useRef } from "react";
import { useEditor } from "tldraw";
import {
  SEED_REFERENCE_PROJECTION_TYPE,
  type SeedReferenceProjectionMeta,
  type SeedReferenceProjectionShape
} from "../seed-reference-projection-shape";
import type {
  WorkbenchCameraLayout,
  WorkbenchFrameLayout,
  WorkbenchLayoutDocument
} from "@/lib/runtime/workbench-layout-shared";

const SAVE_DEBOUNCE_MS = 400;

function frameKeyForShape(
  shape: SeedReferenceProjectionShape
): string | null {
  const meta = shape.meta as SeedReferenceProjectionMeta;
  if (typeof meta.seedRecordId === "string" && meta.seedRecordId.length > 0) {
    return meta.seedRecordId;
  }
  if (meta.kind === "seed_reference_projection") {
    const id = meta.runtimeRecordId;
    if (typeof id === "string" && id.length > 0 && !id.includes(":")) {
      return id;
    }
  }
  return null;
}

function collectLayout(editor: ReturnType<typeof useEditor>): WorkbenchLayoutDocument {
  const camera = editor.getCamera();
  const frames: Record<string, WorkbenchFrameLayout> = {};

  for (const s of editor.getCurrentPageShapes()) {
    if (s.type !== SEED_REFERENCE_PROJECTION_TYPE) continue;
    const shape = s as SeedReferenceProjectionShape;
    const key = frameKeyForShape(shape);
    if (!key) continue;
    frames[key] = {
      x: shape.x,
      y: shape.y,
      w: shape.props.w,
      h: shape.props.h,
      layoutLocked: shape.props.layoutLocked === true
    };
  }

  return {
    version: 1,
    camera: {
      x: camera.x,
      y: camera.y,
      z: camera.z
    },
    frames
  };
}

export function WorkbenchLayoutPersistence({
  session,
  savedCamera,
  onPutLayout,
  onFlushLayout
}: {
  session: string;
  /** Camera from last authoritative GET — applied once per mount. */
  savedCamera: WorkbenchCameraLayout | null;
  onPutLayout: (
    layout: WorkbenchLayoutDocument
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  onFlushLayout: (
    layout: WorkbenchLayoutDocument
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const editor = useEditor();
  const cameraAppliedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPutRef = useRef(onPutLayout);
  onPutRef.current = onPutLayout;
  const onFlushRef = useRef(onFlushLayout);
  onFlushRef.current = onFlushLayout;

  // Restore camera once when layout has loaded (empty/default still applies).
  useEffect(() => {
    if (!editor || cameraAppliedRef.current) return;
    if (!savedCamera) return;
    editor.setCamera({
      x: savedCamera.x,
      y: savedCamera.y,
      z: savedCamera.z
    });
    cameraAppliedRef.current = true;
  }, [editor, savedCamera]);

  useEffect(() => {
    if (!editor) return;
    let flushedForCurrentState = false;

    const flushLatest = () => {
      if (flushedForCurrentState) return;
      flushedForCurrentState = true;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      void onFlushRef.current(collectLayout(editor));
    };

    const scheduleSave = () => {
      flushedForCurrentState = false;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        const layout = collectLayout(editor);
        void onPutRef.current(layout);
      }, SAVE_DEBOUNCE_MS);
    };

    const unsub = editor.store.listen(scheduleSave, { source: "user" });
    window.addEventListener("pagehide", flushLatest);

    return () => {
      unsub();
      window.removeEventListener("pagehide", flushLatest);
      flushLatest();
    };
  }, [editor, session]);

  return null;
}
