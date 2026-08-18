import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { abandonCurrentAlignmentAttempt } from "../../lib/runtime/alignment-attempt-lifecycle";
import { claimAlignmentPreparationCommand, finalizeAlignmentPreparation } from "../../lib/runtime/alignment-agent-command";
import { prepareDesignIntentAlignment } from "../../lib/runtime/alignment-preparation";
import { closeProjectDb, initializeProjectDb, openProjectDb } from "../../lib/runtime/db";
import {
  ALIGNMENT_SECTIONS,
  completeDesignIntentAlignment,
  createAgentAnnotation,
  createQuestionCard,
  getDesignIntentAlignment,
  recordDesignerAnswer,
  updateQuestionCardAnchor,
  updateQuestionCardTitle
} from "../../lib/runtime/design-intent-alignment";
import { recordEvidencePackage } from "../../lib/runtime/evidence-package";
import { listEvents, listResearchEligibleEvents } from "../../lib/runtime/events";
import { setDesignLanguageDescription } from "../../lib/runtime/project-readiness";
import { registerSeedReference } from "../../lib/runtime/seed-reference";

function withProject(run: (context: {
  projectPath: string;
  attemptId: string;
  seedId: string;
  surfaceId: string;
}) => void) {
  const projectPath = mkdtempSync(path.join(tmpdir(), "ikran-abandon-"));
  try {
    initializeProjectDb(projectPath);
    const seed = registerSeedReference(projectPath, {
      figmaSeedReference: "https://www.figma.com/design/Abandon/Mock?node-id=1:2",
      originalDesignIntent: "First attempt"
    });
    if (!seed.ok) throw new Error(seed.reason);
    const evidence = recordEvidencePackage(projectPath, {
      seedReferenceId: seed.record.id,
      frame: { nodeId: "1:2", name: "Mock" },
      evidenceViews: { rawData: "available", screenshot: "missing" }
    });
    if (!evidence.ok) throw new Error(evidence.reason);
    setDesignLanguageDescription(projectPath, "Abandon lifecycle");
    const prepared = prepareDesignIntentAlignment(projectPath);
    if (!prepared.ok) throw new Error(prepared.reason);
    claimAlignmentPreparationCommand(projectPath);
    run({
      projectPath,
      attemptId: prepared.attempt.id,
      seedId: seed.record.id,
      surfaceId: evidence.record.id
    });
  } finally {
    rmSync(projectPath, { recursive: true, force: true });
  }
}

function cardInput(context: { attemptId: string; seedId: string; surfaceId: string }, section = "design-concept", index = 1) {
  return {
    alignmentAttemptId: context.attemptId,
    idempotencyKey: `${section}-${index}`,
    section,
    observation: `${section} ${index}`,
    question: `Question ${index} for ${section}?`,
    proposedAnswer: `Proposal ${index}`,
    anchor: {
      kind: "single",
      target: {
        kind: "surface",
        seedReferenceId: context.seedId,
        evidenceSurfaceId: context.surfaceId,
        evidenceVersionId: context.surfaceId
      }
    }
  };
}

function createRequiredAnnotation(context: {
  projectPath: string;
  attemptId: string;
  seedId: string;
  surfaceId: string;
}, section = "design-concept") {
  return createAgentAnnotation(context.projectPath, {
    alignmentAttemptId: context.attemptId,
    idempotencyKey: `required-assumption-${section}`,
    section,
    inference: "reasonable",
    title: "Existing hierarchy",
    body: "The current hierarchy appears intentional.",
    anchor: cardInput(context).anchor
  });
}

