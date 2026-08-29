import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  registerComponentPreviewCommand,
  resolveComponentPreviewExceptionCommand,
  startComponentPreviewVerificationCommand,
  requireActiveProjectCommand
} from "../runtime/commands";
import {
  failureResult,
  successResult,
  type RegisterIkranToolsDeps
} from "./shared";

const argsObject = z.record(z.string(), z.unknown());

const registerComponentPreviewInputSchema = z.object({
  runId: z.string().describe("Exact current Prototype run id."),
  surfaceId: z.string().describe("Exact ready Prototype surface id for that run."),
  entryId: z.string().describe("Exact Design System component-spec entry id."),
  modulePath: z.string().describe("Exact declared project-relative component module path."),
  exportName: z.string().describe("Exact named export, or the literal `default`."),
  defaultArgs: argsObject.optional().describe("JSON-safe props for the default document."),
  stateArgs: z
    .record(z.string(), argsObject)
    .optional()
    .describe("Optional state name to JSON-safe props mapping.")
});

const verifyRegisteredInputSchema = z.object({
  entryIds: z.array(z.string()).optional(),
  timeoutMs: z.number().int().min(1000).max(60000).optional(),
  concurrency: z
    .number()
    .int()
    .min(1)
    .max(8)
    .optional()
    .describe("Bounded document concurrency; defaults conservatively to 2."),
  priorityEntryIds: z
    .array(z.string())
    .optional()
    .describe("Viewed/requested component entries to queue first, in order.")
});

const resolveExceptionInputSchema = z.object({
  exceptionId: z.string(),
  expectedDigest: z.string(),
  disposition: z.enum([
    "no_reusable_impact",
    "update_existing_rule",
    "create_candidate",
    "retain_open_gap",
    "unresolved_conflict"
  ]),
  rationale: z.string(),
  evidenceRecordIds: z.array(z.string()),
  targetEntryId: z.string().optional(),
  targetCategory: z.string().optional()
});

export function registerComponentPreviewTools(
  mcp: McpServer,
  { ensureRuntime }: RegisterIkranToolsDeps
): void {
  mcp.registerTool(
    "register_component_preview",
    {
      description:
        "Compatibility/diagnostic direct registration. Active components register automatically through record_artifact_written.componentPreview. Uses Ikran's shared Storybook-free Preview adapter and never creates a Story or per-component route.",
      inputSchema: registerComponentPreviewInputSchema
    },
    async (args) => {
      const rt = await ensureRuntime();
      const active = requireActiveProjectCommand();
      if (!active.ok) {
        return failureResult("register_component_preview", active.reason, rt);
      }
      const result = registerComponentPreviewCommand(active.project.path, args);
      return result.ok
        ? successResult(rt, result)
        : failureResult(
            "register_component_preview",
            result.reason,
            rt,
            result.details
          );
    }
  );

  mcp.registerTool(
    "verify_registered_component_previews",
    {
      description:
        "Compatibility/diagnostic trigger only; never call it as the Active post-registration step. record_artifact_written.componentPreview already schedules verification automatically. Default geometry settles first, remaining states run under digest cache and bounded concurrency, and non-default failure never removes a working default hero.",
      inputSchema: verifyRegisteredInputSchema
    },
    async (args) => {
      const rt = await ensureRuntime();
      const active = requireActiveProjectCommand();
      if (!active.ok) {
        return failureResult(
          "verify_registered_component_previews",
          active.reason,
          rt
        );
      }
      const result = await startComponentPreviewVerificationCommand(
        active.project.path,
        args
      );
      return result.ok
        ? successResult(rt, result)
        : failureResult(
            "verify_registered_component_previews",
            result.reason,
            rt,
            result.details
          );
    }
  );

  mcp.registerTool(
    "resolve_component_preview_exception",
    {
      description:
        "Resolve one digest-pinned component Preview exception packet. Choose exactly one structured disposition: no reusable impact, update an existing rule, create a Candidate, retain an Open Gap, or unresolved conflict. Runtime validates packet identity, evidence membership, permitted target category and current digest. Reusable changes continue through the existing Rule Update Review/designer approval boundary; this tool never formalizes an entry.",
      inputSchema: resolveExceptionInputSchema
    },
    async (args) => {
      const rt = await ensureRuntime();
      const active = requireActiveProjectCommand();
      if (!active.ok) {
        return failureResult(
          "resolve_component_preview_exception",
          active.reason,
          rt
        );
      }
      const result = resolveComponentPreviewExceptionCommand(
        active.project.path,
        args
      );
      return result.ok
        ? successResult(rt, result)
        : failureResult(
            "resolve_component_preview_exception",
            result.reason,
            rt,
            result.details
          );
    }
  );
}
