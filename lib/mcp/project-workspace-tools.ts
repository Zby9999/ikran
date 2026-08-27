import { statSync } from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  activateExistingProjectCommand,
  bindProjectCommand,
  createOrOpenProjectInputShape,
  getProjectStateCommand,
  projectPathsMatch,
  requireActiveProjectCommand,
  setupWorkspaceInputShape
} from "../runtime/commands";
import {
  type DiscoveredWorkingFolder,
  type RegisterIkranToolsDeps
} from "./shared";
import { getProjectPhase } from "../runtime/project-phase";
import { readAgentCommandWaitEligibility } from "../runtime/adaptive-agent-wait";

const OPEN_PROJECT_ACTION = {
  tool: "create_or_open_project"
} as const;

const WAIT_FOR_COMMAND_DIRECTIVE =
  "Required next Agent actions: do not end the turn. First open the Workbench URL above in this Agent host's embedded browser so the designer can see the canvas. Then, before waiting, post that exact URL as a user-visible chat message telling the designer they can open it manually in any local browser if it did not open automatically. Only after that, call `wait_for_agent_command` and keep the current turn available while the designer works in the Workbench. Do not call `wait_for_agent_command` before the URL is posted in chat — that call blocks and prevents opening the Workbench. Consume any returned command through its semantic claim tool.";

const NO_WAIT_DIRECTIVE =
  "No wait needed: there is no active Alignment handoff or Rule Update Review wait scope. Do NOT call `wait_for_agent_command`; end the turn when your work is done. Any command published after this turn remains durable for the next turn; this does not imply reverse activation.";

function waitArmFields(armWait: boolean): { wait_armed?: true } {
  return armWait ? { wait_armed: true } : {};
}

/**
 * Arm only for a domain-owned designer handoff: Alignment stages including
 * first-open seed-reference-registration with zero seeds, or one explicitly
 * active Rule Update Review. Merely reaching a post-Alignment project phase
 * never creates a wait lease.
 */
function shouldArmWaitForCommand(projectPath: string): boolean {
  const eligibility = readAgentCommandWaitEligibility(projectPath);
  return eligibility.ok && eligibility.eligible;
}

function isHostAuthoritativeWorkspace(
  discovered: DiscoveredWorkingFolder
): discovered is DiscoveredWorkingFolder & { folder: string } {
  return (
    typeof discovered.folder === "string" &&
    (discovered.source === "env" || discovered.source === "roots")
  );
}

function projectSuccessContent(
  text: string,
  { armWait }: { armWait: boolean }
): Array<{
  type: "text";
  text: string;
}> {
  return [
    {
      type: "text",
      text: `${text}\n\n${armWait ? WAIT_FOR_COMMAND_DIRECTIVE : NO_WAIT_DIRECTIVE}`
    }
  ];
}

