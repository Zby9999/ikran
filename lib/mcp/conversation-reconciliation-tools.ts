import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  reconcileDesignerConversationCommand,
  reconcileDesignerConversationInputSchema
} from "../runtime/commands/conversation-reconciliation";
import { requireActiveProjectCommand } from "../runtime/commands";
import {
  failureResult,
  successResult,
  type RegisterIkranToolsDeps
} from "./shared";

export function registerConversationReconciliationTools(
  mcp: McpServer,
  { ensureRuntime }: RegisterIkranToolsDeps
): void {
  mcp.registerTool(
    "reconcile_designer_conversation",
    {
      description:
        "Complete one bounded conversation review before Rule Update. Call only after the designer explicitly finishes/confirms the design or asks for Rule Update — never during active design turns. Supply the complete ordered Agent-host transcript snapshot between startMessageId and endMessageId plus a structured decision ledger; runId must be the current record_preview Prototype run. Every decision must cite at least one designer-authored source message; later explicit designer corrections supersede earlier decisions, while Agent suggestions are never facts by themselves. Runtime atomically stores the immutable transcript snapshot and all derived feedback. Reuse reviewId after interruption: identical replay is idempotent and changed content is rejected. Then pass the returned reconciliation.id to claim_consolidate_review.",
      inputSchema: reconcileDesignerConversationInputSchema
    },
    async (args) => {
      const rt = await ensureRuntime();
      const active = requireActiveProjectCommand();
      if (!active.ok) {
        return failureResult(
          "reconcile_designer_conversation",
          active.reason,
          rt
        );
      }
      const result = reconcileDesignerConversationCommand(
        active.project.path,
        args
      );
      return result.ok
        ? successResult(rt, result)
        : failureResult(
            "reconcile_designer_conversation",
            result.reason,
            rt
          );
    }
  );
}
