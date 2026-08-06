import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  abandonProjectPhaseCommand,
  confirmDraftDesignSystemCommand,
  confirmPrototypeCommand,
  formalizeDesignSystemCommand,
  requireActiveProjectCommand
} from "../runtime/commands";
import {
  failureResult,
  successResult,
  type RegisterIkranToolsDeps
} from "./shared";

const emptyInputSchema = z.object({});

function phaseFailure(
  toolName: string,
  result: { ok: false; reason: string; phase?: string; unreviewed_feedback_count?: number },
  rt: Awaited<ReturnType<RegisterIkranToolsDeps["ensureRuntime"]>>
) {
  return failureResult(toolName, result.reason, rt, {
    ...(result.phase !== undefined ? { phase: result.phase } : {}),
    ...(result.unreviewed_feedback_count !== undefined
      ? { unreviewed_feedback_count: result.unreviewed_feedback_count }
      : {})
  });
}

export function registerProjectPhaseTools(
  mcp: McpServer,
  { ensureRuntime }: RegisterIkranToolsDeps
): void {
  mcp.registerTool(
    "confirm_draft_design_system",
    {
      description:
        "Declare that the designer finished auditing the Draft Design System. Advances project phase from draft_design_system to prototype_validation and unlocks the first Prototype. Rejected out of order.",
      inputSchema: emptyInputSchema
    },
    async () => {
      const rt = await ensureRuntime();
      const active = requireActiveProjectCommand();
      if (!active.ok) {
        return failureResult("confirm_draft_design_system", active.reason, rt);
      }
      const result = confirmDraftDesignSystemCommand(active.project.path);
      return result.ok
        ? successResult(rt, result)
        : phaseFailure("confirm_draft_design_system", result, rt);
    }
  );

  mcp.registerTool(
    "confirm_prototype",
    {
      description:
        "Declare that the designer confirmed Prototype modifications and audit. Advances prototype_validation to design_system_formal. Prototype file edits must go through the Agent (chat → Agent edit → record_designer_feedback); do not edit prototype files directly. Rejected out of order.",
      inputSchema: emptyInputSchema
    },
    async () => {
      const rt = await ensureRuntime();
      const active = requireActiveProjectCommand();
      if (!active.ok) {
        return failureResult("confirm_prototype", active.reason, rt);
      }
      const result = confirmPrototypeCommand(active.project.path);
      return result.ok
        ? successResult(rt, result)
        : phaseFailure("confirm_prototype", result, rt);
    }
  );

  mcp.registerTool(
    "formalize_design_system",
    {
      description:
        "Formalize the Design System as v1 and advance design_system_formal to ready_for_new_design. Requires every designer_feedback row to be marked consumed in designer_feedback_review_consumption (written when Issue 29 confirms a proposal that references that feedback); otherwise rejects with unreviewed_feedback_count. Rejected out of order.",
      inputSchema: emptyInputSchema
    },
    async () => {
      const rt = await ensureRuntime();
      const active = requireActiveProjectCommand();
      if (!active.ok) {
        return failureResult("formalize_design_system", active.reason, rt);
      }
      const result = formalizeDesignSystemCommand(active.project.path);
      return result.ok
        ? successResult(rt, result)
        : phaseFailure("formalize_design_system", result, rt);
    }
  );

  mcp.registerTool(
    "abandon_project_phase",
    {
      description:
        "Abandon the current post-seed completion chain and return to seed when Draft or Prototype audit exposes a fundamental problem. Allowed from draft_design_system, prototype_validation, or design_system_formal. Records project_phase_abandoned.",
      inputSchema: emptyInputSchema
    },
    async () => {
      const rt = await ensureRuntime();
      const active = requireActiveProjectCommand();
      if (!active.ok) {
        return failureResult("abandon_project_phase", active.reason, rt);
      }
      const result = abandonProjectPhaseCommand(active.project.path);
      return result.ok
        ? successResult(rt, result)
        : phaseFailure("abandon_project_phase", result, rt);
    }
  );
}
