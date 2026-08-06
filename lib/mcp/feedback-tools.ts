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
        "Declare one designer modification conclusion from Agent-host chat. Call once per concluded change — not per conversational turn. Runtime validates optional evidence-surface / region / seed-reference linkage ids (and prototype-surface ids once that table exists in Issue 30); forged ids are rejected. Records a designer_feedback row plus designer_feedback_recorded event. Write-only: do not read the feedback library for design generation; only Issue 29 Consolidate review reads it. Optional opaqueContext (e.g. host-browser DOM selector) is stored without Runtime validation or coordinate mapping.",
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
