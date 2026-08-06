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
        "Claim one designer-initiated Consolidate review. This is the ONLY read path for the designer feedback library — never read it for design generation, and never start a review on your own; call this only when the designer asks for it in chat. Returns every designer_feedback record with its linkage ids and disposition (unreviewed / consumed / dismissed) plus the unreviewed ids, and records consolidate_review_started. Aggregate by run/session and linkage (multiple rounds on the same surface or component become one proposal; a decision later overturned is represented by the latest decision only), classify with the six-part taxonomy, then draft proposals via propose_rule_update. Narrate in chat only the proposals that would become global rules (reusable_candidate / proposed_update); report the other dispositions only when the designer asks. Every record needs an outcome: consumed by a confirmed proposal, or dismiss_designer_feedback with a reason.",
      inputSchema: claimConsolidateReviewInputSchema
    },
    async () => {
      const rt = await ensureRuntime();
      const active = requireActiveProjectCommand();
      if (!active.ok) {
        return failureResult("claim_consolidate_review", active.reason, rt);
      }
      const result = claimConsolidateReviewCommand(active.project.path);
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
