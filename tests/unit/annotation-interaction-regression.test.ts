import { expect, test } from "vitest";
import { annotationProjectionShapeIds } from "../../components/workbench/region-annotation-delete";

test("successful delete removes the marker, text card, and connector as one annotation family", () => {
  const shapes = [
    {
      id: "shape:marker",
      type: "region-annotation",
      meta: { runtimeRecordId: "annotation-1" }
    },
    {
      id: "shape:card",
      type: "designer-annotation-card",
      meta: { runtimeRecordId: "annotation-1" }
    },
    {
      id: "shape:connector",
      type: "designer-annotation-connector",
      meta: { runtimeRecordId: "annotation-1" }
    },
    {
      id: "shape:other",
      type: "region-annotation",
      meta: { runtimeRecordId: "annotation-2" }
    }
  ];

  expect(annotationProjectionShapeIds(shapes, ["annotation-1"])).toEqual([
    "shape:marker",
    "shape:card",
    "shape:connector"
  ]);
});
