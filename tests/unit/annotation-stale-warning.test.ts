import { expect, test } from "vitest";
import { staleAnnotationWarning } from "../../components/workbench/annotation-stale-warning";
import type { RegionAnnotationRecord } from "../../lib/runtime/region-annotation";

function annotation(
  partial: Partial<RegionAnnotationRecord> = {}
): RegionAnnotationRecord {
  return {
    id: "annotation-1",
    surface_id: "surface-v1",
    surface_artifact_id: "surface-v1",
    surface_node_id: "1:2",
    target_kind: "figma-node",
    target_evidence_version_id: "surface-v1",
    target_node_id: "3:4",
    current_evidence_version_id: "surface-v2",
    current_node_id: "3:4",
    current_rect_x: 0.1,
    current_rect_y: 0.2,
    current_rect_w: 0.3,
    current_rect_h: 0.4,
    correspondence_status: "corresponding",
    stale: false,
    author: "designer",
    type: "explanatory",
    body: "Marker",
    rect_x: 0.1,
    rect_y: 0.2,
    rect_w: 0.3,
    rect_h: 0.4,
    primary_node_id: null,
    candidates_json: null,
    created_at: "2026-07-15T00:00:00.000Z",
    geometry_version: "v2_raw",
    from_point: false,
    ...partial
  };
}

test("shows the Timeout-style warning copy when a node Annotation is stale", () => {
  expect(
    staleAnnotationWarning([
      annotation({
        current_node_id: null,
        current_rect_x: null,
        current_rect_y: null,
        current_rect_w: null,
        current_rect_h: null,
        correspondence_status: "missing",
        stale: true
      })
    ])
  ).toBe("An annotated Figma node no longer exists in the current version.");
});

test("does not warn for current node or free-region Annotations", () => {
  expect(
    staleAnnotationWarning([
      annotation(),
      annotation({
        id: "region-1",
        target_kind: "figma-region",
        target_node_id: null,
        correspondence_status: "not_applicable"
      })
    ])
  ).toBeNull();
});

test("warns when an Agent-confirmed region loses its primary Figma node", () => {
  expect(
    staleAnnotationWarning([
      annotation({
        target_kind: "figma-region",
        target_node_id: null,
        primary_node_id: "3:4",
        current_node_id: null,
        current_rect_x: null,
        current_rect_y: null,
        current_rect_w: null,
        current_rect_h: null,
        correspondence_status: "missing",
        stale: true
      })
    ])
  ).toBe("An annotated Figma node no longer exists in the current version.");
});
