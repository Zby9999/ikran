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
    description: "Declare a source artifact immediately after writing it. For every Active component implementation, include componentPreview with exact current runId, ready surfaceId, Design System entryId, modulePath (equal to path), exportName, defaultArgs, stateArgs, and semanticImpact. Declare semanticImpact=none only after comparing the implementation with the current component contract and finding no reusable semantic change; use possible when judgment is needed and include semanticEvidenceRecordIds. Runtime establishes codeLinks, one shared Storybook-free Preview adapter, verified live availability, digest-cached background verification, and internal Verified Candidate automatically; stop unless the result contains one component Preview exception packet for resolve_component_preview_exception. Never guess identity or author a Story/per-component harness. Rule artifacts retain existing Rule Update Review and designer approval gates.",
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
