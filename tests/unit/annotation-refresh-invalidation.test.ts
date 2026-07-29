import { expect, test } from "vitest";
import { annotationSignature } from "../../components/runtime/use-workbench-runtime";
import type { RegionAnnotationRecord } from "../../lib/runtime/region-annotation";

function nodeAnnotation(
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
    current_evidence_version_id: "surface-v1",
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
    section: null,
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

test("Refresh invalidates Annotation projection when only current node mapping changes", () => {
  const before = nodeAnnotation();
  const after = nodeAnnotation({
    current_evidence_version_id: "surface-v2",
    current_rect_x: 0.55,
    current_rect_y: 0.6,
    current_rect_w: 0.2,
    current_rect_h: 0.1
  });

  expect(annotationSignature([after])).not.toBe(annotationSignature([before]));
});

test("Refresh invalidates Annotation projection when a node becomes stale", () => {
  const before = nodeAnnotation();
  const after = nodeAnnotation({
    current_evidence_version_id: "surface-v2",
    current_node_id: null,
    current_rect_x: null,
    current_rect_y: null,
    current_rect_w: null,
    current_rect_h: null,
    correspondence_status: "missing",
    stale: true
  });

  expect(annotationSignature([after])).not.toBe(annotationSignature([before]));
});
