#!/usr/bin/env node
// ikran-mcp — the minimal MCP stdio server an Agent host (Cursor / Codex)
// spawns to "open Ikran".
//
// Issue 02/01: `open_workbench` — starts (or reuses) the local Ikran Runtime
// HTTP surface on 127.0.0.1 (auto port) and returns a localhost Workbench URL
// containing a startup-level session token:
//
//   http://127.0.0.1:{port}/?session={token}
//
// The URL is local-only and is NOT a public/remote link. Open it in any browser;
// the ideal target is this Agent host's embedded browser.
//
// Issue 02/02: `create_or_open_project` — binds or opens the current
// project/session and initializes `.ikran/` (SQLite, event log, config). It is
// a thin policy layer that PROXIES to the existing Workbench HTTP API
// (`/api/project`, `/api/project/bind`) so the MCP tool and the HTTP API
// operate on the SAME project (one Runtime-owned active-project binding). It
// FAILS CLOSED with `project_mismatch` when the Runtime is already bound to a
// different project than the one requested (single-project-single-flow; the
// HTTP `/api/project/bind` still switches programmatically, but the Workbench
// UI no longer exposes a folder picker). The working folder is discovered via
// MCP Roots (`mcp.server.listRoots()` — the client exposes its workspace) with
// an explicit IKRAN_CWD env override — NOT process.cwd() (Cursor sets that to a
// user folder). `list_working_folders` surfaces the discovery. `setup_workspace`
// returns the per-project MCP config snippet (cwd + IKRAN_STATE_DIR) for the
// Agent to write into .cursor/mcp.json — a universal, non-Roots bootstrap. The
// rest of the semantic MCP tool boundary (register_seed_reference, record_evidence_package,
// …) is Issue 02/03 — do NOT add it here.
//
// CRITICAL — stdout discipline: MCP stdio uses stdout as the JSON-RPC channel.
// This server MUST NEVER write to stdout except via the transport. All logging
// goes to stderr (console.error). The spawned Next child uses piped stdio
// (handled inside openWorkbench) so Next's stdout never reaches this process's
// stdout; we additionally drain the child's stdout (drop) here.
//
// Architecture: two-process coordinator + env-token bridge (ADR 0001). This MCP
// server is the coordinator: it generates the startup token, spawns the Next
// HTTP surface as a child with IKRAN_SESSION_TOKEN in env, waits for readiness,
// writes a user-only runtime-endpoint.json (for reuse), and returns the
// Workbench URL. One-process consolidation (MCP tool handlers sharing
// in-memory record state with the HTTP API in a single custom Next server) is
// deliberate follow-up work for Issue 02/03.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync, statSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  openWorkbench,
  readRuntimeEndpoint,
  removeRuntimeEndpoint
} from "../lib/runtime/runtime-endpoint.mjs";
import { z } from "zod";

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(name);
const option = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
};

const LOCALHOST_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const prod = hasFlag("--prod");
const host = option("--host", process.env.IKRAN_HOST || "127.0.0.1");

if (!LOCALHOST_HOSTS.has(host)) {
  console.error(
    `[ikran-mcp] Refusing to bind to "${host}". Ikran only supports localhost (127.0.0.1 / localhost / ::1).`
  );
  process.exit(1);
}

// appDir = package root (contains `app/` and `package.json`), resolved relative
// to this file so the MCP server works regardless of the host's cwd.
const launcherDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(launcherDir, "..");
if (!existsSync(path.join(appDir, "app"))) {
  console.error(
    `[ikran-mcp] Could not locate the Ikran app directory at ${appDir}. The package layout may be broken.`
  );
  process.exit(1);
}

// Reuse state dir + Next dist dir (env-driven; the e2e sets these for --prod
// against the shared build). Default to the user's Ikran state dir (~/.ikran).
const stateDir =
  process.env.IKRAN_STATE_DIR || path.join(homedir(), ".ikran");
const nextDistDir = process.env.IKRAN_NEXT_DIST_DIR || undefined;

