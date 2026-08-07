import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  captureComponentCodeHeroCommand,
  captureComponentCodeHeroInputSchema,
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

  mcp.registerTool(
    "capture_component_code_hero",
    {
      description:
        "Generate the code-backed hero capture for ONE component spec entry (Issue 32): Runtime screenshots the component's CURRENT code rendering — the preview URL of the Prototype Evidence Surface you name — and writes the capture back into the entry's sourceCaptures with origin \"code\", replacing any previous code capture (source captures are never touched). Gate: the entry must be a component spec whose value.codeLinks were backfilled via backfill_component_code_links, and every linked code file must exist; the capture freezes those files' content digest, and the Design System Browser marks the capture stale once the code changes (never auto-regenerated — re-run this tool to refresh). Use crop to frame the component (two passes, like capture_rule_screenshot: plain, inspect, then crop). Honest failure: when the entry has no codeLinks, the surface preview is unavailable, or the render fails, NOTHING is written and the entry keeps its existing captures — the hero falls back to source-capture / unavailable instead of going blank. Live hero (Issue 33): pass harnessPath to upgrade the hero from this static capture to a live sandboxed render — harnessPath is a same-origin relative route YOU add to the prototype app (e.g. \"/__ikran/component/button\") that mounts the component standalone with default props and re-renders on the ?state=<name> query (state names come from the spec's stateMatrix; pure presentation, no postMessage, no Runtime API calls). The hero falls back to this static capture with a reason caption whenever the live surface is not ready or the harness stops loading — digest staleness never takes down the live render.",
      inputSchema: captureComponentCodeHeroInputSchema
    },
    async (args) => {
      const rt = await ensureRuntime();
      const active = requireActiveProjectCommand();
      if (!active.ok) {
        return failureResult("capture_component_code_hero", active.reason, rt);
      }
      const result = await captureComponentCodeHeroCommand(
        active.project.path,
        args
      );
      return result.ok
        ? successResult(rt, result)
        : failureResult("capture_component_code_hero", result.reason, rt);
    }
  );
}
