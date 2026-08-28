import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  claimAlignmentPreparationCommand
} from "../../lib/runtime/alignment-agent-command";
import {
  initializeAlignmentSemanticStateOnDb,
  readAlignmentSemanticDelta,
  readIncrementalPlanningStatus,
  recordIncrementalDesignSystemPlan
} from "../../lib/runtime/alignment-incremental-planning";
import { prepareDesignIntentAlignment } from "../../lib/runtime/alignment-preparation";
import {
  createAgentAnnotation,
  createQuestionCard,
  getDesignIntentAlignment,
  recordDesignerAnswer
} from "../../lib/runtime/design-intent-alignment";
import {
  closeProjectDb,
  initializeProjectDb,
  openProjectDb
} from "../../lib/runtime/db";
import { recordEvidencePackage } from "../../lib/runtime/evidence-package";
import { listEvents } from "../../lib/runtime/events";
import { setDesignLanguageDescription } from "../../lib/runtime/project-readiness";
import { registerSeedReference } from "../../lib/runtime/seed-reference";
import {
  createAlignmentQuestionCardInputSchema,
  recordDesignerAnswerInputSchema
} from "../../lib/runtime/commands";

const temporaryProjects: string[] = [];

afterEach(() => {
  while (temporaryProjects.length > 0) {
    rmSync(temporaryProjects.pop()!, { recursive: true, force: true });
  }
});

function preparedProject() {
  const projectPath = mkdtempSync(
    path.join(tmpdir(), "ikran-answer-options-")
  );
  temporaryProjects.push(projectPath);
  initializeProjectDb(projectPath);
  const seed = registerSeedReference(projectPath, {
    figmaSeedReference:
      "https://www.figma.com/design/AbCdEf/Checkout?node-id=1:2",
    originalDesignIntent: "Answer option fixture"
  });
  if (!seed.ok) throw new Error(seed.reason);
  const evidence = recordEvidencePackage(projectPath, {
    seedReferenceId: seed.record.id,
    frame: {
      nodeId: "1:2",
      name: "Checkout",
      bounds: { x: 0, y: 0, width: 400, height: 800 }
    },
    evidenceViews: { rawData: "available", screenshot: "missing" }
  });
  if (!evidence.ok) throw new Error(evidence.reason);
  expect(
    setDesignLanguageDescription(projectPath, "A calm product language").ok
  ).toBe(true);
  const prepared = prepareDesignIntentAlignment(projectPath);
  if (!prepared.ok) throw new Error(prepared.reason);
  const claimed = claimAlignmentPreparationCommand(projectPath);
  if (!claimed.ok) throw new Error(claimed.reason);
  const anchor = {
    kind: "single" as const,
    target: {
      kind: "surface" as const,
      seedReferenceId: seed.record.id,
      evidenceSurfaceId: evidence.record.id,
      evidenceVersionId: evidence.record.id
    }
  };
  const annotation = createAgentAnnotation(projectPath, {
    alignmentAttemptId: prepared.attempt.id,
    idempotencyKey: "layout-hypothesis",
    section: "layout",
    inference: "reasonable",
    title: "Flexible Layout",
    body: "The layout appears intentionally flexible.",
    anchor
  });
  if (!annotation.ok) throw new Error(annotation.reason);
  return {
    projectPath,
    attemptId: prepared.attempt.id,
    anchor
  };
}

function createOptionCard(
  fixture: ReturnType<typeof preparedProject>,
  idempotencyKey = "layout-question",
  answerOptions: unknown = ["Keep the current grid", "Use a denser grid"]
) {
  return createQuestionCard(fixture.projectPath, {
    alignmentAttemptId: fixture.attemptId,
    idempotencyKey,
    section: "layout",
    observation: "Flexible Grid",
    question: "How should the grid adapt?",
    answerOptions,
    anchor: fixture.anchor
  });
}

function enterAnswering(fixture: ReturnType<typeof preparedProject>): void {
  const db = openProjectDb(fixture.projectPath);
  try {
    const now = new Date().toISOString();
    db.prepare(
      "UPDATE alignment_attempts SET status = 'answering', updated_at = ? WHERE id = ?"
    ).run(now, fixture.attemptId);
    db.prepare(
      "UPDATE project_workflow SET stage = 'alignment-answering', updated_at = ? WHERE singleton = 1"
    ).run(now);
    initializeAlignmentSemanticStateOnDb(db, fixture.attemptId, now);
  } finally {
    closeProjectDb(db);
  }
}

