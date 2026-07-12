import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  addSeedReferenceCommand,
  addSeedReferenceInputSchema,
  getFigmaConnectionStatusCommand,
  getProjectReadinessCommand,
  requireActiveProjectCommand,
  setDesignLanguageDescriptionCommand,
  setDesignLanguageDescriptionInputSchema,
  updateSeedReferenceNoteCommand,
  updateSeedReferenceNoteInputSchema
} from "../runtime/commands";
import {
  failureResult,
  type RegisterIkranToolsDeps
} from "./shared";

/**
 * Active seed/evidence MCP tools (ADR 0003).
 * Legacy `register_seed_reference` / `list_pending_seed_evidence` /
 * Agent-supplied `record_evidence_package` are no longer registered.
 */
export function registerSeedEvidenceTools(
  mcp: McpServer,
  deps: RegisterIkranToolsDeps
): void {
  const { ensureRuntime } = deps;

  mcp.registerTool(
    "get_figma_connection_status",
    {
      description:
        "Return the installation-scoped Figma Connection Gate status (connected or not, plus non-sensitive account identity). Never returns the Personal Access Token. Workbench paste and add_seed_reference require connected:true."
    },
    async () => {
      try {
        const rt = await ensureRuntime();
        const status = await getFigmaConnectionStatusCommand();
        return {
          content: [
            {
              type: "text" as const,
              text: status.connected
                ? `Figma Connection active for ${status.account.handle}.`
                : "Figma Connection Gate is closed. Connect a read-only Personal Access Token in the Workbench."
            }
          ],
          structuredContent: {
            ok: true,
            ...status,
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
              text: `get_figma_connection_status failed: ${message}`
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
    "add_seed_reference",
    {
      description:
        "Add a Figma Seed Reference via Runtime-owned positional evidence capture (ADR 0003). Requires an active Figma Connection. Pass { figmaSeedReference, referenceNote? }. Shares the same command as Workbench paste. Atomic: success creates Seed Reference + Evidence Surface + events together; failure leaves no half-written research facts. Same fileKey+nodeId reuses the existing Frame (no auto-refresh).",
      inputSchema: addSeedReferenceInputSchema
    },
    async (args) => {
      try {
        const rt = await ensureRuntime();
        const active = requireActiveProjectCommand();
        if (!active.ok) {
          return failureResult("add_seed_reference", active.reason, rt);
        }

        const result = await addSeedReferenceCommand(active.project.path, {
          figmaSeedReference: args.figmaSeedReference,
          referenceNote: args.referenceNote,
          initiator: "agent"
        });
        if (!result.ok) {
          return failureResult("add_seed_reference", result.reason, rt);
        }

        return {
          content: [
            {
              type: "text" as const,
              text:
                (result.reused
                  ? `Seed Reference reused: ${result.record.figma_seed_reference}\n`
                  : `Seed Reference captured: ${result.record.figma_seed_reference}\n`) +
                `Surface: ${result.surface.id} (${result.surface.frame_name})\n` +
                `Event: ${result.event_id}\nWorkbench URL: ${rt.url}`
            }
          ],
          structuredContent: {
            ok: true,
            record: result.record,
            surface: result.surface,
            event_id: result.event_id,
            reused: Boolean(result.reused),
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
              text: `add_seed_reference failed: ${message}`
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
    "get_project_readiness",
    {
      description:
        "Return project readiness preconditions for formal Design Intent Alignment (Issue 07). Empty Design Language Description yields precondition description_missing. Does not block Seed Reference capture."
    },
    async () => {
      try {
        const rt = await ensureRuntime();
        const active = requireActiveProjectCommand();
        if (!active.ok) {
          return failureResult("get_project_readiness", active.reason, rt);
        }
        const readiness = getProjectReadinessCommand(active.project.path);
        return {
          content: [
            {
              type: "text" as const,
              text:
                readiness.preconditions.length === 0
                  ? "Project readiness: no blocking preconditions."
                  : `Project readiness preconditions: ${readiness.preconditions.join(", ")}`
            }
          ],
          structuredContent: {
            ok: true,
            preconditions: readiness.preconditions,
            designLanguageDescription: readiness.designLanguageDescription,
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
              text: `get_project_readiness failed: ${message}`
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
    "set_design_language_description",
    {
      description:
        "Set the single project-level Design Language Description shared by all Seed References. Pass { designLanguageDescription }. Whitespace-only clears it and restores description_missing. Does not copy onto Seed Reference records.",
      inputSchema: setDesignLanguageDescriptionInputSchema
    },
    async (args) => {
      try {
        const rt = await ensureRuntime();
        const active = requireActiveProjectCommand();
        if (!active.ok) {
          return failureResult(
            "set_design_language_description",
            active.reason,
            rt
          );
        }
        const result = setDesignLanguageDescriptionCommand(
          active.project.path,
          args.designLanguageDescription
        );
        if (!result.ok) {
          return failureResult(
            "set_design_language_description",
            result.reason,
            rt
          );
        }
        const readiness = getProjectReadinessCommand(active.project.path);
        return {
          content: [
            {
              type: "text" as const,
              text:
                result.designLanguageDescription.length > 0
                  ? `Design Language Description saved (${result.designLanguageDescription.length} chars).`
                  : "Design Language Description cleared."
            }
          ],
          structuredContent: {
            ok: true,
            designLanguageDescription: result.designLanguageDescription,
            preconditions: readiness.preconditions,
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
              text: `set_design_language_description failed: ${message}`
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
    "update_seed_reference_note",
    {
      description:
        "Save, modify, or clear the optional Reference Note on one Seed Reference. Pass { id, referenceNote }. Use an empty string to clear. Does not change canonical identity or initiator.",
      inputSchema: updateSeedReferenceNoteInputSchema
    },
    async (args) => {
      try {
        const rt = await ensureRuntime();
        const active = requireActiveProjectCommand();
        if (!active.ok) {
          return failureResult("update_seed_reference_note", active.reason, rt);
        }
        const result = updateSeedReferenceNoteCommand(active.project.path, {
          id: args.id,
          referenceNote: args.referenceNote
        });
        if (!result.ok) {
          return failureResult("update_seed_reference_note", result.reason, rt);
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `Reference Note updated for Seed Reference ${result.record.id}.`
            }
          ],
          structuredContent: {
            ok: true,
            record: result.record,
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
              text: `update_seed_reference_note failed: ${message}`
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
