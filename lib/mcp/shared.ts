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
  rt?: RuntimeHandle
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
      ...(rt
        ? { session: rt.token, workbench_url: rt.url }
        : {})
    }
  };
}

export const IKRAN_MCP_INSTRUCTIONS =
  "Ikran local research workbench. open_workbench starts (or reuses) the local HTTP Workbench and returns a localhost URL with a startup-level session token. OPEN-AND-WAIT DEFAULT: when the user asks to open or start Ikran, opening the URL is not the end of the task. After create_or_open_project succeeds, do not end the current turn: immediately call wait_for_agent_command and keep consuming any returned durable command through its semantic claim tool. This active wait is what lets a later designer-owned Workbench Next phase or Complete action continue the same Agent turn; standard MCP cannot restart the turn after it ends. create_or_open_project binds or opens the project/session (initializing `.ikran/`); with no `path`, if a project is already bound it returns that active project (discovered cwd is not a bind target), otherwise it discovers the working folder from IKRAN_CWD env, then MCP Roots, then process.cwd(). list_working_folders shows which folder was discovered. setup_workspace returns the per-project MCP config snippet (cwd + IKRAN_CWD + IKRAN_STATE_DIR) to pin a workspace without Roots — the Agent writes it into .cursor/mcp.json and reloads. create_or_open_project fails closed if an explicit `path` differs from the bound project. The URL is local-only; open it in any browser, ideally this Agent host's embedded browser. All research source-of-truth changes go through Ikran tools.\n\n" +
  "FIGMA CONNECTION + RUNTIME CAPTURE (ADR 0003): Runtime owns the installation-scoped Figma Connection Gate and positional evidence capture. Without an active connection, Workbench paste and Agent seed add fail closed — connect a read-only Personal Access Token in the Workbench first. Active seed MCP tools include get_figma_connection_status, add_seed_reference, refresh_seed_reference, get_seed_reference_context, get_annotation_node_candidates, get_captured_node_correspondence, get_project_readiness, set_design_language_description, and update_seed_reference_note. Agent add_seed_reference and Workbench paste share the same Runtime capture command: success atomically creates Seed Reference + Evidence Surface; same fileKey+nodeId reuses the existing Frame (no auto-refresh). Only explicit refresh_seed_reference appends a new positional-evidence version and advances current while preserving history. Runtime capture is the sole Active product path for Figma screenshots / positional evidence. Project Design Language Description is single and optional for capture; empty yields readiness precondition description_missing for Alignment (Issue 07).\n\n" +
  "HOST FIGMA MCP (implementation context only): After Runtime has captured positional evidence, the Agent may use the host's separate Figma MCP for implementation-level layout, style, component, or variable context when needed. Do NOT use host Figma MCP screenshots or retired Agent evidence tools as the Active ingestion path.\n\n" +
  "ANNOTATIONS: Runtime-owned records via create_annotation (not canvas geometry). Use the explicit figma-surface, figma-node, or figma-region target union; every target anchors a captured Evidence Surface/version.\n\n" +
  "ADAPTIVE COMMAND WAIT: After opening/binding Ikran, call wait_for_agent_command in the same turn. When the designer is still working in the Workbench and no command is pending, it keeps the current turn available in rolling three-minute windows. Real visible/focused designer activity renews the lease; background heartbeat does not. A returned idle/cancelled result never advances workflow. On this or a later turn, always consume a returned pending command through its semantic claim tool rather than inferring work from chat history.\n\n" +
  "DESIGN INTENT ALIGNMENT: After the project-level Design Language Description is non-empty, prepare the six sections in order. Within EACH section, first create at least one gray Agent Annotation that openly states a meaningful confirmed observation or reasonable assumption about the existing design; only then create 2–5 colored Question cards that ask the designer to confirm remaining uncertainty, before moving to the next section. Runtime rejects a Question until its same-section Annotation exists and rejects finalize unless all six sections contain both card kinds. Never reuse one Annotation across sections. Do not hide assumptions inside questions, and do not turn genuine uncertainty into an asserted annotation. Content is not a gate section. Both create_agent_annotation and create_alignment_question_card are attempt-bound and idempotent. The Question card observation field is its short title: write a concise 2–5 word noun phrase (48 characters maximum), never a sentence or a repeat of the question. EVERY Agent Annotation and Question card needs exactly one of three evidence-linked target modes: (1) node/region for one specific element or component, rendered with an Annotation and horizontal connector; prefer the exact positional node when available and use a free region only when no exact node represents the target; (2) focus-target-set for repeated/shared elements such as color or typography across components or Frames, rendered with Focus Mode on card hover or click, without Annotation, connector, or camera movement; (3) single/surface for whole-Frame statements or questions, rendered as only its card beside the Frame, without target chrome or Focus Mode. Never approximate a whole Frame or an available node with a guessed region. Runtime validates and resolves targets to mask-ready normalized rects. read_design_intent_alignment is the semantic read surface for current annotations, questions, answers, sources, coverage, resolved target rects, and the designer's own Designer Annotations (designer_annotations: green, author=designer, bound to one of the six sections). Designer Annotations are part of this Alignment — the designer's confirmed per-section intent input: read them before writing answers or summaries for a section, treat them as designer direction, and never contradict, restate as your own, or count them as Agent cards or coverage. Proposed answers only prefill the editor and never count as answered or as coverage. The designer must explicitly submit every Question card; submitting an unchanged proposal records Agent proposed / designer accepted, while an edited answer records designer edited. Global Complete is available only after every Question card has a final answer and never promotes proposals.";
