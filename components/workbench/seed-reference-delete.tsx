"use client";

// Designer Delete/Backspace on Seed / Evidence Surface projections.
//
// Runtime is source of truth: HTTP DELETE must succeed before local remove.
// Local-only tldraw deletes are blocked — otherwise the next projection sync
// (e.g. pasting another frame) recreates the "deleted" shape from SQLite.

import { useEffect, useRef } from "react";
import { useEditor, type TLShape, type TLShapeId } from "tldraw";
import {
  SEED_REFERENCE_PROJECTION_TYPE,
  type SeedReferenceProjectionShape
} from "./seed-reference-projection-shape";

function asSeedProjection(
  shape: TLShape
): SeedReferenceProjectionShape | null {
  if (shape.type !== SEED_REFERENCE_PROJECTION_TYPE) return null;
  return shape as SeedReferenceProjectionShape;
}

function seedIdForProjection(
  shape: SeedReferenceProjectionShape
): string | null {
  const canvasId = shape.meta.canvasRecordId ?? "";
  if (String(canvasId).startsWith("inflight-capture:")) return null;

  const fromSeed = shape.meta.seedRecordId;
  if (typeof fromSeed === "string" && fromSeed.trim().length > 0) {
    return fromSeed.trim();
  }
  if (shape.meta.kind === "seed_reference_projection") {
    const rid = shape.meta.runtimeRecordId;
    if (typeof rid === "string" && rid.trim().length > 0) return rid.trim();
  }
  return null;
}

/**
 * Keyboard + beforeDelete guards for seed-reference-projection shapes.
 * Mount inside `<Tldraw>`.
 */
export function SeedReferenceDeleteController({
  onDelete
}: {
  onDelete?: (
    seedId: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const editor = useEditor();
  const onDeleteRef = useRef(onDelete);
  onDeleteRef.current = onDelete;

  useEffect(() => {
    return editor.sideEffects.registerBeforeDeleteHandler(
      "shape",
      (shape, source) => {
        const projection = asSeedProjection(shape as TLShape);
        if (!projection) return;
        // Optimistic in-flight frames are local-only.
        if (String(projection.meta.canvasRecordId ?? "").startsWith("inflight-capture:")) {
          return;
        }
        // Projection sync / post-HTTP cleanup use mergeRemoteChanges ("remote").
        if (source !== "user") return;
        // Block bare tldraw Delete — requires Runtime-backed keyboard path.
        return false;
      }
    );
  }, [editor]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (editor.getCurrentToolId() !== "select") return;

      const projections = editor
        .getSelectedShapes()
        .map(asSeedProjection)
        .filter((s): s is SeedReferenceProjectionShape => s != null);
      if (projections.length === 0) return;

      const inFlightIds: TLShapeId[] = [];
      const targets: Array<{ shapeId: TLShapeId; seedId: string }> = [];
      for (const shape of projections) {
        if (String(shape.meta.canvasRecordId ?? "").startsWith("inflight-capture:")) {
          inFlightIds.push(shape.id);
          continue;
        }
        const seedId = seedIdForProjection(shape);
        if (!seedId) continue;
        targets.push({ shapeId: shape.id, seedId });
      }

      if (inFlightIds.length === 0 && targets.length === 0) return;

      event.preventDefault();
      event.stopPropagation();

      if (inFlightIds.length > 0) {
        editor.store.mergeRemoteChanges(() => {
          editor.deleteShapes(inFlightIds);
        });
      }

      const mutate = onDeleteRef.current;
      if (!mutate || targets.length === 0) return;

      void (async () => {
        const removed: TLShapeId[] = [];
        const deletedSeedIds = new Set<string>();
        for (const target of targets) {
          if (deletedSeedIds.has(target.seedId)) {
            removed.push(target.shapeId);
            continue;
          }
          const result = await mutate(target.seedId);
          if (result.ok) {
            deletedSeedIds.add(target.seedId);
            removed.push(target.shapeId);
          }
        }
        if (removed.length > 0) {
          editor.store.mergeRemoteChanges(() => {
            editor.deleteShapes(removed);
          });
        }
      })();
    };

    const container = editor.getContainer();
    container.addEventListener("keydown", onKeyDown, true);
    return () => container.removeEventListener("keydown", onKeyDown, true);
  }, [editor]);

  return null;
}
