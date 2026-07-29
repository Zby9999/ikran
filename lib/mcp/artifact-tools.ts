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
    description: "Declare a source artifact IMMEDIATELY after writing it with the host's native file editing (ADR 0004). Runtime only acknowledges declared + validated artifacts: a valid declaration enters the event log and the artifact index; undeclared files are excluded from later research export. Pass the artifact path (absolute or project-relative to the project root), its registry artifactType (design-system.json, token.json, component-list.json, component-spec, layout-rules.json, interaction-rules.json, prototype, code), a semanticPurpose, and related Runtime record ids. Validation is deterministic only: declaration structure, project path scope, file existence, and shallow design-system JSON shape — Runtime never judges code quality and never fabricates semantics. On failure, correct the declared input and retry at most once.",
    inputSchema: recordArtifactWrittenInputSchema
  }, async (args) => {
    const ctx = await active("record_artifact_written");
    if (!ctx.ok) return ctx.result;
    const result = recordArtifactWrittenCommand(ctx.projectPath, args);
    return result.ok
      ? successResult(ctx.rt, {
          ok: true,
          record: result.record,
          event_id: result.event_id
        })
      : failureResult("record_artifact_written", result.reason, ctx.rt);
  });
}
