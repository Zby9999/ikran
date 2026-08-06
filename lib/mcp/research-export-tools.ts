import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  exportResearchCommand,
  requireActiveProjectCommand
} from "../runtime/commands";
import {
  failureResult,
  successResult,
  type RegisterIkranToolsDeps
} from "./shared";

const exportResearchInputSchema = z.object({});

export function registerResearchExportTools(
  mcp: McpServer,
  { ensureRuntime }: RegisterIkranToolsDeps
): void {
  mcp.registerTool(
    "export_research",
    {
      description:
        "Generate the research export package under .ikran/export/ when the project has completed a successful recursion (DS v1 formalize → new_design run → feedback or confirmed rule update → DS v2 formalize → second new_design run). Writes events.jsonl, project-summary.json, alignment-questions.json, designer-answers.json, prototype-runs.json, rule-update-proposals.json, designer-feedback.json, and artifacts-index.json from canonical SQLite records (not a folder scan). Rejects when the eligibility gate is unmet. Undeclared source files, failures, drafts, cancels, and Open Gap stay out of research facts.",
      inputSchema: exportResearchInputSchema
    },
    async () => {
      const rt = await ensureRuntime();
      const active = requireActiveProjectCommand();
      if (!active.ok) {
        return failureResult("export_research", active.reason, rt);
      }
      const result = exportResearchCommand(active.project.path);
      return result.ok
        ? successResult(rt, result)
        : failureResult("export_research", result.reason, rt, {
            ...(result.eligibility
              ? { eligibility: result.eligibility }
              : {})
          });
    }
  );
}
