import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  recordNewDesignRunCommand,
  recordNewDesignRunInputSchema,
  requireActiveProjectCommand
} from "../runtime/commands";
import {
  failureResult,
  successResult,
  type RegisterIkranToolsDeps
} from "./shared";

export function registerNewDesignRunTools(
  mcp: McpServer,
  { ensureRuntime }: RegisterIkranToolsDeps
): void {
  mcp.registerTool(
    "record_new_design_run",
    {
      description:
        "Declare a human-intent new design run after Design System formalization (phase must be ready_for_new_design). Pass the designer's new intent. Returns the generation context packet: intent + design-system source with an explicit version and Formalized=hard / Candidate=soft priority (Formalized wins on conflict and conflicts must be marked). The packet never includes designer feedback, events, annotations, or prior conversation — those must not enter generation. If generation actually depends on Candidate entries, pass their ids as usedCandidateIds (also accepted on record_artifact_written). Then write prototype code, declare artifacts, and call record_preview. Start a new host conversation for each new design run. Requires at least one Seed Reference; rejected with no_seed_reference when the project has none — in that case the project is in seed reconstruction territory (capture a Seed Reference and rebuild the first prototype instead).",
      inputSchema: recordNewDesignRunInputSchema
    },
    async (args) => {
      const rt = await ensureRuntime();
      const active = requireActiveProjectCommand();
      if (!active.ok) {
        return failureResult("record_new_design_run", active.reason, rt);
      }
      const result = recordNewDesignRunCommand(active.project.path, args);
      return result.ok
        ? successResult(rt, result)
        : failureResult("record_new_design_run", result.reason, rt, {
            ...(result.phase !== undefined ? { phase: result.phase } : {})
          });
    }
  );
}
