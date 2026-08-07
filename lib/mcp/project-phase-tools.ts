import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  abandonProjectPhaseCommand,
  backfillComponentCodeLinksCommand,
  backfillComponentCodeLinksInputSchema,
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

const formalizeInputSchema = z.object({
  promoteEntryIds: z
    .array(z.string())
    .optional()
    .describe(
      "Candidate adjudication: design_system_entries ids (row id or entry_id) the designer chose to promote candidate → formalized during the chat review. Unlisted candidates stay candidate. Every id must exist and currently be a candidate."
    )
});

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
        "Declare that the designer finished auditing the Draft Design System. Advances project phase from draft_design_system to prototype_validation and unlocks the first Prototype. After advancing, call get_prototype_rebuild_context to obtain the reconstruction context before writing the first prototype. Rejected out of order.",
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
        "Declare that the designer confirmed Prototype modifications and audit. Advances prototype_validation to design_system_formal; also re-enters design_system_formal from ready_for_new_design after a new-design-run prototype is confirmed, so the Design System can be formalized again (v2, v3, …). After advancing, keep the turn going autonomously — do not stop to ask: claim_consolidate_review to give every designer feedback an outcome (consumed via confirm_rule_update, or dismiss_designer_feedback with a reason), adjudicate candidates with the designer, backfill code links for the components this phase's prototype produced via backfill_component_code_links, then call formalize_design_system. Prototype file edits must go through the Agent (chat → Agent edit → record_designer_feedback); do not edit prototype files directly. Rejected out of order.",
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
        ? successResult(rt, {
            ...result,
            next: "Continue autonomously: claim_consolidate_review → outcome every feedback → backfill_component_code_links for prototype-produced components → formalize_design_system. Do not stop to ask."
          })
        : phaseFailure("confirm_prototype", result, rt);
    }
  );

  mcp.registerTool(
    "backfill_component_code_links",
    {
      description:
        "Backfill Prototype code links into Design System component specs. Declare entryId ↔ code-path mappings explicitly — one mapping per component spec entry, one or more code paths per entry; Runtime never auto-matches by name or filename. Every code path must resolve inside the project, exist on disk, and already be declared via record_artifact_written (artifactType code or prototype); a missing file or undeclared path is rejected with the offending path named, and nothing is written. On success value.codeLinks is written back into each entry's source spec JSON (file and DB stay in step, failure restores both) and a design_system_code_links_backfilled event records the exact mapping. Run after the designer confirms the Prototype and before formalize_design_system, so formalized components point at real code instead of only sourceCaptures.",
      inputSchema: backfillComponentCodeLinksInputSchema
    },
    async (args) => {
      const rt = await ensureRuntime();
      const active = requireActiveProjectCommand();
      if (!active.ok) {
        return failureResult("backfill_component_code_links", active.reason, rt);
      }
      const result = backfillComponentCodeLinksCommand(
        active.project.path,
        args.mappings
      );
      return result.ok
        ? successResult(rt, result)
        : failureResult(
            "backfill_component_code_links",
            result.reason,
            rt,
            result.details
          );
    }
  );

  mcp.registerTool(
    "formalize_design_system",
    {
      description:
        "Formalize the Design System and advance design_system_formal to ready_for_new_design. Requires every designer_feedback row to be marked consumed in designer_feedback_review_consumption (written when Issue 29 confirms a proposal that references that feedback); otherwise rejects with unreviewed_feedback_count. Pass promoteEntryIds to adjudicate Candidates chosen during the chat review: those entries flip candidate → formalized in the same transaction, and their source files are rewritten with the formalized status so file and DB stay in step; unlisted candidates stay candidate. The result carries code_backfill_hints: promoted component specs whose codeLinks are still empty while sourceCaptures remain their only provenance — an advisory gap list for backfill_component_code_links, never a rejection. Rejected out of order.",
      inputSchema: formalizeInputSchema
    },
    async (args) => {
      const rt = await ensureRuntime();
      const active = requireActiveProjectCommand();
      if (!active.ok) {
        return failureResult("formalize_design_system", active.reason, rt);
      }
      const result = formalizeDesignSystemCommand(
        active.project.path,
        args.promoteEntryIds ?? []
      );
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
