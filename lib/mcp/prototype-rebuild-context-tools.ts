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
        "Returns the authoritative seed reconstruction and machine-readable preview contracts for prototype_validation. Follow preview_contract in order: write the complete prototype, declare prototype and package artifacts, then call record_preview once. Runtime owns PORT and the dev-server process; completion requires readiness=ready and stale=false.",
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
