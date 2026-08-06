import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  cancelRuleUpdateCommand,
  cancelRuleUpdateInputSchema,
  confirmRuleUpdateCommand,
  confirmRuleUpdateInputSchema,
  proposeRuleUpdateCommand,
  proposeRuleUpdateInputSchema,
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
    "propose_rule_update",
    {
      description:
        "Draft one rule-update proposal and persist it as awaiting_confirmation. Use kind=move for a rule misplaced under the extraction source_contract taxonomy (requires sourceArtifactPath, entryId, proposedTargetPath); use kind=new or kind=update for a rule the Consolidate review concluded should be added or changed (requires title and changeDescription). classification is the six-part disposition taxonomy: local_exception, reusable_candidate, rule_conflict, open_gap, proposed_update, no_finding. evidenceRecordIds must reference existing Runtime records (alignment question cards, agent annotations, region annotations, evidence surfaces, seed references, designer feedback); forged ids are rejected. Narrate in chat ONLY the proposals that would become global rules (reusable_candidate / proposed_update); the other classifications stay recorded as dispositions the designer can query on demand. This tool never edits any source artifact: wait for confirm_rule_update, then write the file and declare it with record_artifact_written carrying that proposalId.",
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
        : failureResult("propose_rule_update", result.reason, rt);
    }
  );

  mcp.registerTool(
    "confirm_rule_update",
    {
      description:
        "Declare the designer's chat Confirm for one awaiting proposal. Flips it to confirmed, records rule_update_confirmed, and marks every designer_feedback evidence id as reviewed. Only after this may you write the corresponding source artifact and declare it via record_artifact_written with this proposalId. Rejects a proposal that is already confirmed or canceled.",
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
        "Declare the designer's chat Cancel for one awaiting proposal. Flips it to canceled and records rule_update_canceled. Never modifies a source artifact and never marks feedback as reviewed — canceled evidence stays unreviewed until another proposal consumes it or dismiss_designer_feedback records its disposition.",
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
