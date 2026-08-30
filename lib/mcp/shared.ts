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
  studyMode?: boolean;
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

export const STUDY_MCP_INSTRUCTIONS =
  "Ikran Study Kit with preloaded frozen evidence. The assigned numbered workspace and STUDY-KIT-MANIFEST.json are authoritative. Verify the host-native Figma MCP can read the manifest fileKey/nodeId before beginning. Never request credentials, add or refresh Seed References, use Ikran Figma Connection tools, or abandon the project phase. After Draft creation, use get_effective_design_system and revise_draft_design_system to structurally supplement omissions; only the returned active revision may drive Prototype or new-design work.";

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
  "- If MCP transport closes after a Runtime/plugin update, stop and tell the designer to open a new task; never build a temporary MCP client, PTY bridge, or local fallback.\n" +
  "- export_research only after success recursion (exact criteria on the tool).\n\n" +
  "FLOW CONTRACTS on demand: claim_alignment_preparation → Alignment section_contract. finalize_alignment_preparation enters answer monitoring directly; persist each ready section as a draftPatch with record_incremental_initial_design_system_plan while Runtime merges and returns the complete Draft, resume interruptions with resume_initial_design_system_planning, never substitute wait_for_agent_command, and after Alignment completes call commit_incremental_initial_design_system_plan. While continuationRequired=true, execute nextAction immediately and do not end the turn. Initial Design System fallback is a two-call fast path: claim_initial_design_system_preparation once → reason only from its compact frozen context → commit_initial_design_system_semantics once using Q/A/D sourceRefs. Do not re-claim or query SQLite. Explicitly account for every source and every empty category; Runtime never invents omissions. Preserve evidence-backed color roles/rules and composite typography roles. After Draft creation stop for visible designer review. Only after an explicit designer confirmation may confirm_draft_design_system carry that wording → get_prototype_rebuild_context → rebuild seed → record_preview. Declare each implemented component with exact run/entry/module/export/default+state recipe and evidence-backed semanticImpact in record_artifact_written.componentPreview; Runtime links, previews, runs automatic verification, caches, and records internal Verified Candidate. Only resolve_component_preview_exception needs judgment. Do not poll verify_registered_component_previews. After all declarations, stop and return control for visible Prototype review. Apply designer feedback and redeclare changes; only after the designer explicitly completes review may confirm_prototype carry their wording and message id → reconcile_designer_conversation → claim_consolidate_review → Rule Update Review → formalize_design_system.";

// Claude Code truncates server instructions at 2048 UTF-8 bytes. This variant
// is selected only when IKRAN_MCP_HOST=claude (Claude Plugin Kit).
export const CLAUDE_MCP_INSTRUCTIONS =
  "OPEN-AND-WAIT: open that URL first; wait_for_agent_command for Alignment/Review.\n\n" +
  "DISCIPLINES:\n" +
  "- record_new_design_run needs Seed.\n" +
  "- Runtime capture is the sole Active ingestion path.\n" +
  "- record_artifact_written; undeclared files block export_research.\n" +
  "- Never silently drop input; never invent or formalize unrelated claims.\n" +
  "- Follow rule taxonomy; use rule-update proposal, never move silently. Design gen uses design-system source only, never feedback. Freeze transcript; call reconcile_designer_conversation.\n" +
  "- Runtime owns prototype servers: declare code, then record_preview.\n" +
  "- Send reconciliation to claim_consolidate_review; publish once, claim decisions. Never write before acceptance.\n" +
  "- layout/spec updates: fresh capture_rule_screenshot/Figma MCP or omit; never reuse existing capture files.\n" +
  "- Closed MCP: stop; new task; no temp PTY/client.\n" +
  "- export_research after success recursion.\n\n" +
  "On demand: claim_alignment_preparation → section_contract → draftPatch/record_incremental_initial_design_system_plan (full Draft back) → resume_initial_design_system_planning → commit_incremental_initial_design_system_plan. While continuationRequired=true, execute nextAction; do not end turn. Fallback: claim_initial_design_system_preparation → commit_initial_design_system_semantics with sourceRefs. Do not re-claim/query SQLite. Account all sources/empty categories, color rules, composite type roles. Stop after Draft; explicit approval → confirm_draft_design_system → get_prototype_rebuild_context → rebuild seed → record_preview. Put provenance+semanticImpact in record_artifact_written.componentPreview; Runtime runs automatic verification. Only resolve_component_preview_exception needs judgment; do not poll verify_registered_component_previews. After declarations stop for visible Prototype review; apply/redeclare feedback. Only explicit designer completion → confirm_prototype with wording/message id → reconcile → Consolidate → Rule Update Review → formalize.";

export function resolveMcpInstructions(
  env: {
    IKRAN_MCP_HOST?: string;
    IKRAN_STUDY_MODE?: string;
  } = process.env as {
    IKRAN_MCP_HOST?: string;
    IKRAN_STUDY_MODE?: string;
  }
) {
  if (env.IKRAN_STUDY_MODE === "1") return STUDY_MCP_INSTRUCTIONS;
  return env.IKRAN_MCP_HOST === "claude"
    ? CLAUDE_MCP_INSTRUCTIONS
    : IKRAN_MCP_INSTRUCTIONS;
}
