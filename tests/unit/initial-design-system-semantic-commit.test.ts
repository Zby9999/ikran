import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
  claimInitialDesignSystemSemanticContext,
  commitIncrementalInitialDesignSystemPlan,
  commitInitialDesignSystemSemantic,
  type CommitInitialDesignSystemSemanticInput
} from "../../lib/runtime/initial-design-system-semantic-commit";
import {
  readAlignmentSemanticDelta,
  readIncrementalPlanningStatus,
  recordIncrementalDesignSystemPlan
} from "../../lib/runtime/alignment-incremental-planning";
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
    for (let index = 0; index < 3; index += 1) {
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
  claimed: Extract<ReturnType<typeof claimInitialDesignSystemSemanticContext>, { ok: true }>
): CommitInitialDesignSystemSemanticInput {
  const source = (section: string) =>
    claimed.sources.find((record) => record.kind === "question" && record.section === section)!.ref;
  const componentNames = [
    "Project Showcase",
    "Project Card",
    "Filter Bar",
    "Studio Header",
    "Project Metadata",
    "Contact Panel"
  ];
  return {
    alignmentAttemptId: attemptId,
    idempotencyKey: "semantic-commit-v1",
    designSystem: {
      name: "Ikran Studio",
      visualLanguage: {
        description: "深色背景承载强对比排版，并以少量高饱和色强调关键动作。",
        meaning: "冷静精密的数字工作室",
        sourceRefs: [source("visual-language")]
      },
      concepts: [{
        meaning: "克制强调",
        value: "高饱和色仅用于关键动作与当前状态。",
        sourceRefs: [source("design-concept")]
      }],
      tokens: {
        primitive: [{
          name: "fontFamily.display",
          domain: "typography",
          value: "Instrument Sans, sans-serif",
          sourceRefs: [source("token")]
        }],
        semantic: [],
        component: []
      },
      layoutRules: [{
        meaning: "宽阔留白",
        value: "使用宽阔留白和严格网格建立精密秩序。",
        sourceRefs: [source("layout")]
      }],
      interactionRules: [{
        meaning: "短促反馈",
        value: "交互反馈保持短促，只解释状态变化。",
        sourceRefs: [source("interaction")]
      }],
      components: componentNames.map((name) => ({
        name,
        description: `${name} 以高对比图像和精确元数据显示项目。`,
        sourceRefs: [source("component")],
        props: [{ name: "title", type: "string" }],
        variants: [],
        stateMatrix: [{ state: "default", behavior: "Shows project metadata." }],
        guidelines: [{ kind: "do", text: "保留项目标题与图像的强层级。" }],
        tokenLinks: ["primitive.fontFamily.display"],
        codeLinks: [],
        group: "block"
      }))
    }
  };
}

afterEach(() => {
  for (const projectPath of projects.splice(0)) {
    rmSync(projectPath, { recursive: true, force: true });
  }
});

