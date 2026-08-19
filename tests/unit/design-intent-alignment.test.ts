import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { initializeProjectDb, openProjectDb, closeProjectDb } from "../../lib/runtime/db";
import { registerSeedReference } from "../../lib/runtime/seed-reference";
import { recordEvidencePackage } from "../../lib/runtime/evidence-package";
import { setDesignLanguageDescription } from "../../lib/runtime/project-readiness";
import { listEvents } from "../../lib/runtime/events";
import {
  resetRecordBusForTests,
  subscribeRecordEvents,
  type RecordBusEvent
} from "../../lib/runtime/record-bus";
import {
  ALIGNMENT_SECTIONS,
  appendAgentAnnotationInformation,
  completeDesignIntentAlignment,
  createAgentAnnotation,
  createQuestionCard as createQuestionCardRuntime,
  getDesignIntentAlignment,
  recordDesignerAnswer,
  updateQuestionCardAnchor,
  updateQuestionCardTitle
} from "../../lib/runtime/design-intent-alignment";
import { prepareDesignIntentAlignment } from "../../lib/runtime/alignment-preparation";
import {
  claimAlignmentPreparationCommand,
  finalizeAlignmentPreparation
} from "../../lib/runtime/alignment-agent-command";

const FIGMA = "https://www.figma.com/design/AbCdEf/Checkout?node-id=1:2";
let questionDelivery = 0;

function createQuestionCard(
  projectPath: string,
  input: Parameters<typeof createQuestionCardRuntime>[1]
) {
  let preparation = getDesignIntentAlignment(projectPath).preparation;
  if (preparation.workflow.stage === "seed-reference-registration") {
    const prepared = prepareDesignIntentAlignment(projectPath);
    if (prepared.ok) preparation = getDesignIntentAlignment(projectPath).preparation;
  }
  if (preparation.workflow.stage === "alignment-preparing") {
    claimAlignmentPreparationCommand(projectPath);
  }
  if (
    preparation.current_attempt &&
    typeof input.section === "string" &&
    ALIGNMENT_SECTIONS.includes(
      input.section as (typeof ALIGNMENT_SECTIONS)[number]
    )
  ) {
    const db = openProjectDb(projectPath);
    let linkage: { seed_reference_id: string; surface_id: string } | undefined;
    try {
      linkage = db
        .prepare(
          `SELECT s.id AS seed_reference_id, e.id AS surface_id
           FROM seed_references s
           JOIN figma_evidence_surfaces e ON e.id = s.current_surface_id
           LIMIT 1`
        )
        .get() as
        | { seed_reference_id: string; surface_id: string }
        | undefined;
    } finally {
      closeProjectDb(db);
    }
    if (linkage) {
      createAgentAnnotation(projectPath, {
        alignmentAttemptId: preparation.current_attempt.id,
        idempotencyKey: `legacy-section-annotation-${input.section}`,
        section: input.section,
        inference: "reasonable",
        title: "Section Hypothesis",
        body: "A section-specific hypothesis used by this unit fixture.",
        anchor: {
          kind: "single",
          target: {
            kind: "surface",
            seedReferenceId: linkage.seed_reference_id,
            evidenceSurfaceId: linkage.surface_id,
            evidenceVersionId: linkage.surface_id
          }
        }
      });
    }
  }
  questionDelivery += 1;
  return createQuestionCardRuntime(projectPath, {
    ...input,
    alignmentAttemptId: preparation.current_attempt?.id,
    idempotencyKey: `legacy-unit-${questionDelivery}`
  });
}

function forceAnsweringFixture(projectPath: string): void {
  const preparation = getDesignIntentAlignment(projectPath).preparation;
  if (!preparation.current_attempt) throw new Error("missing alignment attempt");
  const db = openProjectDb(projectPath);
  try {
    db.prepare("UPDATE alignment_attempts SET status = 'answering' WHERE id = ?")
      .run(preparation.current_attempt.id);
    db.prepare("UPDATE project_workflow SET stage = 'alignment-answering' WHERE singleton = 1")
      .run();
  } finally {
    closeProjectDb(db);
  }
}

