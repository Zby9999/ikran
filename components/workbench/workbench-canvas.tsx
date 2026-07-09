"use client";

// tldraw Workbench canvas shell (Issue 02/04).
//
// Replaces the React Flow seed surface. This is a MINIMAL canvas 底座:
//   - `<Tldraw hideUi>` renders only the drawing surface (no default
//     toolbar / panels / page menu). The Issue 02/04 brief explicitly says do not
//     add complex toolbars or side panels.
//   - The custom `seed-reference-projection` shape (Figma Frame surface 230:297)
//     is the ONLY thing projected — purple frame + white media placeholder.
//   - `SeedProjectionSync` does a one-way reconciliation: Runtime records ->
//     tldraw shapes. It never reads geometry back. tldraw positions are local
//     only; the default `<Tldraw>` store is in-memory (no persistence), so a
//     refresh resets shapes and they are rebuilt from the records.
//   - Decorative camera-aware 100px page-space grid (Figma 133:129) via
//     Background — visual only, no snap-to-grid.
//
// This file is imported via `next/dynamic({ ssr: false })` from
// SeedEvidenceWorkbench because `<Tldraw>` touches the DOM during render.

import { useEffect } from "react";
import {
  Tldraw,
  useEditor,
  createShapeId,
  type TLShapeId
} from "tldraw";
import {
  SeedReferenceProjectionShapeUtil,
  SEED_REFERENCE_PROJECTION_TYPE,
  SEED_REFERENCE_PROJECTION_DEFAULT_W,
  SEED_REFERENCE_PROJECTION_DEFAULT_H,
  type SeedReferenceProjectionShape
} from "./seed-reference-projection-shape";
import { SeedSelectionForegroundOverlayUtil } from "./seed-selection-foreground-overlay";
import { WORKBENCH_CANVAS_COMPONENTS } from "./workbench-canvas-grid";
import type { SeedReferenceRecord } from "@/lib/runtime/seed-reference";

export function WorkbenchCanvas({
  records
}: {
  records: SeedReferenceRecord[];
}) {
  return (
    <Tldraw
      hideUi
      shapeUtils={[SeedReferenceProjectionShapeUtil]}
      components={WORKBENCH_CANVAS_COMPONENTS}
      overlayUtils={[SeedSelectionForegroundOverlayUtil]}
    >
      <SeedProjectionSync records={records} />
    </Tldraw>
  );
}

// One-way projection: for each Runtime record ensure a shape exists with the
// record's id encoded in `meta`; remove shapes whose record no longer exists.
// Geometry defaults are chosen here and are NOT written back to the Runtime.
function SeedProjectionSync({ records }: { records: SeedReferenceRecord[] }) {
  const editor = useEditor();

  useEffect(() => {
    if (!editor) return;

    const wantIds = new Set<string>();

    records.forEach((record, index) => {
      // Stable shape id per record.id so re-sync does not recreate shapes
      // (which would reset an in-session drag). The record.id is the Runtime
      // fact; the shape id is derived from it, never the reverse.
      const shapeId = createShapeId(record.id) as TLShapeId;
      wantIds.add(String(shapeId));

      const existing = editor.getShape(shapeId);
      if (existing) return; // record already projected; keep its in-session position

      const column = index % 4;
      const row = Math.floor(index / 4);
      // Pin the create-partial to the concrete shape type so `props`/`meta` are
      // checked against the augmented TLShape<'seed-reference-projection'>.
      // Default 380×520: readable tall Frame placeholder (see shape util).
      // frameName "" → UI title "Figma seed". URL stays in props (not displayed).
      editor.createShape<SeedReferenceProjectionShape>({
        id: shapeId,
        type: SEED_REFERENCE_PROJECTION_TYPE,
        x: 120 + column * 420,
        y: 140 + row * 560,
        props: {
          w: SEED_REFERENCE_PROJECTION_DEFAULT_W,
          h: SEED_REFERENCE_PROJECTION_DEFAULT_H,
          figmaSeedReference: record.figma_seed_reference,
          originalDesignIntent: record.original_design_intent,
          frameName: ""
        },
        meta: {
          canvasRecordId: `seed-reference:${record.id}`,
          runtimeRecordId: record.id,
          kind: "seed_reference_projection"
        }
      });
    });

    // Projection follows the record set: drop shapes for records that no
    // longer exist. (Records are not deleted in Issue 02/04, but this keeps the
    // projection a faithful one-way mirror of the source of truth.)
    const projected = editor
      .getCurrentPageShapes()
      .filter((s) => s.type === SEED_REFERENCE_PROJECTION_TYPE);
    for (const shape of projected) {
      if (!wantIds.has(String(shape.id))) {
        editor.deleteShape(shape.id);
      }
    }
  }, [editor, records]);

  return null;
}