describe("Alignment attempt abandonment", () => {
  test("preparing attempt is abandoned atomically and old writes are rejected", () => {
    withProject((context) => {
      const oldAnnotation = createRequiredAnnotation(context);
      expect(oldAnnotation.ok).toBe(true);
      const oldCard = createQuestionCard(context.projectPath, cardInput(context));
      expect(oldCard.ok).toBe(true);
      const abandoned = abandonCurrentAlignmentAttempt(context.projectPath);
      expect(abandoned).toMatchObject({
        ok: true,
        reused: false,
        attempt: { id: context.attemptId, status: "abandoned" },
        workflow: { stage: "seed-reference-registration", current_alignment_attempt_id: null },
        cancelled_command_count: 1
      });
      expect(getDesignIntentAlignment(context.projectPath).question_cards).toEqual([]);
      expect(getDesignIntentAlignment(context.projectPath).annotations).toEqual([]);
      expect(listEvents(context.projectPath, "question_card_created")).toHaveLength(1);
      expect(
        listResearchEligibleEvents(context.projectPath).some(
          (event) =>
            event.payload.question_card_id ===
            (oldCard.ok ? oldCard.record.id : "")
        )
      ).toBe(false);
      expect(createQuestionCard(context.projectPath, {
        ...cardInput(context, "design-concept", 2)
      })).toEqual({ ok: false, reason: "stale_alignment_attempt" });
      expect(createAgentAnnotation(context.projectPath, {
        alignmentAttemptId: context.attemptId,
        idempotencyKey: "stale-assumption",
        section: "design-concept",
        inference: "reasonable",
        title: "Stale assumption",
        body: "This must not attach to a later attempt.",
        anchor: cardInput(context).anchor
      })).toEqual({ ok: false, reason: "stale_alignment_attempt" });
      expect(finalizeAlignmentPreparation(context.projectPath, context.attemptId))
        .toEqual({ ok: false, reason: "stale_alignment_attempt" });
      expect(recordDesignerAnswer(context.projectPath, {
        questionCardId: oldCard.ok ? oldCard.record.id : "",
        finalAnswer: "Must not write"
      })).toEqual({ ok: false, reason: "stale_alignment_attempt" });
      expect(updateQuestionCardTitle(context.projectPath, {
        questionCardId: oldCard.ok ? oldCard.record.id : "",
        title: "Mutated audit title"
      })).toEqual({ ok: false, reason: "stale_alignment_attempt" });
      expect(updateQuestionCardAnchor(context.projectPath, {
        questionCardId: oldCard.ok ? oldCard.record.id : "",
        anchor: cardInput(context).anchor
      })).toEqual({ ok: false, reason: "stale_alignment_attempt" });

      const reopened = prepareDesignIntentAlignment(context.projectPath);
      expect(reopened.ok).toBe(true);
      if (!reopened.ok) return;
      expect(reopened.attempt.id).not.toBe(context.attemptId);
      expect(reopened.input_snapshot.id).not.toBe(abandoned.ok ? abandoned.input_snapshot_id : "");
      expect(prepareDesignIntentAlignment(context.projectPath)).toMatchObject({
        ok: true,
        reused: true,
        attempt: { id: reopened.attempt.id }
      });
    });
  });

  test("answering history remains auditable but disappears from current reads", () => {
    withProject((context) => {
      let firstCardId = "";
      for (const section of ALIGNMENT_SECTIONS) {
        expect(createRequiredAnnotation(context, section).ok).toBe(true);
        for (let index = 1; index <= 2; index += 1) {
          const created = createQuestionCard(context.projectPath, cardInput(context, section, index));
          expect(created.ok).toBe(true);
          if (created.ok && !firstCardId) firstCardId = created.record.id;
        }
      }
      expect(finalizeAlignmentPreparation(context.projectPath, context.attemptId).ok).toBe(true);
      expect(recordDesignerAnswer(context.projectPath, {
        questionCardId: firstCardId,
        finalAnswer: "Auditable answer"
      }).ok).toBe(true);
      expect(abandonCurrentAlignmentAttempt(context.projectPath).ok).toBe(true);
      expect(getDesignIntentAlignment(context.projectPath).question_cards).toEqual([]);

      const db = openProjectDb(context.projectPath);
      try {
        expect(db.prepare(
          "SELECT status FROM alignment_attempts WHERE id = ?"
        ).get(context.attemptId)).toEqual({ status: "abandoned" });
        expect(db.prepare(
          "SELECT final_answer FROM alignment_question_cards WHERE id = ?"
        ).get(firstCardId)).toEqual({ final_answer: "Auditable answer" });
      } finally {
        closeProjectDb(db);
      }
    });
  });

  test("completed Alignment is irreversible", () => {
    withProject((context) => {
      for (const section of ALIGNMENT_SECTIONS) {
        expect(createRequiredAnnotation(context, section).ok).toBe(true);
        for (let index = 1; index <= 2; index += 1) {
          expect(createQuestionCard(context.projectPath, cardInput(context, section, index)).ok).toBe(true);
        }
      }
      finalizeAlignmentPreparation(context.projectPath, context.attemptId);
      const answering = getDesignIntentAlignment(context.projectPath);
      for (const card of answering.question_cards) {
        expect(recordDesignerAnswer(context.projectPath, {
          questionCardId: card.id,
          finalAnswer: card.proposed_answer
        }).ok).toBe(true);
      }
      expect(completeDesignIntentAlignment(context.projectPath).ok).toBe(true);
      expect(abandonCurrentAlignmentAttempt(context.projectPath)).toEqual({
        ok: false,
        reason: "alignment_completed"
      });
    });
  });
});