export function registerProjectWorkspaceTools(
  mcp: McpServer,
  deps: RegisterIkranToolsDeps
): void {
  const { ensureRuntime, discoverWorkingFolder, host, prod, mcpEntryPath } =
    deps;

  const resumeDiscoveredWorkspace = async () => {
    const discovered = await discoverWorkingFolder();
    if (!isHostAuthoritativeWorkspace(discovered)) {
      return { discovered, activation: null };
    }
    const activation = await activateExistingProjectCommand(discovered.folder);
    return { discovered, activation };
  };

  mcp.registerTool(
    "open_workbench",
    {
      description:
        "Start or reuse the local Ikran Runtime HTTP surface and return a localhost Workbench URL. This tool does not open a host browser. After it returns, open that URL in this Agent host's embedded browser (or any local browser), then post that exact URL as a user-visible chat message so the designer can open it manually if it did not open automatically, before calling wait_for_agent_command — wait is a blocking call and cannot open the page. Whether wait is later required is decided per response: the result re-arms wait_for_agent_command for the Alignment designer handoff (including first-open seed-reference-registration with zero seeds) or an explicitly active Rule Update Review wait scope; a post-Alignment phase alone never arms it. When it says no wait is needed, do not call wait_for_agent_command and end the turn. The URL is local-only and is not a public/remote link. Active seed capture is Runtime-owned (ADR 0003): ensure Figma Connection via the Workbench gate, then use add_seed_reference (same command as Workbench paste). Do not orchestrate host Figma screenshots for ingestion."
    },
    async () => {
      const rt = await ensureRuntime();
      // The installed plugin process runs from its cache directory, so the
      // current MCP Roots/IKRAN_CWD — not a persisted global pointer — decide
      // which already-initialized project this host task resumes.
      const binding = await resumeDiscoveredWorkspace();
      const baseText = `Ikran Workbench URL:\n${rt.url}\n\nLocal-only. This tool did not open a browser. Open the URL in this Agent host's embedded browser, then post that exact URL as a user-visible chat message before waiting so the designer can open it manually if it did not open automatically.`;
      const activeProject = requireActiveProjectCommand();
      const armWait =
        activeProject.ok &&
        shouldArmWaitForCommand(activeProject.project.path);
      // Never set next_action to wait_for_agent_command here: that call blocks
      // the turn, so the Agent cannot open the returned URL.
      const nextAction = activeProject.ok ? null : OPEN_PROJECT_ACTION;
      const nextDirective = activeProject.ok
        ? armWait
          ? WAIT_FOR_COMMAND_DIRECTIVE
          : NO_WAIT_DIRECTIVE
        : "Required next Agent actions: do not end the turn yet. Call `create_or_open_project` to bind the current workspace, then follow the wait guidance its response returns.";
      return {
        content: [
          {
            type: "text" as const,
            text: `${baseText}\n\n${nextDirective}`
          }
        ],
        structuredContent: {
          url: rt.url,
          host: rt.host,
          port: rt.port,
          session: rt.token,
          reused: !rt.spawned,
          workspace_folder: binding.discovered.folder,
          workspace_source: binding.discovered.source,
          workspace_binding:
            binding.activation?.ok === true
              ? binding.activation.changed
                ? "resumed"
                : "matched"
              : binding.activation?.reason ?? "not_attempted",
          ...(activeProject.ok
            ? { active_project: activeProject.project.path }
            : {}),
          ...waitArmFields(armWait),
          ...(nextAction ? { next_action: nextAction } : {})
        }
      };
    }
  );

  mcp.registerTool(
    "create_or_open_project",
    {
      description:
        "Bind or open the Ikran project for a local folder and initialize its `.ikran/` state (SQLite, event log, config). With a `path`: CREATE the project there if no project is bound, OPEN it idempotently if that project is already bound, or FAIL CLOSED with `project_mismatch` if the Runtime is bound to a DIFFERENT project (single-project-single-flow — do not silently switch; to change projects, restart Ikran with the new folder as the working folder). With no `path`: if a project is already bound, return that active project + session + workbench_url (discovered cwd is NOT treated as a bind target); otherwise bind/open the working folder discovered from IKRAN_CWD env, then MCP Roots, then process.cwd(); if none is discoverable and no project is bound, returns `no_working_folder` (then pass { path } explicitly — your shell's `pwd` gives the workspace). This tool does not open a host browser. Open the returned Workbench URL in this Agent host's embedded browser before calling wait_for_agent_command — wait is a blocking call and cannot open the page. Whether wait is later required is decided per response: the result re-arms wait_for_agent_command for the Alignment designer handoff (including first-open seed-reference-registration with zero seeds) or an explicitly active Rule Update Review wait scope; a post-Alignment phase alone never arms it. When it says no wait is needed, do not call wait_for_agent_command and end the turn. Always returns the active project, the startup session token, the Workbench URL, and the current project phase so the caller can confirm it is operating on the same project/session as the Workbench HTTP API. All research source-of-truth changes go through Ikran tools.",
      inputSchema: createOrOpenProjectInputShape
    },
    async (args) => {
      try {
        const rt = await ensureRuntime();
        // Explicit user-provided path vs no-arg query. Discovered cwd is only a
        // bind target when there is no active project and no explicit path.
        const explicitPath =
          typeof args.path === "string" && args.path.length > 0
            ? path.resolve(args.path)
            : null;

        const binding = explicitPath
          ? null
          : await resumeDiscoveredWorkspace();
        const state = await getProjectStateCommand();
        const activeProject = state.project;
        const activePath = activeProject ? activeProject.path : null;

        if (
          !explicitPath &&
          binding &&
          isHostAuthoritativeWorkspace(binding.discovered) &&
          binding.activation?.ok === false &&
          binding.activation.reason === "invalid_project_config"
        ) {
          return {
            content: [
              {
                type: "text" as const,
                text: `The current workspace has an invalid Ikran project config: ${binding.discovered.folder}. Refusing to reuse another project's Runtime binding.`
              }
            ],
            structuredContent: {
              ok: false,
              error: "invalid_project_config",
              expected: binding.discovered.folder,
              active: activePath,
              session: rt.token,
              workbench_url: rt.url
            }
          };
        }

        if (
          !explicitPath &&
          activePath &&
          binding &&
          isHostAuthoritativeWorkspace(binding.discovered) &&
          binding.activation?.ok === false
        ) {
          return {
            content: [
              {
                type: "text" as const,
                text: `workspace_project_mismatch: the Agent host workspace is "${binding.discovered.folder}", but it is not an initialized Ikran project and the Runtime is bound to "${activePath}". Refusing to expose the other project.`
              }
            ],
            structuredContent: {
              ok: false,
              error: "workspace_project_mismatch",
              expected: binding.discovered.folder,
              active: activePath,
              session: rt.token,
              workbench_url: rt.url
            }
          };
        }

        // No-arg + active project: return current binding (do not mismatch on cwd).
        if (!explicitPath && activePath) {
          const armWait = shouldArmWaitForCommand(activePath);
          return {
            content: projectSuccessContent(
              `Ikran project: ${activePath}\nSession: ${rt.token}\nWorkbench URL: ${rt.url}`,
              { armWait }
            ),
            structuredContent: {
              ok: true,
              project: activeProject,
              active_project: activePath,
              cwd_candidate: state.cwd_candidate ?? null,
              project_phase: getProjectPhase(activePath),
              session: rt.token,
              workbench_url: rt.url,
              ...waitArmFields(armWait)
            }
          };
        }

        const discovered = explicitPath
          ? null
          : binding?.discovered ?? (await discoverWorkingFolder());
        const requestedPath = explicitPath ?? discovered?.folder ?? null;

        if (!requestedPath) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No working folder known. Pass { path: "<absolute project folder>" } (use your shell: pwd), or have the MCP client expose workspace Roots. Workbench URL: ${rt.url}`
              }
            ],
            structuredContent: {
              ok: false,
              error: "no_working_folder",
              detail:
                "No IKRAN_CWD env, no MCP roots, no process.cwd(), and no active project. Pass { path } explicitly.",
              session: rt.token,
              workbench_url: rt.url
            }
          };
        }

        if (activePath && !projectPathsMatch(activePath, requestedPath)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `project_mismatch: the Runtime is bound to "${activePath}", not "${requestedPath}". Ikran is single-project-single-flow; re-bind to the active project or restart Ikran with the new folder as the working folder.`
              }
            ],
            structuredContent: {
              ok: false,
              error: "project_mismatch",
              expected: requestedPath,
              active: activePath,
              session: rt.token,
              workbench_url: rt.url
            }
          };
        }

        if (activePath && projectPathsMatch(activePath, requestedPath)) {
          const armWait = shouldArmWaitForCommand(activePath);
          return {
            content: projectSuccessContent(
              `Ikran project already open: ${activePath}\nSession: ${rt.token}\nWorkbench URL: ${rt.url}`,
              { armWait }
            ),
            structuredContent: {
              ok: true,
              project: activeProject,
              active_project: activePath,
              project_phase: getProjectPhase(activePath),
              session: rt.token,
              workbench_url: rt.url,
              ...waitArmFields(armWait)
            }
          };
        }

        const bind = await bindProjectCommand(requestedPath);
        if (!bind.ok) {
          if (bind.reason === "project_mismatch") {
            const active =
              bind.active ??
              (await getProjectStateCommand()).project?.path ??
              null;
            return {
              content: [
                {
                  type: "text" as const,
                  text: `project_mismatch: the Runtime is bound to "${active}", not "${requestedPath}". Ikran is single-project-single-flow; re-bind to the active project or restart Ikran with the new folder as the working folder.`
                }
              ],
              structuredContent: {
                ok: false,
                error: "project_mismatch",
                expected: requestedPath,
                active,
                session: rt.token,
                workbench_url: rt.url
              }
            };
          }
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to bind Ikran project "${requestedPath}": ${bind.reason}.`
              }
            ],
            structuredContent: {
              ok: false,
              error: bind.reason,
              detail: bind.reason,
              path: requestedPath,
              session: rt.token,
              workbench_url: rt.url
            }
          };
        }

        // Fail closed if another concurrent bind won the active pointer.
        const after = await getProjectStateCommand();
        const activeAfter = after.project?.path ?? null;
        if (
          !activeAfter ||
          !projectPathsMatch(activeAfter, bind.config.path)
        ) {
          return {
            content: [
              {
                type: "text" as const,
                text: `project_mismatch: the Runtime is bound to "${activeAfter}", not "${requestedPath}". Ikran is single-project-single-flow; re-bind to the active project or restart Ikran with the new folder as the working folder.`
              }
            ],
            structuredContent: {
              ok: false,
              error: "project_mismatch",
              expected: requestedPath,
              active: activeAfter,
              session: rt.token,
              workbench_url: rt.url
            }
          };
        }

        const armWait = shouldArmWaitForCommand(activeAfter);
        return {
          content: projectSuccessContent(
            `Ikran project bound: ${bind.config.path}\nEvents: ${bind.events.project_created}, ${bind.events.folder_selected}\nSession: ${rt.token}\nWorkbench URL: ${rt.url}`,
            { armWait }
          ),
          structuredContent: {
            ok: true,
            project: bind.config,
            events: bind.events,
            active_project: activeAfter,
            project_phase: getProjectPhase(activeAfter),
            session: rt.token,
            workbench_url: rt.url,
            ...waitArmFields(armWait)
          }
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `create_or_open_project failed: ${message}`
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
    "list_working_folders",
    {
      description:
        "Show the working folder the Ikran MCP server has discovered for the Agent host's current workspace, and how it was discovered (IKRAN_CWD env, MCP Roots `roots/list`, process.cwd() / mcp.json cwd, or none). Read-only — does not bind a project. Use this to confirm which folder create_or_open_project / the Workbench will bind before initializing `.ikran/`."
    },
    async () => {
      try {
        const rt = await ensureRuntime();
        const d = await discoverWorkingFolder();
        return {
          content: [
            {
              type: "text" as const,
              text: d.folder
                ? `Working folder: ${d.folder} (source: ${d.source})\nSession: ${rt.token}\nWorkbench URL: ${rt.url}`
                : `No working folder discovered (source: ${d.source}). Expose workspace Roots from the MCP client, set IKRAN_CWD env (or mcp.json cwd), or pass { path } to create_or_open_project.\nWorkbench URL: ${rt.url}`
            }
          ],
          structuredContent: {
            ok: true,
            folder: d.folder,
            source: d.source,
            roots: d.roots,
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
              text: `list_working_folders failed: ${message}`
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
    "setup_workspace",
    {
      description:
        "Pin a workspace as Ikran's working folder WITHOUT relying on MCP Roots or a manual cwd config. Pass { path } = the user's current project folder (use your shell: pwd). Returns the exact MCP config snippet (`mcpServers.ikran` with `cwd` = the folder and `env.IKRAN_CWD` + `env.IKRAN_STATE_DIR` = `<folder>/.ikran`, so each project gets its own state + Runtime and rediscovers without Roots). The tool does NOT write any file — YOU write the snippet into `<path>/.cursor/mcp.json` (merge into `mcpServers`, preserving your other servers; if you invoke ikran differently, keep your command/args and just set `cwd` + `env.IKRAN_CWD` + `env.IKRAN_STATE_DIR`), then reload Cursor's MCP servers. For the current session, also call create_or_open_project({ path }) to bind now. After the reload, future sessions in this workspace auto-discover + auto-bind with per-project isolation.",
      inputSchema: setupWorkspaceInputShape
    },
    async (args) => {
      try {
        const raw = typeof args.path === "string" ? args.path.trim() : "";
        if (!raw) {
          return {
            content: [
              {
                type: "text" as const,
                text: "setup_workspace requires { path } (the user's current project folder; use your shell: pwd)."
              }
            ],
            structuredContent: { ok: false, error: "missing_path" }
          };
        }
        const folder = path.resolve(raw);
        let exists = false;
        try {
          exists = statSync(folder).isDirectory();
        } catch {
          exists = false;
        }
        const entry = {
          command: "node",
          args: [mcpEntryPath, ...(prod ? ["--prod"] : [])],
          cwd: folder,
          env: {
            IKRAN_HOST: host,
            IKRAN_CWD: folder,
            IKRAN_STATE_DIR: path.join(folder, ".ikran")
          }
        };
        const fullConfig = { mcpServers: { ikran: entry } };
        const mcpJsonPath = path.join(folder, ".cursor", "mcp.json");
        const note = prod
          ? "Note: --prod requires `npm run build`; drop --prod for zero-build dev mode."
          : "";
        const instructions = exists
          ? `Merge the \`ikran\` entry into the \`mcpServers\` object in ${mcpJsonPath} (preserve your other MCP servers; if you invoke ikran differently, keep your command/args and just set cwd + env.IKRAN_CWD + env.IKRAN_STATE_DIR), then reload Cursor's MCP servers. For the current session, call create_or_open_project({ path: ${folder} }) to bind now.`
          : `The folder ${folder} does not exist yet. Create it, then merge the \`ikran\` entry into ${mcpJsonPath} and reload Cursor's MCP servers.`;
        return {
          content: [
            {
              type: "text" as const,
              text: `Ikran MCP config for ${folder}:\n\n${JSON.stringify(fullConfig, null, 2)}\n\nWrite this to ${mcpJsonPath} (merge into mcpServers), then reload Cursor's MCP servers.\n${note}`.trim()
            }
          ],
          structuredContent: {
            ok: true,
            path: folder,
            exists,
            mcp_json_path: mcpJsonPath,
            config: fullConfig,
            entry,
            instructions,
            note
          }
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `setup_workspace failed: ${message}`
            }
          ],
          structuredContent: {
            ok: false,
            error: "setup_failed",
            detail: message
          }
        };
      }
    }
  );
}
