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
  "FIGMA CONNECTION + RUNTIME CAPTURE (ADR 0003): Runtime owns the installation-scoped Figma Connection Gate and positional evidence capture. Without an active connection, Workbench paste and Agent seed add fail closed — connect a read-only Personal Access Token in the Workbench first. Active seed MCP tools are only get_figma_connection_status and add_seed_reference. Agent add_seed_reference and Workbench paste share the same Runtime capture command: success atomically creates Seed Reference + Evidence Surface; same fileKey+nodeId reuses the existing Frame (no auto-refresh). Runtime capture is the sole Active product path for Figma screenshots / positional evidence.\n\n" +
  "HOST FIGMA MCP (implementation context only): After Runtime has captured positional evidence, the Agent may use the host's separate Figma MCP for implementation-level layout, style, component, or variable context when needed. Do NOT use host Figma MCP screenshots or retired Agent evidence tools as the Active ingestion path.\n\n" +
  "REGION ANNOTATIONS: Runtime-owned records via create_region_annotation (not canvas geometry). figma-region uses a normalized rect {x,y,w,h} in 0–1 relative to the Evidence Surface screenshot media box; require surfaceArtifactId and/or surfaceNodeId.";
