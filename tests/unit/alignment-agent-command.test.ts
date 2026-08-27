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
import {
  readAlignmentSemanticDelta,
  readIncrementalPlanningStatus,
  recordIncrementalDesignSystemPlan,
  waitForAlignmentSemanticDelta
} from "../../lib/runtime/alignment-incremental-planning";
import {
  createRegionAnnotation,
  deleteRegionAnnotation,
  updateRegionAnnotationBody
} from "../../lib/runtime/region-annotation";

function withPreparedProject<T>(
  run: (
    projectPath: string,
    prepared: Extract<ReturnType<typeof prepareDesignIntentAlignment>, { ok: true }>,
    anchor: Record<string, unknown>
  ) => T
): T extends Promise<infer U> ? Promise<U> : T {
  const projectPath = mkdtempSync(path.join(tmpdir(), "ikran-alignment-command-"));
  const cleanup = () => rmSync(projectPath, { recursive: true, force: true });
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
    const result = run(projectPath, prepared, {
      kind: "single",
      target: {
        kind: "surface",
        seedReferenceId: seed.record.id,
        evidenceSurfaceId: evidence.record.id,
        evidenceVersionId: evidence.record.id
      }
    });
    if (result instanceof Promise) {
      return result.finally(cleanup) as never;
    }
    cleanup();
    return result as never;
  } catch (error) {
    cleanup();
    throw error;
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
          token_foundations: {
            owners: ["color", "typography", "material"],
            token_domains: {
              color: ["color"],
              typography: ["typography"],
              material: expect.arrayContaining(["spacing", "radius", "shadow"])
            },
            reroute: {
              motion: { owner: "interaction", work_unit: "interaction" },
              breakpoint: { owner: "layout", work_unit: "layout" },
              other: { owner: "unresolved", work_unit: null }
            }
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

  test("returns one ready section delta only after every card in that section is answered", () => {
    withPreparedProject((projectPath, prepared, anchor) => {
      claimAlignmentPreparationCommand(projectPath);
      const cardsBySection = new Map<string, string[]>();
      for (const section of ALIGNMENT_SECTIONS) {
        const annotation = createAgentAnnotation(projectPath, {
          alignmentAttemptId: prepared.attempt.id,
          idempotencyKey: `delta-${section}-hypothesis`,
          section,
          inference: "reasonable",
          title: "Section Hypothesis",
          body: `The ${section} choices appear intentional.`,
          anchor
        });
        expect(annotation.ok).toBe(true);
        const sectionCards: string[] = [];
        for (let index = 1; index <= 2; index += 1) {
          const created = createQuestionCard(projectPath, {
            alignmentAttemptId: prepared.attempt.id,
            idempotencyKey: `delta-${section}-${index}`,
            section,
            observation: `${section} ${index}`,
            question: `Question ${index} for ${section}?`,
            proposedAnswer: `Proposed answer ${index}`,
            anchor
          });
          if (!created.ok) throw new Error(created.reason);
          sectionCards.push(created.record.id);
        }
        cardsBySection.set(section, sectionCards);
      }
      const finalized = finalizeAlignmentPreparation(
        projectPath,
        prepared.attempt.id
      );
      expect(finalized.ok).toBe(true);

      expect(readAlignmentSemanticDelta(projectPath, {
        alignmentAttemptId: prepared.attempt.id,
        afterRevision: 0
      })).toMatchObject({
        ok: true,
        currentRevision: 1,
        delta: null
      });

      const designConceptCards = cardsBySection.get("design-concept")!;
      expect(recordDesignerAnswer(projectPath, {
        questionCardId: designConceptCards[0],
        finalAnswer: "First confirmed answer"
      }).ok).toBe(true);
      expect(readAlignmentSemanticDelta(projectPath, {
        alignmentAttemptId: prepared.attempt.id,
        afterRevision: 1
      })).toMatchObject({ ok: true, currentRevision: 2, delta: null });

      expect(recordDesignerAnswer(projectPath, {
        questionCardId: designConceptCards[1],
        finalAnswer: "Second confirmed answer"
      }).ok).toBe(true);
      const ready = readAlignmentSemanticDelta(projectPath, {
        alignmentAttemptId: prepared.attempt.id,
        afterRevision: 1
      });
      expect(ready).toMatchObject({
        ok: true,
        currentRevision: 3,
        delta: {
          section: "design-concept",
          revision: 3,
          fromRevision: 2,
          toRevision: 3,
          changes: expect.arrayContaining([
            expect.objectContaining({
              revision: 3,
              sourceKind: "question",
              operation: "upsert"
            })
          ]),
          sources: expect.arrayContaining([
            expect.objectContaining({ kind: "agent-annotation" }),
            expect.objectContaining({
              kind: "question",
              answer: "First confirmed answer"
            }),
            expect.objectContaining({
              kind: "question",
              answer: "Second confirmed answer"
            })
          ])
        }
      });
      if (!ready.ok || !ready.delta) throw new Error("missing ready delta");
      expect(ready.delta.sources).toHaveLength(3);
      expect(ready.delta.sectionDigest).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  test("persists Agent decisions and invalidates only dependencies whose source digest changed", () => {
    withPreparedProject((projectPath, prepared, anchor) => {
      claimAlignmentPreparationCommand(projectPath);
      const cards: string[] = [];
      for (const section of ALIGNMENT_SECTIONS) {
        const annotation = createAgentAnnotation(projectPath, {
          alignmentAttemptId: prepared.attempt.id,
          idempotencyKey: `plan-${section}-hypothesis`,
          section,
          inference: "reasonable",
          title: "Section Hypothesis",
          body: `The ${section} choices appear intentional.`,
          anchor
        });
        expect(annotation.ok).toBe(true);
        for (let index = 1; index <= 2; index += 1) {
          const created = createQuestionCard(projectPath, {
            alignmentAttemptId: prepared.attempt.id,
            idempotencyKey: `plan-${section}-${index}`,
            section,
            observation: `${section} ${index}`,
            question: `Question ${index} for ${section}?`,
            proposedAnswer: `Proposed answer ${index}`,
            anchor
          });
          if (!created.ok) throw new Error(created.reason);
          if (section === "design-concept") cards.push(created.record.id);
        }
      }
      expect(finalizeAlignmentPreparation(projectPath, prepared.attempt.id).ok)
        .toBe(true);
      for (const [index, questionCardId] of cards.entries()) {
        expect(recordDesignerAnswer(projectPath, {
          questionCardId,
          finalAnswer: `Confirmed concept ${index + 1}`
        }).ok).toBe(true);
      }
      const delta = readAlignmentSemanticDelta(projectPath, {
        alignmentAttemptId: prepared.attempt.id,
        afterRevision: 1
      });
      if (!delta.ok || !delta.delta) throw new Error("missing delta");
      const firstQuestion = delta.delta.sources.find(
        (source) => source.kind === "question"
      )!;
      const annotation = delta.delta.sources.find(
        (source) => source.kind === "agent-annotation"
      )!;

      const recorded = recordIncrementalDesignSystemPlan(projectPath, {
        alignmentAttemptId: prepared.attempt.id,
        idempotencyKey: "design-concept-plan-v1",
        baseRevision: delta.currentRevision,
        section: delta.delta.section,
        sectionDigest: delta.delta.sectionDigest,
        decisions: [
          {
            decisionId: "calm-principle",
            outputConcern: "global",
            statement: "Use calm hierarchy as a global principle.",
            sourceRefs: [{
              sourceId: firstQuestion.sourceId,
              digest: firstQuestion.digest
            }]
          },
          {
            decisionId: "retain-observed-intent",
            outputConcern: "global",
            statement: "Retain the observed deliberate hierarchy.",
            sourceRefs: [{
              sourceId: annotation.sourceId,
              digest: annotation.digest
            }]
          }
        ],
        designSystemDraft: {
          name: "Incremental draft",
          concepts: [{ meaning: "Calm hierarchy" }]
        }
      });
      expect(recorded).toMatchObject({
        ok: true,
        reused: false,
        planVersion: 1,
        processedRevision: delta.currentRevision,
        acknowledgedSections: ["design-concept"]
      });
      expect(recordIncrementalDesignSystemPlan(projectPath, {
        alignmentAttemptId: prepared.attempt.id,
        idempotencyKey: "design-concept-plan-v1",
        baseRevision: delta.currentRevision,
        section: delta.delta.section,
        sectionDigest: delta.delta.sectionDigest,
        decisions: recorded.ok ? recorded.decisions : [],
        designSystemDraft: {
          name: "Incremental draft",
          concepts: [{ meaning: "Calm hierarchy" }]
        }
      })).toMatchObject({ ok: true, reused: true, planVersion: 1 });

      expect(recordDesignerAnswer(projectPath, {
        questionCardId: firstQuestion.sourceId,
        finalAnswer: "Changed concept"
      }).ok).toBe(true);
      expect(readIncrementalPlanningStatus(
        projectPath,
        prepared.attempt.id
      )).toMatchObject({
        ok: true,
        planVersion: 1,
        staleDecisionIds: ["calm-principle"],
        validDecisionIds: ["retain-observed-intent"],
        designSystemDraft: {
          name: "Incremental draft",
          concepts: [{ meaning: "Calm hierarchy" }]
        },
        nextAction: { tool: "record_incremental_initial_design_system_plan" }
      });
      const editedDelta = readAlignmentSemanticDelta(projectPath, {
        alignmentAttemptId: prepared.attempt.id,
        afterRevision: delta.currentRevision
      });
      if (!editedDelta.ok || !editedDelta.delta) {
        throw new Error("missing edited delta");
      }
      expect(recordIncrementalDesignSystemPlan(projectPath, {
        alignmentAttemptId: prepared.attempt.id,
        idempotencyKey: "design-concept-plan-retire-stale",
        baseRevision: editedDelta.currentRevision,
        section: editedDelta.delta.section,
        sectionDigest: editedDelta.delta.sectionDigest,
        decisions: [],
        retireDecisionIds: ["calm-principle"],
        designSystemDraft: { name: "Incremental draft" }
      })).toMatchObject({ ok: true, planVersion: 2 });
      expect(readIncrementalPlanningStatus(
        projectPath,
        prepared.attempt.id
      )).toMatchObject({
        ok: true,
        staleDecisionIds: [],
        validDecisionIds: ["retain-observed-intent"]
      });
    });
  });

  test("accepts unrelated concurrent revisions and updates cross-section decisions by stable id", () => {
    withPreparedProject((projectPath, prepared, anchor) => {
      claimAlignmentPreparationCommand(projectPath);
      const cardsBySection = new Map<string, string[]>();
      for (const section of ALIGNMENT_SECTIONS) {
        expect(createAgentAnnotation(projectPath, {
          alignmentAttemptId: prepared.attempt.id,
          idempotencyKey: `cross-${section}-hypothesis`,
          section,
          inference: "reasonable",
          title: "Section Hypothesis",
          body: `The ${section} choices appear intentional.`,
          anchor
        }).ok).toBe(true);
        for (let index = 1; index <= 2; index += 1) {
          const created = createQuestionCard(projectPath, {
            alignmentAttemptId: prepared.attempt.id,
            idempotencyKey: `cross-${section}-${index}`,
            section,
            observation: `${section} ${index}`,
            question: `Question ${index} for ${section}?`,
            proposedAnswer: `Proposed answer ${index}`,
            anchor
          });
          if (!created.ok) throw new Error(created.reason);
          cardsBySection.set(section, [
            ...(cardsBySection.get(section) ?? []),
            created.record.id
          ]);
        }
      }
      expect(finalizeAlignmentPreparation(projectPath, prepared.attempt.id).ok)
        .toBe(true);
      for (const questionCardId of cardsBySection.get("design-concept")!) {
        expect(recordDesignerAnswer(projectPath, {
          questionCardId,
          finalAnswer: "Concept answer"
        }).ok).toBe(true);
      }
      const conceptDelta = readAlignmentSemanticDelta(projectPath, {
        alignmentAttemptId: prepared.attempt.id,
        afterRevision: 1
      });
      if (!conceptDelta.ok || !conceptDelta.delta) {
        throw new Error("missing concept delta");
      }
      const conceptSource = conceptDelta.delta.sources.find(
        (source) => source.kind === "question"
      )!;

      for (const questionCardId of cardsBySection.get("visual-language")!) {
        expect(recordDesignerAnswer(projectPath, {
          questionCardId,
          finalAnswer: "Visual answer"
        }).ok).toBe(true);
      }
      expect(recordIncrementalDesignSystemPlan(projectPath, {
        alignmentAttemptId: prepared.attempt.id,
        idempotencyKey: "concurrent-concept-plan",
        baseRevision: conceptDelta.currentRevision,
        section: conceptDelta.delta.section,
        sectionDigest: conceptDelta.delta.sectionDigest,
        decisions: [{
          decisionId: "concept-only",
          outputConcern: "global",
          statement: "Preserve the concept.",
          sourceRefs: [{
            sourceId: conceptSource.sourceId,
            digest: conceptSource.digest
          }]
        }],
        designSystemDraft: { name: "Concurrent draft" }
      })).toMatchObject({ ok: true, planVersion: 1 });

      const visualDelta = readAlignmentSemanticDelta(projectPath, {
        alignmentAttemptId: prepared.attempt.id,
        afterRevision: conceptDelta.currentRevision
      });
      if (!visualDelta.ok || !visualDelta.delta) {
        throw new Error("missing visual delta");
      }
      const visualSource = visualDelta.delta.sources.find(
        (source) => source.kind === "question"
      )!;
      expect(recordIncrementalDesignSystemPlan(projectPath, {
        alignmentAttemptId: prepared.attempt.id,
        idempotencyKey: "cross-section-plan-v1",
        baseRevision: visualDelta.currentRevision,
        section: visualDelta.delta.section,
        sectionDigest: visualDelta.delta.sectionDigest,
        decisions: [{
          decisionId: "cross-section-decision",
          outputConcern: "global",
          statement: "Join concept and visual intent.",
          sourceRefs: [
            { sourceId: conceptSource.sourceId, digest: conceptSource.digest },
            { sourceId: visualSource.sourceId, digest: visualSource.digest }
          ]
        }],
        designSystemDraft: { name: "Cross-section draft" }
      })).toMatchObject({ ok: true, planVersion: 2 });

      expect(recordDesignerAnswer(projectPath, {
        questionCardId: visualSource.sourceId,
        finalAnswer: "Edited visual answer"
      }).ok).toBe(true);
      const editedVisual = readAlignmentSemanticDelta(projectPath, {
        alignmentAttemptId: prepared.attempt.id,
        afterRevision: visualDelta.currentRevision
      });
      if (!editedVisual.ok || !editedVisual.delta) {
        throw new Error("missing edited visual delta");
      }
      const editedSource = editedVisual.delta.sources.find(
        (source) => source.sourceId === visualSource.sourceId
      )!;
      expect(recordIncrementalDesignSystemPlan(projectPath, {
        alignmentAttemptId: prepared.attempt.id,
        idempotencyKey: "cross-section-plan-v2",
        baseRevision: editedVisual.currentRevision,
        section: editedVisual.delta.section,
        sectionDigest: editedVisual.delta.sectionDigest,
        decisions: [{
          decisionId: "cross-section-decision",
          outputConcern: "global",
          statement: "Join concept and edited visual intent.",
          sourceRefs: [
            { sourceId: conceptSource.sourceId, digest: conceptSource.digest },
            { sourceId: editedSource.sourceId, digest: editedSource.digest }
          ]
        }],
        designSystemDraft: { name: "Updated cross-section draft" }
      })).toMatchObject({ ok: true, planVersion: 3 });
      expect(readIncrementalPlanningStatus(
        projectPath,
        prepared.attempt.id
      )).toMatchObject({
        ok: true,
        staleDecisionIds: [],
        validDecisionIds: expect.arrayContaining([
          "concept-only",
          "cross-section-decision"
        ])
      });
    });
  });

  test("wakes an active section monitor and durably resumes after cancellation", async () => {
    await withPreparedProject(async (projectPath, prepared, anchor) => {
            claimAlignmentPreparationCommand(projectPath);
            const cardsBySection = new Map<string, string[]>();
            for (const section of ALIGNMENT_SECTIONS) {
              expect(createAgentAnnotation(projectPath, {
                alignmentAttemptId: prepared.attempt.id,
                idempotencyKey: `monitor-${section}-hypothesis`,
                section,
                inference: "reasonable",
                title: "Section Hypothesis",
                body: `The ${section} choices appear intentional.`,
                anchor
              }).ok).toBe(true);
              for (let index = 1; index <= 2; index += 1) {
                const created = createQuestionCard(projectPath, {
                  alignmentAttemptId: prepared.attempt.id,
                  idempotencyKey: `monitor-${section}-${index}`,
                  section,
                  observation: `${section} ${index}`,
                  question: `Question ${index} for ${section}?`,
                  proposedAnswer: `Proposed answer ${index}`,
                  anchor
                });
                if (!created.ok) throw new Error(created.reason);
                const sectionCards = cardsBySection.get(section) ?? [];
                sectionCards.push(created.record.id);
                cardsBySection.set(section, sectionCards);
              }
            }
            expect(finalizeAlignmentPreparation(projectPath, prepared.attempt.id).ok)
              .toBe(true);

            const cards = cardsBySection.get("design-concept")!;
            const waiting = waitForAlignmentSemanticDelta(projectPath, {
              alignmentAttemptId: prepared.attempt.id,
              afterRevision: 1,
              windowMs: 1_000,
              recheckMs: 20
            });
            expect(recordDesignerAnswer(projectPath, {
              questionCardId: cards[0],
              finalAnswer: "First answer"
            }).ok).toBe(true);
            expect(recordDesignerAnswer(projectPath, {
              questionCardId: cards[1],
              finalAnswer: "Second answer"
            }).ok).toBe(true);
            const available = await waiting;
            expect(available).toMatchObject({
              ok: true,
              reason: "delta_available",
              delta: { section: "design-concept" }
            });
            if (!available.ok || available.reason !== "delta_available") {
              throw new Error("missing monitored delta");
            }
            const source = available.delta.sources[0];
            expect(recordIncrementalDesignSystemPlan(projectPath, {
              alignmentAttemptId: prepared.attempt.id,
              idempotencyKey: "monitor-ack-design-concept",
              baseRevision: available.currentRevision,
              section: available.delta.section,
              sectionDigest: available.delta.sectionDigest,
              decisions: [{
                decisionId: "monitor-decision",
                outputConcern: "global",
                statement: "Preserve the monitored decision.",
                sourceRefs: [{ sourceId: source.sourceId, digest: source.digest }]
              }],
              designSystemDraft: { name: "Monitored draft" }
            }).ok).toBe(true);

            const controller = new AbortController();
            const interrupted = waitForAlignmentSemanticDelta(projectPath, {
              alignmentAttemptId: prepared.attempt.id,
              afterRevision: 3,
              windowMs: 1_000,
              recheckMs: 20,
              signal: controller.signal
            });
            controller.abort();
            await expect(interrupted).resolves.toMatchObject({
              ok: true,
              reason: "cancelled",
              delta: null
            });
            expect(readIncrementalPlanningStatus(
              projectPath,
              prepared.attempt.id
            )).toMatchObject({ ok: true, status: "paused" });

            for (const [index, questionCardId] of cardsBySection
              .get("visual-language")!.entries()) {
              expect(recordDesignerAnswer(projectPath, {
                questionCardId,
                finalAnswer: `Visual answer ${index + 1}`
              }).ok).toBe(true);
            }
            const resumed = await waitForAlignmentSemanticDelta(projectPath, {
              alignmentAttemptId: prepared.attempt.id,
              afterRevision: 3,
              windowMs: 0
            });
            expect(resumed).toMatchObject({
              ok: true,
              reason: "delta_available",
              delta: { section: "visual-language" }
            });
    });
  });

  test("includes designer annotation edits and deletion in the section revision", () => {
    withPreparedProject((projectPath, prepared, anchor) => {
      claimAlignmentPreparationCommand(projectPath);
      const cards: string[] = [];
      for (const section of ALIGNMENT_SECTIONS) {
        expect(createAgentAnnotation(projectPath, {
          alignmentAttemptId: prepared.attempt.id,
          idempotencyKey: `designer-delta-${section}-hypothesis`,
          section,
          inference: "reasonable",
          title: "Section Hypothesis",
          body: `The ${section} choices appear intentional.`,
          anchor
        }).ok).toBe(true);
        for (let index = 1; index <= 2; index += 1) {
          const created = createQuestionCard(projectPath, {
            alignmentAttemptId: prepared.attempt.id,
            idempotencyKey: `designer-delta-${section}-${index}`,
            section,
            observation: `${section} ${index}`,
            question: `Question ${index} for ${section}?`,
            proposedAnswer: `Proposed answer ${index}`,
            anchor
          });
          if (!created.ok) throw new Error(created.reason);
          if (section === "design-concept") cards.push(created.record.id);
        }
      }
      expect(finalizeAlignmentPreparation(projectPath, prepared.attempt.id).ok)
        .toBe(true);
      const evidenceVersionId = String(
        ((anchor as { target: { evidenceVersionId: string } }).target)
          .evidenceVersionId
      );
      const designer = createRegionAnnotation(projectPath, {
        target: { kind: "figma-surface", evidenceVersionId },
        author: "designer",
        body: "Keep the hierarchy quiet.",
        section: "design-concept"
      });
      if (!designer.ok) throw new Error(designer.reason);
      for (const questionCardId of cards) {
        expect(recordDesignerAnswer(projectPath, {
          questionCardId,
          finalAnswer: "Confirmed"
        }).ok).toBe(true);
      }
      const first = readAlignmentSemanticDelta(projectPath, {
        alignmentAttemptId: prepared.attempt.id,
        afterRevision: 1
      });
      expect(first).toMatchObject({
        ok: true,
        currentRevision: 4,
        delta: {
          sources: expect.arrayContaining([
            expect.objectContaining({
              sourceId: designer.record.id,
              statement: "Keep the hierarchy quiet."
            })
          ])
        }
      });
      expect(updateRegionAnnotationBody(projectPath, {
        annotationId: designer.record.id,
        body: "Keep the hierarchy extremely quiet."
      }).ok).toBe(true);
      expect(readAlignmentSemanticDelta(projectPath, {
        alignmentAttemptId: prepared.attempt.id,
        afterRevision: 4
      })).toMatchObject({
        ok: true,
        currentRevision: 5,
        delta: {
          sources: expect.arrayContaining([
            expect.objectContaining({
              sourceId: designer.record.id,
              statement: "Keep the hierarchy extremely quiet."
            })
          ])
        }
      });
      expect(deleteRegionAnnotation(projectPath, designer.record.id).ok)
        .toBe(true);
      const deleted = readAlignmentSemanticDelta(projectPath, {
        alignmentAttemptId: prepared.attempt.id,
        afterRevision: 5
      });
      expect(deleted).toMatchObject({
        ok: true,
        currentRevision: 6,
        delta: {
          section: "design-concept",
          fromRevision: 6,
          toRevision: 6,
          changes: [expect.objectContaining({
            sourceId: designer.record.id,
            operation: "delete"
          })]
        }
      });
      if (!deleted.ok || !deleted.delta) throw new Error("missing delete delta");
      expect(deleted.delta.sources.some(
        (source) => source.sourceId === designer.record.id
      )).toBe(false);
    });
  });
});
