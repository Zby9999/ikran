import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  recordDesignerFeedbackCommand,
  recordDesignerFeedbackInputSchema,
  requireActiveProjectCommand
} from "../runtime/commands";
import {
  failureResult,
  successResult,
  type RegisterIkranToolsDeps
} from "./shared";

export function registerDesignerFeedbackTools(
  mcp: McpServer,
  { ensureRuntime }: RegisterIkranToolsDeps
): void {
  mcp.registerTool(
    "record_designer_feedback",
    {
      description:
        "Legacy compatibility escape hatch for importing one already-concluded feedback record. Do NOT call this during active Agent-host design conversation. Normal completion and Rule Update must use reconcile_designer_conversation so Runtime receives a frozen transcript range, designer-message provenance, and one atomic decision batch. Runtime validates optional evidence/prototype/region/seed linkage ids.",
      inputSchema: recordDesignerFeedbackInputSchema
    },
    async (args) => {
      const rt = await ensureRuntime();
      const active = requireActiveProjectCommand();
      if (!active.ok) {
        return failureResult("record_designer_feedback", active.reason, rt);
      }
      const result = recordDesignerFeedbackCommand(active.project.path, args);
      return result.ok
        ? successResult(rt, result)
        : failureResult("record_designer_feedback", result.reason, rt);
    }
  );
}