describe("Alignment answer-option Runtime contract", () => {
  test("MCP schemas require variable answer options and explicit answer intent", () => {
    expect(
      createAlignmentQuestionCardInputSchema.safeParse({
        alignmentAttemptId: "attempt-1",
        idempotencyKey: "question-1",
        section: "layout",
        observation: "Flexible Grid",
        question: "How should the grid adapt?",
        anchor: {
          kind: "single",
          target: {
            kind: "surface",
            seedReferenceId: "seed-1",
            evidenceSurfaceId: "surface-1",
            evidenceVersionId: "surface-1"
          }
        }
      }).success
    ).toBe(false);
    expect(
      createAlignmentQuestionCardInputSchema.safeParse({
        alignmentAttemptId: "attempt-1",
        idempotencyKey: "question-1",
        section: "layout",
        observation: "Flexible Grid",
        question: "How should the grid adapt?",
        answerOptions: ["Keep it", "Change it", "Make it responsive"],
        anchor: {
          kind: "single",
          target: {
            kind: "surface",
            seedReferenceId: "seed-1",
            evidenceSurfaceId: "surface-1",
            evidenceVersionId: "surface-1"
          }
        }
      }).success
    ).toBe(true);
    expect(recordDesignerAnswerInputSchema.safeParse({
      questionCardId: "question-1",
      answer: { kind: "option", optionId: "question-1:option:1" }
    }).success).toBe(true);
    expect(recordDesignerAnswerInputSchema.safeParse({
      questionCardId: "question-1",
      answer: { kind: "custom", text: "A custom answer" }
    }).success).toBe(true);
    expect(recordDesignerAnswerInputSchema.safeParse({
      questionCardId: "question-1"
    }).success).toBe(false);
    expect(recordDesignerAnswerInputSchema.safeParse({
      questionCardId: "question-1",
      answer: { kind: "custom", text: "A custom answer" },
      finalAnswer: "Legacy answer"
    }).success).toBe(false);
  });

  test("persists trimmed ordered choices with stable card-scoped identities", () => {
    const fixture = preparedProject();
    const created = createOptionCard(fixture, "three-options", [
      "  Keep the current grid  ",
      "Use a denser grid",
      "Switch by breakpoint"
    ]);
    expect(created).toMatchObject({
      ok: true,
      record: {
        proposed_answer: null,
        answer_options: [
          { text: "Keep the current grid" },
          { text: "Use a denser grid" },
          { text: "Switch by breakpoint" }
        ],
        selected_option_id: null
      }
    });
    if (!created.ok) return;
    const createdOptions = created.record.answer_options;
    if (!createdOptions) throw new Error("missing answer options");
    expect(createdOptions.map((option) => option.id)).toEqual([
      `${created.record.id}:option:1`,
      `${created.record.id}:option:2`,
      `${created.record.id}:option:3`
    ]);
    expect(createOptionCard(fixture, "three-options", [
      "ignored on idempotent retry",
      "also ignored"
    ])).toMatchObject({
      ok: true,
      reused: true,
      record: { answer_options: created.record.answer_options }
    });
    expect(getDesignIntentAlignment(fixture.projectPath).question_cards[0])
      .toMatchObject({ answer_options: created.record.answer_options });
  });

  test.each([
    [[], "empty"],
    [["Only one"], "fewer than two"],
    [["Valid", "   "], "blank"],
    [["Same", " Same "], "duplicate"]
  ])("rejects invalid answer choices: %s (%s)", (answerOptions) => {
    const fixture = preparedProject();
    expect(createOptionCard(fixture, `invalid-${String(answerOptions)}`, answerOptions))
      .toEqual({ ok: false, reason: "invalid_answer_options" });
  });

  test("rejects newly prepared Runtime cards that omit answer choices", () => {
    const fixture = preparedProject();

    expect(createQuestionCard(fixture.projectPath, {
      alignmentAttemptId: fixture.attemptId,
      idempotencyKey: "missing-options",
      section: "layout",
      observation: "Flexible Grid",
      question: "How should the grid adapt?",
      proposedAnswer: "Keep the old singular proposal",
      anchor: fixture.anchor
    })).toEqual({ ok: false, reason: "invalid_answer_options" });
  });

  test("derives canonical choice/custom answers and advances one semantic revision per change", () => {
    const fixture = preparedProject();
    const first = createOptionCard(fixture, "first-card", [
      "Keep the current grid",
      "Use a denser grid",
      "Switch by breakpoint"
    ]);
    const second = createOptionCard(fixture, "second-card", [
      "Preserve spacing",
      "Compress spacing"
    ]);
    if (!first.ok || !second.ok) throw new Error("fixture card failed");
    const firstOptions = first.record.answer_options;
    if (!firstOptions) throw new Error("missing first-card options");
    enterAnswering(fixture);

    expect(recordDesignerAnswer(fixture.projectPath, {
      questionCardId: second.record.id,
      answer: {
        kind: "option",
        optionId: firstOptions[0].id
      }
    })).toEqual({ ok: false, reason: "invalid_answer_option" });

    const laterChoice = firstOptions[2];
    const accepted = recordDesignerAnswer(fixture.projectPath, {
      questionCardId: first.record.id,
      answer: { kind: "option", optionId: laterChoice.id }
    });
    expect(accepted).toMatchObject({
      ok: true,
      record: {
        final_answer: laterChoice.text,
        answer_source: "agent-proposed-designer-accepted",
        selected_option_id: laterChoice.id
      }
    });

    const custom = recordDesignerAnswer(fixture.projectPath, {
      questionCardId: first.record.id,
      answer: { kind: "custom", text: `  ${laterChoice.text}  ` }
    });
    expect(custom).toMatchObject({
      ok: true,
      record: {
        final_answer: laterChoice.text,
        answer_source: "designer-edited",
        selected_option_id: null
      }
    });

    const firstChoice = firstOptions[0];
    const revised = recordDesignerAnswer(fixture.projectPath, {
      questionCardId: first.record.id,
      answer: { kind: "option", optionId: firstChoice.id }
    });
    expect(revised).toMatchObject({
      ok: true,
      record: {
        final_answer: firstChoice.text,
        answer_source: "agent-proposed-designer-accepted",
        selected_option_id: firstChoice.id
      }
    });

    const db = openProjectDb(fixture.projectPath);
    try {
      expect(db.prepare(
        "SELECT current_revision FROM alignment_semantic_state WHERE alignment_attempt_id = ?"
      ).get(fixture.attemptId)).toEqual({ current_revision: 4 });
      expect(db.prepare(
        "SELECT COUNT(*) AS count FROM alignment_semantic_changes WHERE alignment_attempt_id = ? AND source_kind = 'question' AND source_id = ?"
      ).get(fixture.attemptId, first.record.id)).toEqual({ count: 3 });
    } finally {
      closeProjectDb(db);
    }

    expect(
      listEvents(fixture.projectPath, "designer_answer_submitted").map(
        (event) => ({
          question_card_id: event.payload.question_card_id,
          final_answer: event.payload.final_answer,
          answer_source: event.payload.answer_source,
          answer_kind: event.payload.answer_kind,
          selected_option_id: event.payload.selected_option_id
        })
      )
    ).toEqual([
      {
        question_card_id: first.record.id,
        final_answer: laterChoice.text,
        answer_source: "agent-proposed-designer-accepted",
        answer_kind: "option",
        selected_option_id: laterChoice.id
      },
      {
        question_card_id: first.record.id,
        final_answer: laterChoice.text,
        answer_source: "designer-edited",
        answer_kind: "custom",
        selected_option_id: null
      },
      {
        question_card_id: first.record.id,
        final_answer: firstChoice.text,
        answer_source: "agent-proposed-designer-accepted",
        answer_kind: "option",
        selected_option_id: firstChoice.id
      }
    ]);
  });

  test("allows legacy finalAnswer only for cards without answer options", () => {
    const fixture = preparedProject();
    const legacyId = "persisted-legacy-card";
    const now = new Date().toISOString();
    const db = openProjectDb(fixture.projectPath);
    try {
      db.prepare(
        `INSERT INTO alignment_question_cards
         (id, section, observation, question, proposed_answer, final_answer,
          answer_source, anchor_json, created_at, updated_at,
          alignment_attempt_id, agent_idempotency_key, answer_options_json,
          selected_option_id)
         VALUES (?, 'layout', ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, NULL, NULL)`
      ).run(
        legacyId,
        "Legacy Answer",
        "Should the legacy answer remain available?",
        "Keep the legacy answer",
        JSON.stringify(fixture.anchor),
        now,
        now,
        fixture.attemptId,
        "legacy-card"
      );
    } finally {
      closeProjectDb(db);
    }
    const legacy = getDesignIntentAlignment(fixture.projectPath)
      .question_cards.find((card) => card.id === legacyId);
    const modern = createOptionCard(fixture, "modern-card");
    if (!legacy || !modern.ok) throw new Error("fixture card failed");
    expect(legacy.answer_options).toBeNull();
    enterAnswering(fixture);
    expect(recordDesignerAnswer(fixture.projectPath, {
      questionCardId: legacy.id,
      finalAnswer: "Keep the legacy answer"
    })).toMatchObject({
      ok: true,
      record: {
        answer_source: "agent-proposed-designer-accepted",
        selected_option_id: null
      }
    });
    expect(recordDesignerAnswer(fixture.projectPath, {
      questionCardId: modern.record.id,
      finalAnswer: "Keep the current grid"
    })).toEqual({ ok: false, reason: "legacy_final_answer_not_allowed" });
    expect(
      listEvents(fixture.projectPath, "designer_answer_submitted").map(
        (event) => event.payload
      )
    ).toEqual([
      expect.objectContaining({
        question_card_id: legacy.id,
        final_answer: "Keep the legacy answer",
        answer_kind: "legacy",
        answer_source: "agent-proposed-designer-accepted",
        selected_option_id: null
      })
    ]);
  });

  test("invalidates only dependent incremental decisions across every revision direction", () => {
    const fixture = preparedProject();
    const first = createOptionCard(fixture, "dependent-card", [
      "Keep the current grid",
      "Use a denser grid"
    ]);
    const second = createOptionCard(fixture, "independent-card", [
      "Preserve spacing",
      "Compress spacing"
    ]);
    if (!first.ok || !second.ok) throw new Error("fixture card failed");
    const firstOptions = first.record.answer_options;
    const secondOptions = second.record.answer_options;
    if (!firstOptions || !secondOptions) throw new Error("missing options");
    enterAnswering(fixture);

    expect(recordDesignerAnswer(fixture.projectPath, {
      questionCardId: first.record.id,
      answer: { kind: "option", optionId: firstOptions[0]!.id }
    }).ok).toBe(true);
    expect(recordDesignerAnswer(fixture.projectPath, {
      questionCardId: second.record.id,
      answer: { kind: "option", optionId: secondOptions[0]!.id }
    }).ok).toBe(true);

    let planVersion = 0;
    const recordCurrentPlan = (idempotencyKey: string) => {
      const delta = readAlignmentSemanticDelta(fixture.projectPath, {
        alignmentAttemptId: fixture.attemptId,
        afterRevision: 0
      });
      if (!delta.ok || !delta.delta) throw new Error("missing layout delta");
      const firstSource = delta.delta.sources.find(
        (source) => source.sourceId === first.record.id
      );
      const secondSource = delta.delta.sources.find(
        (source) => source.sourceId === second.record.id
      );
      if (!firstSource || !secondSource) throw new Error("missing sources");
      const recorded = recordIncrementalDesignSystemPlan(fixture.projectPath, {
        alignmentAttemptId: fixture.attemptId,
        idempotencyKey,
        basePlanVersion: planVersion,
        baseRevision: delta.currentRevision,
        section: delta.delta.section,
        sectionDigest: delta.delta.sectionDigest,
        decisions: [
          {
            decisionId: "dependent-decision",
            outputConcern: "layout",
            statement: "Follow the first grid answer.",
            sourceRefs: [{
              sourceId: firstSource.sourceId,
              digest: firstSource.digest
            }]
          },
          {
            decisionId: "independent-decision",
            outputConcern: "layout",
            statement: "Follow the independent spacing answer.",
            sourceRefs: [{
              sourceId: secondSource.sourceId,
              digest: secondSource.digest
            }]
          }
        ],
        draftBindings: [],
        designSystemDraft: { name: "Answer option invalidation fixture" }
      });
      if (!recorded.ok) throw new Error(recorded.reason);
      planVersion = recorded.planVersion;
    };
    const expectOnlyDependentStale = () => {
      expect(readIncrementalPlanningStatus(
        fixture.projectPath,
        fixture.attemptId
      )).toMatchObject({
        ok: true,
        staleDecisionIds: ["dependent-decision"],
        validDecisionIds: ["independent-decision"]
      });
    };

    recordCurrentPlan("initial-option-plan");
    expect(recordDesignerAnswer(fixture.projectPath, {
      questionCardId: first.record.id,
      answer: { kind: "option", optionId: firstOptions[1]!.id }
    }).ok).toBe(true);
    expectOnlyDependentStale();

    recordCurrentPlan("choice-to-choice-plan");
    expect(recordDesignerAnswer(fixture.projectPath, {
      questionCardId: first.record.id,
      answer: { kind: "custom", text: firstOptions[1]!.text }
    }).ok).toBe(true);
    expectOnlyDependentStale();

    recordCurrentPlan("choice-to-custom-plan");
    expect(recordDesignerAnswer(fixture.projectPath, {
      questionCardId: first.record.id,
      answer: { kind: "option", optionId: firstOptions[1]!.id }
    }).ok).toBe(true);
    expectOnlyDependentStale();
  });
});
