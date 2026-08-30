import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  getDesignSystemRevisionHistoryCommand,
  getEffectiveDesignSystemCommand,
  requireActiveProjectCommand,
  reviseDraftDesignSystemCommand
} from "../runtime/commands";
import { reviseDraftDesignSystemInputSchema } from "../runtime/design-system-revision";
import {
  conciseSuccessResult,
  failureResult,
  successResult,
  type RegisterIkranToolsDeps
} from "./shared";

export function registerDesignSystemRevisionTools(
  mcp: McpServer,
  { ensureRuntime }: RegisterIkranToolsDeps
): void {
  const active = async (tool: string) => {
    const rt = await ensureRuntime();
    const project = requireActiveProjectCommand();
    return project.ok
      ? { ok: true as const, rt, projectPath: project.project.path }
      : { ok: false as const, result: failureResult(tool, project.reason, rt) };
  };

  mcp.registerTool(
    "get_effective_design_system",
    {
      description:
        "Return only the single active Design System revision and its materialized entries. Historical revisions are deliberately excluded so design generation cannot mix versions. Call get_design_system_revision_history only for an explicit audit request."
    },
    async () => {
      const ctx = await active("get_effective_design_system");
      if (!ctx.ok) return ctx.result;
      const result = getEffectiveDesignSystemCommand(ctx.projectPath);
      return result.ok
        ? conciseSuccessResult(
            ctx.rt,
            result,
            `Active Design System revision ${result.revision.sequence}: ${result.revision.id}. History excluded.`
          )
        : failureResult("get_effective_design_system", result.reason, ctx.rt);
    }
  );

  mcp.registerTool(
    "revise_draft_design_system",
    {
      description:
        "Structurally supplement the current Draft without returning to Seed. Start from the exact revision id returned by get_effective_design_system, then add evidence-linked tokens, concepts, layout/interaction rules, or complete component specs. Runtime validates and ingests the source files, creates one immutable child revision, activates only that revision, and keeps project phase=draft_design_system. Existing entries are never implicitly removed. Use the returned activeRevisionId for any further supplement.",
      inputSchema: reviseDraftDesignSystemInputSchema
    },
    async (args) => {
      const ctx = await active("revise_draft_design_system");
      if (!ctx.ok) return ctx.result;
      const result = reviseDraftDesignSystemCommand(ctx.projectPath, args);
      return result.ok
        ? conciseSuccessResult(
            ctx.rt,
            result,
            `Draft revision ${result.revision.sequence} is now the only active revision; ${result.additionsApplied} structural addition(s) applied.`
          )
        : failureResult(
            "revise_draft_design_system",
            result.reason,
            ctx.rt,
            "details" in result ? result.details : result
          );
    }
  );

  mcp.registerTool(
    "get_design_system_revision_history",
    {
      description:
        "Audit-only: list immutable Design System revision metadata and the active revision id. Does not return historical entry payloads and must not be used as design-generation context."
    },
    async () => {
      const ctx = await active("get_design_system_revision_history");
      if (!ctx.ok) return ctx.result;
      return successResult(
        ctx.rt,
        getDesignSystemRevisionHistoryCommand(ctx.projectPath)
      );
    }
  );
}
