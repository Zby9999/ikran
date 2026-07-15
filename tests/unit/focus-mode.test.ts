import { expect, test } from "vitest";
import {
  FOCUS_MODE_IDLE,
  focusModeReducer,
  type FocusCardSelection
} from "../../components/workbench/focus-mode";
import { createFocusModeController } from "../../components/workbench/focus-mode-controller";

const firstCard: FocusCardSelection = {
  cardId: "question-1",
  targets: [
    {
      targetId: "target-1",
      surfaceArtifactId: "surface-1",
      evidenceVersionId: "evidence-v1",
      rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 }
    }
  ]
};

test("selecting a focus card enters focus and selecting it again keeps the current focus", () => {
  const active = focusModeReducer(FOCUS_MODE_IDLE, {
    type: "focus-card-selected",
    selection: firstCard
  });

  expect(active).toEqual({
    phase: "active",
    activeCardId: "question-1",
    targets: firstCard.targets
  });
  expect(
    focusModeReducer(active, {
      type: "focus-card-selected",
      selection: firstCard
    })
  ).toBe(active);
});

test("an exit request retains targets for fade-out, then transition completion clears focus", () => {
  const active = focusModeReducer(FOCUS_MODE_IDLE, {
    type: "focus-card-selected",
    selection: firstCard
  });

  const exiting = focusModeReducer(active, { type: "exit-requested" });
  expect(exiting).toEqual({ ...active, phase: "exiting" });
  expect(
    focusModeReducer(exiting, { type: "exit-transition-completed" })
  ).toBe(FOCUS_MODE_IDLE);
});

test("controller maps focus-card, blank-canvas, Escape, and fade completion to focus actions", () => {
  const actions: unknown[] = [];
  const controller = createFocusModeController((action) => actions.push(action));

  controller.selectFocusCard(firstCard);
  controller.canvasBlankSelected();
  expect(controller.keyDown({ key: "Enter" })).toBe(false);
  expect(controller.keyDown({ key: "Escape" })).toBe(true);
  controller.maskTransitionCompleted();

  expect(actions).toEqual([
    { type: "focus-card-selected", selection: firstCard },
    { type: "exit-requested" },
    { type: "exit-requested" },
    { type: "exit-transition-completed" }
  ]);
});

test("selecting another focus card switches the active target set", () => {
  const active = focusModeReducer(FOCUS_MODE_IDLE, {
    type: "focus-card-selected",
    selection: firstCard
  });
  const secondCard: FocusCardSelection = {
    cardId: "question-2",
    targets: [
      {
        targetId: "target-2",
        surfaceArtifactId: "surface-2",
        evidenceVersionId: "evidence-v3",
        rect: { x: 0.5, y: 0.1, width: 0.2, height: 0.2 }
      }
    ]
  };

  expect(
    focusModeReducer(active, {
      type: "focus-card-selected",
      selection: secondCard
    })
  ).toEqual({
    phase: "active",
    activeCardId: "question-2",
    targets: secondCard.targets
  });
});
