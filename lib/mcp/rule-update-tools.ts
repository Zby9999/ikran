import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  cancelRuleUpdateCommand,
  cancelRuleUpdateInputSchema,
  confirmRuleUpdateCommand,
  confirmRuleUpdateInputSchema,
  proposeRuleUpdateCommand,
  proposeRuleUpdateInputSchema,
  createRuleUpdateReviewCommand,
  createRuleUpdateReviewInputSchema,
  publishRuleUpdateReviewCommand,
  publishRuleUpdateReviewInputSchema,
  claimRuleUpdateDecisionCommand,
  failRuleUpdateApplyCommand,
  failRuleUpdateApplyInputSchema,
  retryRuleUpdateApplyCommand,
  retryRuleUpdateApplyInputSchema,
  requireActiveProjectCommand
} from "../runtime/commands";
import {
  failureResult,
  successResult,
  type RegisterIkranToolsDeps
} from "./shared";

export function registerRuleUpdateTools(
  mcp: McpServer,
  { ensureRuntime }: RegisterIkranToolsDeps
): void {
  mcp.registerTool(
    "create_rule_update_review",
    {
      description:
        "Create the one draft Rule Update Review for a completed Consolidate review. Draft proposals are private until publish_rule_update_review publishes the complete batch. Supply the reconciliation id when the Review comes from a frozen Agent-host transcript.",
      inputSchema: createRuleUpdateReviewInputSchema
    },
    async (args) => {
      const rt = await ensureRuntime();
      const active = requireActiveProjectCommand();
      if (!active.ok) return failureResult("create_rule_update_review", active.reason, rt);
      const result = createRuleUpdateReviewCommand(active.project.path, args);
      return result.ok ? successResult(rt, result) : failureResult("create_rule_update_review", result.reason, rt);
    }
  );

  mcp.registerTool(
    "publish_rule_update_review",
    {
      description:
        "Publish every proposal in a draft Review as one visible batch and activate the Rule Update-specific designer wait. Component targets must resolve to a browsable component-list.json id through its specPath; publishing rejects orphan targets with the valid component ids. An empty batch completes immediately as an explicit no-change Review; an already completed Review is rejected.",
      inputSchema: publishRuleUpdateReviewInputSchema
    },
    async (args) => {
      const rt = await ensureRuntime();
      const active = requireActiveProjectCommand();
      if (!active.ok) return failureResult("publish_rule_update_review", active.reason, rt);
      const result = publishRuleUpdateReviewCommand(active.project.path, args.reviewId);
      return result.ok ? successResult(rt, result) : failureResult(
        "publish_rule_update_review",
        result.reason,
        rt,
        "details" in result ? result.details : undefined
      );
    }
  );
  mcp.registerTool(
    "propose_rule_update",
    {
      description:
        "Draft one Rule Update proposal. For new/update/move pass the complete machine-write body in fullRuleBody and a short human-readable changeDescription. Retire is available only inside a managed Review: omit fullRuleBody and bind exactly one existing prose Rule in foundations.home/layout/interaction with sourceArtifactPath plus entryId; an accepted retire authorizes only that Rule's removal. Pass targetCategory as foundations.home/color/typography/materials/layout/interaction or component:<component-list.json id>. Component ids always come from design-system/component-list.json, never from the spec JSON id; Runtime accepts a linked legacy spec id only by canonicalizing it through specPath. Move proposals also pass their typed sourceCategory. The draft stays private until publish_rule_update_review. This tool never edits source artifacts.",
      inputSchema: proposeRuleUpdateInputSchema
    },
    async (args) => {
      const rt = await ensureRuntime();
      const active = requireActiveProjectCommand();
      if (!active.ok) {
        return failureResult("propose_rule_update", active.reason, rt);
      }
      const result = proposeRuleUpdateCommand(active.project.path, args);
      return result.ok
        ? successResult(rt, result)
        : failureResult(
            "propose_rule_update",
            result.reason,
            rt,
            "details" in result ? result.details : undefined
          );
    }
  );

  mcp.registerTool(
    "claim_rule_update_decision",
    {
      description:
        "Claim the earliest durable designer decision across published Rule Update Reviews. The payload freezes the exact proposal revision, semantic target, and base digest. Rejected decisions complete on claim without a source write. Accepted decisions must be applied to the authorized source, declared with record_artifact_written(proposalId), or failed explicitly.",
      inputSchema: {}
    },
    async () => {
      const rt = await ensureRuntime();
      const active = requireActiveProjectCommand();
      if (!active.ok) return failureResult("claim_rule_update_decision", active.reason, rt);
      const result = claimRuleUpdateDecisionCommand(active.project.path);
      return result.ok
        ? successResult(rt, result)
        : failureResult(
            "claim_rule_update_decision",
            result.reason,
            rt,
            "details" in result ? result.details : undefined
          );
    }
  );

  mcp.registerTool(
    "fail_rule_update_apply",
    {
      description:
        "Mark a claimed accepted Rule Update application as recoverably failed. This preserves the same command/proposal/revision identity and reopens the Review wait; use retry_rule_update_apply after correcting the operational failure.",
      inputSchema: failRuleUpdateApplyInputSchema
    },
    async (args) => {
      const rt = await ensureRuntime();
      const active = requireActiveProjectCommand();
      if (!active.ok) return failureResult("fail_rule_update_apply", active.reason, rt);
      const result = failRuleUpdateApplyCommand(active.project.path, args);
      return result.ok ? successResult(rt, result) : failureResult("fail_rule_update_apply", result.reason, rt);
    }
  );

  mcp.registerTool(
    "retry_rule_update_apply",
    {
      description:
        "Retry a recoverably failed Rule Update application using the same durable command identity. Base digest validation still runs again at claim time.",
      inputSchema: retryRuleUpdateApplyInputSchema
    },
    async (args) => {
      const rt = await ensureRuntime();
      const active = requireActiveProjectCommand();
      if (!active.ok) return failureResult("retry_rule_update_apply", active.reason, rt);
      const result = retryRuleUpdateApplyCommand(active.project.path, args.commandId);
      return result.ok ? successResult(rt, result) : failureResult("retry_rule_update_apply", result.reason, rt);
    }
  );

  mcp.registerTool(
    "confirm_rule_update",
    {
      description:
        "Compatibility adapter for a designer's chat Confirm. Managed Review proposals use the same accepted designer-decision command as Workbench; legacy awaiting proposals keep the prior confirm flow. The Agent must claim the durable accepted decision before writing, then declare the exact authorized source via record_artifact_written with this proposalId.",
      inputSchema: confirmRuleUpdateInputSchema
    },
    async (args) => {
      const rt = await ensureRuntime();
      const active = requireActiveProjectCommand();
      if (!active.ok) {
        return failureResult("confirm_rule_update", active.reason, rt);
      }
      const result = confirmRuleUpdateCommand(active.project.path, args);
      return result.ok
        ? successResult(rt, result)
        : failureResult("confirm_rule_update", result.reason, rt);
    }
  );

  mcp.registerTool(
    "cancel_rule_update",
    {
      description:
        "Compatibility adapter for a designer's chat Cancel. Managed Review proposals use the same rejected designer-decision command as Workbench; legacy awaiting proposals keep the prior cancel flow. Rejection is terminal, never modifies a source artifact, and remains visible in canonical interaction history.",
      inputSchema: cancelRuleUpdateInputSchema
    },
    async (args) => {
      const rt = await ensureRuntime();
      const active = requireActiveProjectCommand();
      if (!active.ok) {
        return failureResult("cancel_rule_update", active.reason, rt);
      }
      const result = cancelRuleUpdateCommand(active.project.path, args);
      return result.ok
        ? successResult(rt, result)
        : failureResult("cancel_rule_update", result.reason, rt);
    }
  );
}