// ---- Lifecycle / cleanup --------------------------------------------------
// Only tear down a Runtime THIS server spawned. If openWorkbench reused an
// already-running Runtime (spawned:false), we do NOT own it: leave it (and its
// endpoint file) alone on exit.
let lastResult = null;
let spawnedChild = null;
let cleaning = false;

function cleanup() {
  if (cleaning) return;
  cleaning = true;
  if (lastResult && lastResult.spawned && spawnedChild && spawnedChild.pid) {
    try {
      process.kill(-spawnedChild.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
    // Only remove the reuse file if it still points at THIS child's pid, so we
    // don't clobber a concurrently-started Runtime (best-effort).
    try {
      const ep = readRuntimeEndpoint(stateDir);
      if (ep && ep.pid === lastResult.pid) {
        removeRuntimeEndpoint(stateDir);
      }
    } catch {
      /* ignore */
    }
  }
}

function shutdown(code) {
  cleanup();
  process.exit(code);
}

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));
process.on("exit", cleanup);
// When the Agent host closes the MCP stdio transport (client disconnect), our
// stdin ends. Treat that as a shutdown so we don't leak the spawned Runtime.
process.stdin.on("end", () => shutdown(0));
process.stdin.on("close", () => shutdown(0));

// ---- Shared helpers -------------------------------------------------------
// ensureRuntime: reuse-or-spawn the local HTTP surface and return the
// coordinator's view of it. Every tool calls this first so they share ONE
// Runtime + ONE startup token. Updates the module-level lifecycle handles when
// it spawns, so cleanup stays correct across multiple tool calls.
async function ensureRuntime() {
  // Forward the Agent host's working folder to the Runtime as IKRAN_CWD so the
  // Workbench can bind/open THAT folder instead of asking the designer to pick
  // one (Issue 02/02). The folder is discovered via discoverWorkingFolder()
  // (explicit IKRAN_CWD env, then MCP Roots) — NOT process.cwd(), which Cursor
  // sets to a user folder. If nothing is discovered, no IKRAN_CWD is forwarded
  // and the Workbench shows a "no working folder" state until the Agent binds.
  const discovered = await discoverWorkingFolder();
  const ikranCwd = discovered.folder;
  const r = await openWorkbench({
    stateDir,
    host,
    prod,
    cwd: appDir,
    nextDistDir,
    extraEnv: ikranCwd ? { IKRAN_CWD: ikranCwd } : {},
    timeoutMs: 60_000
  });
  lastResult = r;
  if (r.spawned && r.child) {
    spawnedChild = r.child;
    // Drain the Next child's stdout (drop) so it NEVER reaches this process's
    // stdout (stdout is the MCP JSON-RPC channel). Forward the child's stderr to
    // our stderr for debuggability (stderr is NOT the MCP channel). Draining
    // also prevents the child from blocking on a full pipe buffer during long
    // sessions.
    r.child.stdout?.on("data", () => {});
    r.child.stderr?.on("data", (d) => process.stderr.write(d));
  }
  return { host: r.host, port: r.port, token: r.token, url: r.url, spawned: r.spawned };
}