describe("commitInitialDesignSystemSemantic", () => {
  test("selects the existing preparation claim when no incremental plan exists", () => {
    const fixture = completedAlignment();

    expect(commitIncrementalInitialDesignSystemPlan(fixture.projectPath, {
      alignmentAttemptId: fixture.attemptId,
      planVersion: 1,
      idempotencyKey: "missing-plan-fallback"
    })).toEqual({
      ok: false,
      reason: "incremental_plan_unavailable",
      fallback: { tool: "claim_initial_design_system_preparation" }
    });
    expect(getProjectPhase(fixture.projectPath)).not.toBe("draft_design_system");
  });

  test("commits a caught-up frozen incremental plan without another semantic bundle", () => {
    const fixture = completedAlignment();
    const claimed = claimInitialDesignSystemSemanticContext(fixture.projectPath);
    if (!claimed.ok) throw new Error(claimed.reason);
    const designSystem = semanticInput(fixture.attemptId, claimed).designSystem;
    const sectionPlanningMs: number[] = [];

    for (let index = 0; index < ALIGNMENT_SECTIONS.length; index += 1) {
      const sectionStartedAt = performance.now();
      const delta = readAlignmentSemanticDelta(fixture.projectPath, {
        alignmentAttemptId: fixture.attemptId,
        afterRevision: 0
      });
      if (!delta.ok || !delta.delta) throw new Error("missing plan delta");
      const source = delta.delta.sources[0];
      const recorded = recordIncrementalDesignSystemPlan(fixture.projectPath, {
        alignmentAttemptId: fixture.attemptId,
        idempotencyKey: `frozen-plan-${index}`,
        baseRevision: delta.currentRevision,
        section: delta.delta.section,
        sectionDigest: delta.delta.sectionDigest,
        decisions: [{
          decisionId: `frozen-decision-${index}`,
          outputConcern: delta.delta.section,
          statement: `Prepared ${delta.delta.section} semantics.`,
          sourceRefs: [{ sourceId: source.sourceId, digest: source.digest }]
        }],
        designSystemDraft: designSystem
      });
      expect(recorded.ok).toBe(true);
      sectionPlanningMs.push(performance.now() - sectionStartedAt);
    }
    const status = readIncrementalPlanningStatus(
      fixture.projectPath,
      fixture.attemptId
    );
    expect(status).toMatchObject({
      ok: true,
      acknowledgedSections: ALIGNMENT_SECTIONS,
      staleDecisionIds: [],
      nextAction: { tool: "commit_incremental_initial_design_system_plan" }
    });
    if (!status.ok) throw new Error(status.reason);

    const commitStartedAt = performance.now();
    const committed = commitIncrementalInitialDesignSystemPlan(fixture.projectPath, {
      alignmentAttemptId: fixture.attemptId,
      planVersion: status.planVersion,
      idempotencyKey: "commit-frozen-plan"
    });
    const commitElapsedMs = performance.now() - commitStartedAt;
    expect(committed).toMatchObject({
      ok: true,
      draftReady: true,
      projectPhase: "draft_design_system",
      planVersion: status.planVersion,
      frozenRevision: status.frozenRevision
    });
    expect(Math.max(...sectionPlanningMs)).toBeLessThan(500);
    expect(commitElapsedMs).toBeLessThan(2_000);
    if (process.env.IKRAN_BENCHMARK_OUTPUT === "1") {
      console.info(JSON.stringify({
        benchmark: "incremental-plan-runtime",
        sections: sectionPlanningMs.length,
        sectionPlanningMs: sectionPlanningMs.map((value) => Number(value.toFixed(1))),
        maxSectionPlanningMs: Number(Math.max(...sectionPlanningMs).toFixed(1)),
        planBackedCommitMs: Number(commitElapsedMs.toFixed(1))
      }));
    }
  });

  test("projects one semantic bundle through the existing artifact, lineage, audit, and finalize gates", () => {
    const fixture = completedAlignment();
    const claimed = claimInitialDesignSystemSemanticContext(fixture.projectPath);
    if (!claimed.ok) throw new Error(claimed.reason);
    const input = semanticInput(fixture.attemptId, claimed);

    const commitStartedAt = performance.now();
    const result = commitInitialDesignSystemSemantic(fixture.projectPath, input);
    const commitElapsedMs = performance.now() - commitStartedAt;

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
      ]),
      draftReady: true,
      projectPhase: "draft_design_system"
    });
    expect(result).not.toHaveProperty("result");
    if (!result.ok) throw new Error(result.reason);
    expect(commitElapsedMs).toBeLessThan(2_000);
    expect(JSON.stringify(result).length).toBeLessThan(2_000);
    if (process.env.IKRAN_BENCHMARK_OUTPUT === "1") {
      console.info(JSON.stringify({
        benchmark: "semantic-commit",
        sources: claimed.sources.length,
        components: input.designSystem.components.length,
        artifacts: result.artifactPaths.length,
        elapsedMs: Number(commitElapsedMs.toFixed(1)),
        responseBytes: Buffer.byteLength(JSON.stringify(result), "utf8")
      }));
    }
    expect(result.artifactPaths).toHaveLength(11);
    expect(result.workUnitKeys).toHaveLength(10);
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
    expect(JSON.stringify(spec)).not.toContain('"Q01"');

    const repeated = commitInitialDesignSystemSemantic(fixture.projectPath, input);
    expect(repeated).toMatchObject({ ok: true, reused: true });
  });

  test("rejects unknown source refs before writing projected artifacts", () => {
    const fixture = completedAlignment();
    const claimed = claimInitialDesignSystemSemanticContext(fixture.projectPath);
    if (!claimed.ok) throw new Error(claimed.reason);
    const input = semanticInput(fixture.attemptId, claimed);
    input.designSystem.visualLanguage.sourceRefs = ["missing-source"];

    expect(commitInitialDesignSystemSemantic(fixture.projectPath, input)).toMatchObject({
      ok: false,
      reason: "invalid_semantic_source",
      failedStage: "projection"
    });
  });

  test("validates the complete projection before writing any artifact", () => {
    const fixture = completedAlignment();
    const claimed = claimInitialDesignSystemSemanticContext(fixture.projectPath);
    if (!claimed.ok) throw new Error(claimed.reason);
    const input = semanticInput(fixture.attemptId, claimed);
    input.designSystem.tokens.primitive[0]!.value = undefined;

    expect(commitInitialDesignSystemSemantic(fixture.projectPath, input)).toMatchObject({
      ok: false,
      reason: "invalid_projected_artifact",
      failedStage: "projection"
    });
    expect(
      existsSync(path.join(fixture.projectPath, "design-system/design-system.json"))
    ).toBe(false);
    expect(getProjectPhase(fixture.projectPath)).not.toBe("draft_design_system");
  });

  test("claims a Study Kit 5-scale compact context within the response budget", () => {
    const fixture = completedAlignment();
    const raw = claimInitialDesignSystemPreparation(fixture.projectPath);
    const claimStartedAt = performance.now();
    const compact = claimInitialDesignSystemSemanticContext(fixture.projectPath);
    const claimElapsedMs = performance.now() - claimStartedAt;
    if (!raw.ok || !compact.ok) throw new Error("claim failed");

    const serialized = JSON.stringify(compact);
    expect(compact.sources).toHaveLength(24);
    expect(compact.sources[0]).toMatchObject({ ref: "Q01", kind: "question" });
    expect(serialized.length).toBeLessThan(12_000);
    expect(claimElapsedMs).toBeLessThan(500);
    expect(serialized.length).toBeLessThan(JSON.stringify(raw).length / 2);
    expect(serialized).not.toContain(raw.question_cards[0]!.id);
    expect(serialized).not.toContain("source_contract");
    expect(compact.nextAction).toMatchObject({
      tool: "commit_initial_design_system_semantics",
      sourceField: "sourceRefs"
    });
    if (process.env.IKRAN_BENCHMARK_OUTPUT === "1") {
      console.info(JSON.stringify({
        benchmark: "semantic-claim",
        sources: compact.sources.length,
        elapsedMs: Number(claimElapsedMs.toFixed(1)),
        compactBytes: Buffer.byteLength(serialized, "utf8"),
        rawBytes: Buffer.byteLength(JSON.stringify(raw), "utf8")
      }));
    }
  });
});
