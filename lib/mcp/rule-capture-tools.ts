import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  captureRuleScreenshotCommand,
  captureRuleScreenshotInputSchema,
  declareComponentLiveHeroesCommand,
  declareComponentLiveHeroesInputSchema,
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
    "declare_component_live_heroes",
    {
      description:
        'Declare live iframe heroes for one or more component specs without taking screenshots. First write ALL standalone harness routes and one shared sizing helper, declare every file with record_artifact_written, then call record_preview ONCE so the linked surface is ready and non-stale; finally call this batch tool. Each mapping explicitly binds entryId + surfaceId + harnessPath + harnessArtifactPath. Runtime validates component codeLinks, declared code/prototype artifacts, the surface/root relationship and readiness, then writes value.liveHero into each source spec atomically. No Chromium is launched and no code-render PNG is created. The Design System Browser renders <previewUrl><harnessPath>; its default route must retain native pointer hover, while declared states are forced through ?state=<name>. Reset html/body margin to 0 and overflow to hidden. Wrap the specimen plus symmetric focus/shadow/portal halo in exactly one non-transformed `[data-ikran-component-root]` at non-negative document coordinates, with no negative overflow; its horizontal extent x + width MUST fit the 1133px presentation viewport. Install the sizing helper anew for every default/state document and bind `const href = window.location.href` at install time, so a queued old-state report keeps its old href. On mount, root ResizeObserver updates, and window resize, read one rect and post `{ type: "ikran:component-size", version: 2, href, x: rect.left, y: rect.top, width: max(root.scrollWidth, rect.width), height: max(root.scrollHeight, rect.height) }` to parent. The Browser verifies source + preview origin + current href, preserves the fixed presentation viewport, centers the measured root, grows around tall roots, and proportionally fits roots wider than the hero stage. Each default/state navigation must report independently. Legacy body-size/v1 messages are rejected and fall back after timeout. On failure it falls back directly to the existing source capture or explicit unavailable state. The harness document must suppress framework development chrome locally without disabling it for the normal prototype; for Next.js, add `nextjs-portal { display: none !important; }` to the harness route only and do NOT set global next.config devIndicators=false.',
      inputSchema: declareComponentLiveHeroesInputSchema
    },
    async (args) => {
      const rt = await ensureRuntime();
      const active = requireActiveProjectCommand();
      if (!active.ok) {
        return failureResult("declare_component_live_heroes", active.reason, rt);
      }
      const result = declareComponentLiveHeroesCommand(
        active.project.path,
        args
      );
      return result.ok
        ? successResult(rt, result)
        : failureResult("declare_component_live_heroes", result.reason, rt);
    }
  );
}
