export type RuntimeHandle = {
  host: string;
  port: number;
  token: string;
  url: string;
  spawned: boolean;
};

export type DiscoveredWorkingFolder = {
  folder: string | null;
  source: string;
  roots: unknown[];
};

export type RegisterIkranToolsDeps = {
  ensureRuntime: () => Promise<RuntimeHandle>;
  discoverWorkingFolder: () => Promise<DiscoveredWorkingFolder>;
  host: string;
  prod: boolean;
  /** Absolute path to bin/ikran-mcp.mjs (for setup_workspace snippet). */
  mcpEntryPath: string;
};

export function failureResult(
  toolName: string,
  reason: string,
  rt?: RuntimeHandle,
  details?: unknown
) {
  return {
    content: [
      {
        type: "text" as const,
        text:
          details === undefined
            ? `${toolName} failed: ${reason}`
            : `${toolName} failed: ${reason}\n${JSON.stringify(details)}`
      }
    ],
    structuredContent: {
      ok: false,
      error: reason,
      detail: reason,
      ...(details === undefined ? {} : { details }),
      ...(rt
        ? { session: rt.token, workbench_url: rt.url }
        : {})
    }
  };
}

export function successResult(
  rt: RuntimeHandle,
  value: Record<string, unknown>
) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: { ...value, session: rt.token, workbench_url: rt.url }
  };
}

export function conciseSuccessResult(
  rt: RuntimeHandle,
  value: Record<string, unknown>,
  message: string
) {
  return {
    content: [{ type: "text" as const, text: message }],
    structuredContent: { ...value, session: rt.token, workbench_url: rt.url }
  };
}

// Issue 18: instructions are the always-resident channel — behavioral floor +
// routing pointers only. Flow contracts ship on demand: the Alignment
// section_contract rides claim_alignment_preparation, compact extraction
// context rides claim_initial_design_system_preparation, live-hero
// component Preview provenance rides record_artifact_written.componentPreview;
// per-tool semantics live on each tool's description. Never restate contract
// content here.
export const CLAUDE_MCP_TEXT_BUDGET = 2048;

export const IKRAN_MCP_INSTRUCTIONS =
  "Ikran local research workbench; open_workbench returns a localhost URL. OPEN-AND-WAIT: open that URL first; while a response re-arms it for Alignment preparation or an active Rule Update Review, keep calling wait_for_agent_command and claim each scoped durable command. All source-of-truth changes go through Ikran tools.\n\n" +
  "GLOBAL DISCIPLINES:\n" +
  "- Read phase + seed count via get_project_readiness; record_new_design_run requires an existing Seed Reference — with none, only seed reconstruction.\n" +
  "- Runtime capture is the sole Active ingestion path for Figma evidence; without Figma Connection, paste and Agent seed add fail closed.\n" +
  "- Declare host edits via record_artifact_written; undeclared files stay out of export_research.\n" +
  "- Never silently drop confirmed input: map to a stable record/entry or record conflict/omitted/gap. Never invent semantics or use one designer-edited card to formalize unrelated claims.\n" +
  "- Follow rule taxonomy; route misplaced rules through rule-update proposal, never move silently. Design gen uses design-system source only, never feedback. At explicit completion/Rule Update freeze the full transcript; call reconcile_designer_conversation.\n" +
  "- Runtime owns prototype dev servers: declare code, then record_preview; never run one.\n" +
  "- Pass the completed reconciliation to claim_consolidate_review; draft the complete Rule Update Review, publish it once, then claim designer decisions. Never write before an accepted decision is claimed.\n" +
  "- Rule updates to layout/components.spec attach a fresh capture via capture_rule_screenshot (or Figma MCP, or omit); never reuse existing capture files.\n" +
  "- export_research only after success recursion (exact criteria on the tool).\n\n" +
  "FLOW CONTRACTS on demand: claim_alignment_preparation → Alignment section_contract. finalize_alignment_preparation enters answer monitoring directly; persist every ready section with record_incremental_initial_design_system_plan, resume interruptions with resume_initial_design_system_planning, never substitute wait_for_agent_command, and after Alignment completes call commit_incremental_initial_design_system_plan. While continuationRequired=true, execute nextAction immediately and do not end the turn. Initial Design System fallback is a two-call fast path: claim_initial_design_system_preparation once → reason only from its compact frozen context → commit_initial_design_system_semantics once using Q/A/D sourceRefs. Do not re-claim or query SQLite. Explicitly account for every source and every empty category; Runtime never invents omissions. Preserve evidence-backed color roles/rules and composite typography roles. After Draft creation stop for visible designer review. Only after an explicit designer confirmation may confirm_draft_design_system carry that wording → get_prototype_rebuild_context → rebuild seed → record_preview. Declare each implemented component with exact run/entry/module/export/default+state recipe and evidence-backed semanticImpact in record_artifact_written.componentPreview; Runtime links, previews, verifies, caches, and records internal Verified Candidate automatically. Only resolve_component_preview_exception wakes the Agent for judgment. confirm_prototype → reconcile_designer_conversation → claim_consolidate_review → automatic verification → formalize_design_system.";

// Claude Code truncates server instructions at 2048 UTF-8 bytes. This variant
// is selected only when IKRAN_MCP_HOST=claude (Claude Plugin Kit).
export const CLAUDE_MCP_INSTRUCTIONS =
  "OPEN-AND-WAIT: open that URL first; wait_for_agent_command only for Alignment prep/Rule Review.\n\n" +
  "DISCIPLINES:\n" +
  "- record_new_design_run needs a Seed Reference.\n" +
  "- Runtime capture is the sole Active ingestion path; no Connection means no paste/add.\n" +
  "- Declare edits via record_artifact_written; undeclared files cannot export_research.\n" +
  "- Never silently drop input: map/mark conflict/omitted/gap. Never invent semantics or formalize unrelated claims.\n" +
  "- Follow rule taxonomy; use rule-update proposal, never move silently. Design gen uses design-system source only, never feedback. Freeze transcript; call reconcile_designer_conversation.\n" +
  "- Runtime owns prototype servers: declare code, then record_preview.\n" +
  "- Send reconciliation to claim_consolidate_review; publish once, claim decisions. Never write before acceptance.\n" +
  "- layout/components.spec updates attach fresh capture via capture_rule_screenshot/Figma MCP or omit; never reuse existing capture files.\n" +
  "- export_research only after success recursion.\n\n" +
  "On demand: claim_alignment_preparation → section_contract. finalize_alignment_preparation monitors answers; record_incremental_initial_design_system_plan, resume_initial_design_system_planning, then commit_incremental_initial_design_system_plan. While continuationRequired=true, execute nextAction; do not end the turn. Fallback: claim_initial_design_system_preparation once → commit_initial_design_system_semantics once using Q/A/D sourceRefs. Do not re-claim/query SQLite. Account every source/empty category; preserve color rules and composite type roles. Stop after Draft for review; only quote explicit designer approval in confirm_draft_design_system → get_prototype_rebuild_context → rebuild seed → record_preview. Put provenance + semanticImpact in record_artifact_written.componentPreview; Runtime verifies. Only resolve_component_preview_exception needs judgment. confirm_prototype → reconcile_designer_conversation → claim_consolidate_review → automatic verification → formalize_design_system.";

export function resolveMcpInstructions(
  env: {
    IKRAN_MCP_HOST?: string;
  } = process.env as {
    IKRAN_MCP_HOST?: string;
  }
) {
  return env.IKRAN_MCP_HOST === "claude"
    ? CLAUDE_MCP_INSTRUCTIONS
    : IKRAN_MCP_INSTRUCTIONS;
}
