import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  claimInitialDesignSystemPreparationCommand,
  finalizeInitialDesignSystemPreparationCommand,
  finalizeInitialDesignSystemPreparationInputSchema,
  recordDesignSystemExtractionManifestCommand,
  recordDesignSystemExtractionManifestInputSchema,
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
        "Claim the current durable prepare_initial_design_system command. Returns the frozen completed Alignment input: Design Language Description, Seed References and evidence versions, Agent Annotations, answered Question cards with answer sources, Designer Annotations, the 09B source contract, required design-system JSON artifacts, already-declared artifacts, and any previously recorded extraction manifest. Safe to retry after disconnect; a repeated claim returns the same input and current recovery state. After claim, build an atomic extraction manifest before writing/finalizing source artifacts. No arguments."
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
    "record_design_system_extraction_manifest",
    {
      description:
        "Record the attempt-bound atomic Evidence-to-Decision manifest for the claimed Initial Design System command. Every answered Question card, Agent Annotation, and Designer Annotation in the immutable snapshot must be consumed by at least one claim. Each claim must be mapped to stable artifact/entry/JSON-pointer targets, or explicitly marked conflict, omitted, or gap with a reason. The Runtime validates structure and snapshot coverage but does not pretend to judge natural-language semantic relevance.",
      inputSchema: recordDesignSystemExtractionManifestInputSchema
    },
    async (args) => {
      const ctx = await active("record_design_system_extraction_manifest");
      if (!ctx.ok) return ctx.result;
      const result = recordDesignSystemExtractionManifestCommand(
        ctx.projectPath,
        args
      );
      return result.ok
        ? successResult(ctx.rt, result)
        : failureResult(
            "record_design_system_extraction_manifest",
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
        "Complete the claimed Initial Design System command only after the extraction manifest, audit, required declared+ingested JSON artifacts, manifest targets, reverse entry coverage, component inventory/spec pairing, and formalized-claim support all pass. Returns typed failures naming the missing artifact, claim, target, or entry so the Agent can repair and safely retry.",
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
