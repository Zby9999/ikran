import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  recordPreviewCommand,
  recordPreviewInputSchema,
  requireActiveProjectCommand
} from "../runtime/commands";
import {
  failureResult,
  successResult,
  type RegisterIkranToolsDeps
} from "./shared";

export function registerPrototypePreviewTools(
  mcp: McpServer,
  { ensureRuntime }: RegisterIkranToolsDeps
): void {
  mcp.registerTool(
    "record_preview",
    {
      description:
        "Hand a complete, declared prototype to the Runtime-owned Workbench preview. Follow get_prototype_rebuild_context.preview_contract first. Creates or updates one run and one surface per surfaceKey; pass explicit sourceArtifactPath, prototypeRoot, routePath, runId, surfaceKey, seedReferenceIds, and evidenceVersionIds. Runtime installs dependencies, injects PORT, starts the dev script, and requires a stable ready/non-stale surface before this tool succeeds. preview_not_ready includes a typed diagnosis; repair it and retry with the same runId and surfaceKey. After success, Runtime watches ordinary source/style edits and refreshes the screenshot without another call.",
      inputSchema: recordPreviewInputSchema
    },
    async (args) => {
      const rt = await ensureRuntime();
      const active = requireActiveProjectCommand();
      if (!active.ok) {
        return failureResult("record_preview", active.reason, rt);
      }
      const result = await recordPreviewCommand(active.project.path, args);
      if (result.ok) return successResult(rt, result);
      return result.reason === "preview_not_ready"
        ? failureResult("record_preview", result.reason, rt, {
            preview_reason: result.preview_reason,
            diagnosis: result.diagnosis,
            preview_url: result.preview_url,
            surface: result.surface
          })
        : failureResult("record_preview", result.reason, rt);
    }
  );
}
