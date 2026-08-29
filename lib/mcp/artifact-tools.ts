import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  recordArtifactWrittenCommand,
  recordArtifactWrittenInputSchema,
  requireActiveProjectCommand
} from "../runtime/commands";
import { failureResult, successResult, type RegisterIkranToolsDeps } from "./shared";

export function registerArtifactTools(
  mcp: McpServer,
  { ensureRuntime }: RegisterIkranToolsDeps
): void {
  const active = async (tool: string) => {
    const rt = await ensureRuntime();
    const project = requireActiveProjectCommand();
    return project.ok ? { ok: true as const, rt, projectPath: project.project.path } : { ok: false as const, result: failureResult(tool, project.reason, rt) };
  };

  mcp.registerTool("record_artifact_written", {
    description: "Declare a source artifact immediately after writing it. For every Active component implementation, include componentPreview with the exact current runId, ready surfaceId, and entryId returned by get_prototype_rebuild_context.component_preview_targets; never substitute an inventory id. modulePath must equal path. Include exportName, defaultArgs, semanticImpact, and only stateArgs whose keys appear in that target's allowedStateNames. Runtime detects Next App Router or Vite React, establishes codeLinks, one shared Storybook-free Preview adapter, live availability, cached background verification, and internal Verified Candidate automatically. After a standard success, do not call verify_registered_component_previews or poll: declare any remaining targets, then stop and return control for designer Prototype review. Only a returned exception packet requires resolve_component_preview_exception. Never guess identity or author a Story/per-component harness. Rule artifacts retain existing review gates.",
    inputSchema: recordArtifactWrittenInputSchema
  }, async (args) => {
    const ctx = await active("record_artifact_written");
    if (!ctx.ok) return ctx.result;
    const result = recordArtifactWrittenCommand(ctx.projectPath, args);
    return result.ok
      ? successResult(ctx.rt, {
          ok: true,
          record: result.record,
          event_id: result.event_id,
          quality_diagnostics: result.quality_diagnostics,
          ...("component_preview" in result
            ? { component_preview: result.component_preview }
            : {})
        })
      : failureResult(
          "record_artifact_written",
          result.reason,
          ctx.rt,
          result.details
        );
  });
}
