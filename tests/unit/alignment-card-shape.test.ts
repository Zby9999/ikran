import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import {
  AlignmentCardProjectionProvider,
  AlignmentCardShapeUtil,
  AlignmentCardShapeView,
  activateAlignmentCardFocus,
  alignmentCardXForWidth,
  alignmentCardEditorUpdates,
  isAlignmentCanvasPointerDown,
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
      placement: "right",
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
      readOnly: false,
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
  test("does not focus or move the canvas for ordinary annotation-backed cards", () => {
    const onFocusCardSelection = vi.fn();

    activateAlignmentCardFocus(null, onFocusCardSelection);

    expect(onFocusCardSelection).not.toHaveBeenCalled();
  });

  test("keeps focus-mode activation for shared-element cards", () => {
    const onFocusCardSelection = vi.fn();
    const selection = {
      cardId: "question-1",
      targets: []
    };

    activateAlignmentCardFocus(selection, onFocusCardSelection);

    expect(onFocusCardSelection).toHaveBeenCalledOnce();
    expect(onFocusCardSelection).toHaveBeenCalledWith(selection);
  });

  test("keeps only one Question or Agent Annotation editor open", () => {
    const cards = [
      { id: "question-1", x: 100, w: 320, placement: "left" as const, cardKind: "question" as const, expanded: false, editing: false },
      { id: "question-2", x: 500, w: 360, placement: "right" as const, cardKind: "question" as const, expanded: true, editing: false },
      { id: "annotation-1", x: 60, w: 360, placement: "left" as const, cardKind: "agent-annotation" as const, expanded: false, editing: true },
      { id: "annotation-2", x: 500, w: 320, placement: "right" as const, cardKind: "agent-annotation" as const, expanded: false, editing: false }
    ];

    expect(alignmentCardEditorUpdates(cards, "question-1")).toEqual([
      { id: "question-1", x: 60, expanded: true, editing: false, w: 360 },
      { id: "question-2", x: 500, expanded: false, editing: false, w: 320 },
      { id: "annotation-1", x: 100, expanded: false, editing: false, w: 320 }
    ]);
    expect(alignmentCardEditorUpdates(cards, "annotation-2")).toEqual([
      { id: "question-2", x: 500, expanded: false, editing: false, w: 320 },
      { id: "annotation-1", x: 100, expanded: false, editing: false, w: 320 },
      { id: "annotation-2", x: 500, expanded: false, editing: true, w: 360 }
    ]);
    expect(alignmentCardEditorUpdates(cards, null)).toEqual([
      { id: "question-2", x: 500, expanded: false, editing: false, w: 320 },
      { id: "annotation-1", x: 100, expanded: false, editing: false, w: 320 }
    ]);
  });

  test("keeps the frame-facing edge fixed while a left card changes width", () => {
    expect(alignmentCardXForWidth(100, 320, 360, "left")).toBe(60);
    expect(alignmentCardXForWidth(60, 360, 320, "left")).toBe(100);
    expect(alignmentCardXForWidth(500, 320, 360, "right")).toBe(500);
  });

  test("dismisses only semantic tldraw canvas pointer-down events", () => {
    expect(isAlignmentCanvasPointerDown({
      type: "pointer",
      name: "pointer_down",
      target: "canvas"
    })).toBe(true);
    expect(isAlignmentCanvasPointerDown({
      type: "pointer",
      name: "pointer_down",
      target: "shape"
    })).toBe(false);
    expect(isAlignmentCanvasPointerDown({
      type: "pointer",
      name: "pointer_up",
      target: "canvas"
    })).toBe(false);
  });

  test("enforces the Figma collapsed and expanded widths", () => {
    expect(normalizeAlignmentCardDimensions({
      w: 999,
      h: 236,
      expanded: false,
      editing: false
    })).toEqual({ w: 320, h: 236 });
    expect(normalizeAlignmentCardDimensions({
      w: 1,
      h: 236,
      expanded: true,
      editing: false
    })).toEqual({ w: 360, h: 236 });
    expect(normalizeAlignmentCardDimensions({
      w: 320,
      h: 180,
      expanded: false,
      editing: true
    })).toEqual({ w: 360, h: 180 });

    const util = Object.create(
      AlignmentCardShapeUtil.prototype
    ) as AlignmentCardShapeUtil;
    expect(util.getDefaultProps()).toMatchObject({
      w: 320,
      placement: "right",
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
          onFocusCardPreviewEnd: vi.fn(),
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
    expect(html).toContain('data-evidence-version-id="version-1"');
    expect(html).toContain('data-stage="layout"');
    expect(html).toContain("Cards use a stable inset.");
    expect(html).toContain("Should the inset remain 20px?");
    expect(html).not.toContain("Figma node 44:120");
    expect(html).toContain(
      'style="width:320px;height:fit-content;top:50%;bottom:auto;transform:translateY(-50%);pointer-events:all'
    );
  });
});
