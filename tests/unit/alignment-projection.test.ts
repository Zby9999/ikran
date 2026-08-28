import { describe, expect, test } from "vitest";

import {
  AGENT_REGION_MARGIN
} from "../../lib/runtime/region-annotation-display";
import {
  ALIGNMENT_ANNOTATION_CARD_H,
  ALIGNMENT_CARD_STACK_GAP,
  ALIGNMENT_QUESTION_CARD_H,
  alignmentCardLaneFootprintHeight,
  buildAlignmentProjectionPlan,
  type AlignmentProjectionInput
} from "../../components/workbench/projection/alignment-projection";
import {
  alignmentCardShapeProps,
  collectMeasuredQuestionHeights,
  collectQuestionCardTopPositions,
  questionCardRuntimeIdsWithHeightChanges,
  shouldResyncAlignmentForQuestionHeightChanges
} from "../../components/workbench/projection/alignment-projection-sync";

const input: AlignmentProjectionInput = {
  currentStage: "layout",
  readOnly: false,
  seedFrames: [
    {
      id: "shape:seed-1",
      x: 100,
      y: 50,
      w: 380,
      h: 520,
      mediaX: 110,
      mediaY: 80,
      mediaW: 360,
      mediaH: 480,
      meta: {
        runtimeRecordId: "surface-1",
        seedRecordId: "seed-1",
        surfaceRecordId: "surface-1"
      }
    }
  ],
  questions: [
    {
      id: "question-layout",
      section: "layout",
      observation: "Cards use a stable inset.",
      question: "Should the inset remain 20px?",
      proposed_answer: "Yes.",
      answer_options: [
        { id: "yes", text: "Yes, keep the inset." },
        { id: "responsive", text: "Make it responsive." }
      ],
      final_answer: null,
      answer_source: null,
      selected_option_id: null,
      anchor: {
        kind: "single",
        target: {
          seedReferenceId: "seed-1",
          evidenceSurfaceId: "surface-1",
          evidenceVersionId: "version-1",
          nodeId: "44:120",
          resolvedRect: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 }
        }
      }
    },
    {
      id: "question-token",
      section: "token",
      observation: "Hidden in this stage.",
      question: "Which token?",
      proposed_answer: null,
      final_answer: null,
      answer_source: null,
      anchor: {
        kind: "single",
        target: {
          seedReferenceId: "seed-1",
          evidenceSurfaceId: "surface-1",
          evidenceVersionId: "version-1",
          rect: { x: 0, y: 0, w: 0.1, h: 0.1 }
        }
      }
    },
    {
      id: "question-focus",
      section: "layout",
      observation: "The pattern repeats.",
      question: "Should all instances match?",
      proposed_answer: null,
      final_answer: null,
      answer_source: null,
      anchor: {
        kind: "focus-target-set",
        targets: [
          {
            seedReferenceId: "seed-1",
            evidenceSurfaceId: "surface-1",
            evidenceVersionId: "version-1",
            nodeId: "44:120",
            rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 }
          },
          {
            seedReferenceId: "seed-1",
            evidenceSurfaceId: "surface-1",
            evidenceVersionId: "version-1",
            nodeId: "44:121",
            rect: { x: 0.5, y: 0.2, w: 0.3, h: 0.1 }
          }
        ]
      }
    }
  ],
  annotations: [
    {
      id: "annotation-1",
      section: "layout",
      title: "Root layout",
      body: "The page uses a stable outer inset.",
      additional_information: [],
      anchor: {
        kind: "single",
        target: {
          seedReferenceId: "seed-1",
          evidenceSurfaceId: "surface-1",
          evidenceVersionId: "version-1",
          rect: { x: 0.05, y: 0.05, w: 0.2, h: 0.1 }
        }
      }
    }
  ]
};

