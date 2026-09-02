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
  reviseRuleUpdateProposalCommand,
  reviseRuleUpdateProposalInputSchema,
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
        "Publish every proposal in a draft Review as one visible batch and activate the Rule Update-specific designer wait. For a reconciliation-bound Review, publishing first verifies that every decision is covered by proposal evidence or a typed no-proposal disposition; every final_decision must be in proposal evidence or cite an existing Rule. One proposal may cover multiple related decisions. Component targets must resolve to a browsable component-list.json id through its specPath, and their frozen bodies must already link canonical proposal evidence; publishing rejects unappliable or orphan targets before designer review. An empty batch completes immediately only when the coverage audit is complete.",
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
        "Draft one Rule Update proposal. For new/update/move pass the complete machine-write body in fullRuleBody and a short human-readable changeDescription. For a component target, fullRuleBody is the complete component-spec JSON and its top-level links must include at least one canonical answered-card, Agent-annotation, or designer-feedback id also present in evidenceRecordIds; Runtime rejects a body that could not be applied exactly after approval. Retire is available only inside a managed Review: omit fullRuleBody and bind exactly one existing prose Rule in foundations.home/layout/interaction with sourceArtifactPath plus entryId; an accepted retire authorizes only that Rule's removal. Pass targetCategory as foundations.home/color/typography/materials/layout/interaction or component:<component-list.json id>. Component ids always come from design-system/component-list.json, never from the spec JSON id; Runtime accepts a linked legacy spec id only by canonicalizing it through specPath. Move proposals also pass their typed sourceCategory. The draft stays private until publish_rule_update_review. This tool never edits source artifacts.",
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
        "Claim the earliest durable designer decision across published Rule Update Reviews. The payload freezes the exact proposal revision, semantic target, base digest, and source_write_evidence_record_ids. Rejected decisions complete on claim without a source write. For accepted decisions, apply only full_rule_body to the authorized target, copy source_write_evidence_record_ids into the changed entry links, and call record_artifact_written(proposalId); Runtime automatically binds the same evidence to the declaration, so never search old Alignment records or invent message ids. A provenance-only declaration error is repaired and redeclared against the same claimed revision; it does not require designer re-acceptance. Fail explicitly only when the accepted semantic body itself is wrong or cannot be applied.",
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
        "Mark a claimed accepted Rule Update application as recoverably failed and reopen the Review wait. Use retry_rule_update_apply only when the frozen proposal is still correct and the failure was operational. If the accepted proposal body itself is invalid, use revise_rule_update_proposal to append a corrected immutable revision for a new designer decision.",
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
    "revise_rule_update_proposal",
    {
      description:
        "Append an Agent-authored immutable revision after an accepted Rule Update application failed or entered Needs revision. Submit the complete corrected title, machine-write body, optional short changeDescription, and the same canonical semantic target. Runtime schema-validates component bodies before saving, cancels the failed command without deleting its audit history, and returns the proposal to Pending Review. The designer must Accept the new revision before any source write. This tool cannot revise a normal pending proposal.",
      inputSchema: reviseRuleUpdateProposalInputSchema
    },
    async (args) => {
      const rt = await ensureRuntime();
      const active = requireActiveProjectCommand();
      if (!active.ok) {
        return failureResult(
          "revise_rule_update_proposal",
          active.reason,
          rt
        );
      }
      const result = reviseRuleUpdateProposalCommand(active.project.path, {
        ...args,
        author: "agent"
      });
      return result.ok
        ? successResult(rt, result)
        : failureResult(
            "revise_rule_update_proposal",
            result.reason,
            rt,
            "details" in result ? result.details : undefined
          );
    }
  );

  mcp.registerTool(
    "retry_rule_update_apply",
    {
      description:
        "Retry a Rule Update application only after an operational failure when the frozen proposal body remains correct, using the same durable command identity. If the proposal body is invalid, submit a corrected immutable revision with revise_rule_update_proposal instead. Base digest validation still runs again at claim time.",
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
