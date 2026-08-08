import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  claimConsolidateReviewCommand,
  claimConsolidateReviewInputSchema,
  dismissDesignerFeedbackCommand,
  dismissDesignerFeedbackInputSchema,
  requireActiveProjectCommand
} from "../runtime/commands";
import {
  failureResult,
  successResult,
  type RegisterIkranToolsDeps
} from "./shared";

export function registerConsolidateReviewTools(
  mcp: McpServer,
  { ensureRuntime }: RegisterIkranToolsDeps
): void {
  mcp.registerTool(
    "claim_consolidate_review",
    {
      description:
        "Claim Consolidate only after reconcile_designer_conversation completed the frozen Agent-host transcript review; pass its reconciliation id. This is the ONLY read path for designer feedback and must never be used for design generation. Returns the reconciled decision ledger plus legacy feedback with linkage, transcript provenance, and review disposition. Use final decisions as current evidence; preserve superseded/local/open-gap outcomes rather than promoting them silently. Draft global proposals via propose_rule_update and give every feedback record an outcome through a confirmed proposal or dismiss_designer_feedback.",
      inputSchema: claimConsolidateReviewInputSchema
    },
    async (args) => {
      const rt = await ensureRuntime();
      const active = requireActiveProjectCommand();
      if (!active.ok) {
        return failureResult("claim_consolidate_review", active.reason, rt);
      }
      const result = claimConsolidateReviewCommand(active.project.path, args);
      return result.ok
        ? successResult(rt, result)
        : failureResult("claim_consolidate_review", result.reason, rt);
    }
  );

  mcp.registerTool(
    "dismiss_designer_feedback",
    {
      description:
        "Record the no-rule-change disposition for feedback the designer decided against acting on during Consolidate review. Requires an explicit reason and records one designer_feedback_dismissed event per record. Dismissed records stop counting as unreviewed for formalize_design_system. Unknown feedback ids are rejected.",
      inputSchema: dismissDesignerFeedbackInputSchema
    },
    async (args) => {
      const rt = await ensureRuntime();
      const active = requireActiveProjectCommand();
      if (!active.ok) {
        return failureResult("dismiss_designer_feedback", active.reason, rt);
      }
      const result = dismissDesignerFeedbackCommand(active.project.path, args);
      return result.ok
        ? successResult(rt, result)
        : failureResult("dismiss_designer_feedback", result.reason, rt);
    }
  );
}
