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
        "Claim Consolidate only after reconcile_designer_conversation completed the frozen Agent-host transcript review; pass its reconciliation id. During design_system_formal that reconciliation must have completed after the latest confirm_prototype and, when the confirmation has a canonical record_preview binding, carry the same runId. The result returns prototype_confirmation_event_id as the durable current-cycle binding. Older or different-run reconciliations are rejected. This is the ONLY read path for designer feedback and must never be used for design generation. Returns the reconciled decision ledger, exact legal target categories, existing Rule entries, and a draft coverage contract. Audit every final decision before publishing. Related decisions may be merged into one proposal when their meaningful boundaries survive; include every merged decision id in evidenceRecordIds. A final_decision needs proposal coverage or an exact existing Rule entry.",
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
        "Record a typed no-proposal disposition during Consolidate review. final_decision records cannot be dismissed as local/superseded/process/open-gap: include them in proposal evidenceRecordIds or use covered_by_existing_rule with an exact existingRuleEntryId from the claim contract. Other reconciliation dispositions must match their typed dismissal. Requires an evidence-grounded reason and records one designer_feedback_dismissed event per record.",
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
