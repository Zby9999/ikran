import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createRegionAnnotationCommand,
  createRegionAnnotationInputSchema,
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
    "create_region_annotation",
    {
      description:
        "Create a Region Annotation anchored to a Figma Evidence Surface for the active Ikran project. SEMANTIC BOUNDARY: this validates the annotation schema and inserts a Runtime-owned record (source-of-truth). It does NOT access Figma. Pass { author: \"agent\"|\"designer\", surfaceArtifactId and/or surfaceNodeId (at least one), rect?: {x,y,w,h} OR point?: {x,y} normalized 0–1 on the Evidence Surface screenshot media box, body? (defaults to \"Placeholder annotation\"), type?, primaryNodeId?, candidates? }. Agent defaults: type assumption; designer defaults: type explanatory. Runtime stores the Agent-submitted tight/raw normalized rect; Workbench projection applies approximately 1.2% page-isotropic display padding (clamped to the media box). Pass tight node bounds and do not pre-pad. For Agent single-node semantics provide primaryNodeId or high-confidence candidates. Requires an active project — call create_or_open_project first. On validation failure returns a structured error and writes NO annotation row.",
      inputSchema: createRegionAnnotationInputSchema
    },
    async (args) => {
      try {
        const rt = await ensureRuntime();
        const active = requireActiveProjectCommand();
        if (!active.ok) {
          return failureResult("create_region_annotation", active.reason, rt);
        }

        const body =
          typeof args.body === "string" && args.body.trim().length > 0
            ? args.body
            : "Placeholder annotation";

        const result = createRegionAnnotationCommand(active.project.path, {
          ...args,
          body
        });
        if (!result.ok) {
          return failureResult("create_region_annotation", result.reason, rt);
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
              text: `create_region_annotation failed: ${message}`
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
