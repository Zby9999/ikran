import { describe, expect, test } from "vitest";

import {
  AGENT_REGION_MARGIN
} from "../../lib/runtime/region-annotation-display";
import {
  ALIGNMENT_CARD_STACK_GAP,
  buildAlignmentProjectionPlan,
  type AlignmentProjectionInput
} from "../../components/workbench/projection/alignment-projection";
import { alignmentCardShapeProps } from "../../components/workbench/projection/alignment-projection-sync";

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
      final_answer: null,
      answer_source: null,
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
    expect(cards.map((shape) => shape.x)).toEqual([-240, -240, 500]);
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
    expect(focusCard.props.focusSelection).toEqual({
      cardId: "question-focus",
      targets: [
        {
          targetId: "question-focus:0",
          surfaceArtifactId: "surface-1",
          evidenceVersionId: "version-1",
          rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 }
        },
        {
          targetId: "question-focus:1",
          surfaceArtifactId: "surface-1",
          evidenceVersionId: "version-1",
          rect: { x: 0.5, y: 0.2, width: 0.3, height: 0.1 }
        }
      ]
    });
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
    expect(cards[0]!.x).toBe(-240);
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
    expect(props.focusSelectionJson).toBe("");
  });
});
