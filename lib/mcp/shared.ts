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

export const IKRAN_MCP_INSTRUCTIONS =
  "Ikran local research workbench. open_workbench starts (or reuses) the local HTTP Workbench and returns a localhost URL with a startup-level session token. OPEN-AND-WAIT DEFAULT: when the user asks to open or start Ikran, opening the URL is not the end of the task. After create_or_open_project succeeds, do not end the current turn: immediately call wait_for_agent_command and keep consuming any returned durable command through its semantic claim tool. This active wait is what lets a later designer-owned Workbench Next phase or Complete action continue the same Agent turn; standard MCP cannot restart the turn after it ends. create_or_open_project binds or opens the project/session (initializing `.ikran/`); with no `path`, if a project is already bound it returns that active project (discovered cwd is not a bind target), otherwise it discovers the working folder from IKRAN_CWD env, then MCP Roots, then process.cwd(). list_working_folders shows which folder was discovered. setup_workspace returns the per-project MCP config snippet (cwd + IKRAN_CWD + IKRAN_STATE_DIR) to pin a workspace without Roots — the Agent writes it into .cursor/mcp.json and reloads. create_or_open_project fails closed if an explicit `path` differs from the bound project. The URL is local-only; open it in any browser, ideally this Agent host's embedded browser. All research source-of-truth changes go through Ikran tools.\n\n" +
  "FIGMA CONNECTION + RUNTIME CAPTURE (ADR 0003): Runtime owns the installation-scoped Figma Connection Gate and positional evidence capture. Without an active connection, Workbench paste and Agent seed add fail closed — connect a read-only Personal Access Token in the Workbench first. Active seed MCP tools include get_figma_connection_status, add_seed_reference, refresh_seed_reference, get_seed_reference_context, get_annotation_node_candidates, get_captured_node_correspondence, get_project_readiness, set_design_language_description, and update_seed_reference_note. Agent add_seed_reference and Workbench paste share the same Runtime capture command: success atomically creates Seed Reference + Evidence Surface; same fileKey+nodeId reuses the existing Frame (no auto-refresh). Only explicit refresh_seed_reference appends a new positional-evidence version and advances current while preserving history. Runtime capture is the sole Active product path for Figma screenshots / positional evidence. Project Design Language Description is single and optional for capture; empty yields readiness precondition description_missing for Alignment (Issue 07).\n\n" +
  "HOST FIGMA MCP (implementation context only): After Runtime has captured positional evidence, the Agent may use the host's separate Figma MCP for implementation-level layout, style, component, or variable context when needed. Do NOT use host Figma MCP screenshots or retired Agent evidence tools as the Active ingestion path.\n\n" +
  "ANNOTATIONS: Runtime-owned records via create_annotation (not canvas geometry). Use the explicit figma-surface, figma-node, or figma-region target union; every target anchors a captured Evidence Surface/version.\n\n" +
  "ADAPTIVE COMMAND WAIT: After opening/binding Ikran, call wait_for_agent_command in the same turn. When the designer is still working in the Workbench and no command is pending, it keeps the current turn available in rolling three-minute windows. Real visible/focused designer activity renews the lease; background heartbeat does not. A returned idle/cancelled result never advances workflow. On this or a later turn, always consume a returned pending command through its semantic claim tool rather than inferring work from chat history.\n\n" +
  "DESIGN INTENT ALIGNMENT: After the project-level Design Language Description is non-empty, prepare the six sections in order. Within EACH section, first create at least one gray Agent Annotation that openly states a meaningful confirmed observation or reasonable assumption about the existing design; only then create 2–5 colored Question cards that ask the designer to confirm remaining uncertainty, before moving to the next section. Runtime rejects a Question until its same-section Annotation exists and rejects finalize unless all six sections contain both card kinds. Never reuse one Annotation across sections. Do not hide assumptions inside questions, and do not turn genuine uncertainty into an asserted annotation. Content is not a gate section. Both create_agent_annotation and create_alignment_question_card are attempt-bound and idempotent. The Question card observation field is its short title: write a concise 2–5 word noun phrase (48 characters maximum), never a sentence or a repeat of the question. EVERY Agent Annotation and Question card needs exactly one of three evidence-linked target modes: (1) node/region for one specific element or component, rendered with an Annotation and horizontal connector; prefer the exact positional node when available and use a free region only when no exact node represents the target; (2) focus-target-set for repeated/shared elements such as color or typography across components or Frames, rendered with Focus Mode on card hover or click, without Annotation, connector, or camera movement; (3) single/surface for whole-Frame statements or questions, rendered as only its card beside the Frame, without target chrome or Focus Mode. Never approximate a whole Frame or an available node with a guessed region. Runtime validates and resolves targets to mask-ready normalized rects. read_design_intent_alignment is the semantic read surface for current annotations, questions, answers, sources, coverage, resolved target rects, and the designer's own Designer Annotations (designer_annotations: green, author=designer, bound to one of the six sections). Designer Annotations are part of this Alignment — the designer's confirmed per-section intent input: read them before writing answers or summaries for a section, treat them as designer direction, and never contradict, restate as your own, or count them as Agent cards or coverage. Proposed answers only prefill the editor and never count as answered or as coverage. The designer must explicitly submit every Question card; submitting an unchanged proposal records Agent proposed / designer accepted, while an edited answer records designer edited. Global Complete is available only after every Question card has a final answer and never promotes proposals." +
  "\n\nINITIAL DESIGN SYSTEM PREPARATION: Consume a returned prepare_initial_design_system command only through claim_initial_design_system_preparation. Decompose the immutable Alignment inputs into atomic claims, record every answered Question card, Agent Annotation, and Designer Annotation in record_design_system_extraction_manifest, then write and immediately declare the all-JSON design-system source set. Confirmed input must map to a stable entry target or carry an explicit conflict/omitted/gap outcome; never silently drop typography, color, spacing, layout, component, or interaction facts, never manufacture irrelevant generic gaps, and never use one designer-edited card to formalize unrelated claims. Every new token entry must declare one of the returned source_contract token_domains; typography values should retain family, size, weight, line-height, letter-spacing, and transform facts instead of collapsing them into meaning. Every new component spec must include all returned component_spec_fields (empty arrays are allowed only when genuinely not applicable and the manifest explains that exact /value/<field> target) so anatomy, variants, sizes, component-bound states and motion, token links, usage/content rules, responsive behavior, code links, verification targets, and open gaps survive ingest. SPLIT INTERACTION ENTRIES AT EXTRACTION TIME: interaction-rules.json contains only cross-component interaction or motion strategies; any applies-to/state behavior/motion tied to a component belongs in that component spec's states/stateMatrix and motion fields. Never defer this classification to Browser projection. Use the returned principle_value_fields, layout_rule_value_fields, and interaction_rule_value_fields to retain description/behavior/accessibility and responsive relationships/token links/checks whenever supported by the evidence. RICH-FIELD WRITING STYLE: apply source_contract.rich_field_writing_style to layout relationship/responsiveBehavior/acceptanceChecks, interaction description/behavior/accessibility, and component anatomy/variants/sizes/states/motion/usageRules/contentRules/responsiveBehavior/verificationTargets/openGaps. Each array item is one short constraint sentence: one sentence, one rule; never multi-sentence prose. Put spatial and numeric facts in structured values, such as a dedicated key or the compact value '96 → 56px', instead of burying them in prose. Put interpretation, rationale, and design intent in meaning, using one sentence only. Use the language of the designer's source text; if the designer writes Chinese, write the extracted rules in Chinese. Do not restate existing rules, add padding, or generalize beyond the evidence; unsupported ideas belong in open questions, not source rules. Layout good: value { gap: '20px', imageSize: '461.25 × 446px', responsiveBehavior: ['窄屏支持触控横向滚动。'], acceptanceChecks: ['右侧裁切提示仍可见。'] }, meaning: '横向画廊用于连续浏览项目。' Layout bad: relationship: ['Project images form a horizontal track with 461.25 × 446px images and 20px gaps. The clipped edge creates a dynamic sense of discovery and should inspire future galleries.'] Interaction good: value { statement: '动效保持克制。', description: '高频工具中的动效只用于解释状态变化。', behavior: ['使用短促反馈确认系统已响应。', '避免循环或装饰性动效。'], accessibility: ['减少动态效果时保留等价的状态信息。'] }, meaning: '动效服务理解，不争夺注意力。' Interaction bad: value { appliesTo: ['Text Link'], stateBehavior: [{ state: 'hover', behavior: '箭头右移 4px。' }], motion: ['160ms ease-out'] } because component-bound specifications belong in the Text Link component spec. Component good: value { anatomy: ['CTA 由文字标签和右箭头组成。'], states: ['hover：箭头右移 4px。'], motion: ['transform 160ms ease-out。'], contentRules: ['标签使用动词短语。'] }, meaning: '文字链接保持行动入口轻量。' Component bad: usageRules: ['Use this sophisticated CTA throughout the product wherever a strong action is needed. It should feel bold, polished, and memorable.'] Finish only through finalize_initial_design_system_preparation and repair the typed coverage failure when it identifies a missing artifact, target, entry, component spec, token domain, or audit issue." +
  "\n\nSOURCE ARTIFACT DECLARATION (Issue 08): After writing any source artifact (a design-system JSON source under design-system/, or prototype/code) with the host's native file editing, the Agent MUST immediately declare it via record_artifact_written with its path, artifact type, semantic purpose, and related record ids. Runtime only acknowledges declared + validated artifacts: they enter the event log and the artifact index, and undeclared files are excluded from later research export. Validation is deterministic — project path scope, file existence, and shallow structure only. Runtime never fabricates semantics and requests at most one repair for a failed declaration.";
