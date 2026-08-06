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
  "Ikran local research workbench. open_workbench starts (or reuses) the local HTTP Workbench and returns a localhost URL with a startup-level session token. OPEN-AND-WAIT DEFAULT: when the user asks to open or start Ikran, opening the URL is not the end of the task. After create_or_open_project succeeds, do not end the current turn: immediately call wait_for_agent_command and keep consuming any returned durable command through its semantic claim tool — this active wait is what lets a later designer-owned Workbench Next phase or Complete action continue the same Agent turn; standard MCP cannot restart the turn after it ends. All research source-of-truth changes go through Ikran tools.\n\n" +
  "GLOBAL DISCIPLINES:\n" +
  "- Runtime capture is the sole Active ingestion path for Figma screenshots / positional evidence; without an active Figma Connection, Workbench paste and Agent seed add fail closed. The host's separate Figma MCP is implementation-level context only, never an ingestion path.\n" +
  "- After writing any source artifact with the host's native file editing, immediately declare it via record_artifact_written; undeclared files are excluded from research export.\n" +
  "- Never silently drop confirmed input: map it to a stable record or entry target, or record an explicit conflict / omitted / gap outcome. Never invent semantics to fill gaps, and never use one designer-edited card to formalize unrelated claims.\n" +
  "- Follow the source_contract rule taxonomy; propose misplaced-rule moves through the rule-update proposal channel, never move silently. Design gen uses design-system source only — never feedback; declare each modification conclusion via record_designer_feedback.\n\n" +
  "FLOW CONTRACTS arrive on demand: claim_alignment_preparation returns the Alignment section_contract; claim_initial_design_system_preparation returns frozen context and extraction source_contract. Read all context first; then record global/tokens/layout/interaction work units and one unit per component, then the cross-section audit. Follow each tool description.";
