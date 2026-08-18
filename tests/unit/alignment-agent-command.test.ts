import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

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
  claimAlignmentPreparationCommand,
  finalizeAlignmentPreparation
} from "../../lib/runtime/alignment-agent-command";
import {
  ALIGNMENT_SECTIONS,
  createAgentAnnotation,
  createQuestionCard,
  getDesignIntentAlignment,
  recordDesignerAnswer
} from "../../lib/runtime/design-intent-alignment";
import { prepareDesignIntentAlignment } from "../../lib/runtime/alignment-preparation";

function withPreparedProject(
  run: (
    projectPath: string,
    prepared: Extract<ReturnType<typeof prepareDesignIntentAlignment>, { ok: true }>,
    anchor: Record<string, unknown>
  ) => void
) {
  const projectPath = mkdtempSync(path.join(tmpdir(), "ikran-alignment-command-"));
  try {
    initializeProjectDb(projectPath);
    const seed = registerSeedReference(projectPath, {
      figmaSeedReference:
        "https://www.figma.com/design/AbCdEf/Checkout?node-id=1:2",
      originalDesignIntent: "Command-bound seed"
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
    setDesignLanguageDescription(projectPath, "A calm, precise product language");
    const prepared = prepareDesignIntentAlignment(projectPath);
    if (!prepared.ok) throw new Error(prepared.reason);
    run(projectPath, prepared, {
      kind: "single",
      target: {
        kind: "surface",
        seedReferenceId: seed.record.id,
        evidenceSurfaceId: evidence.record.id,
        evidenceVersionId: evidence.record.id
      }
    });
  } finally {
    rmSync(projectPath, { recursive: true, force: true });
  }
}

describe("Alignment preparation Agent command", () => {
  test("claim is durable and returns the immutable attempt snapshot context", () => {
    withPreparedProject((projectPath, prepared) => {
      const claimed = claimAlignmentPreparationCommand(projectPath);
      expect(claimed).toMatchObject({
        ok: true,
        reused: false,
        command: {
          id: prepared.command.id,
          status: "claimed",
          alignment_attempt_id: prepared.attempt.id
        },
        attempt: { id: prepared.attempt.id, status: "preparing" },
        input_snapshot: {
          id: prepared.input_snapshot.id,
          data: {
            design_language_description: "A calm, precise product language"
          }
        },
        // Issue 18: the section contract rides the claim payload (fresh and
        // reused claims alike), sourced from the same constants the coverage
        // validators enforce.
        section_contract: {
          sections: ALIGNMENT_SECTIONS,
          per_section: {
            agent_annotations_min: 1,
            question_cards_min: 2,
            question_cards_max: 5
          },
          question_title: {
            max_characters: 48,
            min_words: 2,
            max_words: 5,
            min_han_characters: 2,
            max_han_characters: 12
          },
          output_language: expect.stringContaining("Chinese")
        }
      });
      expect(claimAlignmentPreparationCommand(projectPath)).toMatchObject({
        ok: true,
        reused: true,
        command: { id: prepared.command.id, status: "claimed" },
        section_contract: { sections: ALIGNMENT_SECTIONS }
      });
    });
  });

  test("question writes are attempt-bound, idempotent, and read-only until finalize", () => {
    withPreparedProject((projectPath, prepared, anchor) => {
      claimAlignmentPreparationCommand(projectPath);
      const input = {
        alignmentAttemptId: prepared.attempt.id,
        idempotencyKey: "design-concept-1",
        section: "design-concept",
        observation: "Calm hierarchy",
        question: "Should hierarchy remain calm?",
        proposedAnswer: "Yes, keep contrast deliberate.",
        anchor
      };
      expect(
        createAgentAnnotation(projectPath, {
          alignmentAttemptId: prepared.attempt.id,
          idempotencyKey: "design-concept-hypothesis",
          section: "design-concept",
          inference: "reasonable",
          title: "Calm Hierarchy",
          body: "The hierarchy appears intentionally calm.",
          anchor
        }).ok
      ).toBe(true);
      const created = createQuestionCard(projectPath, input);
      expect(created).toMatchObject({
        ok: true,
        reused: false,
        record: { alignment_attempt_id: prepared.attempt.id }
      });
      const retried = createQuestionCard(projectPath, input);
      expect(retried).toMatchObject({
        ok: true,
        reused: true,
        record: { id: created.ok ? created.record.id : "" }
      });
      expect(getDesignIntentAlignment(projectPath).question_cards).toHaveLength(1);
      expect(listEvents(projectPath, "question_card_created")).toHaveLength(1);
      expect(
        recordDesignerAnswer(projectPath, {
          questionCardId: created.ok ? created.record.id : "",
          finalAnswer: "Designer answer"
        })
      ).toEqual({ ok: false, reason: "alignment_not_answering" });
      expect(finalizeAlignmentPreparation(projectPath, prepared.attempt.id)).toEqual({
        ok: false,
        reason: "section_annotation_required"
      });

      expect(
        createQuestionCard(projectPath, {
          ...input,
          alignmentAttemptId: "stale-attempt",
          idempotencyKey: "stale"
        })
      ).toEqual({ ok: false, reason: "stale_alignment_attempt" });
    });
  });

  test("finalize atomically completes the command and unlocks answering", () => {
    withPreparedProject((projectPath, prepared, anchor) => {
      claimAlignmentPreparationCommand(projectPath);
      let firstCardId = "";
      for (const section of ALIGNMENT_SECTIONS) {
        expect(
          createAgentAnnotation(projectPath, {
            alignmentAttemptId: prepared.attempt.id,
            idempotencyKey: `${section}-hypothesis`,
            section,
            inference: "reasonable",
            title: "Section Hypothesis",
            body: `The ${section} choices appear intentional.`,
            anchor
          }).ok
        ).toBe(true);
        for (let index = 1; index <= 2; index += 1) {
          const created = createQuestionCard(projectPath, {
            alignmentAttemptId: prepared.attempt.id,
            idempotencyKey: `${section}-${index}`,
            section,
            observation: `${section} ${index}`,
            question: `Question ${index} for ${section}?`,
            proposedAnswer: `Proposed answer ${index}`,
            anchor
          });
          expect(created.ok).toBe(true);
          if (created.ok && !firstCardId) firstCardId = created.record.id;
        }
      }
      const db = openProjectDb(projectPath);
      try {
        db.prepare(
          `UPDATE agent_alignment_annotations
           SET section = NULL
           WHERE alignment_attempt_id = ? AND section = 'interaction'`
        ).run(prepared.attempt.id);
      } finally {
        closeProjectDb(db);
      }
      expect(
        finalizeAlignmentPreparation(projectPath, prepared.attempt.id)
      ).toEqual({
        ok: false,
        reason: "section_annotation_required"
      });
      const repairDb = openProjectDb(projectPath);
      try {
        repairDb.prepare(
          `UPDATE agent_alignment_annotations
           SET section = 'interaction'
           WHERE alignment_attempt_id = ? AND agent_idempotency_key = ?`
        ).run(prepared.attempt.id, "interaction-hypothesis");
      } finally {
        closeProjectDb(repairDb);
      }

      const finalized = finalizeAlignmentPreparation(
        projectPath,
        prepared.attempt.id
      );
      expect(finalized).toMatchObject({
        ok: true,
        reused: false,
        workflow: { stage: "alignment-answering" },
        attempt: { status: "answering" },
        command: { status: "completed" }
      });
      expect(
        finalizeAlignmentPreparation(projectPath, prepared.attempt.id)
      ).toMatchObject({ ok: true, reused: true });
      expect(
        createQuestionCard(projectPath, {
          alignmentAttemptId: prepared.attempt.id,
          idempotencyKey: "design-concept-1",
          section: "design-concept",
          observation: "design-concept 1",
          question: "Question 1 for design-concept?",
          proposedAnswer: "Proposed answer 1",
          anchor
        })
      ).toMatchObject({
        ok: true,
        reused: true,
        record: { id: firstCardId }
      });
      expect(
        recordDesignerAnswer(projectPath, {
          questionCardId: firstCardId,
          finalAnswer: "Designer-confirmed answer"
        })
      ).toMatchObject({ ok: true });
    });
  });
});
