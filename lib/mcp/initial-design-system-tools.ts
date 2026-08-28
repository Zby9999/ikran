import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  finalizeInitialDesignSystemPreparationCommand,
  finalizeInitialDesignSystemPreparationInputSchema,
  commitIncrementalDesignSystemPlanInputSchema,
  recordDesignSystemExtractionAuditCommand,
  recordDesignSystemExtractionAuditInputSchema,
  recordDesignSystemExtractionWorkUnitCommand,
  recordDesignSystemExtractionWorkUnitInputSchema,
  requireActiveProjectCommand
} from "../runtime/commands";
import {
  claimInitialDesignSystemSemanticContext,
  commitIncrementalInitialDesignSystemPlan,
  commitInitialDesignSystemSemantic,
  commitInitialDesignSystemSemanticInputSchema
} from "../runtime/initial-design-system-semantic-commit";
import {
  conciseSuccessResult,
  failureResult,
  successResult,
  type RegisterIkranToolsDeps
} from "./shared";

export function registerInitialDesignSystemTools(
  mcp: McpServer,
  { ensureRuntime }: RegisterIkranToolsDeps
): void {
  const active = async (tool: string) => {
    const rt = await ensureRuntime();
    const project = requireActiveProjectCommand();
    return project.ok
      ? { ok: true as const, rt, projectPath: project.project.path }
      : {
          ok: false as const,
          result: failureResult(tool, project.reason, rt)
        };
  };

  mcp.registerTool(
    "commit_incremental_initial_design_system_plan",
    {
      description:
        "Commit the caught-up hidden Incremental Plan against the Alignment's frozen revision. Takes only attempt id, exact plan version, and idempotency key; Runtime loads the persisted semantic draft, validates its complete final schema, every section digest, every output/omission dependency, then runs the artifact, lineage, audit, and Draft gates. On a semantic Draft reconciliation result, repair the plan instead of pretending the fast path succeeded. On an unavailable or stale plan, follow the returned claim_initial_design_system_preparation fallback.",
      inputSchema: commitIncrementalDesignSystemPlanInputSchema
    },
    async (args) => {
      const ctx = await active("commit_incremental_initial_design_system_plan");
      if (!ctx.ok) return ctx.result;
      const result = commitIncrementalInitialDesignSystemPlan(
        ctx.projectPath,
        args
      );
      return result.ok
        ? conciseSuccessResult(
            ctx.rt,
            result,
            `Draft Design System ready from incremental plan v${result.planVersion}.`
          )
        : failureResult(
            "commit_incremental_initial_design_system_plan",
            result.reason,
            ctx.rt,
            "fallback" in result ? { fallback: result.fallback } : undefined
          );
    }
  );

  mcp.registerTool(
    "commit_initial_design_system_semantics",
    {
      description:
        "Second and final call in the Initial Design System fast path. Submit one semantic Draft using the alignmentAttemptId and short Q/A/D refs returned by claim_initial_design_system_preparation. Every frozen source must be mapped or receive an explicit Agent-authored sourceOmission; every empty tokens/layout/interaction/components category needs an evidence-linked categoryOmission. Preserve evidence-backed color primitives, semantic roles, and foundationRules. Keep typography facts atomic in primitive; each supported semantic/component role needs one scalar fontSize, at least one other style field, one stable job, and a distinct usedFor—never bundle a scale or step collection. Runtime validates complete coverage, projects deterministic files/provenance/work units/audit, and supports corrected retry with a new key after a failed commit. Do not re-claim, inspect legacy tools, query SQLite, or re-extract raw evidence.",
      inputSchema: commitInitialDesignSystemSemanticInputSchema
    },
    async (args) => {
      const ctx = await active("commit_initial_design_system_semantics");
      if (!ctx.ok) return ctx.result;
      const result = commitInitialDesignSystemSemantic(ctx.projectPath, args);
      return result.ok
        ? conciseSuccessResult(
            ctx.rt,
            result,
            `Draft Design System ready: ${result.artifactPaths.length} artifacts, ${result.workUnitKeys.length} work units, ${result.claimCount} claims.`
          )
        : failureResult(
            "commit_initial_design_system_semantics",
            result.reason,
            ctx.rt,
            result.details === undefined
              ? result.failedStage === undefined
                ? undefined
                : { failed_stage: result.failedStage }
              : {
                  failed_stage: result.failedStage ?? null,
                  details: result.details
                }
          );
    }
  );

  mcp.registerTool(
    "claim_initial_design_system_preparation",
    {
      description:
        "First call in the two-call Initial Design System fast path. Returns a compact frozen semantic context with Design Language Description, Seed References, answered Question cards, and Annotations labeled by short Q/A/D refs. Read it once, make the semantic decisions, then call commit_initial_design_system_semantics once. Do not discover progressive extraction tools, query SQLite, or re-read raw positional evidence. Safe to retry only after a disconnect. No arguments."
    },
    async () => {
      const ctx = await active("claim_initial_design_system_preparation");
      if (!ctx.ok) return ctx.result;
      const result = claimInitialDesignSystemSemanticContext(ctx.projectPath);
      return result.ok
        ? successResult(ctx.rt, result)
        : failureResult(
            "claim_initial_design_system_preparation",
            result.reason,
            ctx.rt
          );
    }
  );

  if (process.env.IKRAN_ENABLE_LEGACY_DESIGN_SYSTEM_EXTRACTION !== "1") {
    return;
  }

  mcp.registerTool(
    "record_design_system_extraction_work_unit",
    {
      description:
        "Record or replace one completed output work unit after its artifact JSON has been declared and ingested. A unit is global, tokens, layout, interaction, or one atomic component containing its inventory entry, matching component spec, and captures. The tokens unit is only a storage checkpoint: perform independent Color, Typography, and Material passes, then send reviewedFoundationOwners with exactly those three owners. Runtime rejects motion, breakpoint, ambiguous other-domain, and ownerless targets from that unit. Claims may consume evidence from any Alignment section. Target stable artifactPath + entryId identities; fieldPath is only for an omitted component-spec value field. Never send JSON pointers because the Runtime derives them. Replacing a unit recomputes coverage and invalidates the previous residual claims and global audit. If a previously recorded component was removed or renamed, retire its obsolete unit with that componentEntryId, retire: true, no specArtifactPath, and claims: []; retirement is idempotent and also invalidates the previous residual claims and audit.",
      inputSchema: recordDesignSystemExtractionWorkUnitInputSchema
    },
    async (args) => {
      const ctx = await active("record_design_system_extraction_work_unit");
      if (!ctx.ok) return ctx.result;
      const result = recordDesignSystemExtractionWorkUnitCommand(
        ctx.projectPath,
        args
      );
      return result.ok
        ? successResult(ctx.rt, result)
        : failureResult(
            "record_design_system_extraction_work_unit",
            result.reason,
            ctx.rt,
            result.details
          );
    }
  );

  mcp.registerTool(
    "record_design_system_extraction_audit",
    {
      description:
        "Record the final cross-section coverage audit after all output work units are complete. residualClaims may only describe evidence intentionally omitted or still in conflict and must have no output targets. The audit checkedClaimIds must exactly cover all work-unit and residual claims, and every frozen Question card and Annotation must be consumed. A passed issue-free audit makes the extraction ready to finalize only when all required work units are also present.",
      inputSchema: recordDesignSystemExtractionAuditInputSchema
    },
    async (args) => {
      const ctx = await active("record_design_system_extraction_audit");
      if (!ctx.ok) return ctx.result;
      const result = recordDesignSystemExtractionAuditCommand(
        ctx.projectPath,
        args
      );
      return result.ok
        ? successResult(ctx.rt, result)
        : failureResult(
            "record_design_system_extraction_audit",
            result.reason,
            ctx.rt,
            result.details
          );
    }
  );

  mcp.registerTool(
    "finalize_initial_design_system_preparation",
    {
      description:
        "Complete the claimed Initial Design System command only after all required output work units, the passed global audit, required declared+ingested JSON artifacts, Runtime-resolved targets, reverse entry coverage, atomic component inventory/spec pairing, and formalized-claim support all pass. Returns typed failures naming the missing artifact, work unit, claim, target, or entry so the Agent can repair and safely retry.",
      inputSchema: finalizeInitialDesignSystemPreparationInputSchema
    },
    async (args) => {
      const ctx = await active("finalize_initial_design_system_preparation");
      if (!ctx.ok) return ctx.result;
      const result = finalizeInitialDesignSystemPreparationCommand(
        ctx.projectPath,
        args.alignmentAttemptId
      );
      return result.ok
        ? successResult(ctx.rt, result)
        : failureResult(
            "finalize_initial_design_system_preparation",
            result.reason,
            ctx.rt,
            result.details
          );
    }
  );
}
