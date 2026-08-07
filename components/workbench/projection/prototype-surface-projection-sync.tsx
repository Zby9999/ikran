"use client";

// One-way Prototype Evidence Surface projection sync (Issue 30).
// Runtime `prototype_surfaces` rows → prototype-surface-projection shapes.
// Writes go through mergeRemoteChanges so the designer's own tldraw history
// never records a projection, and so a create does not fight layout persistence.

import { useEffect } from "react";
import { createShapeId, useEditor, type TLShapeId } from "tldraw";
import {
  PROTOTYPE_SURFACE_PROJECTION_TYPE,
  type PrototypeSurfaceProjectionMeta,
  type PrototypeSurfaceProjectionShape
} from "../prototype-surface-shape";
import { SEED_REFERENCE_PROJECTION_TYPE } from "../seed-reference-projection-shape";
import type { SeedReferenceProjectionShape } from "../seed-reference-projection-shape";
import {
  buildPrototypeSurfaceProjectionTargets,
  planPrototypeSurfaceProjectionOps,
  type PrototypeSurfaceProjectionExisting
} from "./prototype-surface-projection";
import { seedProjectionOccupiedBounds } from "./seed-projection";
import type { PrototypeSurfaceRecord } from "@/lib/runtime/prototype-surface";

function syncPrototypeSurfaceShapes(
  editor: ReturnType<typeof useEditor>,
  surfaces: PrototypeSurfaceRecord[],
  session: string
): void {
  const pageShapes = editor.getCurrentPageShapes();
  const existing: PrototypeSurfaceProjectionExisting[] = pageShapes
    .filter((s) => s.type === PROTOTYPE_SURFACE_PROJECTION_TYPE)
    .map((s) => {
      const shape = s as PrototypeSurfaceProjectionShape;
      return {
        id: String(shape.id),
        x: shape.x,
        y: shape.y,
        props: shape.props,
        meta: shape.meta as PrototypeSurfaceProjectionMeta
      };
    });
  const seedBounds = pageShapes
    .filter((s) => s.type === SEED_REFERENCE_PROJECTION_TYPE)
    .map((s) => seedProjectionOccupiedBounds(s as SeedReferenceProjectionShape));

  const ops = planPrototypeSurfaceProjectionOps(
    buildPrototypeSurfaceProjectionTargets(surfaces, session),
    existing,
    (surfaceId) => String(createShapeId(`prototype-surface:${surfaceId}`)),
    seedBounds
  );
  if (ops.length === 0) return;

  editor.store.mergeRemoteChanges(() => {
    for (const op of ops) {
      if (op.type === "create") {
        editor.createShape<PrototypeSurfaceProjectionShape>({
          id: op.id as TLShapeId,
          type: PROTOTYPE_SURFACE_PROJECTION_TYPE,
          x: op.x,
          y: op.y,
          props: op.props,
          meta: op.meta
        });
      } else if (op.type === "update") {
        editor.updateShape<PrototypeSurfaceProjectionShape>({
          id: op.id as TLShapeId,
          type: PROTOTYPE_SURFACE_PROJECTION_TYPE,
          ...(op.props ? { props: op.props } : {}),
          ...(op.meta ? { meta: op.meta } : {})
        });
      } else {
        editor.deleteShape(op.id as TLShapeId);
      }
    }
  });
}

export function PrototypeSurfaceProjectionSync({
  prototypeSurfaces,
  session
}: {
  prototypeSurfaces: PrototypeSurfaceRecord[];
  /** Startup session token — screenshot bitmaps load via /api/artifacts. */
  session: string;
}) {
  const editor = useEditor();

  useEffect(() => {
    if (!editor) return;
    syncPrototypeSurfaceShapes(editor, prototypeSurfaces, session);
  }, [editor, prototypeSurfaces, session]);

  return null;
}
