import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  captureRuleScreenshotCommand,
  captureRuleScreenshotInputSchema,
  declareComponentLiveHeroesCommand,
  declareComponentLiveHeroesInputSchema,
  requireActiveProjectCommand,
  scaffoldComponentHarnessCommand,
  scaffoldComponentHarnessInputSchema,
  verifyComponentLiveHeroesCommand,
  verifyComponentLiveHeroesInputSchema
} from "../runtime/commands";
import {
  failureResult,
  successResult,
  type RegisterIkranToolsDeps
} from "./shared";

export const DECLARE_COMPONENT_LIVE_HEROES_DESCRIPTION =
  "Declare live iframe heroes for one or more component specs without taking screenshots. First obtain the shared sizing helper via scaffold_component_harness (Runtime-owned, never hand-write it; follow the returned live_hero_contract when writing harness routes), write ALL standalone harness routes around it, and declare every file with record_artifact_written; then call record_preview ONCE so the linked surface is ready and non-stale; finally call this batch tool. Each mapping explicitly binds entryId + surfaceId + harnessPath + harnessArtifactPath. Runtime validates component codeLinks, declared code/prototype artifacts, the surface/root relationship and readiness, then writes value.liveHero into each source spec atomically. No Chromium is launched and no code-render PNG is created — declaration is metadata-only, so a successful declare does NOT prove the harness renders: always run verify_component_live_heroes next and fix every failure before formalize_design_system.";

export function registerRuleCaptureTools(
  mcp: McpServer,
  { ensureRuntime }: RegisterIkranToolsDeps
): void {
  mcp.registerTool(
    "capture_rule_screenshot",
    {
      description:
        "Capture a fresh screenshot of a prototype surface's CURRENT rendering for design-system rule provenance (layout / components.spec sourceCaptures). Runtime loads the surface's preview URL in headless Chromium, optionally crops to `crop`, and bakes each `annotations` rect into the PNG as a green highlight mark; crop and annotations are normalized floats in [0, 1] against the FULL page (x/y = top-left). Typical usage is two passes: capture plain, inspect the PNG, then capture again with crop + annotations. The PNG lands under design-system/captures/ and the returned artifactPath is what you declare in the rule's sourceCaptures — record_artifact_written rejects a declared capture file that does not exist. Never reuse another rule's existing capture file. During Initial Design System extraction, do not use this tool or Figma MCP to crop locators: Runtime derives those from Alignment node anchors and the seed screenshot. When no preview surface is ready and no Runtime evidence screenshot exists, capture via the host Figma MCP or omit sourceCaptures (honest unavailable only when there is no source node).",
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
    "scaffold_component_harness",
    {
      description:
        "Write the Runtime-owned sizing helper for component live hero harnesses. The helper is protocol glue (the v2 ikran:component-size contract), not project code: Runtime writes it byte-identical every time so harness routes never hand-copy it from prose. Pass ONE shared helperPath inside the prototype app source tree (e.g. prototype/src/lib/ikran-component-harness.ts); idempotent on re-run, and a hand-edited existing file fails with helper_file_conflict instead of being clobbered. Success includes live_hero_contract (layout, sizing, browser, Next.js chrome). Call this BEFORE writing harness routes, then: import installIkranComponentSizing from this exact path in your shared harness frame, declare the helper and every harness file via record_artifact_written (artifactType code or prototype), call record_preview ONCE, declare_component_live_heroes, and finally verify_component_live_heroes.",
      inputSchema: scaffoldComponentHarnessInputSchema
    },
    async (args) => {
      const rt = await ensureRuntime();
      const active = requireActiveProjectCommand();
      if (!active.ok) {
        return failureResult("scaffold_component_harness", active.reason, rt);
      }
      const result = scaffoldComponentHarnessCommand(active.project.path, args);
      return result.ok
        ? successResult(rt, {
            ...result,
            next: "Declare the helper via record_artifact_written (artifactType code), write the harness routes importing installIkranComponentSizing from this exact path, declare every harness file, record_preview ONCE, then declare_component_live_heroes."
          })
        : failureResult("scaffold_component_harness", result.reason, rt);
    }
  );

  mcp.registerTool(
    "declare_component_live_heroes",
    {
      description: DECLARE_COMPONENT_LIVE_HEROES_DESCRIPTION,
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
        ? successResult(rt, {
            ...result,
            next_action: { tool: "verify_component_live_heroes" },
            next: "Declaration is metadata-only — the heroes are NOT proven live yet. Call verify_component_live_heroes now; fix every http_error (broken harness route/imports) or geometry_timeout (missing/misinstalled sizing helper) and re-verify until all_passed, then formalize_design_system."
          })
        : failureResult("declare_component_live_heroes", result.reason, rt);
    }
  );

  mcp.registerTool(
    "verify_component_live_heroes",
    {
      description:
        "Verify that declared component live heroes actually render. For every component spec with a liveHero declaration (or only entryIds), Runtime loads <previewUrl><harnessPath> — the default document plus each stateMatrix state — in a sandboxed iframe in headless Chromium and waits for the exact v2 ikran:component-size geometry report the Workbench hero requires. A plain HTTP preflight runs first so a dev-server error (wrong import, missing file → http_error with status, e.g. 500) is distinguished from a page that loads but never reports (geometry_timeout → the sizing helper is missing or misinstalled) and from invalid bounds (invalid_geometry → root exceeds the 1133px presentation viewport or reports non-finite values). Entries whose surface is not ready/stale are skipped with the reason. Observation only — nothing is written. Run after declare_component_live_heroes and re-run until all_passed before formalize_design_system; the Workbench shows the same failures to the designer as a silent source-capture fallback, so catching them here is what makes the declaration honest.",
      inputSchema: verifyComponentLiveHeroesInputSchema
    },
    async (args) => {
      const rt = await ensureRuntime();
      const active = requireActiveProjectCommand();
      if (!active.ok) {
        return failureResult("verify_component_live_heroes", active.reason, rt);
      }
      const result = await verifyComponentLiveHeroesCommand(
        active.project.path,
        args
      );
      if (!result.ok) {
        return failureResult("verify_component_live_heroes", result.reason, rt);
      }
      return successResult(rt, {
        ...result,
        ...(result.all_passed
          ? {
              next_action: { tool: "formalize_design_system" },
              next: "Every declared live hero reported valid geometry. Continue to formalize_design_system(modificationReview)."
            }
          : {
              next: "Some heroes failed verification — do NOT formalize yet. Fix each failing harness (http_error → route/imports; geometry_timeout → sizing helper; surface_stale → record_preview once) and re-run verify_component_live_heroes until all_passed."
            })
      });
    }
  );
}
