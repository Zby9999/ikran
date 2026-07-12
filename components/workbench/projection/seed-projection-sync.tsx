"use client";

// One-way seed / Evidence Surface projection sync (Task 12).
// Runtime records → tldraw shapes. Geometry is never written back.

import { useEffect } from "react";
import { createShapeId, useEditor, type TLShapeId } from "tldraw";
import {
  SEED_REFERENCE_PROJECTION_TYPE,
  type SeedReferenceProjectionMeta,
  type SeedReferenceProjectionShape
} from "../seed-reference-projection-shape";
import {
  buildInFlightSeedProjectionTargets,
  buildSeedProjectionTargets,
  planSeedProjectionOps,
  type InFlightSeedCapture,
  type SeedProjectionExisting
} from "./seed-projection";
import type { SeedReferenceRecord } from "@/lib/runtime/seed-reference";
import type { FigmaEvidenceSurfaceRecord } from "@/lib/runtime/evidence-package";

export function SeedProjectionSync({
  records,
  surfaces,
  session,
  inFlightCaptures = []
}: {
  records: SeedReferenceRecord[];
  surfaces: FigmaEvidenceSurfaceRecord[];
  session: string;
  /** In-flight paste captures — show spinner frame until Runtime responds. */
  inFlightCaptures?: InFlightSeedCapture[];
}) {
  const editor = useEditor();

  useEffect(() => {
    if (!editor) return;

    const targets = [
      ...buildSeedProjectionTargets(records, surfaces, session),
      ...buildInFlightSeedProjectionTargets(inFlightCaptures)
    ];
    const existing: SeedProjectionExisting[] = editor
      .getCurrentPageShapes()
      .filter((s) => s.type === SEED_REFERENCE_PROJECTION_TYPE)
      .map((s) => {
        const shape = s as SeedReferenceProjectionShape;
        return {
          id: String(shape.id),
          x: shape.x,
          y: shape.y,
          props: shape.props,
          meta: shape.meta as SeedReferenceProjectionMeta
        };
      });

    const ops = planSeedProjectionOps(targets, existing, (key) =>
      String(createShapeId(key))
    );

    editor.store.mergeRemoteChanges(() => {
      for (const op of ops) {
        if (op.type === "create") {
          editor.createShape<SeedReferenceProjectionShape>({
            id: op.id as TLShapeId,
            type: SEED_REFERENCE_PROJECTION_TYPE,
            x: op.x,
            y: op.y,
            props: op.props,
            meta: op.meta
          });
        } else if (op.type === "update") {
          editor.updateShape<SeedReferenceProjectionShape>({
            id: op.id as TLShapeId,
            type: SEED_REFERENCE_PROJECTION_TYPE,
            ...(op.props ? { props: op.props } : {}),
            ...(op.meta ? { meta: op.meta } : {})
          });
        } else {
          editor.deleteShape(op.id as TLShapeId);
        }
      }
    });
  }, [editor, records, surfaces, session, inFlightCaptures]);

  return null;
}
