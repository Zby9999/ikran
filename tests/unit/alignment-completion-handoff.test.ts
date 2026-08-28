import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import {
  claimAlignmentPreparationCommand,
  finalizeAlignmentPreparation
} from "../../lib/runtime/alignment-agent-command";
import { abandonCurrentAlignmentAttempt } from "../../lib/runtime/alignment-attempt-lifecycle";
import { waitForAgentCommand } from "../../lib/runtime/adaptive-agent-wait";
import { prepareDesignIntentAlignment } from "../../lib/runtime/alignment-preparation";
import {
  closeProjectDb,
  initializeProjectDb,
  openProjectDb
} from "../../lib/runtime/db";
import {
  ALIGNMENT_SECTIONS,
  completeDesignIntentAlignment,
  createAgentAnnotation,
  createQuestionCard,
  getDesignIntentAlignment,
  recordDesignerAnswer,
  updateQuestionCardTitle
} from "../../lib/runtime/design-intent-alignment";
import { recordEvidencePackage } from "../../lib/runtime/evidence-package";
import { listEvents } from "../../lib/runtime/events";
import { setDesignLanguageDescription } from "../../lib/runtime/project-readiness";
import { registerSeedReference } from "../../lib/runtime/seed-reference";
import { readAlignmentSemanticDelta } from "../../lib/runtime/alignment-incremental-planning";
import {
  createRegionAnnotation,
  deleteRegionAnnotation,
  updateRegionAnnotationBody
} from "../../lib/runtime/region-annotation";

type Fixture = {
  projectPath: string;
  attemptId: string;
  snapshotId: string;
  evidenceVersionId: string;
  questionIds: string[];
};

function createAnsweringFixture(finalize = true): Fixture {
  const projectPath = mkdtempSync(path.join(tmpdir(), "ikran-complete-"));
  initializeProjectDb(projectPath);
  const seed = registerSeedReference(projectPath, {
    figmaSeedReference:
      "https://www.figma.com/design/Complete/Mock?node-id=1:2",
    originalDesignIntent: "Completion fixture"
  });
  if (!seed.ok) throw new Error(seed.reason);
  const evidence = recordEvidencePackage(projectPath, {
    seedReferenceId: seed.record.id,
    frame: { nodeId: "1:2", name: "Mock" },
    evidenceViews: { rawData: "available", screenshot: "missing" }
  });
  if (!evidence.ok) throw new Error(evidence.reason);
  setDesignLanguageDescription(projectPath, "Completion handoff contract");
  const prepared = prepareDesignIntentAlignment(projectPath);
  if (!prepared.ok) throw new Error(prepared.reason);
  const claimed = claimAlignmentPreparationCommand(projectPath);
  if (!claimed.ok) throw new Error(claimed.reason);

  const questionIds: string[] = [];
  const acceptedOptionIds: string[] = [];
  for (const section of ALIGNMENT_SECTIONS) {
    const annotation = createAgentAnnotation(projectPath, {
      alignmentAttemptId: prepared.attempt.id,
      idempotencyKey: `completion-assumption-${section}`,
      section,
      inference: "reasonable",
      title: "Completion Assumption",
      body: `The current ${section} choices appear deliberate.`,
      anchor: {
        kind: "single",
        target: {
          kind: "surface",
          seedReferenceId: seed.record.id,
          evidenceSurfaceId: evidence.record.id,
          evidenceVersionId: evidence.record.id
        }
      }
    });
    if (!annotation.ok) throw new Error(annotation.reason);
    for (let index = 1; index <= 2; index += 1) {
      const proposedAnswer = `Proposal ${index} for ${section}`;
      const created = createQuestionCard(projectPath, {
        alignmentAttemptId: prepared.attempt.id,
        idempotencyKey: `${section}-${index}`,
        section,
        observation: `${section} ${index}`,
        question: `Question ${index} for ${section}?`,
        answerOptions: [
          proposedAnswer,
          `Alternative ${index} for ${section}`
        ],
        anchor: {
          kind: "single",
          target: {
            kind: "surface",
            seedReferenceId: seed.record.id,
            evidenceSurfaceId: evidence.record.id,
            evidenceVersionId: evidence.record.id
          }
        }
      });
      if (!created.ok) throw new Error(created.reason);
      const acceptedOptionId = created.record.answer_options?.[0]?.id;
      if (!acceptedOptionId) throw new Error("missing first answer option");
      questionIds.push(created.record.id);
      acceptedOptionIds.push(acceptedOptionId);
    }
  }
  if (finalize) {
    const finalized = finalizeAlignmentPreparation(
      projectPath,
      prepared.attempt.id
    );
    if (!finalized.ok) throw new Error(finalized.reason);
    questionIds.forEach((questionCardId, index) => {
      const confirmed = recordDesignerAnswer(projectPath, {
        questionCardId,
        answer: { kind: "option", optionId: acceptedOptionIds[index]! }
      });
      if (!confirmed.ok) throw new Error(confirmed.reason);
    });
  }
  return {
    projectPath,
    attemptId: prepared.attempt.id,
    snapshotId: prepared.input_snapshot.id,
    evidenceVersionId: evidence.record.id,
    questionIds
  };
}

