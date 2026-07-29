// Composition root for Ikran MCP tools. Tool implementations are grouped by
// domain and call the shared command kernel directly (no localhost HTTP).

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerProjectWorkspaceTools } from "./project-workspace-tools";
import { registerRegionTools } from "./region-tools";
import { registerSeedEvidenceTools } from "./seed-evidence-tools";
import { registerDesignIntentAlignmentTools } from "./design-intent-alignment-tools";
import { registerArtifactTools } from "./artifact-tools";
import {
  IKRAN_MCP_INSTRUCTIONS,
  type RegisterIkranToolsDeps
} from "./shared";

export { IKRAN_MCP_INSTRUCTIONS };
export type {
  DiscoveredWorkingFolder,
  RegisterIkranToolsDeps,
  RuntimeHandle
} from "./shared";

export function registerIkranTools(
  mcp: McpServer,
  deps: RegisterIkranToolsDeps
): void {
  registerProjectWorkspaceTools(mcp, deps);
  registerSeedEvidenceTools(mcp, deps);
  registerRegionTools(mcp, deps);
  registerDesignIntentAlignmentTools(mcp, deps);
  registerArtifactTools(mcp, deps);
}
