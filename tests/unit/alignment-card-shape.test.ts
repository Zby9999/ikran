import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import {
  ALIGNMENT_CARD_TYPE,
  AlignmentCardProjectionProvider,
  AlignmentCardShapeUtil,
  AlignmentCardShapeView,
  activateAlignmentCardFocus,
  alignmentCardXForWidth,
  alignmentCardEditorUpdates,
  isAlignmentCanvasPointerDown,
  normalizeAlignmentCardDimensions,
  scheduleAlignmentCardHeightUpdate,
  setOnlyOpenAlignmentCard,
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
      w: 360,
      h: 236,
      placement: "right",
      cardKind: "question",
      stage: "layout",
      number: 1,
      observation: "Cards use a stable inset.",
      question: "Should the inset remain 20px?",
      answerOptionsJson: JSON.stringify([
        { id: "keep", text: "Yes, keep the inset." },
        { id: "change", text: "Change the inset." }
      ]),
      proposedAnswer: "Yes.",
      finalAnswer: "",
      selectedOptionId: "",
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
  test("exits stale focus when an ordinary annotation-backed card activates", () => {
    const onFocusCardSelection = vi.fn();
    const onFocusCardExit = vi.fn();

    activateAlignmentCardFocus(
      null,
      onFocusCardSelection,
      onFocusCardExit
    );

    expect(onFocusCardSelection).not.toHaveBeenCalled();
    expect(onFocusCardExit).toHaveBeenCalledOnce();
  });

  test("keeps focus-mode activation for shared-element cards", () => {
    const onFocusCardSelection = vi.fn();
    const onFocusCardExit = vi.fn();
    const selection = {
      cardId: "question-1",
      targets: []
    };

    activateAlignmentCardFocus(
      selection,
      onFocusCardSelection,
      onFocusCardExit
    );

    expect(onFocusCardSelection).toHaveBeenCalledOnce();
    expect(onFocusCardSelection).toHaveBeenCalledWith(selection);
    expect(onFocusCardExit).not.toHaveBeenCalled();
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
      { id: "question-2", x: 500, expanded: false, editing: false, w: 360 },
      { id: "annotation-1", x: 100, expanded: false, editing: false, w: 320 }
    ]);
    expect(alignmentCardEditorUpdates(cards, "annotation-2")).toEqual([
      { id: "question-2", x: 500, expanded: false, editing: false, w: 360 },
      { id: "annotation-1", x: 100, expanded: false, editing: false, w: 320 },
      { id: "annotation-2", x: 500, expanded: false, editing: true, w: 360 }
    ]);
    expect(alignmentCardEditorUpdates(cards, null)).toEqual([
      { id: "question-2", x: 500, expanded: false, editing: false, w: 360 },
      { id: "annotation-1", x: 100, expanded: false, editing: false, w: 320 }
    ]);
  });

  test("batches sibling height measurements into one canvas transaction", () => {
    let flushGeometry: (() => void) | undefined;
    const scheduleGeometry = vi.fn((callback: () => void) => {
      flushGeometry = callback;
    });
    const updateShape = vi.fn();
    const shapes = new Map([
      ["shape:alignment-card:question-1", questionShape(false)],
      [
        "shape:alignment-card:question-2",
        {
          ...questionShape(false),
          id: "shape:alignment-card:question-2"
        }
      ]
    ]);
    const run = vi.fn((callback: () => void) => callback());
    const mergeRemoteChanges = vi.fn((callback: () => void) => callback());
    const editor = {
      getShape: (id: string) => shapes.get(id),
      updateShape,
      run,
      store: { mergeRemoteChanges }
    };

    scheduleAlignmentCardHeightUpdate(
      editor as never,
      "shape:alignment-card:question-1" as never,
      152,
      scheduleGeometry
    );
    scheduleAlignmentCardHeightUpdate(
      editor as never,
      "shape:alignment-card:question-2" as never,
      353,
      scheduleGeometry
    );

    expect(scheduleGeometry).toHaveBeenCalledOnce();
    expect(updateShape).not.toHaveBeenCalled();

    flushGeometry?.();

    expect(mergeRemoteChanges).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
    expect(updateShape).toHaveBeenCalledTimes(2);
    expect(updateShape.mock.calls.map(([update]) => update.props.h)).toEqual([
      152,
      353
    ]);
  });

  test("raises the open dialog above overlapping sibling cards", () => {
    const bringToFront = vi.fn();
    const updateShape = vi.fn();
    const editor = {
      getCurrentPageShapes: () => [
        {
          id: "shape:q1",
          type: ALIGNMENT_CARD_TYPE,
          x: 500,
          props: {
            w: 320,
            placement: "right",
            cardKind: "question",
            expanded: false,
            editing: false
          }
        },
        {
          id: "shape:q2",
          type: ALIGNMENT_CARD_TYPE,
          x: 500,
          props: {
            w: 320,
            placement: "right",
            cardKind: "question",
            expanded: false,
            editing: false
          }
        }
      ],
      run: (fn: () => void) => fn(),
      updateShape,
      bringToFront
    };

    setOnlyOpenAlignmentCard(editor as never, "shape:q1");
    expect(bringToFront).toHaveBeenCalledWith(["shape:q1"]);

    bringToFront.mockClear();
    editor.getCurrentPageShapes = () => [
      {
        id: "shape:q1",
        type: ALIGNMENT_CARD_TYPE,
        x: 500,
        props: {
          w: 360,
          placement: "right",
          cardKind: "question",
          expanded: true,
          editing: false
        }
      }
    ];
    setOnlyOpenAlignmentCard(editor as never, "shape:q1");
    expect(bringToFront).toHaveBeenCalledWith(["shape:q1"]);

    bringToFront.mockClear();
    setOnlyOpenAlignmentCard(editor as never, null);
    expect(bringToFront).not.toHaveBeenCalled();

    editor.getCurrentPageShapes = () => [
      {
        id: "shape:a1",
        type: ALIGNMENT_CARD_TYPE,
        x: 500,
        props: {
          w: 320,
          placement: "right",
          cardKind: "agent-annotation",
          expanded: false,
          editing: false
        }
      }
    ];
    setOnlyOpenAlignmentCard(editor as never, "shape:a1");
    expect(bringToFront).toHaveBeenCalledWith(["shape:a1"]);
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

  test("keeps Question Cards at 360px while preserving annotation browse/edit widths", () => {
    expect(normalizeAlignmentCardDimensions({
      w: 999,
      h: 236,
      cardKind: "question",
      expanded: false,
      editing: false
    })).toEqual({ w: 360, h: 236 });
    expect(normalizeAlignmentCardDimensions({
      w: 1,
      h: 236,
      cardKind: "question",
      expanded: true,
      editing: false
    })).toEqual({ w: 360, h: 236 });
    expect(normalizeAlignmentCardDimensions({
      w: 320,
      h: 180,
      cardKind: "agent-annotation",
      expanded: false,
      editing: true
    })).toEqual({ w: 360, h: 180 });
    expect(normalizeAlignmentCardDimensions({
      w: 360,
      h: 180,
      cardKind: "agent-annotation",
      expanded: false,
      editing: false
    })).toEqual({ w: 320, h: 180 });

    const util = Object.create(
      AlignmentCardShapeUtil.prototype
    ) as AlignmentCardShapeUtil;
    expect(util.getDefaultProps()).toMatchObject({
      w: 360,
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
      'style="width:360px;height:fit-content;bottom:auto;pointer-events:all'
    );
    expect(html).not.toContain("translateY");
  });
});