function withProject(fn: (projectPath: string, link: { seedReferenceId: string; surfaceId: string }) => void) {
  const projectPath = mkdtempSync(path.join(tmpdir(), "ikran-alignment-"));
  try {
    initializeProjectDb(projectPath);
    const seed = registerSeedReference(projectPath, {
      figmaSeedReference: FIGMA,
      originalDesignIntent: "Alignment fixture"
    });
    if (!seed.ok) throw new Error(seed.reason);
    const evidence = recordEvidencePackage(projectPath, {
      seedReferenceId: seed.record.id,
      frame: {
        nodeId: "1:2",
        name: "Checkout",
        bounds: { x: 100, y: 200, width: 400, height: 800 }
      },
      evidenceViews: { rawData: "available", screenshot: "missing" }
    });
    if (!evidence.ok) throw new Error(evidence.reason);
    const db = openProjectDb(projectPath);
    try {
      db.prepare(
        "UPDATE figma_evidence_surfaces SET positional_nodes_json = ? WHERE id = ?"
      ).run(
        JSON.stringify([
          {
            id: "1:2",
            parentId: null,
            name: "Checkout",
            type: "FRAME",
            depth: 0,
            visible: true,
            bounds: { x: 100, y: 200, width: 400, height: 800 }
          },
          {
            id: "10:20",
            parentId: "1:2",
            name: "Primary action",
            type: "FRAME",
            depth: 1,
            visible: true,
            bounds: { x: 140, y: 600, width: 200, height: 80 }
          }
        ]),
        evidence.record.id
      );
    } finally {
      closeProjectDb(db);
    }
    fn(projectPath, {
      seedReferenceId: seed.record.id,
      surfaceId: evidence.record.id
    });
  } finally {
    rmSync(projectPath, { recursive: true, force: true });
  }
}

function singleTarget(link: { seedReferenceId: string; surfaceId: string }) {
  return {
    kind: "single" as const,
    target: {
      kind: "node" as const,
      seedReferenceId: link.seedReferenceId,
      evidenceSurfaceId: link.surfaceId,
      evidenceVersionId: link.surfaceId,
      nodeId: "1:2"
    }
  };
}