describe("buildAlignmentProjectionPlan", () => {
  test("shows current-section annotations before questions in all three anchor modes", () => {
    const annotationInput: AlignmentProjectionInput = {
      ...input,
      questions: [input.questions[0]!],
      annotations: [
        {
          ...input.annotations[0]!,
          id: "annotation-node",
          section: "layout",
          anchor: {
            kind: "single",
            target: {
              kind: "node",
              seedReferenceId: "seed-1",
              evidenceSurfaceId: "surface-1",
              evidenceVersionId: "version-1",
              nodeId: "44:120",
              resolvedRect: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 }
            }
          }
        },
        {
          ...input.annotations[0]!,
          id: "annotation-surface",
          section: "layout",
          anchor: {
            kind: "single",
            target: {
              kind: "surface",
              seedReferenceId: "seed-1",
              evidenceSurfaceId: "surface-1",
              evidenceVersionId: "version-1",
              resolvedRect: { x: 0, y: 0, w: 1, h: 1 }
            }
          }
        },
        {
          ...input.annotations[0]!,
          id: "annotation-focus",
          section: "layout",
          anchor: input.questions[2]!.anchor
        },
        {
          ...input.annotations[0]!,
          id: "annotation-other-section",
          section: "token"
        }
      ]
    };

    const plan = buildAlignmentProjectionPlan(annotationInput);
    const cards = plan.filter((shape) => shape.type === "alignment-card");

    expect(cards.map((card) => card.meta.runtimeRecordId)).toEqual([
      "annotation-node",
      "annotation-surface",
      "annotation-focus",
      "question-layout"
    ]);
    expect(
      plan.filter(
        (shape) =>
          shape.type === "alignment-target" &&
          shape.meta.runtimeRecordId === "annotation-node"
      )
    ).toHaveLength(1);
    expect(
      plan.filter(
        (shape) =>
          shape.type === "alignment-connector" &&
          shape.meta.runtimeRecordId === "annotation-node"
      )
    ).toHaveLength(1);
    expect(
      plan.some(
        (shape) =>
          shape.type !== "alignment-card" &&
          (shape.meta.runtimeRecordId === "annotation-surface" ||
            shape.meta.runtimeRecordId === "annotation-focus")
      )
    ).toBe(false);
    const focusCard = cards.find(
      (card) => card.meta.runtimeRecordId === "annotation-focus"
    );
    expect(focusCard?.props.focusSelection?.targets).toHaveLength(2);
  });

  test("projects current-stage cards beside their first target and preserves auditable linkage", () => {
    const plan = buildAlignmentProjectionPlan(input);
    const cards = plan.filter((shape) => shape.type === "alignment-card");
    const targets = plan.filter((shape) => shape.type === "alignment-target");
    const connectors = plan.filter(
      (shape) => shape.type === "alignment-connector"
    );

    expect(cards.map((shape) => shape.meta.runtimeRecordId)).toEqual([
      "annotation-1",
      "question-layout",
      "question-focus"
    ]);
    expect(cards.map((shape) => shape.props.number)).toEqual([1, 2, 3]);
    expect(cards.map((shape) => shape.x)).toEqual([-240, -280, 500]);
    expect(cards.map((shape) => shape.props.placement)).toEqual([
      "left",
      "left",
      "right"
    ]);
    expect(cards[1]!.y).toBeGreaterThan(cards[0]!.y);
    expect(cards.every((shape) => shape.isLocked)).toBe(true);
    expect(cards[1]!.meta).toMatchObject({
      runtimeRecordId: "question-layout",
      seedReferenceId: "seed-1",
      surfaceRecordId: "surface-1",
      evidenceVersionId: "version-1"
    });
    expect(cards[1]!.props.answerOptions).toEqual([
      { id: "yes", text: "Yes, keep the inset." },
      { id: "responsive", text: "Make it responsive." }
    ]);
    expect(cards[1]!.props.selectedOptionId).toBe("");

    expect(targets).toHaveLength(2);
    const verticalMargin =
      (AGENT_REGION_MARGIN * input.seedFrames[0]!.mediaW!) /
      input.seedFrames[0]!.mediaH!;
    expect(targets[1]!.x).toBeCloseTo(
      110 + (0.1 - AGENT_REGION_MARGIN) * 360,
      6
    );
    expect(targets[1]!.y).toBeCloseTo(
      80 + (0.2 - verticalMargin) * 480,
      6
    );
    expect(targets[1]!.props.w).toBeCloseTo(
      (0.3 + AGENT_REGION_MARGIN * 2) * 360,
      6
    );
    expect(targets[1]!.props.h).toBeCloseTo(
      (0.1 + verticalMargin * 2) * 480,
      6
    );
    expect(connectors).toHaveLength(2);
    expect(connectors[1]!.props.startX).toBeGreaterThan(
      connectors[1]!.props.endX
    );
    expect(connectors[1]!.props.startY).toBe(connectors[1]!.props.endY);
    expect(connectors[1]!.props.h).toBe(1);
    expect(cards[1]!.y + cards[1]!.props.h / 2).toBe(
      connectors[1]!.y + connectors[1]!.props.endY
    );
    expect(
      targets.some((shape) =>
        shape.meta.runtimeRecordId.includes("question-focus")
      )
    ).toBe(false);
    expect(
      connectors.some((shape) =>
        shape.meta.runtimeRecordId.includes("question-focus")
      )
    ).toBe(false);
    expect(
      plan.every(
        (shape) =>
          shape.isLocked &&
          shape.meta.canvasRecordId.length > 0 &&
          shape.meta.surface === "design-intent-alignment"
      )
    ).toBe(true);
  });

  test("exposes auditable focus selection without materializing target chrome", () => {
    const focusCard = buildAlignmentProjectionPlan(input).find(
      (shape) =>
        shape.type === "alignment-card" &&
        shape.meta.runtimeRecordId === "question-focus"
    );

    expect(focusCard?.type).toBe("alignment-card");
    if (focusCard?.type !== "alignment-card") return;
    const media = input.seedFrames[0]!;
    const padX = 2 / media.mediaW!;
    const padY = 2 / media.mediaH!;
    const selection = focusCard.props.focusSelection;
    expect(selection?.cardId).toBe("question-focus");
    expect(selection?.targets).toHaveLength(2);
    expect(selection?.targets[0]).toMatchObject({
      targetId: "question-focus:0",
      surfaceArtifactId: "surface-1",
      evidenceVersionId: "version-1"
    });
    expect(selection?.targets[0]!.rect.x).toBeCloseTo(0.1 - padX, 6);
    expect(selection?.targets[0]!.rect.y).toBeCloseTo(0.2 - padY, 6);
    expect(selection?.targets[0]!.rect.width).toBeCloseTo(0.3 + padX * 2, 6);
    expect(selection?.targets[0]!.rect.height).toBeCloseTo(0.1 + padY * 2, 6);
    expect(selection?.targets[1]!.rect.x).toBeCloseTo(0.5 - padX, 6);
    expect(selection?.targets[1]!.rect.width).toBeCloseTo(0.3 + padX * 2, 6);
  });

  test("does not materialize annotation chrome for a whole-frame question", () => {
    const surfaceInput: AlignmentProjectionInput = {
      ...input,
      questions: [
        {
          ...input.questions[0]!,
          id: "question-surface",
          anchor: {
            kind: "single",
            target: {
              kind: "surface",
              seedReferenceId: "seed-1",
              evidenceSurfaceId: "surface-1",
              evidenceVersionId: "version-1",
              resolvedRect: { x: 0, y: 0, w: 1, h: 1 }
            }
          }
        }
      ],
      annotations: []
    };
    const plan = buildAlignmentProjectionPlan(surfaceInput);

    expect(plan.filter((shape) => shape.type === "alignment-card")).toHaveLength(1);
    expect(plan.filter((shape) => shape.type === "alignment-target")).toHaveLength(0);
    expect(plan.filter((shape) => shape.type === "alignment-connector")).toHaveLength(0);
  });

  test("separates cards that resolve to the same anchor while keeping connectors horizontal", () => {
    const repeatedAnchorInput: AlignmentProjectionInput = {
      ...input,
      questions: [
        input.questions[0]!,
        {
          ...input.questions[0]!,
          id: "question-layout-repeated",
          question: "Should the repeated use follow the same rule?"
        }
      ],
      annotations: []
    };
    const plan = buildAlignmentProjectionPlan(repeatedAnchorInput);
    const cards = plan.filter((shape) => shape.type === "alignment-card");
    const connectors = plan.filter(
      (shape) => shape.type === "alignment-connector"
    );

    expect(cards).toHaveLength(2);
    expect(cards[1]!.y).toBeGreaterThanOrEqual(
      cards[0]!.y + cards[0]!.props.h + ALIGNMENT_CARD_STACK_GAP
    );
    expect(connectors).toHaveLength(2);
    expect(
      connectors.every(
        (connector) =>
          connector.props.startY === connector.props.endY &&
          connector.props.h === 1
      )
    ).toBe(true);
  });

  test("uses measured Question Card heights for stacking and connector centers", () => {
    const measuredInput: AlignmentProjectionInput = {
      ...input,
      questions: [
        input.questions[0]!,
        {
          ...input.questions[0]!,
          id: "question-layout-repeated",
          question: "Which of the many prepared choices should be used?"
        }
      ],
      annotations: [],
      measuredQuestionHeights: new Map([
        ["question-layout", 344],
        ["question-layout-repeated", 411]
      ])
    };
    const plan = buildAlignmentProjectionPlan(measuredInput);
    const cards = plan.filter((shape) => shape.type === "alignment-card");
    const connectors = plan.filter(
      (shape) => shape.type === "alignment-connector"
    );

    expect(cards.map((card) => card.props.w)).toEqual([360, 360]);
    expect(cards.map((card) => card.props.h)).toEqual([344, 411]);
    expect(cards[1]!.y).toBeGreaterThanOrEqual(
      cards[0]!.y + 344 + ALIGNMENT_CARD_STACK_GAP
    );
    expect(connectors).toHaveLength(2);
    for (let index = 0; index < cards.length; index += 1) {
      expect(cards[index]!.y + cards[index]!.props.h / 2).toBe(
        connectors[index]!.y + connectors[index]!.props.endY
      );
    }
  });

  test("keeps a Question Card top edge stable across open and collapse measurements", () => {
    const collapsed = buildAlignmentProjectionPlan({
      ...input,
      questions: [input.questions[0]!],
      annotations: [],
      measuredQuestionHeights: new Map([["question-layout", 152]])
    });
    const collapsedCard = collapsed.find(
      (shape) => shape.type === "alignment-card"
    );
    expect(collapsedCard?.type).toBe("alignment-card");
    if (collapsedCard?.type !== "alignment-card") return;

    const expanded = buildAlignmentProjectionPlan({
      ...input,
      questions: [input.questions[0]!],
      annotations: [],
      measuredQuestionHeights: new Map([["question-layout", 353]]),
      currentQuestionTopPositions: new Map([
        ["question-layout", collapsedCard.y]
      ])
    });
    const expandedCard = expanded.find(
      (shape) => shape.type === "alignment-card"
    );
    expect(expandedCard?.type).toBe("alignment-card");
    if (expandedCard?.type !== "alignment-card") return;

    expect(expandedCard.y).toBe(collapsedCard.y);
    expect(expandedCard.props.h).toBe(353);

    const collapsedAgain = buildAlignmentProjectionPlan({
      ...input,
      questions: [input.questions[0]!],
      annotations: [],
      measuredQuestionHeights: new Map([["question-layout", 152]]),
      currentQuestionTopPositions: new Map([
        ["question-layout", expandedCard.y]
      ])
    });
    const collapsedAgainCard = collapsedAgain.find(
      (shape) => shape.type === "alignment-card"
    );
    expect(collapsedAgainCard?.type).toBe("alignment-card");
    if (collapsedAgainCard?.type !== "alignment-card") return;
    expect(collapsedAgainCard.y).toBe(collapsedCard.y);
  });

  test("reflows later cards back to their baseline without ratcheting down", () => {
    const questions = [
      input.questions[0]!,
      {
        ...input.questions[0]!,
        id: "question-layout-repeated",
        question: "Should the repeated use follow the same rule?"
      }
    ];
    const cardShapes = (plan: ReturnType<typeof buildAlignmentProjectionPlan>) =>
      plan.filter((shape) => shape.type === "alignment-card");
    const baseline = cardShapes(buildAlignmentProjectionPlan({
      ...input,
      questions,
      annotations: [],
      measuredQuestionHeights: new Map([
        ["question-layout", 152],
        ["question-layout-repeated", 152]
      ])
    }));
    const grown = cardShapes(buildAlignmentProjectionPlan({
      ...input,
      questions,
      annotations: [],
      measuredQuestionHeights: new Map([
        ["question-layout", 500],
        ["question-layout-repeated", 152]
      ]),
      currentQuestionTopPositions: new Map([
        ["question-layout", baseline[0]!.y]
      ])
    }));
    const shrunk = cardShapes(buildAlignmentProjectionPlan({
      ...input,
      questions,
      annotations: [],
      measuredQuestionHeights: new Map([
        ["question-layout", 152],
        ["question-layout-repeated", 152]
      ]),
      currentQuestionTopPositions: new Map([
        ["question-layout", grown[0]!.y]
      ])
    }));
    const grownAgain = cardShapes(buildAlignmentProjectionPlan({
      ...input,
      questions,
      annotations: [],
      measuredQuestionHeights: new Map([
        ["question-layout", 500],
        ["question-layout-repeated", 152]
      ]),
      currentQuestionTopPositions: new Map([
        ["question-layout", shrunk[0]!.y]
      ])
    }));

    expect(grown[0]!.y).toBe(baseline[0]!.y);
    expect(grown[1]!.y).toBeGreaterThan(baseline[1]!.y);
    expect(shrunk.map((card) => card.y)).toEqual(
      baseline.map((card) => card.y)
    );
    expect(grownAgain.map((card) => card.y)).toEqual(
      grown.map((card) => card.y)
    );
  });

  test("keeps collapsed Question Cards from compressing the shared annotation lane", () => {
    const collapsedInput: AlignmentProjectionInput = {
      ...input,
      questions: [
        input.questions[0]!,
        {
          ...input.questions[0]!,
          id: "question-layout-repeated",
          question: "Should the repeated use follow the same rule?"
        }
      ],
      annotations: [],
      measuredQuestionHeights: new Map([
        ["question-layout", 152],
        ["question-layout-repeated", 173]
      ])
    };
    const plan = buildAlignmentProjectionPlan(collapsedInput);
    const cards = plan.filter((shape) => shape.type === "alignment-card");
    const connectors = plan.filter(
      (shape) => shape.type === "alignment-connector"
    );

    expect(cards.map((card) => card.props.h)).toEqual([152, 173]);
    expect(cards[1]!.y).toBeGreaterThanOrEqual(
      cards[0]!.y + ALIGNMENT_QUESTION_CARD_H + ALIGNMENT_CARD_STACK_GAP
    );
    expect(connectors[0]!.y + connectors[0]!.props.endY).toBe(
      cards[0]!.y + 152 / 2
    );
    expect(alignmentCardLaneFootprintHeight("question", 152)).toBe(
      ALIGNMENT_QUESTION_CARD_H
    );
    expect(alignmentCardLaneFootprintHeight("question", 344)).toBe(344);
    expect(alignmentCardLaneFootprintHeight("agent-annotation", 180)).toBe(180);
  });

  test("falls back from invalid measurements and never changes annotation height", () => {
    const invalidInput: AlignmentProjectionInput = {
      ...input,
      questions: [input.questions[0]!],
      measuredQuestionHeights: new Map([
        ["question-layout", Number.NaN],
        ["annotation-1", 999]
      ])
    };
    const cards = buildAlignmentProjectionPlan(invalidInput).filter(
      (shape) => shape.type === "alignment-card"
    );

    expect(cards.find((card) => card.meta.runtimeRecordId === "question-layout")?.props.h)
      .toBe(ALIGNMENT_QUESTION_CARD_H);
    expect(cards.find((card) => card.meta.runtimeRecordId === "annotation-1")?.props.h)
      .toBe(ALIGNMENT_ANNOTATION_CARD_H);
  });

  test("places cards on the annotation side and keeps left and right collision lanes independent", () => {
    const sidedInput: AlignmentProjectionInput = {
      ...input,
      questions: [
        input.questions[0]!,
        {
          ...input.questions[0]!,
          id: "question-right",
          anchor: {
            kind: "single",
            target: {
              seedReferenceId: "seed-1",
              evidenceSurfaceId: "surface-1",
              evidenceVersionId: "version-1",
              nodeId: "44:121",
              resolvedRect: { x: 0.7, y: 0.2, w: 0.2, h: 0.1 }
            }
          }
        }
      ],
      annotations: []
    };
    const plan = buildAlignmentProjectionPlan(sidedInput);
    const cards = plan.filter((shape) => shape.type === "alignment-card");
    const connectors = plan.filter(
      (shape) => shape.type === "alignment-connector"
    );

    expect(cards.map((card) => card.props.placement)).toEqual([
      "left",
      "right"
    ]);
    expect(cards[0]!.x).toBe(-280);
    expect(cards[1]!.x).toBe(500);
    expect(cards[0]!.y).toBe(cards[1]!.y);
    expect(connectors[0]!.props.startX).toBeGreaterThan(
      connectors[0]!.props.endX
    );
    expect(connectors[1]!.props.startX).toBeLessThan(
      connectors[1]!.props.endX
    );
  });

  test("serializes focus selection without leaking projection-only props into tldraw", () => {
    const focusCard = buildAlignmentProjectionPlan(input).find(
      (shape) =>
        shape.type === "alignment-card" &&
        shape.meta.runtimeRecordId === "question-focus"
    );

    expect(focusCard?.type).toBe("alignment-card");
    if (focusCard?.type !== "alignment-card") return;

    const props = alignmentCardShapeProps(focusCard.props);

    expect(props).not.toHaveProperty("focusSelection");
    expect(JSON.parse(props.focusSelectionJson)).toEqual(
      focusCard.props.focusSelection
    );
  });

  test("omits an empty focus selection from normal tldraw cards", () => {
    const normalCard = buildAlignmentProjectionPlan(input).find(
      (shape) =>
        shape.type === "alignment-card" &&
        shape.meta.runtimeRecordId === "question-layout"
    );

    expect(normalCard?.type).toBe("alignment-card");
    if (normalCard?.type !== "alignment-card") return;

    const props = alignmentCardShapeProps(normalCard.props);

    expect(props).not.toHaveProperty("focusSelection");
    expect(props).not.toHaveProperty("answerOptions");
    expect(JSON.parse(props.answerOptionsJson)).toEqual([
      { id: "yes", text: "Yes, keep the inset." },
      { id: "responsive", text: "Make it responsive." }
    ]);
    expect(props.focusSelectionJson).toBe("");
  });

  test("collects only finite positive measured Question Card heights", () => {
    const heights = collectMeasuredQuestionHeights([
      {
        type: "alignment-card",
        props: { cardKind: "question", h: 312 },
        meta: { runtimeRecordId: "question-1" }
      },
      {
        type: "alignment-card",
        props: { cardKind: "agent-annotation", h: 777 },
        meta: { runtimeRecordId: "annotation-1" }
      },
      {
        type: "alignment-card",
        props: { cardKind: "question", h: 0 },
        meta: { runtimeRecordId: "question-zero" }
      },
      { type: "geo", props: { h: 888 }, meta: { runtimeRecordId: "other" } }
    ]);

    expect([...heights]).toEqual([["question-1", 312]]);
  });

  test("collects only finite Question Card top positions", () => {
    const positions = collectQuestionCardTopPositions([
      {
        type: "alignment-card",
        y: 214,
        props: { cardKind: "question", h: 312 },
        meta: { runtimeRecordId: "question-1" }
      },
      {
        type: "alignment-card",
        y: 98,
        props: { cardKind: "agent-annotation", h: 180 },
        meta: { runtimeRecordId: "annotation-1" }
      },
      {
        type: "alignment-card",
        y: Number.NaN,
        props: { cardKind: "question", h: 312 },
        meta: { runtimeRecordId: "question-invalid" }
      }
    ], new Set(["question-1", "annotation-1", "question-invalid"]));

    expect([...positions]).toEqual([["question-1", 214]]);
  });

  test("resyncs only when a projected Question Card height changes", () => {
    const record = (
      runtimeRecordId: string,
      cardKind: "question" | "agent-annotation",
      h: number
    ) => ({
      type: "alignment-card",
      props: { cardKind, h },
      meta: { runtimeRecordId }
    });

    const changed = {
      added: {},
      removed: {},
      updated: {
        first: [record("question-1", "question", 236), record("question-1", "question", 312)] as const,
        second: [record("question-2", "question", 180), record("question-2", "question", 180)] as const,
        annotation: [record("annotation-1", "agent-annotation", 180), record("annotation-1", "agent-annotation", 220)] as const
      }
    };

    expect(
      shouldResyncAlignmentForQuestionHeightChanges(changed)
    ).toBe(true);
    expect([...questionCardRuntimeIdsWithHeightChanges(changed)]).toEqual([
      "question-1"
    ]);
    expect(
      shouldResyncAlignmentForQuestionHeightChanges({
        added: {},
        removed: {},
        updated: { card: [record("question-1", "question", 312), record("question-1", "question", 312)] }
      })
    ).toBe(false);
    expect(
      shouldResyncAlignmentForQuestionHeightChanges({
        added: {},
        removed: {},
        updated: {
          card: [record("annotation-1", "agent-annotation", 180), record("annotation-1", "agent-annotation", 220)]
        }
      })
    ).toBe(false);
  });
});
