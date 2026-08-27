import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { claimAlignmentPreparationCommand } from "../lib/runtime/alignment-agent-command";
import { prepareDesignIntentAlignment } from "../lib/runtime/alignment-preparation";
import { initializeProjectDb } from "../lib/runtime/db";
import {
  ALIGNMENT_SECTIONS,
  createAgentAnnotation,
  createQuestionCard,
  getDesignIntentAlignment,
  recordDesignerAnswer
} from "../lib/runtime/design-intent-alignment";
import { recordEvidencePackage } from "../lib/runtime/evidence-package";
import { setDesignLanguageDescription } from "../lib/runtime/project-readiness";
import { registerSeedReference } from "../lib/runtime/seed-reference";
import { readIncrementalPlanningStatus } from "../lib/runtime/alignment-incremental-planning";
import {
  killRecordedRuntime,
  sc,
  spawnMcpClient
} from "./helpers/mcp";

test("dev MCP finalize and plan calls remain in the durable section monitor loop", async () => {
  const stateDir = mkdtempSync(path.join(tmpdir(), "ikran-incremental-mcp-state-"));
  const projectPath = mkdtempSync(path.join(tmpdir(), "ikran-incremental-mcp-project-"));
  let handle: Awaited<ReturnType<typeof spawnMcpClient>> | null = null;
  try {
    initializeProjectDb(projectPath);
    const seed = registerSeedReference(projectPath, {
      figmaSeedReference: "https://www.figma.com/design/Incremental/Mcp?node-id=1:2",
      originalDesignIntent: "Incremental MCP vertical fixture"
    });
    if (!seed.ok) throw new Error(seed.reason);
    const evidence = recordEvidencePackage(projectPath, {
      seedReferenceId: seed.record.id,
      frame: { nodeId: "1:2", name: "Incremental" },
      evidenceViews: { rawData: "available", screenshot: "missing" }
    });
    if (!evidence.ok) throw new Error(evidence.reason);
    expect(setDesignLanguageDescription(
      projectPath,
      "A quiet and exact system."
    ).ok).toBe(true);
    const prepared = prepareDesignIntentAlignment(projectPath);
    if (!prepared.ok) throw new Error(prepared.reason);
    expect(claimAlignmentPreparationCommand(projectPath).ok).toBe(true);
    const cardsBySection = new Map<string, string[]>();
    const anchor = {
      kind: "single" as const,
      target: {
        kind: "surface" as const,
        seedReferenceId: seed.record.id,
        evidenceSurfaceId: evidence.record.id,
        evidenceVersionId: evidence.record.id
      }
    };
    for (const section of ALIGNMENT_SECTIONS) {
      expect(createAgentAnnotation(projectPath, {
        alignmentAttemptId: prepared.attempt.id,
        idempotencyKey: `mcp-${section}-annotation`,
        section,
        inference: "reasonable",
        title: "Section observation",
        body: `${section} appears intentional.`,
        anchor
      }).ok).toBe(true);
      for (let index = 0; index < 2; index += 1) {
        const card = createQuestionCard(projectPath, {
          alignmentAttemptId: prepared.attempt.id,
          idempotencyKey: `mcp-${section}-${index}`,
          section,
          observation: `${section} ${index + 1}`,
          question: `Confirm ${section} ${index + 1}?`,
          proposedAnswer: `Confirm ${section} ${index + 1}.`,
          anchor
        });
        if (!card.ok) throw new Error(card.reason);
        cardsBySection.set(section, [
          ...(cardsBySection.get(section) ?? []),
          card.record.id
        ]);
      }
    }

    handle = await spawnMcpClient(stateDir, {
      prod: false,
      cwd: projectPath,
      env: { IKRAN_ENABLE_INCREMENTAL_DESIGN_SYSTEM_PLANNING: "1" }
    });
    expect(sc(await handle.client.callTool({
      name: "create_or_open_project",
      arguments: { path: projectPath }
    }))).toMatchObject({ ok: true, active_project: projectPath });

    const finalizeCall = handle.client.callTool({
      name: "finalize_alignment_preparation",
      arguments: { alignmentAttemptId: prepared.attempt.id }
    });
    for (let index = 0; index < 100; index += 1) {
      if (
        getDesignIntentAlignment(projectPath).preparation.workflow.stage ===
        "alignment-answering"
      ) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(
      getDesignIntentAlignment(projectPath).preparation.workflow.stage
    ).toBe("alignment-answering");
    for (const questionCardId of cardsBySection.get("design-concept")!) {
      expect(recordDesignerAnswer(projectPath, {
        questionCardId,
        finalAnswer: "Confirmed concept"
      }).ok).toBe(true);
    }
    const finalized = sc(await finalizeCall);
    expect(finalized).toMatchObject({
      ok: true,
      incrementalPlanning: {
        reason: "delta_available",
        delta: { section: "design-concept" }
      },
      nextAction: { tool: "record_incremental_initial_design_system_plan" }
    });
    const delta = (finalized.incrementalPlanning as {
      currentRevision: number;
      planVersion: number;
      delta: {
        section: string;
        sectionDigest: string;
        sources: Array<{ sourceId: string; digest: string }>;
      };
    });
    const source = delta.delta.sources[0]!;
    const planCall = handle.client.callTool({
      name: "record_incremental_initial_design_system_plan",
      arguments: {
        alignmentAttemptId: prepared.attempt.id,
        idempotencyKey: "mcp-plan-design-concept",
        basePlanVersion: delta.planVersion,
        baseRevision: delta.currentRevision,
        section: delta.delta.section,
        sectionDigest: delta.delta.sectionDigest,
        decisions: [{
          decisionId: "mcp-concept",
          outputConcern: "global",
          statement: "Preserve the confirmed concept.",
          sourceRefs: [{ sourceId: source.sourceId, digest: source.digest }]
        }],
        draftBindings: [],
        designSystemDraft: { name: "Incremental MCP draft" }
      }
    });
    for (let index = 0; index < 100; index += 1) {
      const status = readIncrementalPlanningStatus(
        projectPath,
        prepared.attempt.id
      );
      if (status.ok && status.planVersion === 1) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(readIncrementalPlanningStatus(
      projectPath,
      prepared.attempt.id
    )).toMatchObject({ ok: true, planVersion: 1 });
    for (const questionCardId of cardsBySection.get("visual-language")!) {
      const answer = recordDesignerAnswer(projectPath, {
        questionCardId,
        finalAnswer: "Confirmed visual language"
      });
      expect(answer, answer.ok ? undefined : answer.reason).toMatchObject({
        ok: true
      });
    }
    const conceptPlanned = sc(await planCall);
    expect(conceptPlanned).toMatchObject({
      ok: true,
      planVersion: 1,
      incrementalPlanning: {
        reason: "delta_available",
        delta: { section: "visual-language" }
      },
      nextAction: { tool: "record_incremental_initial_design_system_plan" }
    });
    const visualDelta = (conceptPlanned.incrementalPlanning as {
      currentRevision: number;
      planVersion: number;
      delta: {
        section: string;
        sectionDigest: string;
        sources: Array<{ sourceId: string; digest: string }>;
      };
    });
    const visualSource = visualDelta.delta.sources[0]!;
    expect(sc(await handle.client.callTool({
      name: "record_incremental_initial_design_system_plan",
      arguments: {
        alignmentAttemptId: prepared.attempt.id,
        idempotencyKey: "mcp-stale-plan-write",
        basePlanVersion: 0,
        baseRevision: visualDelta.currentRevision,
        section: visualDelta.delta.section,
        sectionDigest: visualDelta.delta.sectionDigest,
        decisions: [{
          decisionId: "mcp-stale-visual",
          outputConcern: "visual-language",
          statement: "This stale write must not replace the cumulative plan.",
          sourceRefs: [{
            sourceId: visualSource.sourceId,
            digest: visualSource.digest
          }]
        }],
        draftBindings: [],
        designSystemDraft: { name: "Stale MCP draft" }
      }
    }))).toMatchObject({
      ok: false,
      error: "stale_incremental_plan_version",
      details: {
        expected: 1,
        received: 0,
        checkpoint: {
          ok: true,
          planVersion: 1,
          designSystemDraft: { name: "Incremental MCP draft" }
        }
      }
    });
    const visualPlanCall = handle.client.callTool({
      name: "record_incremental_initial_design_system_plan",
      arguments: {
        alignmentAttemptId: prepared.attempt.id,
        idempotencyKey: "mcp-plan-visual-language",
        basePlanVersion: visualDelta.planVersion,
        baseRevision: visualDelta.currentRevision,
        section: visualDelta.delta.section,
        sectionDigest: visualDelta.delta.sectionDigest,
        decisions: [{
          decisionId: "mcp-visual",
          outputConcern: "visual-language",
          statement: "Preserve the confirmed visual language.",
          sourceRefs: [{
            sourceId: visualSource.sourceId,
            digest: visualSource.digest
          }]
        }],
        draftBindings: [],
        designSystemDraft: { name: "Incremental MCP draft" }
      }
    });
    for (let index = 0; index < 100; index += 1) {
      const status = readIncrementalPlanningStatus(
        projectPath,
        prepared.attempt.id
      );
      if (status.ok && status.planVersion === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(recordDesignerAnswer(projectPath, {
      questionCardId: source.sourceId,
      finalAnswer: "Edited concept after visual planning"
    }).ok).toBe(true);
    expect(sc(await visualPlanCall)).toMatchObject({
      ok: true,
      planVersion: 2,
      incrementalPlanning: {
        reason: "delta_available",
        delta: { section: "design-concept" }
      },
      nextAction: { tool: "record_incremental_initial_design_system_plan" }
    });
    expect(readIncrementalPlanningStatus(
      projectPath,
      prepared.attempt.id
    )).toMatchObject({
      ok: true,
      planVersion: 2,
      staleDecisionIds: ["mcp-concept"],
      validDecisionIds: ["mcp-visual"],
      remainingReadySections: ["design-concept"]
    });
  } finally {
    try {
      await handle?.client.close();
    } catch {
      // The child may already be gone after a failed assertion.
    }
    killRecordedRuntime(stateDir);
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(projectPath, { recursive: true, force: true });
  }
});
