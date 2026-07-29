import { describe, expect, test } from "vitest";

import { designerAnnotationCardEditorUpdates } from "../../components/workbench/designer-annotation-card-shape";

describe("designerAnnotationCardEditorUpdates", () => {
  const cards = [
    { id: "card-1", editing: false },
    { id: "card-2", editing: true },
    { id: "card-3", editing: true }
  ];

  test("activating one card closes every other open edit form", () => {
    expect(designerAnnotationCardEditorUpdates(cards, "card-1")).toEqual([
      { id: "card-1", editing: true },
      { id: "card-2", editing: false },
      { id: "card-3", editing: false }
    ]);
  });

  test("null active id closes all edit forms", () => {
    expect(designerAnnotationCardEditorUpdates(cards, null)).toEqual([
      { id: "card-2", editing: false },
      { id: "card-3", editing: false }
    ]);
  });

  test("no changes needed returns no updates", () => {
    expect(
      designerAnnotationCardEditorUpdates(
        [
          { id: "card-1", editing: false },
          { id: "card-2", editing: true }
        ],
        "card-2"
      )
    ).toEqual([]);
    expect(
      designerAnnotationCardEditorUpdates(
        [
          { id: "card-1", editing: false },
          { id: "card-2", editing: false }
        ],
        null
      )
    ).toEqual([]);
  });
});
