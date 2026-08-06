import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  recordPreviewCommand,
  recordPreviewInputSchema,
  requireActiveProjectCommand
} from "../runtime/commands";
import {
  failureResult,
  successResult,
  type RegisterIkranToolsDeps
} from "./shared";

export function registerPrototypePreviewTools(
  mcp: McpServer,
  { ensureRuntime }: RegisterIkranToolsDeps
): void {
  mcp.registerTool(
    "record_preview",
    {
      description:
        "Declare a prototype preview after writing the code and declaring its artifact with record_artifact_written. Creates or updates one prototype run plus one Prototype Evidence Surface per previewable page (surfaceKey), and records the run inputs: seed reference ids, evidence version ids (Figma Evidence Surface ids) and the Runtime-derived design-system version. Runtime — not you — owns the dev server: it installs, starts, probes and reports readiness (installing / starting / ready / failed) on a stable preview URL. Never start, restart or supervise a dev server yourself, and never pass a preview URL. Rejected before the designer confirms the draft design system (phase_gate). During prototype_validation, seedReferenceIds and evidenceVersionIds are required. When the dev server exits or you declare a further code change, the surface is marked stale — call record_preview again to re-establish it.",
      inputSchema: recordPreviewInputSchema
    },
    async (args) => {
      const rt = await ensureRuntime();
      const active = requireActiveProjectCommand();
      if (!active.ok) {
        return failureResult("record_preview", active.reason, rt);
      }
      const result = await recordPreviewCommand(active.project.path, args);
      return result.ok
        ? successResult(rt, result)
        : failureResult("record_preview", result.reason, rt);
    }
  );
}