describe("Design Intent Alignment Runtime contract", () => {
  test("keeps pre-attempt legacy Agent Annotations readable without assigning a section", () => {
    withProject((projectPath, link) => {
      const now = new Date().toISOString();
      const db = openProjectDb(projectPath);
      try {
        db.prepare(
          `INSERT INTO agent_alignment_annotations
             (id, inference, title, body, additional_information_json,
              anchor_json, created_at, updated_at, alignment_attempt_id,
              agent_idempotency_key, section)
           VALUES (?, 'reasonable', ?, ?, '[]', ?, ?, ?, NULL, NULL, NULL)`
        ).run(
          "legacy-orphan-annotation",
          "Legacy Hypothesis",
          "This annotation predates attempt-bound preparation.",
          JSON.stringify({
            kind: "single",
            target: {
              kind: "surface",
              seedReferenceId: link.seedReferenceId,
              evidenceSurfaceId: link.surfaceId,
              evidenceVersionId: link.surfaceId
            }
          }),
          now,
          now
        );
      } finally {
        closeProjectDb(db);
      }

      expect(getDesignIntentAlignment(projectPath).annotations).toMatchObject([
        {
          id: "legacy-orphan-annotation",
          alignment_attempt_id: null,
          section: null,
          title: "Legacy Hypothesis"
        }
      ]);
    });
  });

  test("persists section identity and all three anchor modes for Agent Annotations", () => {
    withProject((projectPath, link) => {
      setDesignLanguageDescription(projectPath, "A calm, precise product language");
      const prepared = prepareDesignIntentAlignment(projectPath);
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;
      expect(claimAlignmentPreparationCommand(projectPath).ok).toBe(true);

      const inputs = [
        {
          section: "design-concept",
          idempotencyKey: "annotation-node",
          anchor: singleTarget(link)
        },
        {
          section: "visual-language",
          idempotencyKey: "annotation-surface",
          anchor: {
            kind: "single" as const,
            target: {
              kind: "surface" as const,
              seedReferenceId: link.seedReferenceId,
              evidenceSurfaceId: link.surfaceId,
              evidenceVersionId: link.surfaceId
            }
          }
        },
        {
          section: "component",
          idempotencyKey: "annotation-focus-set",
          anchor: {
            kind: "focus-target-set" as const,
            targets: [
              singleTarget(link).target,
              { ...singleTarget(link).target, nodeId: "10:20" }
            ]
          }
        }
      ] as const;

      for (const [index, input] of inputs.entries()) {
        const created = createAgentAnnotation(projectPath, {
          alignmentAttemptId: prepared.attempt.id,
          idempotencyKey: input.idempotencyKey,
          section: input.section,
          inference: "reasonable",
          title: `Section hypothesis ${index + 1}`,
          body: "This section-specific hypothesis needs designer confirmation.",
          anchor: input.anchor
        });
        expect(created.ok).toBe(true);
        if (!created.ok) continue;
        expect(created.record.section).toBe(input.section);
        expect(created.record.anchor.kind).toBe(input.anchor.kind);
      }

      expect(
        getDesignIntentAlignment(projectPath).annotations.map((annotation) => ({
          section: annotation.section,
          anchorKind: annotation.anchor.kind
        }))
      ).toEqual([
        { section: "design-concept", anchorKind: "single" },
        { section: "visual-language", anchorKind: "single" },
        { section: "component", anchorKind: "focus-target-set" }
      ]);

      const db = openProjectDb(projectPath);
      try {
        db.prepare(
          "UPDATE agent_alignment_annotations SET section = NULL WHERE agent_idempotency_key = ?"
        ).run("annotation-node");
      } finally {
        closeProjectDb(db);
      }
      expect(
        getDesignIntentAlignment(projectPath).annotations[0]?.section
      ).toBeNull();
    });
  });

  test("requires a same-section Agent Annotation before creating a Question Card", () => {
    withProject((projectPath, link) => {
      setDesignLanguageDescription(projectPath, "A calm, precise product language");
      const prepared = prepareDesignIntentAlignment(projectPath);
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;
      expect(claimAlignmentPreparationCommand(projectPath).ok).toBe(true);

      const questionInput = {
        alignmentAttemptId: prepared.attempt.id,
        idempotencyKey: "layout-question",
        section: "layout",
        observation: "Flexible Grid",
        question: "Should the grid adapt across viewport sizes?",
        anchor: singleTarget(link)
      } as const;

      expect(createQuestionCardRuntime(projectPath, questionInput)).toEqual({
        ok: false,
        reason: "section_annotation_required"
      });

      expect(
        createAgentAnnotation(projectPath, {
          alignmentAttemptId: prepared.attempt.id,
          idempotencyKey: "token-hypothesis",
          section: "token",
          inference: "reasonable",
          title: "Sparse Accent",
          body: "Accent color appears intentionally sparse.",
          anchor: singleTarget(link)
        }).ok
      ).toBe(true);
      expect(createQuestionCardRuntime(projectPath, questionInput)).toEqual({
        ok: false,
        reason: "section_annotation_required"
      });

      expect(
        createAgentAnnotation(projectPath, {
          alignmentAttemptId: prepared.attempt.id,
          idempotencyKey: "layout-hypothesis",
          section: "layout",
          inference: "reasonable",
          title: "Flexible Grid",
          body: "The layout appears designed to adapt across viewport sizes.",
          anchor: singleTarget(link)
        }).ok
      ).toBe(true);
      expect(createQuestionCardRuntime(projectPath, questionInput).ok).toBe(true);
      expect(
        createAgentAnnotation(projectPath, {
          alignmentAttemptId: prepared.attempt.id,
          idempotencyKey: "late-layout-assertion",
          section: "layout",
          inference: "confirmed",
          title: "Late Assertion",
          body: "This assertion must not be added after questions start.",
          anchor: singleTarget(link)
        })
      ).toEqual({
        ok: false,
        reason: "section_questions_already_started"
      });
    });
  });

  test("exposes exactly the six gate sections; Content is rejected", () => {
    expect(ALIGNMENT_SECTIONS).toEqual([
      "design-concept",
      "visual-language",
      "token",
      "layout",
      "component",
      "interaction"
    ]);

    withProject((projectPath, link) => {
      setDesignLanguageDescription(projectPath, "A calm, precise product language");
      const result = createQuestionCard(projectPath, {
        section: "content",
        observation: "Labels are concise",
        question: "Should labels remain concise?",
        anchor: singleTarget(link)
      });
      expect(result).toEqual({ ok: false, reason: "invalid_section" });
    });
  });

  test("requires project description and validates current single/focus target linkage", () => {
    withProject((projectPath, link) => {
      const blocked = createQuestionCard(projectPath, {
        section: "layout",
        observation: "Cards share a grid",
        question: "Should the grid remain fixed?",
        anchor: singleTarget(link)
      });
      expect(blocked).toEqual({
        ok: false,
        reason: "design_language_description_required"
      });

      setDesignLanguageDescription(projectPath, "A calm, precise product language");
      const emptyQuestion = createQuestionCard(projectPath, {
        section: "layout",
        observation: "Cards share a grid",
        question: "   ",
        anchor: singleTarget(link)
      });
      expect(emptyQuestion).toEqual({ ok: false, reason: "empty_question" });

      const mismatched = createQuestionCard(projectPath, {
        section: "layout",
        observation: "Cards share a grid",
        question: "Should the grid remain fixed?",
        anchor: {
          kind: "single",
          target: {
            kind: "node",
            seedReferenceId: link.seedReferenceId,
            evidenceSurfaceId: link.surfaceId,
            evidenceVersionId: "not-the-surface",
            nodeId: "1:2"
          }
        }
      });
      expect(mismatched).toEqual({ ok: false, reason: "invalid_anchor_linkage" });

      const oneTargetSet = createQuestionCard(projectPath, {
        section: "layout",
        observation: "Cards repeat",
        question: "Should repeated cards share spacing?",
        anchor: { kind: "focus-target-set", targets: [singleTarget(link).target] }
      });
      expect(oneTargetSet).toEqual({ ok: false, reason: "invalid_focus_target_set" });

      const surfaceInFocusSet = createQuestionCard(projectPath, {
        section: "layout",
        observation: "Shared layout language",
        question: "Should these references share one layout language?",
        anchor: {
          kind: "focus-target-set",
          targets: [
            {
              kind: "surface",
              seedReferenceId: link.seedReferenceId,
              evidenceSurfaceId: link.surfaceId,
              evidenceVersionId: link.surfaceId
            },
            {
              kind: "region",
              seedReferenceId: link.seedReferenceId,
              evidenceSurfaceId: link.surfaceId,
              evidenceVersionId: link.surfaceId,
              rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }
            }
          ]
        }
      });
      expect(surfaceInFocusSet).toEqual({
        ok: false,
        reason: "invalid_focus_target_set"
      });

      const missingNode = createQuestionCard(projectPath, {
        section: "layout",
        observation: "Unknown source node",
        question: "Can this be focused?",
        anchor: {
          kind: "single",
          target: {
            kind: "node",
            seedReferenceId: link.seedReferenceId,
            evidenceSurfaceId: link.surfaceId,
            evidenceVersionId: link.surfaceId,
            nodeId: "999:999"
          }
        }
      });
      expect(missingNode).toEqual({ ok: false, reason: "invalid_anchor_target" });
    });
  });

  test("requires a concise question-card title instead of a sentence-like observation", () => {
    withProject((projectPath, link) => {
      setDesignLanguageDescription(projectPath, "A calm, precise product language");
      const result = createQuestionCard(projectPath, {
        section: "design-concept",
        observation:
          "The portfolio and guideline reference both foreground authored visual identity over dense utility.",
        question: "Should editorial expression guide the system?",
        anchor: singleTarget(link)
      });

      expect(result).toEqual({ ok: false, reason: "question_title_too_long" });
      expect(createQuestionCard(projectPath, {
        section: "design-concept",
        observation: "Hierarchy",
        question: "Should hierarchy guide the system?",
        anchor: singleTarget(link)
      })).toEqual({ ok: false, reason: "invalid_question_title" });
      expect(createQuestionCard(projectPath, {
        section: "design-concept",
        observation: "Should hierarchy guide system?",
        question: "Should hierarchy guide the system?",
        anchor: singleTarget(link)
      })).toEqual({ ok: false, reason: "invalid_question_title" });
      expect(createQuestionCard(projectPath, {
        section: "design-concept",
        observation: "Hierarchy guides the system",
        question: "Hierarchy guides the system?",
        anchor: singleTarget(link)
      })).toEqual({ ok: false, reason: "invalid_question_title" });
      expect(createQuestionCard(projectPath, {
        section: "design-concept",
        observation: "Calm editorial hierarchy across all surfaces",
        question: "Should hierarchy guide the system?",
        anchor: singleTarget(link)
      })).toEqual({ ok: false, reason: "invalid_question_title" });
    });
  });

  test("accepts concise Han titles and rejects one-character or sentence-like Han titles", () => {
    withProject((projectPath, link) => {
      setDesignLanguageDescription(projectPath, "冷静、克制的产品语言");
      expect(createQuestionCard(projectPath, {
        section: "layout",
        observation: "交替分栏",
        question: "项目行是否保持交替分栏（先文后图，再图后文）？",
        proposedAnswer: "保持奇数项文左图右、偶数项图左文右，两列等宽。",
        anchor: singleTarget(link)
      }).ok).toBe(true);
      expect(createQuestionCard(projectPath, {
        section: "layout",
        observation: "全宽电影感裁切",
        question: "后续项目是否改为全宽裁切，标签放在图下一行？",
        proposedAnswer: "保留一个后期项目为全宽电影感裁切。",
        anchor: singleTarget(link)
      }).ok).toBe(true);
      expect(createQuestionCard(projectPath, {
        section: "layout",
        observation: "先分割再电影感裁切",
        question: "页首是否先留空再做电影感裁切？",
        proposedAnswer: "页首保持高空场，名称居中。",
        anchor: singleTarget(link)
      }).ok).toBe(true);
      expect(createQuestionCard(projectPath, {
        section: "layout",
        observation: "栏",
        question: "是否只用单栏？",
        anchor: singleTarget(link)
      })).toEqual({ ok: false, reason: "invalid_question_title" });
      expect(createQuestionCard(projectPath, {
        section: "layout",
        observation: "项目行是否应保持交替分栏布局结构",
        question: "项目行是否保持交替分栏？",
        anchor: singleTarget(link)
      })).toEqual({ ok: false, reason: "invalid_question_title" });
      expect(createQuestionCard(projectPath, {
        section: "layout",
        observation: "交替分栏。",
        question: "项目行是否保持交替分栏？",
        anchor: singleTarget(link)
      })).toEqual({ ok: false, reason: "invalid_question_title" });
      expect(createQuestionCard(projectPath, {
        section: "layout",
        observation: "交替分栏",
        question: "交替分栏？",
        anchor: singleTarget(link)
      })).toEqual({ ok: false, reason: "invalid_question_title" });
    });
  });

  test("resolves surface, node, and normalized region targets into mask-ready rects", () => {
    withProject((projectPath, link) => {
      setDesignLanguageDescription(projectPath, "A calm, precise product language");
      const created = createQuestionCard(projectPath, {
        section: "interaction",
        observation: "Actions repeat across contexts",
        question: "Should both actions share hover behavior?",
        anchor: {
          kind: "focus-target-set",
          targets: [
            {
              kind: "node",
              seedReferenceId: link.seedReferenceId,
              evidenceSurfaceId: link.surfaceId,
              evidenceVersionId: link.surfaceId,
              nodeId: "10:20"
            },
            {
              kind: "region",
              seedReferenceId: link.seedReferenceId,
              evidenceSurfaceId: link.surfaceId,
              evidenceVersionId: link.surfaceId,
              rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.25 }
            }
          ]
        }
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const targets = created.record.anchor.kind === "focus-target-set"
        ? created.record.anchor.targets
        : [];
      expect(targets[0].resolvedRect).toEqual({
        x: 0.1,
        y: 0.5,
        width: 0.5,
        height: 0.1
      });
      expect(targets[1].resolvedRect).toEqual({
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.25
      });

      const surface = createQuestionCard(projectPath, {
        section: "interaction",
        observation: "Whole frame interaction context",
        question: "Keep this interaction model across the surface?",
        anchor: {
          kind: "single",
          target: {
            kind: "surface",
            seedReferenceId: link.seedReferenceId,
            evidenceSurfaceId: link.surfaceId,
            evidenceVersionId: link.surfaceId
          }
        }
      });
      expect(surface.ok).toBe(true);
      if (surface.ok && surface.record.anchor.kind === "single") {
        expect(surface.record.anchor.target.resolvedRect).toEqual({
          x: 0,
          y: 0,
          width: 1,
          height: 1
        });
      }
    });
  });

  test("requires an explicit surface target for a whole-frame question", () => {
    withProject((projectPath, link) => {
      setDesignLanguageDescription(projectPath, "A calm, precise product language");
      const created = createQuestionCard(projectPath, {
        section: "layout",
        observation: "Flexible editorial layouts",
        question: "Should the system support both reference layouts?",
        anchor: {
          kind: "single",
          target: {
            kind: "region",
            seedReferenceId: link.seedReferenceId,
            evidenceSurfaceId: link.surfaceId,
            evidenceVersionId: link.surfaceId,
            rect: { x: 0.01, y: 0.01, width: 0.98, height: 0.98 }
          }
        }
      });

      expect(created).toEqual({
        ok: false,
        reason: "whole_surface_requires_surface_anchor"
      });
    });
  });

  test("gray Agent Annotations are attempt-bound, share one projection, and stay outside question coverage", () => {
    withProject((projectPath, link) => {
      setDesignLanguageDescription(projectPath, "A calm, precise product language");
      const prepared = prepareDesignIntentAlignment(projectPath);
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;
      expect(claimAlignmentPreparationCommand(projectPath).ok).toBe(true);
      const confirmed = createAgentAnnotation(projectPath, {
        alignmentAttemptId: prepared.attempt.id,
        idempotencyKey: "confirmed-root-layout",
        section: "layout",
        inference: "confirmed",
        title: "Root Layout",
        body: "The primary action is visually dominant",
        anchor: singleTarget(link)
      });
      const reasonable = createAgentAnnotation(projectPath, {
        alignmentAttemptId: prepared.attempt.id,
        idempotencyKey: "reasonable-border-hierarchy",
        section: "layout",
        inference: "reasonable",
        title: "Border hierarchy",
        body: "The muted border likely reduces hierarchy noise",
        anchor: singleTarget(link)
      });
      expect(confirmed.ok).toBe(true);
      expect(reasonable.ok).toBe(true);
      if (!confirmed.ok || !reasonable.ok) return;
      expect(confirmed.record.card_kind).toBe("agent-annotation");
      expect(confirmed.record.alignment_attempt_id).toBe(prepared.attempt.id);
      expect(confirmed.record.title).toBe("Root Layout");
      expect(reasonable.record.card_kind).toBe("agent-annotation");

      const appended = appendAgentAnnotationInformation(
        projectPath,
        confirmed.record.id,
        "Designer confirms this applies to checkout only"
      );
      expect(appended.ok).toBe(true);

      const snapshot = getDesignIntentAlignment(projectPath);
      expect(snapshot.annotations).toHaveLength(2);
      expect(snapshot.annotations[0].additional_information).toEqual([
        "Designer confirms this applies to checkout only"
      ]);
      expect(snapshot.coverage.total_questions).toBe(0);
      expect(snapshot.coverage.can_complete).toBe(false);

      expect(
        createAgentAnnotation(projectPath, {
          alignmentAttemptId: prepared.attempt.id,
          idempotencyKey: "invalid-empty-title",
          section: "layout",
          inference: "confirmed",
          title: "   ",
          body: "Missing title should fail",
          anchor: singleTarget(link)
        })
      ).toEqual({ ok: false, reason: "empty_title" });
    });
  });

  test("designer edit persists immediately with source and emits record+event", () => {
    withProject((projectPath, link) => {
      resetRecordBusForTests();
      const invalidations: RecordBusEvent[] = [];
      const unsubscribe = subscribeRecordEvents((event) => invalidations.push(event));
      setDesignLanguageDescription(projectPath, "A calm, precise product language");
      const card = createQuestionCard(projectPath, {
        section: "token",
        observation: "Sparse accent color usage",
        question: "Reserve accent for primary actions?",
        proposedAnswer: "Yes, reserve it for primary actions",
        anchor: singleTarget(link)
      });
      expect(card.ok).toBe(true);
      if (!card.ok) return;

      forceAnsweringFixture(projectPath);

      const answer = recordDesignerAnswer(projectPath, {
        questionCardId: card.record.id,
        finalAnswer: "Yes, but allow it for selected navigation too"
      });
      expect(answer.ok).toBe(true);
      if (!answer.ok) return;
      expect(answer.record.final_answer).toBe(
        "Yes, but allow it for selected navigation too"
      );
      expect(answer.record.answer_source).toBe("designer-edited");

      const read = getDesignIntentAlignment(projectPath);
      expect(read.question_cards[0].final_answer).toBe(answer.record.final_answer);
      expect(read.question_cards[0].status).toBe("answered");
      expect(listEvents(projectPath, "designer_answer_submitted")).toHaveLength(1);
      expect(invalidations).toContainEqual(
        expect.objectContaining({
          kind: "alignment",
          action: "updated",
          id: card.record.id
        })
      );
      unsubscribe();
    });
  });

  test("updates a legacy question-card title through an audited command", () => {
    withProject((projectPath, link) => {
      setDesignLanguageDescription(projectPath, "A calm, precise product language");
      const card = createQuestionCard(projectPath, {
        section: "design-concept",
        observation: "Editorial identity",
        question: "Should expression guide systems?",
        anchor: singleTarget(link)
      });
      expect(card.ok).toBe(true);
      if (!card.ok) return;

      const updated = updateQuestionCardTitle(projectPath, {
        questionCardId: card.record.id,
        title: "Authored identity"
      });

      expect(updated.ok).toBe(true);
      if (!updated.ok) return;
      expect(updated.record.observation).toBe("Authored identity");
      expect(getDesignIntentAlignment(projectPath).question_cards[0].observation)
        .toBe("Authored identity");
      expect(listEvents(projectPath, "question_card_title_updated")).toHaveLength(1);
      expect(updateQuestionCardTitle(projectPath, {
        questionCardId: card.record.id,
        title: "Should expression guide systems?"
      })).toEqual({ ok: false, reason: "invalid_question_title" });
      expect(updateQuestionCardTitle(projectPath, {
        questionCardId: card.record.id,
        title: "Should expression guide systems"
      })).toEqual({ ok: false, reason: "invalid_question_title" });
    });
  });

  test("repairs a question-card anchor through an audited Runtime command", () => {
    withProject((projectPath, link) => {
      setDesignLanguageDescription(projectPath, "A calm, precise product language");
      const card = createQuestionCard(projectPath, {
        section: "layout",
        observation: "Large compositional zones",
        question: "Should layouts favor a few large zones?",
        anchor: {
          kind: "single",
          target: {
            kind: "region",
            seedReferenceId: link.seedReferenceId,
            evidenceSurfaceId: link.surfaceId,
            evidenceVersionId: link.surfaceId,
            rect: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }
          }
        }
      });
      expect(card.ok).toBe(true);
      if (!card.ok) return;

      const updated = updateQuestionCardAnchor(projectPath, {
        questionCardId: card.record.id,
        anchor: {
          kind: "single",
          target: {
            kind: "surface",
            seedReferenceId: link.seedReferenceId,
            evidenceSurfaceId: link.surfaceId,
            evidenceVersionId: link.surfaceId
          }
        }
      });

      expect(updated.ok).toBe(true);
      if (!updated.ok) return;
      expect(updated.record.anchor).toEqual({
        kind: "single",
        target: expect.objectContaining({ kind: "surface" })
      });
      expect(listEvents(projectPath, "question_card_anchor_updated")).toHaveLength(1);
    });
  });

  test("rejects anchor repair against evidence created after the attempt snapshot", () => {
    withProject((projectPath, link) => {
      setDesignLanguageDescription(projectPath, "A calm, precise product language");
      const card = createQuestionCard(projectPath, {
        section: "layout",
        observation: "Stable layout anchor",
        question: "Should layouts preserve this anchor?",
        anchor: singleTarget(link)
      });
      expect(card.ok).toBe(true);
      if (!card.ok) return;

      const refreshed = recordEvidencePackage(projectPath, {
        seedReferenceId: link.seedReferenceId,
        frame: { nodeId: "1:2", name: "Checkout refreshed" },
        evidenceViews: { rawData: "available", screenshot: "missing" }
      });
      expect(refreshed.ok).toBe(true);
      if (!refreshed.ok) return;

      expect(updateQuestionCardAnchor(projectPath, {
        questionCardId: card.record.id,
        anchor: {
          kind: "single",
          target: {
            kind: "surface",
            seedReferenceId: link.seedReferenceId,
            evidenceSurfaceId: refreshed.record.id,
            evidenceVersionId: refreshed.record.id
          }
        }
      })).toEqual({ ok: false, reason: "invalid_anchor_linkage" });
    });
  });

  test("coverage requires 2–5 explicitly submitted final answers in every section", () => {
    withProject((projectPath, link) => {
      setDesignLanguageDescription(projectPath, "A calm, precise product language");
      const ids: string[] = [];
      for (const section of ALIGNMENT_SECTIONS) {
        for (let index = 1; index <= 2; index += 1) {
          const created = createQuestionCard(projectPath, {
            section,
            observation: `${section} observation ${index}`,
            question: `${section} question ${index}?`,
            proposedAnswer: `${section} proposal ${index}`,
            anchor: singleTarget(link)
          });
          expect(created.ok).toBe(true);
          if (created.ok) ids.push(created.record.id);
        }
      }

      const before = getDesignIntentAlignment(projectPath);
      expect(before.coverage.can_complete).toBe(false);
      expect(before.coverage.sections.every((section) => !section.complete)).toBe(true);
      expect(before.coverage.sections.every((section) => section.covered_count === 0)).toBe(true);
      expect(before.question_cards.every((card) => card.status === "unanswered")).toBe(true);

      const preparation = before.preparation.current_attempt;
      expect(preparation).not.toBeNull();
      if (!preparation) return;
      expect(finalizeAlignmentPreparation(projectPath, preparation.id).ok).toBe(true);

      expect(completeDesignIntentAlignment(projectPath)).toEqual({
        ok: false,
        reason: "coverage_incomplete"
      });

      const answering = getDesignIntentAlignment(projectPath);
      for (const card of answering.question_cards) {
        const confirmed = recordDesignerAnswer(projectPath, {
          questionCardId: card.id,
          finalAnswer: card.proposed_answer
        });
        expect(confirmed.ok).toBe(true);
        if (confirmed.ok) {
          expect(confirmed.record.answer_source).toBe(
            "agent-proposed-designer-accepted"
          );
        }
      }

      const confirmed = getDesignIntentAlignment(projectPath);
      expect(confirmed.coverage.can_complete).toBe(true);
      expect(confirmed.coverage.sections.every((section) => section.complete)).toBe(true);

      const completed = completeDesignIntentAlignment(projectPath);
      expect(completed.ok).toBe(true);
      if (!completed.ok) return;
      expect(completed.alignment.status).toBe("completed");
      expect(completed.question_cards).toHaveLength(12);
      expect(
        completed.question_cards.every(
          (card) =>
            card.final_answer === card.proposed_answer &&
            card.answer_source === "agent-proposed-designer-accepted" &&
            card.status === "answered"
        )
      ).toBe(true);
      expect(listEvents(projectPath, "design_intent_alignment_completed")).toHaveLength(1);
      expect(listEvents(projectPath, "designer_answer_submitted")).toHaveLength(12);

      const db = openProjectDb(projectPath);
      try {
        const persisted = db
          .prepare("SELECT COUNT(*) AS count FROM alignment_question_cards WHERE final_answer IS NOT NULL")
          .get() as { count: number };
        expect(persisted.count).toBe(ids.length);
      } finally {
        closeProjectDb(db);
      }
    });
  });
});
