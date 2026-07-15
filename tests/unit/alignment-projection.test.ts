import { describe, expect, test } from "vitest";

import {
  buildAlignmentProjectionPlan,
  type AlignmentProjectionInput
} from "../../components/workbench/projection/alignment-projection";

const input: AlignmentProjectionInput = {
  currentStage: "layout",
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
  test("projects current-stage cards beside their first target and preserves auditable linkage", () => {
    const plan = buildAlignmentProjectionPlan(input);
    const cards = plan.filter((shape) => shape.type === "alignment-card");
    const targets = plan.filter((shape) => shape.type === "alignment-target");
    const connectors = plan.filter(
      (shape) => shape.type === "alignment-connector"
    );

    expect(cards.map((shape) => shape.meta.runtimeRecordId)).toEqual([
      "question-layout",
      "question-focus",
      "annotation-1"
    ]);
    expect(cards.map((shape) => shape.props.number)).toEqual([1, 2, 3]);
    expect(cards.map((shape) => shape.x)).toEqual([500, 500, 500]);
    expect(cards[1]!.y).toBeGreaterThan(cards[0]!.y);
    expect(cards[2]!.y).toBeGreaterThan(cards[1]!.y);
    expect(cards.every((shape) => shape.isLocked)).toBe(true);
    expect(cards[0]!.meta).toMatchObject({
      runtimeRecordId: "question-layout",
      seedReferenceId: "seed-1",
      surfaceRecordId: "surface-1",
      evidenceVersionId: "version-1"
    });

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      x: 146,
      y: 176,
      props: { w: 108, h: 48 }
    });
    expect(connectors).toHaveLength(1);
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
});
