import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  addSeedReferenceCommand,
  addSeedReferenceInputSchema,
  getFigmaConnectionStatusCommand,
  listPendingSeedEvidenceCommand,
  recordEvidencePackageCommand,
  recordEvidencePackageInputSchema,
  registerSeedReferenceCommand,
  registerSeedReferenceInputSchema,
  requireActiveProjectCommand
} from "../runtime/commands";
import { pendingFulfillmentDirective } from "./pending-directive";
import {
  failureResult,
  pendingSeedRecords,
  type RegisterIkranToolsDeps
} from "./shared";

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
    "register_seed_reference",
    {
      description:
        "Register a Figma seed reference and the designer's original design intent for the active Ikran project. This is the ONLY product write entry for seeds (Workbench has no seed URL/intent UI). SEMANTIC BOUNDARY: this records the seed URL + design intent as Runtime-owned research source-of-truth. It does NOT access Figma, does NOT fetch / oEmbed / probe the link, and does NOT verify the file exists online — it only performs a LOCAL format check (https URL, figma.com / www.figma.com host, /design/<key> or /file/<key> path) and stores the ORIGINAL URL verbatim (never rewritten). IDEMPOTENT: same Figma fileKey + node-id (ignoring share `t=` and other query noise) returns the existing seed with reused:true — does not insert a duplicate. Prefer list_pending_seed_evidence / open_workbench first; if a screenshot Evidence Surface already exists for that seed, skip register and reuse it. Requires an active project — call create_or_open_project first. Pass { figmaSeedReference, originalDesignIntent }. On validation failure returns a structured error and writes NO record/event (no half-written state). SUCCESS IS NOT THE END when the seed is NEW or still pending screenshot: use the host Figma MCP get_screenshot with maxDimension: 4096 (do not use the default 1024), then call record_evidence_package with the screenshot and explicit evidenceViews — then provide/open the Workbench URL. The Workbench shows loading until that Evidence Surface with screenshot arrives. All research source-of-truth changes go through Ikran tools.",
      inputSchema: registerSeedReferenceInputSchema
    },
    async (args) => {
      try {
        const rt = await ensureRuntime();
        const active = requireActiveProjectCommand();
        if (!active.ok) {
          return failureResult("register_seed_reference", active.reason, rt);
        }

        // registeredVia is intentionally absent from the Agent schema and is
        // fixed at the semantic boundary.
        const result = registerSeedReferenceCommand(active.project.path, {
          figmaSeedReference: args.figmaSeedReference,
          originalDesignIntent: args.originalDesignIntent,
          registeredVia: "agent"
        });
        if (!result.ok) {
          return failureResult("register_seed_reference", result.reason, rt);
        }

        const reused = Boolean(result.reused);
        let pendingSeed: ReturnType<typeof pendingSeedRecords> = [];
        let directive = "";
        if (!reused) {
          pendingSeed = [
            {
              id: result.record.id,
              figma_seed_reference: result.record.figma_seed_reference,
              original_design_intent: result.record.original_design_intent,
              created_at: result.record.created_at
            }
          ];
          directive = pendingFulfillmentDirective(pendingSeed);
        } else {
          pendingSeed = pendingSeedRecords(active.project.path);
          directive =
            pendingSeed.length > 0
              ? pendingFulfillmentDirective(pendingSeed)
              : "Seed already registered for this Figma file+node (reused). No new row inserted. If a screenshot Evidence Surface already exists, proceed to annotations; otherwise fulfill pending evidence.";
        }

        return {
          content: [
            {
              type: "text" as const,
              text:
                (reused
                  ? `Seed reference reused (same fileKey+nodeId): ${result.record.figma_seed_reference}\n`
                  : `Seed reference registered: ${result.record.figma_seed_reference}\n`) +
                `Design intent: ${result.record.original_design_intent}\n` +
                (reused
                  ? `Record id: ${result.record.id} (reused:true)\n`
                  : `Event: ${result.event_id}\n`) +
                `Workbench URL: ${rt.url}\n\n` +
                directive
            }
          ],
          structuredContent: {
            ok: true,
            record: result.record,
            event_id: result.event_id,
            ...(reused ? { reused: true } : {}),
            session: rt.token,
            workbench_url: rt.url,
            pending_seed_evidence: pendingSeed,
            ...(reused && pendingSeed.length === 0
              ? {}
              : {
                  action_required: "fulfill_pending_seed_evidence",
                  fulfill_now: true
                })
          }
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `register_seed_reference failed: ${message}`
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
    "list_pending_seed_evidence",
    {
      description:
        "List active-project seed references that still need an Agent-declared Evidence Surface screenshot. Seeds are Agent-registered (register_seed_reference); Workbench has no seed write UI. Legacy pending rows may still appear until fulfilled. No arguments. Requires an active project — call create_or_open_project first. When this returns records (or fulfill_now), IMMEDIATELY fulfill each with Figma get_screenshot maxDimension 4096 then record_evidence_package — DO NOT ask the user whether to continue. Ikran never contacts Figma."
    },
    async () => {
      try {
        const rt = await ensureRuntime();
        const active = requireActiveProjectCommand();
        if (!active.ok) {
          return failureResult("list_pending_seed_evidence", active.reason, rt);
        }
        const records = listPendingSeedEvidenceCommand(
          active.project.path
        ).records;
        const directive = pendingFulfillmentDirective(records);
        const text =
          records.length === 0 ? "No pending seed evidence." : directive;
        return {
          content: [{ type: "text" as const, text }],
          structuredContent: {
            ok: true,
            records,
            session: rt.token,
            workbench_url: rt.url,
            ...(records.length > 0
              ? {
                  action_required: "fulfill_pending_seed_evidence",
                  fulfill_now: true
                }
              : {})
          }
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `list_pending_seed_evidence failed: ${message}`
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
    "record_evidence_package",
    {
      description:
        "Record a minimal Figma evidence package for the active Ikran project and create a Figma Evidence Surface. SEMANTIC BOUNDARY: this validates the package schema and inserts a Runtime-owned surface record (source-of-truth). It does NOT access Figma, does NOT fetch / oEmbed / probe the link — evidence views and screenshots are Agent-supplied. SCREENSHOT QUALITY: for this product, screenshots MUST be captured via the host Figma MCP get_screenshot with maxDimension: 4096 (never rely on the Figma MCP default 1024); prefer calling this tool only after that capture. Pass { figmaSeedReference and/or seedReferenceId, frame: { nodeId, name, bounds? }, evidenceViews: { rawData, screenshot } each \"available\"|\"missing\", screenshot?: { artifactPath?, dataUrl? }, designSignals?, surfaceBounds? }. Requires an active project — call create_or_open_project first. On validation failure returns a structured error and writes NO surface row (no half-written state). The Workbench shows loading until a surface with screenshot arrives. All research source-of-truth changes go through Ikran tools.",
      inputSchema: recordEvidencePackageInputSchema
    },
    async (args) => {
      try {
        const rt = await ensureRuntime();
        const active = requireActiveProjectCommand();
        if (!active.ok) {
          return failureResult("record_evidence_package", active.reason, rt);
        }

        const result = recordEvidencePackageCommand(active.project.path, args);
        if (!result.ok) {
          return failureResult("record_evidence_package", result.reason, rt);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Evidence package recorded: surface ${result.record.id}\nFrame: ${result.record.frame_name} (${result.record.frame_node_id})\nSeed: ${result.record.figma_seed_reference}\nEvent: ${result.event_id}\nWorkbench URL: ${rt.url}`
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
              text: `record_evidence_package failed: ${message}`
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
