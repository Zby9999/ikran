import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
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
        "Propose moving a rule that appears misplaced under the extraction source_contract taxonomy. Records the source entry, proposed target artifact, semantic reason, affected items, and evidence record ids as an awaiting-confirmation event. This tool never edits or moves either source artifact; do not perform the move unless a later designer-owned confirmation flow explicitly authorizes it.",
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
}
