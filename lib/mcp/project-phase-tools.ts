import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  abandonProjectPhaseCommand,
  backfillComponentCodeLinksCommand,
  backfillComponentCodeLinksInputSchema,
  confirmDraftDesignSystemCommand,
  confirmPrototypeCommand,
  formalizeDesignSystemCommand,
  getComponentFormalizationTimingCommand,
  requireActiveProjectCommand
} from "../runtime/commands";
import {
  failureResult,
  successResult,
  type RegisterIkranToolsDeps
} from "./shared";

const emptyInputSchema = z.object({});

const confirmDraftInputSchema = z.object({
  designerConfirmation: z.string().trim().min(1).describe(
    "The designer's explicit current-turn confirmation that they have reviewed the visible Draft Design System and want Prototype work to begin. Quote or faithfully preserve their wording; never infer this from Alignment completion or Draft creation."
  )
}).strict();

const timingInputSchema = z.object({
  sessionId: z
    .string()
    .optional()
    .describe("Optional timing session id; omit to read the latest local run.")
});

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
    verification_entry_ids?: string[];
    preview_entry_ids?: string[];
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
      : {}),
    ...(result.verification_entry_ids !== undefined
      ? { verification_entry_ids: result.verification_entry_ids }
      : {}),
    ...(result.preview_entry_ids !== undefined
      ? { preview_entry_ids: result.preview_entry_ids }
      : {})
  });
}

export function registerProjectPhaseTools(
  mcp: McpServer,
  { ensureRuntime }: RegisterIkranToolsDeps
): void {
  mcp.registerTool(
    "get_component_formalization_timing",
    {
      description:
        "Read the latest project-local code-backed formalization timing breakdown, or one exact session by id. Returns Runtime work, observable Agent wait, stage attempts, cold/warm Preview startup, cache status, typed failure, and Time to Visual/Verified/Formalized. Operational data only; it is not research evidence.",
      inputSchema: timingInputSchema
    },
    async (args) => {
      const rt = await ensureRuntime();
      const active = requireActiveProjectCommand();
      if (!active.ok) {
        return failureResult(
          "get_component_formalization_timing",
          active.reason,
          rt
        );
      }
      return successResult(
        rt,
        getComponentFormalizationTimingCommand(
          active.project.path,
          args.sessionId
        )
      );
    }
  );

  mcp.registerTool(
    "confirm_draft_design_system",
    {
      description:
        "Use only after the designer explicitly says they reviewed the visible Draft Design System and wants Prototype work to begin. Never call automatically after Draft creation, never infer approval from silence or Alignment completion, and never fabricate designerConfirmation. Records that confirmation, advances from draft_design_system to prototype_validation, then unlocks get_prototype_rebuild_context. Rejected without explicit confirmation or out of order.",
      inputSchema: confirmDraftInputSchema
    },
    async (args) => {
      const rt = await ensureRuntime();
      const active = requireActiveProjectCommand();
      if (!active.ok) {
        return failureResult("confirm_draft_design_system", active.reason, rt);
      }
      const result = confirmDraftDesignSystemCommand(
        active.project.path,
        args.designerConfirmation
      );
      return result.ok
        ? successResult(rt, result)
        : phaseFailure("confirm_draft_design_system", result, rt);
    }
  );

  mcp.registerTool(
    "confirm_prototype",
    {
      description:
        "Declare that the designer confirmed Prototype modifications and audit. Every code-linked Candidate component must already have a Runtime Preview registration from record_artifact_written.componentPreview or a resolved retain_open_gap exception; compatibility code-link backfill alone cannot satisfy this gate. Runtime owns code linking, the shared live Preview, verification cache, and internal Verified Candidate. Then reconcile the frozen conversation, complete claim_consolidate_review, resolve only emitted component Preview exceptions, wait for automatic verification eligibility, and formalize. Do not run the legacy per-component harness/backfill/declaration/verification chain. Rejected out of order.",
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
            next: "Continue autonomously: reconcile the frozen transcript → claim_consolidate_review → outcome feedback → resolve only emitted component Preview exceptions → wait for automatic verification → formalize_design_system."
          })
        : phaseFailure("confirm_prototype", result, rt);
    }
  );

  mcp.registerTool(
    "backfill_component_code_links",
    {
      description:
        "Compatibility-only repair for legacy records. Explicitly backfills entryId ↔ code paths and never guesses identity. Active components use record_artifact_written.componentPreview, which links and verifies automatically; this tool is not an Active next step.",
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
        ? successResult(rt, {
            ...result,
            next: "Legacy codeLinks repaired. Active updates must be redeclared through record_artifact_written.componentPreview."
          })
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
        "Formalize the Design System after current Rule Update Review completion, feedback consumption, source integrity checks, modificationReview, and designer-selected Candidate promotion. Registered component previews must already be fully Runtime-verified; queued/failed/stale registrations reject with component_preview_verification_required. Internal Verified Candidate never auto-promotes to Formalized. Rejected out of order.",
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
