import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  claimInitialDesignSystemPreparationCommand,
  finalizeInitialDesignSystemPreparationCommand,
  finalizeInitialDesignSystemPreparationInputSchema,
  recordDesignSystemExtractionAuditCommand,
  recordDesignSystemExtractionAuditInputSchema,
  recordDesignSystemExtractionWorkUnitCommand,
  recordDesignSystemExtractionWorkUnitInputSchema,
  requireActiveProjectCommand
} from "../runtime/commands";
import {
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
    "claim_initial_design_system_preparation",
    {
      description:
        "Claim the current durable prepare_initial_design_system command. Returns the complete frozen Alignment context in one read: Design Language Description, Seed References and evidence versions, every Agent Annotation, answered Question card with answer source, and Designer Annotation, plus the source contract, required artifacts, completed extraction work units, global audit, and resumable progress. Read and reason over this whole context before writing output section by section. Safe to retry after disconnect; a repeated claim returns the same frozen input and current recovery state. No arguments."
    },
    async () => {
      const ctx = await active("claim_initial_design_system_preparation");
      if (!ctx.ok) return ctx.result;
      const result = claimInitialDesignSystemPreparationCommand(ctx.projectPath);
      return result.ok
        ? successResult(ctx.rt, result)
        : failureResult(
            "claim_initial_design_system_preparation",
            result.reason,
            ctx.rt
          );
    }
  );

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
