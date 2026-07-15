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
  createQuestionCard,
  getDesignIntentAlignment,
  recordDesignerAnswer
} from "../../lib/runtime/design-intent-alignment";

const FIGMA = "https://www.figma.com/design/AbCdEf/Checkout?node-id=1:2";

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
  test("exposes exactly the six gate sections; Content is rejected", () => {
    expect(ALIGNMENT_SECTIONS).toEqual([
      "design-principle",
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
        observation: "The whole frame establishes interaction context",
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

  test("gray Agent Annotations share one projection, can append information, and never block coverage", () => {
    withProject((projectPath, link) => {
      setDesignLanguageDescription(projectPath, "A calm, precise product language");
      const confirmed = createAgentAnnotation(projectPath, {
        inference: "confirmed",
        title: "Root Layout",
        body: "The primary action is visually dominant",
        anchor: singleTarget(link)
      });
      const reasonable = createAgentAnnotation(projectPath, {
        inference: "reasonable",
        title: "Border hierarchy",
        body: "The muted border likely reduces hierarchy noise",
        anchor: singleTarget(link)
      });
      expect(confirmed.ok).toBe(true);
      expect(reasonable.ok).toBe(true);
      if (!confirmed.ok || !reasonable.ok) return;
      expect(confirmed.record.card_kind).toBe("agent-annotation");
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
        observation: "The accent color is used sparingly",
        question: "Reserve accent for primary actions?",
        proposedAnswer: "Yes, reserve it for primary actions",
        anchor: singleTarget(link)
      });
      expect(card.ok).toBe(true);
      if (!card.ok) return;

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

  test("coverage requires 2–5 cards in every section and Complete atomically accepts proposals", () => {
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
      expect(before.coverage.can_complete).toBe(true);
      expect(before.coverage.sections.every((section) => section.complete)).toBe(true);
      expect(before.question_cards.every((card) => card.status === "unanswered")).toBe(true);

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
