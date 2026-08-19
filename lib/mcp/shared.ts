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

// Issue 18: instructions are the always-resident channel — behavioral floor +
// routing pointers only. Flow contracts ship on demand: the Alignment
// section_contract rides claim_alignment_preparation, the extraction
// source_contract rides claim_initial_design_system_preparation, and per-tool
// semantics live on each tool's description. Never restate contract content
// here; the byte budget (~2KB) is enforced by mcp-instructions.test.ts.
export const IKRAN_MCP_INSTRUCTIONS =
  "Ikran local research workbench; open_workbench returns a localhost URL. OPEN-AND-WAIT: while a response re-arms it for Alignment or an active Rule Update Review, keep calling wait_for_agent_command and claim each scoped durable command. All source-of-truth changes go through Ikran tools.\n\n" +
  "GLOBAL DISCIPLINES:\n" +
  "- Read phase + seed count via get_project_readiness; record_new_design_run requires an existing Seed Reference — with none, only seed reconstruction.\n" +
  "- Runtime capture is the sole Active ingestion path for Figma evidence; without Figma Connection, paste and Agent seed add fail closed.\n" +
  "- Declare host edits via record_artifact_written; undeclared files stay out of export_research.\n" +
  "- Never silently drop confirmed input: map to a stable record/entry or record conflict/omitted/gap. Never invent semantics or use one designer-edited card to formalize unrelated claims.\n" +
  "- Follow rule taxonomy; route misplaced rules through rule-update proposal, never move silently. Design gen uses design-system source only, never feedback. At explicit completion/Rule Update freeze the full transcript; call reconcile_designer_conversation.\n" +
  "- Runtime owns prototype dev servers: declare code, then record_preview; never run one.\n" +
  "- Pass the completed reconciliation to claim_consolidate_review; draft the complete Rule Update Review, publish it once, then claim designer decisions. Never write before an accepted decision is claimed.\n" +
  "- Rule updates to layout/components.spec attach a fresh capture via capture_rule_screenshot (or Figma MCP, or omit); never reuse existing capture files.\n" +
  "- export_research only after complete success recursion (DS v1→new design→confirm→DS v2).\n\n" +
  "FLOW CONTRACTS on demand: claim_alignment_preparation → Alignment section_contract; claim_initial_design_system_preparation → extraction source_contract. confirm_draft_design_system → get_prototype_rebuild_context → rebuild seed, then record_preview. confirm_prototype → reconcile_designer_conversation → claim_consolidate_review → backfill_component_code_links → declare_component_live_heroes → formalize_design_system(modificationReview).";
