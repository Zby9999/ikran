import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  getPrototypeRebuildContextCommand,
  requireActiveProjectCommand
} from "../runtime/commands";
import {
  failureResult,
  successResult,
  type RegisterIkranToolsDeps
} from "./shared";

const emptyInputSchema = z.object({});

export function registerPrototypeRebuildContextTools(
  mcp: McpServer,
  { ensureRuntime }: RegisterIkranToolsDeps
): void {
  mcp.registerTool(
    "get_prototype_rebuild_context",
    {
      description:
        "Returns the seed reconstruction context for the prototype_validation phase: seed source identities (fileKey/nodeId/figmaLink), current evidence surface ids, the design-system version, and the rebuild contract. Rebuild the seed page from the LIVE Figma design context fetched via the host's Figma MCP get_design_context — current Figma state is the source of truth; persisted screenshots are auxiliary fallback only. Then declare artifacts and call record_preview with the returned seedReferenceIds and evidence surface ids.",
      inputSchema: emptyInputSchema
    },
    async () => {
      const rt = await ensureRuntime();
      const active = requireActiveProjectCommand();
      if (!active.ok) {
        return failureResult("get_prototype_rebuild_context", active.reason, rt);
      }
      const result = getPrototypeRebuildContextCommand(active.project.path);
      return result.ok
        ? successResult(rt, result)
        : failureResult("get_prototype_rebuild_context", result.reason, rt, {
            ...(result.reason === "phase_gate" ? { phase: result.phase } : {})
          });
    }
  );
}
