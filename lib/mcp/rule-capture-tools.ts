import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  captureRuleScreenshotCommand,
  captureRuleScreenshotInputSchema,
  requireActiveProjectCommand
} from "../runtime/commands";
import {
  failureResult,
  successResult,
  type RegisterIkranToolsDeps
} from "./shared";

export function registerRuleCaptureTools(
  mcp: McpServer,
  { ensureRuntime }: RegisterIkranToolsDeps
): void {
  mcp.registerTool(
    "capture_rule_screenshot",
    {
      description:
        "Capture a fresh screenshot of a prototype surface's CURRENT rendering for design-system rule provenance (layout / components.spec sourceCaptures). Runtime loads the surface's preview URL in headless Chromium, optionally crops to `crop`, and bakes each `annotations` rect into the PNG as a green highlight mark; crop and annotations are normalized floats in [0, 1] against the FULL page (x/y = top-left). Typical usage is two passes: capture plain, inspect the PNG, then capture again with crop + annotations. The PNG lands under design-system/captures/ and the returned artifactPath is what you declare in the rule's sourceCaptures — record_artifact_written rejects a declared capture file that does not exist. Never reuse another rule's existing capture file; when no preview surface is ready, capture via the host Figma MCP or omit sourceCaptures (honest unavailable).",
      inputSchema: captureRuleScreenshotInputSchema
    },
    async (args) => {
      const rt = await ensureRuntime();
      const active = requireActiveProjectCommand();
      if (!active.ok) {
        return failureResult("capture_rule_screenshot", active.reason, rt);
      }
      const result = await captureRuleScreenshotCommand(active.project.path, args);
      return result.ok
        ? successResult(rt, result)
        : failureResult("capture_rule_screenshot", result.reason, rt);
    }
  );
}
