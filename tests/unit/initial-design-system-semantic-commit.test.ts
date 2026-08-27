import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  claimAlignmentPreparationCommand,
  finalizeAlignmentPreparation
} from "../../lib/runtime/alignment-agent-command";
import { prepareDesignIntentAlignment } from "../../lib/runtime/alignment-preparation";
import { initializeProjectDb } from "../../lib/runtime/db";
import {
  ALIGNMENT_SECTIONS,
  completeDesignIntentAlignment,
  createAgentAnnotation,
  createQuestionCard,
  recordDesignerAnswer
} from "../../lib/runtime/design-intent-alignment";
import { recordEvidencePackage } from "../../lib/runtime/evidence-package";
import { getProjectPhase } from "../../lib/runtime/project-phase";
import {
  claimInitialDesignSystemPreparation
} from "../../lib/runtime/initial-design-system-preparation";
import {
  commitInitialDesignSystemSemantic,
  type CommitInitialDesignSystemSemanticInput
} from "../../lib/runtime/initial-design-system-semantic-commit";
import { setDesignLanguageDescription } from "../../lib/runtime/project-readiness";
import { registerSeedReference } from "../../lib/runtime/seed-reference";

const projects: string[] = [];

function completedAlignment() {
  const projectPath = mkdtempSync(path.join(tmpdir(), "ikran-semantic-commit-"));
  projects.push(projectPath);
  initializeProjectDb(projectPath);
  const seed = registerSeedReference(projectPath, {
    figmaSeedReference: "https://www.figma.com/design/SemanticCommit/Seed?node-id=1:2",
    originalDesignIntent: "A precise dark digital studio."
  });
  if (!seed.ok) throw new Error(seed.reason);
  const evidence = recordEvidencePackage(projectPath, {
    seedReferenceId: seed.record.id,
    frame: { nodeId: "1:2", name: "Studio" },
    evidenceViews: { rawData: "available", screenshot: "missing" }
  });
  if (!evidence.ok) throw new Error(evidence.reason);
  const description = setDesignLanguageDescription(
    projectPath,
    "冷静、精密的数字工作室风格，以深色背景和强对比排版表达专业感。"
  );
  if (!description.ok) throw new Error(description.reason);
  const prepared = prepareDesignIntentAlignment(projectPath);
  if (!prepared.ok) throw new Error(prepared.reason);
  const claimed = claimAlignmentPreparationCommand(projectPath);
  if (!claimed.ok) throw new Error(claimed.reason);

  const questions: Array<{ id: string; section: string }> = [];
  for (const section of ALIGNMENT_SECTIONS) {
    const annotation = createAgentAnnotation(projectPath, {
      alignmentAttemptId: prepared.attempt.id,
      idempotencyKey: `annotation-${section}`,
      section,
      inference: section === "visual-language" ? "reasonable" : "confirmed",
      title: `${section} observation`,
      body: `${section} evidence is intentional.`,
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
    for (let index = 0; index < 2; index += 1) {
      const question = createQuestionCard(projectPath, {
        alignmentAttemptId: prepared.attempt.id,
        idempotencyKey: `question-${section}-${index}`,
        section,
        observation: `${section} ${index + 1}`,
        question: `Confirm ${section} decision ${index + 1}?`,
        proposedAnswer: `Confirmed ${section} decision ${index + 1}.`,
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
      if (!question.ok) throw new Error(question.reason);
      questions.push({ id: question.record.id, section });
    }
  }
  const finalized = finalizeAlignmentPreparation(projectPath, prepared.attempt.id);
  if (!finalized.ok) throw new Error(finalized.reason);
  for (const question of questions) {
    const answer = recordDesignerAnswer(projectPath, {
      questionCardId: question.id,
      finalAnswer: `Designer confirmed ${question.section}.`
    });
    if (!answer.ok) throw new Error(answer.reason);
  }
  const completed = completeDesignIntentAlignment(projectPath);
  if (!completed.ok) throw new Error(completed.reason);
  return { projectPath, attemptId: prepared.attempt.id };
}

function semanticInput(
  attemptId: string,
  claimed: Extract<ReturnType<typeof claimInitialDesignSystemPreparation>, { ok: true }>
): CommitInitialDesignSystemSemanticInput {
  const source = (section: string) =>
    claimed.question_cards.find((card) => card.section === section)!.id;
  return {
    alignmentAttemptId: attemptId,
    idempotencyKey: "semantic-commit-v1",
    designSystem: {
      name: "Ikran Studio",
      visualLanguage: {
        description: "深色背景承载强对比排版，并以少量高饱和色强调关键动作。",
        meaning: "冷静精密的数字工作室",
        sourceRecordIds: [source("visual-language")]
      },
      concepts: [{
        meaning: "克制强调",
        value: "高饱和色仅用于关键动作与当前状态。",
        sourceRecordIds: [source("design-concept")]
      }],
      tokens: {
        primitive: [{
          name: "fontFamily.display",
          domain: "typography",
          value: "Instrument Sans, sans-serif",
          sourceRecordIds: [source("token")]
        }],
        semantic: [],
        component: []
      },
      layoutRules: [{
        meaning: "宽阔留白",
        value: "使用宽阔留白和严格网格建立精密秩序。",
        sourceRecordIds: [source("layout")]
      }],
      interactionRules: [{
        meaning: "短促反馈",
        value: "交互反馈保持短促，只解释状态变化。",
        sourceRecordIds: [source("interaction")]
      }],
      components: [{
        name: "Project Showcase",
        description: "以高对比图像和精确元数据显示项目。",
        sourceRecordIds: [source("component")],
        props: [{ name: "title", type: "string" }],
        variants: [],
        stateMatrix: [{ state: "default", behavior: "Shows project metadata." }],
        guidelines: [{ kind: "do", text: "保留项目标题与图像的强层级。" }],
        tokenLinks: ["primitive.fontFamily.display"],
        codeLinks: [],
        group: "block"
      }]
    }
  };
}

afterEach(() => {
  for (const projectPath of projects.splice(0)) {
    rmSync(projectPath, { recursive: true, force: true });
  }
});

describe("commitInitialDesignSystemSemantic", () => {
  test("projects one semantic bundle through the existing artifact, lineage, audit, and finalize gates", () => {
    const fixture = completedAlignment();
    const claimed = claimInitialDesignSystemPreparation(fixture.projectPath);
    if (!claimed.ok) throw new Error(claimed.reason);
    const input = semanticInput(fixture.attemptId, claimed);

    const result = commitInitialDesignSystemSemantic(fixture.projectPath, input);

    expect(result).toMatchObject({
      ok: true,
      reused: false,
      artifactPaths: expect.arrayContaining([
        "design-system/design-system.json",
        "design-system/components/project-showcase.json"
      ]),
      workUnitKeys: expect.arrayContaining([
        "global",
        "tokens",
        "layout",
        "interaction",
        "component:component-project-showcase"
      ])
    });
    expect(getProjectPhase(fixture.projectPath)).toBe("draft_design_system");
    const spec = JSON.parse(readFileSync(
      path.join(fixture.projectPath, "design-system/components/project-showcase.json"),
      "utf8"
    )) as Record<string, unknown>;
    expect(spec).toMatchObject({
      id: "component-spec-project-showcase",
      name: "Project Showcase",
      status: "candidate"
    });

    const repeated = commitInitialDesignSystemSemantic(fixture.projectPath, input);
    expect(repeated).toMatchObject({ ok: true, reused: true });
  });

  test("rejects unknown source ids before writing projected artifacts", () => {
    const fixture = completedAlignment();
    const claimed = claimInitialDesignSystemPreparation(fixture.projectPath);
    if (!claimed.ok) throw new Error(claimed.reason);
    const input = semanticInput(fixture.attemptId, claimed);
    input.designSystem.visualLanguage.sourceRecordIds = ["missing-source"];

    expect(commitInitialDesignSystemSemantic(fixture.projectPath, input)).toMatchObject({
      ok: false,
      reason: "invalid_semantic_source",
      failedStage: "projection"
    });
  });
});
