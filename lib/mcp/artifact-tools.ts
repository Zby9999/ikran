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
    description: "Declare a source artifact IMMEDIATELY after writing it with the host's native file editing (ADR 0004). Runtime only acknowledges declared + validated artifacts: a valid declaration enters the event log and the artifact index; undeclared files are excluded from later research export. Pass the artifact path (absolute or project-relative to the project root), its registry artifactType (design-system.json, token.json, component-list.json, component-spec, layout-rules.json, interaction-rules.json, prototype, code), a semanticPurpose, and related Runtime record ids. For rule artifacts, follow the claim source_contract taxonomy, inspect existing rules in that file, and send misplaced-rule moves through the rule-update proposal channel; never move them silently. Initial extraction and Draft review may author the first Design System directly; from Prototype validation onward every Agent-authored Design System write requires a confirmed Rule Update proposal from the current phase/review cycle that authorizes this exact artifact path. Never write the file before confirm_rule_update, and pass that proposalId here so Runtime can verify the authorization — omission rejects with rule_update_proposal_required; stale-cycle, path-mismatched, unknown, and unconfirmed ids are rejected separately. Structural validation remains deterministic and fail-closed. A successful design-system declaration may also return advisory quality_diagnostics; these warnings never reject declaration or ingest, and should be repaired only from available evidence rather than by inventing semantics. On failure, correct the declared input and retry at most once.",
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
          quality_diagnostics: result.quality_diagnostics
        })
      : failureResult(
          "record_artifact_written",
          result.reason,
          ctx.rt,
          result.details
        );
  });
}
