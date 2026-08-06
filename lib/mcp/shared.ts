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
        text: `${toolName} failed: ${reason}`
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
// here; keep this within ~2KB.
export const IKRAN_MCP_INSTRUCTIONS =
  "Ikran local research workbench. open_workbench starts/reuses it and returns a localhost URL. OPEN-AND-WAIT: after create_or_open_project, keep calling wait_for_agent_command and claim each durable command so designer Next/Complete continues the same turn; MCP cannot restart a turn once it ends. All source-of-truth changes go through Ikran tools.\n\n" +
  "GLOBAL DISCIPLINES:\n" +
  "- Runtime capture is the sole Active ingestion path for Figma screenshots/positional evidence; without Figma Connection, Workbench paste and Agent seed add fail closed. Host Figma MCP is context only.\n" +
  "- Declare artifacts via record_artifact_written after host edits; undeclared files stay out of export_research.\n" +
  "- Never silently drop confirmed input: map to a stable record/entry, or record conflict/omitted/gap. Never invent semantics; never use one designer-edited card to formalize unrelated claims.\n" +
  "- Follow source_contract rule taxonomy; route misplaced-rule moves through the rule-update proposal channel, never move silently. Design gen uses design-system source only, never feedback; Formalized hard over Candidate soft—pass usedCandidateIds when depending on Candidate; declare conclusions via record_designer_feedback.\n" +
  "- Runtime owns prototype dev servers: declare code, then record_preview; never run one. After formalize: record_new_design_run (intent+DS only), new host chat.\n" +
  "- Read feedback only via claim_consolidate_review when the designer starts review; narrate only global-rule proposals (reusable_candidate/proposed_update). Never write a rule-update artifact before confirm_rule_update; declare with that proposalId.\n" +
  "- Call export_research only after complete success recursion (DS v1→new design→feedback/confirm→DS v2→second new design).\n\n" +
  "FLOW CONTRACTS on demand: claim_alignment_preparation → Alignment section_contract; claim_initial_design_system_preparation → frozen context + extraction source_contract. Read all context first, then record global/tokens/layout/interaction units, one per component, then the audit.";