// Same-origin HTTP API helpers. The MCP tool PROXIES to the Workbench HTTP API:
// the MCP server and the Next HTTP surface are separate processes (two-process
// coordinator, ADR 0001) that share ONE active-project pointer (via
// IKRAN_STATE_DIR) and ONE startup token (env bridge). Server-side fetch sends
// no `Origin` header, so authorize()'s same-origin check is skipped; the
// localhost-Host + valid-session checks pass with the headers below. The token
// is the same one the Runtime was spawned with, so authorize() accepts it.
// One-process consolidation (MCP handlers sharing in-memory record state with
// the HTTP API) is deliberate follow-up work for Issue 02/03.
async function apiGet(port, token, route) {
  const res = await fetch(`http://${host}:${port}${route}`, {
    headers: { host: `${host}:${port}`, "x-ikran-session": token }
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, body };
}

async function apiPost(port, token, route, payload) {
  const res = await fetch(`http://${host}:${port}${route}`, {
    method: "POST",
    headers: {
      host: `${host}:${port}`,
      "x-ikran-session": token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, body };
}

// Canonical-path compare (mirror lib/runtime/project.ts projectPathsMatch).
function canonicalPath(p) {
  try { return realpathSync(p); } catch { return path.resolve(p); }
}

function samePath(a, b) {
  return canonicalPath(a) === canonicalPath(b);
}

// discoverWorkingFolder — resolve the Agent host's working folder (the project
// the user opened in Cursor/Codex) WITHOUT relying on process.cwd(), which
// Cursor sets to a user folder, not the workspace (Issue 02/02). Resolution
// order (explicit wins, then the MCP standard, then none):
//   1. process.env.IKRAN_CWD — an explicit override (set in mcp.json env).
//   2. MCP Roots: mcp.server.listRoots() asks the client for its workspace
//      folders; the first file:// root is converted to a path. This is the
//      protocol-blessed way for a server to discover the client's workspace.
//      The call rejects if the client didn't declare the `roots` capability.
//   3. null — no working folder discoverable; the Agent should pass { path }
//      (its shell runs in the project, so `pwd` gives the workspace).
// The result is cached for the life of this process. `mcp` is the module-level
// McpServer defined below; it is initialized before any tool handler calls this.
let discoveredWorkingFolder = null;
async function discoverWorkingFolder() {
  if (discoveredWorkingFolder) return discoveredWorkingFolder;
  const envCwd = process.env.IKRAN_CWD;
  if (typeof envCwd === "string" && envCwd.length > 0) {
    discoveredWorkingFolder = { folder: path.resolve(envCwd), source: "env", roots: [] };
    return discoveredWorkingFolder;
  }
  let roots = [];
  try {
    const res = await mcp.server.listRoots();
    roots = Array.isArray(res && res.roots) ? res.roots : [];
  } catch {
    // Client didn't declare `roots`, or rejected — no roots available.
    roots = [];
  }
  for (const r of roots) {
    if (r && typeof r.uri === "string" && r.uri.startsWith("file://")) {
      try {
        const p = fileURLToPath(r.uri);
        if (p) {
          discoveredWorkingFolder = { folder: path.resolve(p), source: "roots", roots };
          return discoveredWorkingFolder;
        }
      } catch {
        /* malformed file URI — skip */
      }
    }
  }
  discoveredWorkingFolder = { folder: null, source: "none", roots };
  return discoveredWorkingFolder;
}

// ---- MCP server -----------------------------------------------------------
const mcp = new McpServer(
  { name: "ikran", version: "0.1.0" },
  {
    instructions:
      "Ikran local research workbench. open_workbench starts (or reuses) the local HTTP Workbench and returns a localhost URL with a startup-level session token. create_or_open_project binds or opens the project/session (initializing `.ikran/`); with no `path` it discovers the working folder from the MCP client's workspace Roots (or IKRAN_CWD env). list_working_folders shows which folder was discovered. setup_workspace returns the per-project MCP config snippet (cwd + IKRAN_STATE_DIR) to pin a workspace without Roots — the Agent writes it into .cursor/mcp.json and reloads. register_seed_reference records a Figma seed URL + the designer's original design intent as Runtime-owned research source-of-truth (it does NOT access Figma — local format check only). create_or_open_project fails closed if the Runtime is bound to a different project. The URL is local-only; open it in any browser, ideally this Agent host's embedded browser. All research source-of-truth changes go through Ikran tools."
  }
);

// registerTool(name, { description, inputSchema? }, cb). With no inputSchema it
// registers a zero-argument tool; with a Zod raw shape (e.g.
// { path: z.string().optional() }) it registers a tool whose callback receives
// parsed args. Each callback returns { content, structuredContent }.
mcp.registerTool(
  "open_workbench",
  {
    description:
      "Open the Ikran workbench. Starts or reuses the local Runtime HTTP surface on 127.0.0.1 (auto port) and returns a localhost Workbench URL containing a startup-level session token. Open it in any browser; ideal target is this Agent host's embedded browser. The URL is local-only and is not a public/remote link."
  },
  async () => {
    const rt = await ensureRuntime();
    return {
      content: [
        {
          type: "text",
          text: `Ikran Workbench URL:\n${rt.url}\n\nLocal-only. Open in any browser (ideal: this Agent host's embedded browser).`
        }
      ],
      structuredContent: {
        url: rt.url,
        host: rt.host,
        port: rt.port,
        session: rt.token,
        reused: !rt.spawned
      }
    };
  }
);

// create_or_open_project — the Agent's project-binding tool (Issue 02/02). It
// shares ONE project/session with the Workbench HTTP API by proxying to it, and
// fails closed when the Runtime is already bound to a different project.
mcp.registerTool(
  "create_or_open_project",
  {
    description:
      "Bind or open the Ikran project for a local folder and initialize its `.ikran/` state (SQLite, event log, config). With a `path`: CREATE the project there if no project is bound, OPEN it idempotently if that project is already bound, or FAIL CLOSED with `project_mismatch` if the Runtime is bound to a DIFFERENT project (single-project-single-flow — do not silently switch; to change projects, restart Ikran with the new folder as the working folder). With no `path`: bind/open the working folder discovered from the MCP client's workspace Roots (or IKRAN_CWD env); if none is discoverable and no project is bound, returns `no_working_folder` (then pass { path } explicitly — your shell's `pwd` gives the workspace). Always returns the active project, the startup session token, and the Workbench URL so the caller can confirm it is operating on the same project/session as the Workbench HTTP API. All research source-of-truth changes go through Ikran tools.",
    inputSchema: { path: z.string().optional() }
  },
  async (args) => {
    try {
      const rt = await ensureRuntime();
      // The folder to bind: an explicit `path` arg wins; otherwise discover the
      // Agent host's working folder (MCP Roots / explicit IKRAN_CWD env).
      const discovered = await discoverWorkingFolder();
      const requestedPath =
        typeof args.path === "string" && args.path.length > 0
          ? path.resolve(args.path)
          : discovered.folder;

      // Read the Runtime's current active project (the shared binding).
      const state = await apiGet(rt.port, rt.token, "/api/project");
      if (state.status !== 200 || !state.body || !state.body.ok) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to read Ikran project state (HTTP ${state.status}). Is the Runtime healthy?`
            }
          ],
          structuredContent: {
            ok: false,
            error: "runtime_unavailable",
            detail: `project state HTTP ${state.status}`,
            session: rt.token,
            workbench_url: rt.url
          }
        };
      }

      const activeProject = state.body.project || null;
      const activePath = activeProject ? activeProject.path : null;

      // No folder to bind (no `path` and discovery found nothing).
      if (!requestedPath) {
        if (activePath) {
          // Read-only open of the currently bound project/session.
          return {
            content: [
              {
                type: "text",
                text: `Ikran project: ${activePath}\nSession: ${rt.token}\nWorkbench URL: ${rt.url}`
              }
            ],
            structuredContent: {
              ok: true,
              project: activeProject,
              active_project: activePath,
              connected_agent: state.body.connected_agent ?? null,
              cwd_candidate: state.body.cwd_candidate ?? null,
              session: rt.token,
              workbench_url: rt.url
            }
          };
        }
        // No active project AND no discoverable working folder — guide the
        // Agent to pass the workspace path explicitly (its shell runs in the
        // project, so `pwd` gives it; the MCP server's cwd is unreliable).
        return {
          content: [
            {
              type: "text",
              text: `No working folder known. Pass { path: "<absolute project folder>" } (use your shell: pwd), or have the MCP client expose workspace Roots. Workbench URL: ${rt.url}`
            }
          ],
          structuredContent: {
            ok: false,
            error: "no_working_folder",
            detail:
              "No IKRAN_CWD env, no MCP roots, and no active project. Pass { path } explicitly.",
            session: rt.token,
            workbench_url: rt.url
          }
        };
      }

      // FAIL CLOSED: a different project is already bound. Do NOT switch.
      if (activePath && !samePath(activePath, requestedPath)) {
        return {
          content: [
            {
              type: "text",
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

      // OPEN idempotent: already bound to the requested path.
      if (activePath && samePath(activePath, requestedPath)) {
        return {
          content: [
            {
              type: "text",
              text: `Ikran project already open: ${activePath}\nSession: ${rt.token}\nWorkbench URL: ${rt.url}`
            }
          ],
          structuredContent: {
            ok: true,
            project: activeProject,
            active_project: activePath,
            connected_agent: state.body.connected_agent ?? null,
            session: rt.token,
            workbench_url: rt.url
          }
        };
      }

      // CREATE: no active project -> bind via the HTTP API (validate + mkdir +
      // SQLite + events + set-active all live in the HTTP route; no logic
      // duplication here).
      const bind = await apiPost(rt.port, rt.token, "/api/project/bind", {
        path: requestedPath
      });
      if (bind.status !== 200 || !bind.body || !bind.body.ok) {
        const reason = (bind.body && bind.body.error) || `HTTP ${bind.status}`;
        return {
          content: [
            {
              type: "text",
              text: `Failed to bind Ikran project "${requestedPath}": ${reason}.`
            }
          ],
          structuredContent: {
            ok: false,
            error: (bind.body && bind.body.error) || "bind_failed",
            detail: reason,
            path: requestedPath,
            session: rt.token,
            workbench_url: rt.url
          }
        };
      }
      return {
        content: [
          {
            type: "text",
            text: `Ikran project bound: ${bind.body.project.path}\nEvents: ${bind.body.events.project_created}, ${bind.body.events.folder_selected}\nSession: ${rt.token}\nWorkbench URL: ${rt.url}`
          }
        ],
        structuredContent: {
          ok: true,
          project: bind.body.project,
          events: bind.body.events,
          active_project: bind.body.project.path,
          session: rt.token,
          workbench_url: rt.url
        }
      };
    } catch (err) {
      return {
        content: [
          { type: "text", text: `create_or_open_project failed: ${err.message}` }
        ],
        structuredContent: {
          ok: false,
          error: "runtime_unavailable",
          detail: err.message
        }
      };
    }
  }
);

// list_working_folders — transparency tool: show which working folder the MCP
// server discovered and how (MCP Roots / explicit env / none), so the Agent /
// designer can confirm the binding target. Read-only; does not bind.
mcp.registerTool(
  "list_working_folders",
  {
    description:
      "Show the working folder the Ikran MCP server has discovered for the Agent host's current workspace, and how it was discovered (MCP Roots `roots/list`, an explicit IKRAN_CWD env override, or none). Read-only — does not bind a project. Use this to confirm which folder create_or_open_project / the Workbench will bind before initializing `.ikran/`."
  },
  async () => {
    try {
      const rt = await ensureRuntime();
      const d = await discoverWorkingFolder();
      return {
        content: [
          {
            type: "text",
            text: d.folder
              ? `Working folder: ${d.folder} (source: ${d.source})\nSession: ${rt.token}\nWorkbench URL: ${rt.url}`
              : `No working folder discovered (source: ${d.source}). Expose workspace Roots from the MCP client, set IKRAN_CWD env, or pass { path } to create_or_open_project.\nWorkbench URL: ${rt.url}`
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
      return {
        content: [
          { type: "text", text: `list_working_folders failed: ${err.message}` }
        ],
        structuredContent: {
          ok: false,
          error: "runtime_unavailable",
          detail: err.message
        }
      };
    }
  }
);

// setup_workspace — universal, non-Roots bootstrap. Returns the exact MCP config
// snippet that pins a workspace as Ikran's working folder (cwd) with per-project
// state (IKRAN_STATE_DIR = <workspace>/.ikran), so the NEXT launch of this MCP
// server runs in the right workspace without relying on MCP Roots or a manual cwd
// setting. The Agent passes { path } = its current project folder (use pwd). The
// tool does NOT write any file — the Agent writes the snippet into
// <path>/.cursor/mcp.json (merge into mcpServers) and reloads Cursor's MCP
// servers. For the current session, the Agent also calls create_or_open_project
// ({ path }) to bind now. After the reload, future sessions in this workspace
// auto-discover (cwd) + auto-bind (resume) with per-project isolation.
mcp.registerTool(
  "setup_workspace",
  {
    description:
      "Pin a workspace as Ikran's working folder WITHOUT relying on MCP Roots or a manual cwd config. Pass { path } = the user's current project folder (use your shell: pwd). Returns the exact MCP config snippet (`mcpServers.ikran` with `cwd` = the folder and `env.IKRAN_STATE_DIR` = `<folder>/.ikran`, so each project gets its own state + Runtime). The tool does NOT write any file — YOU write the snippet into `<path>/.cursor/mcp.json` (merge into `mcpServers`, preserving your other servers; if you invoke ikran differently, keep your command/args and just set `cwd` + `env.IKRAN_STATE_DIR`), then reload Cursor's MCP servers. For the current session, also call create_or_open_project({ path }) to bind now. After the reload, future sessions in this workspace auto-discover + auto-bind with per-project isolation.",
    inputSchema: { path: z.string() }
  },
  async (args) => {
    try {
      const raw = typeof args.path === "string" ? args.path.trim() : "";
      if (!raw) {
        return {
          content: [
            { type: "text", text: "setup_workspace requires { path } (the user's current project folder; use your shell: pwd)." }
          ],
          structuredContent: { ok: false, error: "missing_path" }
        };
      }
      const folder = path.resolve(raw);
      // Light validation: warn (don't hard-fail) if the folder doesn't exist yet —
      // the Agent may be configuring before creating it.
      let exists = false;
      try {
        exists = statSync(folder).isDirectory();
      } catch {
        exists = false;
      }
      const selfPath = fileURLToPath(import.meta.url);
      const entry = {
        command: "node",
        args: [selfPath, ...(prod ? ["--prod"] : [])],
        cwd: folder,
        env: { IKRAN_HOST: host, IKRAN_STATE_DIR: path.join(folder, ".ikran") }
      };
      const fullConfig = { mcpServers: { ikran: entry } };
      const mcpJsonPath = path.join(folder, ".cursor", "mcp.json");
      const note = prod
        ? "Note: --prod requires `npm run build`; drop --prod for zero-build dev mode."
        : "";
      const instructions = exists
        ? `Merge the \`ikran\` entry into the \`mcpServers\` object in ${mcpJsonPath} (preserve your other MCP servers; if you invoke ikran differently, keep your command/args and just set cwd + env.IKRAN_STATE_DIR), then reload Cursor's MCP servers. For the current session, call create_or_open_project({ path: ${folder} }) to bind now.`
        : `The folder ${folder} does not exist yet. Create it, then merge the \`ikran\` entry into ${mcpJsonPath} and reload Cursor's MCP servers.`;
      return {
        content: [
          {
            type: "text",
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
      return {
        content: [
          { type: "text", text: `setup_workspace failed: ${err.message}` }
        ],
        structuredContent: { ok: false, error: "setup_failed", detail: err.message }
      };
    }
  }
);

// register_seed_reference — the Agent's semantic record-write tool (Issue
// 02/03). It records a Figma seed URL + the designer's original design intent as
// Runtime-owned research source-of-truth by PROXYING to the Workbench HTTP API
// at POST /api/seed-reference (the SAME route the Web UI would use). It is the
// ONLY sanctioned way for an Agent to change this Runtime-owned record — there
// is no raw exec tool and no separate geometry tool. The handler only performs
// a LOCAL format check; it never accesses Figma, fetches, or probes the link.
// On validation failure the HTTP route returns a structured error and writes NO
// record/event (no half-written state); this proxy surfaces that error.
mcp.registerTool(
  "register_seed_reference",
  {
    description:
      "Register a Figma seed reference and the designer's original design intent for the active Ikran project. SEMANTIC BOUNDARY: this records the seed URL + design intent as Runtime-owned research source-of-truth. It does NOT access Figma, does NOT fetch / oEmbed / probe the link, and does NOT verify the file exists online — it only performs a LOCAL format check (https URL, figma.com / www.figma.com host, /design/<key> or /file/<key> path) and stores the ORIGINAL URL verbatim (never rewritten). Requires an active project — call create_or_open_project first. Pass { figmaSeedReference, originalDesignIntent }. On validation failure returns a structured error and writes NO record/event (no half-written state). All research source-of-truth changes go through Ikran tools.",
    inputSchema: {
      figmaSeedReference: z.string(),
      originalDesignIntent: z.string()
    }
  },
  async (args) => {
    try {
      const rt = await ensureRuntime();
      const res = await apiPost(rt.port, rt.token, "/api/seed-reference", {
        figmaSeedReference: args.figmaSeedReference,
        originalDesignIntent: args.originalDesignIntent
      });
      // 404 means the Runtime serving this MCP server does NOT know the
      // /api/seed-reference route — i.e. it is a STALE build/runtime spawned
      // before this tool existed (the most likely real-Agent failure). Surface
      // a diagnosable error instead of a generic "register_failed" so the user
      // knows to rebuild + restart the MCP host / Runtime.
      if (res.status === 404) {
        return {
          content: [
            {
              type: "text",
              text: `register_seed_reference failed: the Runtime at ${rt.host}:${rt.port} returned HTTP 404 for /api/seed-reference — the running Runtime is STALE (built before this route existed). Fix ONE of: (a) npm run build, then restart the MCP host / Ikran Runtime so it serves the fresh build; or (b) run the MCP server in dev mode (drop --prod) so the route hot-reloads. Then retry.`
            }
          ],
          structuredContent: {
            ok: false,
            error: "route_not_found",
            detail: `HTTP 404 on /api/seed-reference (stale Runtime at ${rt.host}:${rt.port}; fix: npm run build + restart MCP host/runtime, or use dev mode)`,
            route: "/api/seed-reference",
            session: rt.token,
            workbench_url: rt.url
          }
        };
      }
      if (res.status !== 200 || !res.body || !res.body.ok) {
        const reason = (res.body && res.body.error) || `HTTP ${res.status}`;
        return {
          content: [
            {
              type: "text",
              text: `register_seed_reference failed: ${reason}`
            }
          ],
          structuredContent: {
            ok: false,
            error: (res.body && res.body.error) || "register_failed",
            detail: reason,
            session: rt.token,
            workbench_url: rt.url
          }
        };
      }
      return {
        content: [
          {
            type: "text",
            text: `Seed reference registered: ${res.body.record.figma_seed_reference}\nDesign intent: ${res.body.record.original_design_intent}\nEvent: ${res.body.event_id ? res.body.event_id : "(audit write failed — record still saved; do NOT retry)"}\nWorkbench URL: ${rt.url}`
          }
        ],
        structuredContent: {
          ok: true,
          record: res.body.record,
          event_id: res.body.event_id,
          ...(res.body.audit_warning ? { audit_warning: res.body.audit_warning } : {}),
          session: rt.token,
          workbench_url: rt.url
        }
      };
    } catch (err) {
      return {
        content: [
          { type: "text", text: `register_seed_reference failed: ${err.message}` }
        ],
        structuredContent: {
          ok: false,
          error: "runtime_unavailable",
          detail: err.message
        }
      };
    }
  }
);

const transport = new StdioServerTransport();
mcp
  .connect(transport)
  .then(() => {
    console.error(`[ikran-mcp] ready (open_workbench, create_or_open_project, register_seed_reference, list_working_folders, setup_workspace, host=${host}, prod=${prod})`);
  })
  .catch((err) => {
    console.error(`[ikran-mcp] failed to connect transport: ${err.message}`);
    shutdown(1);
  });