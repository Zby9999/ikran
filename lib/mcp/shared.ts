import { listPendingSeedEvidenceCommand } from "../runtime/commands";

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

export function pendingSeedRecords(projectPath: string) {
  return listPendingSeedEvidenceCommand(projectPath).records;
}

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
  "Ikran local research workbench. open_workbench starts (or reuses) the local HTTP Workbench and returns a localhost URL with a startup-level session token. create_or_open_project binds or opens the project/session (initializing `.ikran/`); with no `path`, if a project is already bound it returns that active project (discovered cwd is not a bind target), otherwise it discovers the working folder from IKRAN_CWD env, then MCP Roots, then process.cwd(). list_working_folders shows which folder was discovered. setup_workspace returns the per-project MCP config snippet (cwd + IKRAN_CWD + IKRAN_STATE_DIR) to pin a workspace without Roots — the Agent writes it into .cursor/mcp.json and reloads. create_or_open_project fails closed if an explicit `path` differs from the bound project. The URL is local-only; open it in any browser, ideally this Agent host's embedded browser. All research source-of-truth changes go through Ikran tools.\n\n" +
  "ZERO FIGMA CONTACT: Ikran Runtime and Ikran MCP tools never fetch, oEmbed, probe, or otherwise contact Figma. Seed registration is a local format check only. Evidence (screenshots, view availability) is always Agent-supplied. Use the host's separate Figma MCP for any Figma read.\n\n" +
  "SEED → EVIDENCE ORCHESTRATION (required, AUTO-EXECUTE, Agent-first): Seeds are registered ONLY by the Agent via register_seed_reference — the Workbench has no seed URL/intent write UI. Normal sequence: create_or_open_project → register_seed_reference → host Figma MCP get_screenshot (maxDimension: 4096) → record_evidence_package → THEN provide/open the Workbench URL for the designer. BEFORE register_seed_reference: call list_pending_seed_evidence and/or open_workbench — if the same Figma file+node already has a seed with a screenshot Evidence Surface, DO NOT register again; reuse that seed/surface for annotations. register_seed_reference is idempotent on fileKey+nodeId (ignores share `t=`), but still prefer checking pending/existing first. open_workbench may start the Runtime, but when it reports pending items OR action_required/fulfill_now you MUST fulfill them in the SAME turn before treating the flow as complete — DO NOT ask \"如果需要，我可以继续\" / \"shall I continue?\" / wait for confirmation. Immediately for EACH pending seed: (1) host Figma MCP get_screenshot with maxDimension: 4096 (never default 1024), (2) Ikran record_evidence_package with screenshot + explicit evidenceViews. After open_workbench always read pending_seed_evidence in the tool result (or call list_pending_seed_evidence). The Workbench shows awaiting-evidence loading until a screenshot surface arrives.\n\n" +
  "REGION ANNOTATIONS: Runtime-owned records via create_region_annotation (not canvas geometry). figma-region uses a normalized rect {x,y,w,h} in 0–1 relative to the Evidence Surface screenshot media box; require surfaceArtifactId and/or surfaceNodeId.";
