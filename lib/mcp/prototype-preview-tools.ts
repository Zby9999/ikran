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
        "Declare a prototype preview after writing the code and declaring its artifact with record_artifact_written. Creates or updates one prototype run plus one Prototype Evidence Surface per previewable page (surfaceKey), and records the run inputs: seed reference ids, evidence version ids (Figma Evidence Surface ids) and the Runtime-derived design-system version. Pass routePath explicitly for every page (`/` for home, `/projects/atlas` for that route); sourceArtifactPath is provenance and is never guessed into a framework route. Runtime — not you — owns the dev server: it installs, starts, probes and reports readiness (installing / starting / ready / failed) on a stable preview URL. Never start, restart or supervise a dev server yourself, and never pass a preview origin or URL. Rejected before the designer confirms the draft design system (phase_gate). During prototype_validation, seedReferenceIds and evidenceVersionIds are required. After the first successful record_preview, Runtime watches prototype files and refreshes the Workbench screenshot itself — do not recapture by calling this tool again on ordinary source/style edits. Call it again only to declare a new page/route, or after the surface goes stale because the dev server exited or became unreachable.",
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
