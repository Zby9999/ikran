import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import {
  AlignmentCardProjectionProvider,
  AlignmentCardShapeUtil,
  AlignmentCardShapeView,
  normalizeAlignmentCardDimensions,
  type AlignmentCardShape
} from "../../components/workbench/alignment-card-shape";

function questionShape(expanded = false): AlignmentCardShape {
  return {
    id: "shape:alignment-card:question-1" as AlignmentCardShape["id"],
    typeName: "shape",
    type: "alignment-card",
    x: 500,
    y: 50,
    rotation: 0,
    index: "a1" as AlignmentCardShape["index"],
    parentId: "page:page" as AlignmentCardShape["parentId"],
    isLocked: true,
    opacity: 1,
    props: {
      w: expanded ? 360 : 320,
      h: 236,
      cardKind: "question",
      stage: "layout",
      number: 1,
      observation: "Cards use a stable inset.",
      question: "Should the inset remain 20px?",
      proposedAnswer: "Yes.",
      finalAnswer: "",
      answerSource: "",
      title: "",
      body: "",
      additionalInformationJson: "[]",
      evidenceAnchor: "Figma node 44:120",
      expanded,
      editing: false,
      focusSelectionJson: JSON.stringify({
        cardId: "question-1",
        targets: [
          {
            targetId: "question-1:0",
            surfaceArtifactId: "surface-1",
            evidenceVersionId: "version-1",
            rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 }
          }
        ]
      })
    },
    meta: {
      canvasRecordId: "alignment-card:question-1",
      runtimeRecordId: "question-1",
      surface: "design-intent-alignment",
      seedReferenceId: "seed-1",
      surfaceRecordId: "surface-1",
      evidenceVersionId: "version-1",
      nodeId: "44:120"
    }
  };
}

describe("AlignmentCardShapeUtil", () => {
  test("enforces the Figma collapsed and expanded widths", () => {
    expect(normalizeAlignmentCardDimensions({
      w: 999,
      h: 236,
      expanded: false
    })).toEqual({ w: 320, h: 236 });
    expect(normalizeAlignmentCardDimensions({
      w: 1,
      h: 236,
      expanded: true
    })).toEqual({ w: 360, h: 236 });

    const util = Object.create(
      AlignmentCardShapeUtil.prototype
    ) as AlignmentCardShapeUtil;
    expect(util.getDefaultProps()).toMatchObject({
      w: 320,
      cardKind: "question",
      expanded: false
    });
    expect(util.canResize(questionShape())).toBe(false);
  });

  test("renders the existing question card inside the projection container", () => {
    const html = renderToStaticMarkup(
      createElement(
        AlignmentCardProjectionProvider,
        {
          onSubmitAnswer: vi.fn(),
          onAppendAnnotationInformation: vi.fn(),
          onFocusCardSelection: vi.fn(),
          children: createElement(AlignmentCardShapeView, {
            shape: questionShape(),
            onExpandedChange: vi.fn(),
            onEditingChange: vi.fn()
          })
        }
      )
    );

    expect(html).toContain('data-testid="alignment-card-shape"');
    expect(html).toContain('data-runtime-record-id="question-1"');
    expect(html).toContain('data-stage="layout"');
    expect(html).toContain("Cards use a stable inset.");
    expect(html).toContain("Should the inset remain 20px?");
    expect(html).toContain('style="width:320px;height:236px');
  });
});