function removeFixture(fixture: Fixture): void {
  rmSync(fixture.projectPath, { recursive: true, force: true });
}

describe("Alignment completion handoff", () => {
  test("rejects preparing and abandoned attempts without creating handoff state", () => {
    const fixture = createAnsweringFixture(false);
    try {
      expect(completeDesignIntentAlignment(fixture.projectPath)).toEqual({
        ok: false,
        reason: "alignment_not_answering"
      });
      expect(abandonCurrentAlignmentAttempt(fixture.projectPath).ok).toBe(true);
      expect(completeDesignIntentAlignment(fixture.projectPath)).toEqual({
        ok: false,
        reason: "alignment_not_answering"
      });
      const read = getDesignIntentAlignment(fixture.projectPath);
      expect(read.alignment.status).toBe("draft");
      expect(read.preparation.workflow.stage).toBe("seed-reference-registration");
      expect(read.preparation.commands).toEqual([]);
    } finally {
      removeFixture(fixture);
    }
  });

  test("rejects an answering attempt with a missing answer without partial writes", () => {
    const fixture = createAnsweringFixture();
    try {
      const db = openProjectDb(fixture.projectPath);
      try {
        db.prepare(
          `UPDATE alignment_question_cards
           SET final_answer = NULL, answer_source = NULL
           WHERE id = ?`
        ).run(fixture.questionIds[0]);
      } finally {
        closeProjectDb(db);
      }
      expect(completeDesignIntentAlignment(fixture.projectPath)).toEqual({
        ok: false,
        reason: "coverage_incomplete"
      });
      const read = getDesignIntentAlignment(fixture.projectPath);
      expect(read.alignment.status).toBe("draft");
      expect(read.preparation.workflow.stage).toBe("alignment-answering");
      expect(read.preparation.current_attempt?.status).toBe("answering");
      expect(read.preparation.commands).toHaveLength(1);
    } finally {
      removeFixture(fixture);
    }
  });

  test("atomically freezes the attempt, advances workflow, and creates one pending next command", async () => {
    const fixture = createAnsweringFixture();
    try {
      const designerAnnotation = createRegionAnnotation(fixture.projectPath, {
        target: {
          kind: "figma-surface",
          evidenceVersionId: fixture.evidenceVersionId
        },
        author: "designer",
        body: "Keep this Alignment input immutable.",
        section: "design-concept"
      });
      if (!designerAnnotation.ok) throw new Error(designerAnnotation.reason);
      expect(
        recordDesignerAnswer(fixture.projectPath, {
          questionCardId: fixture.questionIds[0],
          answer: { kind: "custom", text: "Designer final" }
        }).ok
      ).toBe(true);

      const completed = completeDesignIntentAlignment(fixture.projectPath);
      expect(completed).toMatchObject({
        ok: true,
        reused: false,
        alignment: { status: "completed" },
        attempt: { id: fixture.attemptId, status: "completed" },
        workflow: {
          stage: "initial-design-system-preparing",
          current_alignment_attempt_id: fixture.attemptId
        },
        command: {
          command_type: "prepare_initial_design_system",
          status: "pending",
          alignment_attempt_id: fixture.attemptId
        }
      });
      await expect(
        waitForAgentCommand(fixture.projectPath, { windowMs: 0 })
      ).resolves.toMatchObject({
        ok: true,
        reason: "command_available",
        command: {
          id: completed.ok ? completed.command.id : "",
          command_type: "prepare_initial_design_system"
        }
      });

      const read = getDesignIntentAlignment(fixture.projectPath);
      expect(read.preparation.input_snapshot?.id).toBe(fixture.snapshotId);
      expect(read.question_cards).toHaveLength(12);
      expect(read.question_cards[0]).toMatchObject({
        final_answer: "Designer final",
        answer_source: "designer-edited"
      });
      expect(read.question_cards.slice(1).every((card) =>
        card.final_answer === card.answer_options?.[0]?.text &&
        card.answer_source === "agent-proposed-designer-accepted"
      )).toBe(true);
      expect(listEvents(fixture.projectPath, "design_intent_alignment_completed"))
        .toHaveLength(1);
      expect(readAlignmentSemanticDelta(fixture.projectPath, {
        alignmentAttemptId: fixture.attemptId,
        afterRevision: 0
      })).toMatchObject({
        ok: true,
        currentRevision: 15,
        frozenRevision: 15,
        frozenDigest: expect.stringMatching(/^[a-f0-9]{64}$/)
      });
      expect(updateRegionAnnotationBody(fixture.projectPath, {
        annotationId: designerAnnotation.record.id,
        body: "Attempt to mutate frozen input."
      })).toEqual({ ok: false, reason: "alignment_completed" });
      expect(deleteRegionAnnotation(
        fixture.projectPath,
        designerAnnotation.record.id
      )).toEqual({ ok: false, reason: "alignment_completed" });

      expect(completeDesignIntentAlignment(fixture.projectPath)).toEqual({
        ok: false,
        reason: "alignment_completed"
      });
      expect(
        getDesignIntentAlignment(fixture.projectPath).preparation.commands.filter(
          (command) => command.command_type === "prepare_initial_design_system"
        )
      ).toHaveLength(1);
      expect(listEvents(fixture.projectPath, "design_intent_alignment_completed"))
        .toHaveLength(1);
    } finally {
      removeFixture(fixture);
    }
  });

  test("rolls back every handoff write when next-command insertion fails", () => {
    const fixture = createAnsweringFixture();
    try {
      const db = openProjectDb(fixture.projectPath);
      try {
        db.exec(`
CREATE TRIGGER reject_initial_design_system_command
BEFORE INSERT ON agent_commands
WHEN NEW.command_type = 'prepare_initial_design_system'
BEGIN
  SELECT RAISE(ABORT, 'injected_command_failure');
END;
        `);
      } finally {
        closeProjectDb(db);
      }

      expect(completeDesignIntentAlignment(fixture.projectPath)).toEqual({
        ok: false,
        reason: "db_error"
      });
      const read = getDesignIntentAlignment(fixture.projectPath);
      expect(read.alignment.status).toBe("draft");
      expect(read.preparation.workflow.stage).toBe("alignment-answering");
      expect(read.preparation.current_attempt?.status).toBe("answering");
      expect(read.question_cards.every((card) => card.final_answer !== null))
        .toBe(true);
      expect(read.preparation.commands).toHaveLength(1);
      expect(listEvents(fixture.projectPath, "design_intent_alignment_completed"))
        .toHaveLength(0);
    } finally {
      removeFixture(fixture);
    }
  });

  test("completed inputs stay immutable while next-command status cannot roll workflow back", () => {
    const fixture = createAnsweringFixture();
    try {
      const completed = completeDesignIntentAlignment(fixture.projectPath);
      if (!completed.ok) throw new Error(completed.reason);
      expect(
        recordDesignerAnswer(fixture.projectPath, {
          questionCardId: fixture.questionIds[0],
          answer: { kind: "custom", text: "Late mutation" }
        })
      ).toEqual({ ok: false, reason: "alignment_completed" });
      expect(
        updateQuestionCardTitle(fixture.projectPath, {
          questionCardId: fixture.questionIds[0],
          title: "Late title"
        })
      ).toEqual({ ok: false, reason: "alignment_completed" });

      for (const status of ["claimed", "failed"] as const) {
        const db = openProjectDb(fixture.projectPath);
        try {
          db.prepare(
            "UPDATE agent_commands SET status = ?, updated_at = ? WHERE id = ?"
          ).run(status, new Date().toISOString(), completed.command.id);
        } finally {
          closeProjectDb(db);
        }
        const read = getDesignIntentAlignment(fixture.projectPath);
        expect(read.alignment.status).toBe("completed");
        expect(read.preparation.current_attempt?.status).toBe("completed");
        expect(read.preparation.workflow.stage).toBe(
          "initial-design-system-preparing"
        );
        expect(read.preparation.commands).toContainEqual(
          expect.objectContaining({ id: completed.command.id, status })
        );
      }
    } finally {
      removeFixture(fixture);
    }
  });

  test("Alignment answering exits generic wait while a later queued command still wins", async () => {
    const fixture = createAnsweringFixture();
    try {
      await expect(waitForAgentCommand(fixture.projectPath, {
        windowMs: 1_000
      })).resolves.toMatchObject({
        reason: "not_applicable",
        command: null,
        stage: "alignment-answering",
        not_applicable_reason: "incremental_alignment_planning",
        next_action: { tool: "resume_initial_design_system_planning" }
      });

      const completed = completeDesignIntentAlignment(fixture.projectPath);
      expect(completed.ok).toBe(true);
      await expect(waitForAgentCommand(fixture.projectPath)).resolves.toMatchObject({
        reason: "command_available",
        command: {
          command_type: "prepare_initial_design_system",
          alignment_attempt_id: fixture.attemptId
        }
      });
    } finally {
      removeFixture(fixture);
    }
  });
});
