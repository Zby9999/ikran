import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createRegionAnnotationCommand,
  createRegionAnnotationInputSchema,
  confirmAnnotationPrimaryInputSchema,
  confirmAnnotationPrimaryNodeCommand,
  listRegionAnnotationsCommand,
  requireActiveProjectCommand
} from "../runtime/commands";
import {
  failureResult,
  type RegisterIkranToolsDeps
} from "./shared";

export function registerRegionTools(
  mcp: McpServer,
  deps: RegisterIkranToolsDeps
): void {
  const { ensureRuntime } = deps;

  mcp.registerTool(
    "create_annotation",
    {
      description:
        "Create an Annotation anchored to a captured Figma Evidence Surface/version. Pass an explicit target union: {kind:'figma-surface', evidenceVersionId}, {kind:'figma-node', evidenceVersionId, nodeId}, or {kind:'figma-region', surfaceArtifactId and/or surfaceNodeId, rect or point}. Runtime ranks deterministic candidates for regions but never infers primaryNodeId. Agent defaults to assumption; designer defaults to explanatory. Requires an active project. On validation failure writes no row.",
      inputSchema: createRegionAnnotationInputSchema
    },
    async (args) => {
      try {
        const rt = await ensureRuntime();
        const active = requireActiveProjectCommand();
        if (!active.ok) {
          return failureResult("create_annotation", active.reason, rt);
        }

        const result = createRegionAnnotationCommand(active.project.path, {
          ...args
        });
        if (!result.ok) {
          return failureResult("create_annotation", result.reason, rt);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Region annotation created: ${result.record.id}\nAuthor: ${result.record.author}\nType: ${result.record.type}\nSurface: ${result.record.surface_id || result.record.surface_artifact_id || result.record.surface_node_id || "(unresolved)"}\nEvent: ${result.event_id}\nWorkbench URL: ${rt.url}`
            }
          ],
          structuredContent: {
            ok: true,
            record: result.record,
            event_id: result.event_id,
            session: rt.token,
            workbench_url: rt.url
          }
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `create_annotation failed: ${message}`
            }
          ],
          structuredContent: {
            ok: false,
            error: "runtime_unavailable",
            detail: message
          }
        };
      }
    }
  );

  mcp.registerTool(
    "confirm_annotation_primary_node",
    {
      description:
        "After verifying a Runtime candidate through the host Figma MCP, explicitly confirm the primary source node for an existing annotation. Requires annotationId, its captured evidenceVersionId, and sourceNodeId; the confirmation is stored as a separate linked fact.",
      inputSchema: confirmAnnotationPrimaryInputSchema
    },
    async (args) => {
      try {
        const rt = await ensureRuntime();
        const active = requireActiveProjectCommand();
        if (!active.ok) {
          return failureResult(
            "confirm_annotation_primary_node",
            active.reason,
            rt
          );
        }
        const result = confirmAnnotationPrimaryNodeCommand(
          active.project.path,
          args
        );
        if (!result.ok) {
          return failureResult(
            "confirm_annotation_primary_node",
            result.reason,
            rt
          );
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `Annotation primary node confirmed: ${result.confirmation.source_node_id}\nAnnotation: ${result.confirmation.annotation_id}\nEvidence version: ${result.confirmation.evidence_version_id}\nEvent: ${result.event_id}`
            }
          ],
          structuredContent: {
            ok: true,
            confirmation: result.confirmation,
            event_id: result.event_id,
            session: rt.token,
            workbench_url: rt.url
          }
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `confirm_annotation_primary_node failed: ${message}`
            }
          ],
          structuredContent: {
            ok: false,
            error: "runtime_unavailable",
            detail: message
          }
        };
      }
    }
  );

  mcp.registerTool(
    "list_region_annotations",
    {
      description:
        "List Runtime-owned Region Annotation records for the active Ikran project. No arguments. Requires an active project — call create_or_open_project first. Records are the source of truth; tldraw shapes are projections only."
    },
    async () => {
      try {
        const rt = await ensureRuntime();
        const active = requireActiveProjectCommand();
        if (!active.ok) {
          return failureResult("list_region_annotations", active.reason, rt);
        }
        const records = listRegionAnnotationsCommand(
          active.project.path
        ).records;
        return {
          content: [
            {
              type: "text" as const,
              text: `Region annotations: ${records.length}\nWorkbench URL: ${rt.url}`
            }
          ],
          structuredContent: {
            ok: true,
            records,
            session: rt.token,
            workbench_url: rt.url
          }
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `list_region_annotations failed: ${message}`
            }
          ],
          structuredContent: {
            ok: false,
            error: "runtime_unavailable",
            detail: message
          }
        };
      }
    }
  );
}
