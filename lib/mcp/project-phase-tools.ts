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
  modificationReview: z
    .string()
    .describe(
      "Required modification-review attestation: one sentence declaring that you inspected this phase's prototype modifications for reusable-rule candidates, and where any identified candidates went (e.g. 'Reviewed the phase's modifications; the divider inset fix became proposal <id>, the rest were page-local defect fixes with no reusable rule.'). Pure defect fixes are a fine outcome — what is not allowed is skipping the judgment. Recorded verbatim on the design_system_formalized event; an empty or whitespace-only value is rejected with empty_modification_review."
    ),
  promoteEntryIds: z
    .array(z.string())
    .optional()
    .describe(
      "Candidate adjudication: design_system_entries ids (row id or entry_id) the designer chose to promote candidate → formalized during the chat review. Unlisted candidates stay candidate. Every id must exist and currently be a candidate."
    )
});

function phaseFailure(
  toolName: string,
  result: {
    ok: false;
    reason: string;
    phase?: string;
    unreviewed_feedback_count?: number;
    changed_artifact_paths?: string[];
    source_warnings?: unknown[];
    source_issues?: unknown[];
  },
  rt: Awaited<ReturnType<RegisterIkranToolsDeps["ensureRuntime"]>>
) {
  return failureResult(toolName, result.reason, rt, {
    ...(result.phase !== undefined ? { phase: result.phase } : {}),
    ...(result.unreviewed_feedback_count !== undefined
      ? { unreviewed_feedback_count: result.unreviewed_feedback_count }
      : {}),
    ...(result.changed_artifact_paths !== undefined
      ? { changed_artifact_paths: result.changed_artifact_paths }
      : {}),
    ...(result.source_warnings !== undefined
      ? { source_warnings: result.source_warnings }
      : {}),
    ...(result.source_issues !== undefined
      ? { source_issues: result.source_issues }
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
        "Declare that the designer confirmed Prototype modifications and audit. Advances prototype_validation to design_system_formal; also re-enters design_system_formal from ready_for_new_design after a new-design-run prototype is confirmed. After advancing, keep the turn going autonomously: freeze the complete current host-conversation range and call reconcile_designer_conversation; pass its id to claim_consolidate_review and give every feedback an outcome; then review reusable candidates, backfill code links, and formalize. Do not write semantic feedback during active dialogue. Prototype file edits must go through the Agent; do not edit prototype files directly. Rejected out of order.",
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
            next_action: { tool: "reconcile_designer_conversation" },
            next: "Continue autonomously: freeze the completed host transcript → reconcile_designer_conversation → claim_consolidate_review(reconciliationId) → outcome every feedback → backfill_component_code_links → formalize_design_system."
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
        "Formalize the Design System and advance design_system_formal to ready_for_new_design. A completed Rule Update round is mandatory for every Prototype confirmation, even when it concludes that no rules should change: reconcile_designer_conversation and claim_consolidate_review must both occur after the latest confirm_prototype, or this rejects with rule_update_review_required. Every designer_feedback row must then be consumed by a confirmed proposal or explicitly dismissed; otherwise this rejects with unreviewed_feedback_count. Any undeclared Design System source drift rejects with rule_update_proposal_required and the changed paths; a missing, invalid, or otherwise unready declared source rejects with design_system_source_not_ready and source_warnings. Source digests are checked again immediately before the final transaction; concurrent drift rejects with design_system_source_changed_during_formalize. Requires modificationReview: your one-sentence attestation that this phase's prototype modifications were inspected for reusable-rule candidates — the review itself is mandatory even when its outcome is 'no reusable rules'. Pass promoteEntryIds to adjudicate Candidates chosen during the chat review: those entries flip candidate → formalized in the same transaction, and their source files are rewritten with the formalized status so file and DB stay in step; unlisted candidates stay candidate. The result carries code_backfill_hints: promoted component specs whose codeLinks are still empty while sourceCaptures remain their only provenance — an advisory gap list for backfill_component_code_links, never a rejection. Rejected out of order.",
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
        args.promoteEntryIds ?? [],
        args.modificationReview
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
