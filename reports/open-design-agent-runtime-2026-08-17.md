# Open Design agent / runtime 交互调研

Date: 2026-08-17
Status: research notes from primary sources
Product: [Open Design](https://open-design.ai) · GitHub [`nexu-io/open-design`](https://github.com/nexu-io/open-design) · Apache-2.0 · latest noted release v0.19.1

This note describes how Open Design’s **agent** and **runtime** talk, and how that compares with Ikran’s local MCP + HTTP Workbench + embedded-browser shape. It is not an implementation plan.

## Outcome first

Open Design and Ikran look similar at the product surface: a local daemon, a Web UI, and an Agent-host embedded browser as the ideal viewer. The control plane is inverted.

- **Ikran:** the Agent host owns the model and the turn. Runtime is an MCP server the host calls. The Workbench cannot wake an idle host.
- **Open Design (primary product):** the daemon owns spawning. The UI talks HTTP/SSE to the daemon; the daemon `spawn()`s a coding-agent CLI into the project folder and streams events back. Open Design does not reimplement the agent loop.
- **Open Design (Codex plugin / `od mcp`):** looks more like Ikran (host agent + MCP + studio URL in the in-app browser), but `start_run` still commissions an **inner** agent inside the daemon. The outer Codex agent is a commissioner, not the design worker.

Sources: [architecture.md](https://github.com/nexu-io/open-design/blob/main/docs/architecture.md), [agent-adapters.md](https://github.com/nexu-io/open-design/blob/main/docs/agent-adapters.md), [`apps/daemon/src/mcp.ts`](https://github.com/nexu-io/open-design/blob/main/apps/daemon/src/mcp.ts), [0.17.0 Codex notes](https://open-design.ai/blog/open-design-0-17-0-open-design-for-codex/).

## Canonical surfaces

| Surface | URL |
|---|---|
| Website | https://open-design.ai |
| Official aliases / GitHub pointer | https://open-design.ai/official/ |
| GitHub | https://github.com/nexu-io/open-design |
| Agents catalog | https://open-design.ai/agents/ |
| Codex plugin install | https://open-design.ai/codex-plugin/ |
| MCP marketing page | https://opendesigner.io/mcp |

Three runnable surfaces ([official page](https://open-design.ai/official/)):

1. **Desktop app** — packaged Electron for macOS / Windows / Linux.
2. **Daemon (`od`)** — local HTTP daemon + CLI for agents, shell, or CI.
3. **Skills + Systems** — Markdown bundles (`SKILL.md`, `DESIGN.md`).

## Topology (primary product)

From [architecture.md](https://github.com/nexu-io/open-design/blob/main/docs/architecture.md):

```
browser or Electron renderer
          │  same-origin HTTP + SSE
          ▼
Next.js web app  ── /api/* rewrites ──►  Express daemon
                                             │
                        SQLite + project files + skills/systems
                                             │
                        runtime registry → spawn CLI / ACP process
                                             │
                        structured events, file writes, text
```

The web UI and `od` CLI call the **same** daemon HTTP APIs. The CLI is not a second business-logic stack.

Daemon ownership ([`apps/daemon/AGENTS.md`](https://github.com/nexu-io/open-design/blob/main/apps/daemon/AGENTS.md)): `/api/*` HTTP + SSE, SQLite, agent spawning, MCP, static serving. Default loopback is `http://127.0.0.1:7456`. Packaged desktop discovers the web URL through sidecar IPC rather than assuming a port (`STATUS · EVAL · SCREENSHOT · CONSOLE · CLICK · SHUTDOWN` — desktop automation/export, not the Agent conversation channel). Headless packaged runtime (`apps/packaged/src/headless.ts`) omits the Electron window; Codex plugin uses this.

Studio does **not** use MCP to wake the inner agent. The UI path is `POST /api/chat` (SSE) or `POST /api/runs`. MCP is only the foreign-host face. Early WebSocket `session.generate` drafts are explicitly obsolete.

## Lane A — Open Design as host, agent as child

This is the default Studio / desktop loop.

Thesis from [agent-adapters.md](https://github.com/nexu-io/open-design/blob/main/docs/agent-adapters.md):

> We delegate the **entire agent loop** — model calls, tool use, context management, permission handling, resume, cancel — to the user's existing code agent CLI. OD's job is to detect it, feed it a skill + prompt + working directory, and stream its output back to the web UI.

### Who starts whom

1. User opens Desktop / `pnpm tools-dev` / packaged headless runtime.
2. Daemon boots, probes PATH for registered CLIs (`detectAgents()`).
3. User submits a brief in Studio (question form → direction → generate).
4. UI `POST`s `/api/chat` or `/api/runs`.
5. Daemon `spawn(cli, [...], { cwd: managed project cwd })`.
6. Child agent writes HTML/CSS/JS (and other artifacts) into that folder.
7. Daemon parses stdout into a shared event stream (thinking / tool-call / text-delta / file-write / done) and SSE’s it to the UI.
8. Preview is a sandboxed iframe of the project files (or a `srcdoc` iframe for BYOK/plain-API runs).

The marketing site states the same: the daemon scans PATH for known CLIs; whichever it finds become candidate design engines, driven over stdio with one adapter per CLI ([opendesigner.io](https://opendesigner.io/)).

### Adapter shape

An adapter is **data, not a class**. One `RuntimeAgentDef` object per CLI in `apps/daemon/src/runtimes/defs/*.ts`. The generic engine in `runtimes/` does detect / launch / invoke / parse. Adding a CLI is “drop one def file + register it”.

Shipped stream formats ([agent-adapters.md](https://github.com/nexu-io/open-design/blob/main/docs/agent-adapters.md)):

| Stream format | Example runtimes |
|---|---|
| `claude-stream-json` | claude, amp, codebuddy |
| `json-event-stream` | codex, cursor-agent, opencode |
| `acp-json-rpc` | amr, devin, hermes, kimi, kiro, kilo, trae-cli, vibe |
| `pi-rpc` | pi |
| `dsh-profile-jsonl` | deepseek-harness |
| `plain` | aider, antigravity, grok-build, qwen |

Preferred new-runtime contract is **ACP over stdio** ([new-agent-runtime-acp.md](https://github.com/nexu-io/open-design/blob/main/docs/new-agent-runtime-acp.md)):

```
Open Design daemon
  └─ spawn your-agent acp
       ├─ stdin  <- ACP JSON-RPC
       ├─ stdout -> ACP JSON-RPC
       └─ stderr -> logs
```

ACP session methods OD sends: `initialize` → `session/new` or `session/load` → optional `session/set_model` → `session/prompt` → `session/cancel`. Notifications come back as `session/update`. Permission requests are auto-approved when an allow-style option exists.

Prompt delivery varies: argv, stdin, or a prompt file (Windows `CreateProcess` length forces stdin for some CLIs).

### Prompt stack (what the inner agent actually sees)

Composed by the daemon before spawn ([opendesigner.io](https://opendesigner.io/)):

```
DISCOVERY directives  (turn-1 form, TodoWrite, critique)
  + identity charter
  + active DESIGN.md
  + active SKILL.md
  + project metadata
  + skill side files (staged under .od-skills/, not live-symlinked)
```

Skills are copied into the project as dereferenced trees so the inner agent cannot mutate the source catalog.

### Reverse MCP: daemon injects tools into the child

For mature ACP runtimes, the daemon can inject an MCP server **into the spawned agent**:

`buildLiveArtifactsMcpServersForAgent()` in [`apps/daemon/src/runtimes/mcp.ts`](https://github.com/nexu-io/open-design/blob/main/apps/daemon/src/runtimes/mcp.ts) returns:

```
{ name: 'open-design-live-artifacts', command: 'od', args: ['mcp', 'live-artifacts'] }
```

So the child agent may call Open Design tools while it is already a child of Open Design. This is the opposite of Ikran’s single MCP direction (host → Runtime).

A third callback path exists besides MCP: the spawned CLI receives `OD_DAEMON_URL` / `OD_TOOL_TOKEN` and is expected to call back into daemon helpers (for example `od media generate`) instead of hitting cloud image/video APIs itself. Inner Codex, when used as a **runtime**, is `codex exec --json --skip-git-repo-check` with prompt on stdin and `codex exec resume --json <thread_id>` — a different process from the outer Codex Desktop task that loaded the plugin.

### UI ↔ agent interaction (no host-wake problem)

Because OD spawned the process, the UI can:

- start a run immediately from a button / brief;
- stream TodoWrite live;
- cancel via `session/cancel` or `SIGTERM`;
- resume via ACP `session/load` or CLI-native resume flags.

This is host-mediated activation in Ikran vocabulary — except Open Design **is** the host of the inner CLI, not a guest of Cursor/Codex.

Turn-1 product rule: a question form first when the brief is incomplete; skip it when the first prompt already contains enough direction ([0.17.0](https://open-design.ai/blog/open-design-0-17-0-open-design-for-codex/)).

Fallback when no CLI is installed: `POST /api/proxy/{provider}/stream` to any OpenAI-compatible endpoint (SSRF-guarded). That path is a thin proxy, not a full agent loop.

## Lane B — Open Design as MCP server, host agent as commissioner

This is the Codex-plugin / Cursor / Claude Code embedding lane. It is the one that most resembles Ikran.

### `od mcp`

[`apps/daemon/src/mcp.ts`](https://github.com/nexu-io/open-design/blob/main/apps/daemon/src/mcp.ts) header:

> stdio MCP server that proxies project tool calls to the running daemon's HTTP API. The server itself holds no state and never touches the filesystem; every tool resolves to a `fetch()` against `OD_DAEMON_URL`.

If the daemon is down, the MCP process still starts so the host can list schemas; tool calls return “daemon not reachable”. Codex plugin docs say the registered local MCP can **start the signed Open Design runtime headlessly** when needed ([codex-plugin](https://open-design.ai/codex-plugin/)).

Marketing pages still say “read-only at the edge” ([opendesigner.io/mcp](https://opendesigner.io/mcp)). Source as of this research also exposes write/generation tools. Treat marketing as stale relative to `mcp.ts`.

### Generation contract (nested agent)

Comment in `mcp.ts` (authoritative):

> An external coding agent does NOT run a skill itself — it commissions Open Design to, via `start_run`. The daemon then spawns ITS OWN agent (Claude Code / API fallback / …) to do the work.

| Tool | Role |
|---|---|
| `collect_brief` / `confirm_brief` | MCP App / GenUI: host renders `ui://open-design/artifact-card-v8.html` (`text/html;profile=mcp-app`) so the designer confirms a visual brief inside Codex, not in a second window |
| `list_projects` / `get_active_context` / `get_project` | Discover OD projects; default project is “what the user has open in OD”, expires ~5 minutes after last UI activity |
| `list_files` / `get_file` / `search_files` / `get_artifact` | Read live project files; `get_artifact` bundles HTML + referenced siblings |
| `list_skills` / `list_plugins` / `list_agents` | Discovery only — caller does not execute the skill |
| `create_project` | Empty project + `conversationId`; MCP defaults skip the discovery brief to avoid a double interview |
| `start_run` | Returns `runId` immediately; daemon spawns inner agent |
| `get_run` | Poll `queued\|running\|succeeded\|failed\|canceled`; on success: `previewUrl`, `studioUrl`, `agentMessage`, `eventsLogPath` |
| `cancel_run` | Abort inner run |
| `create_artifact` / `write_file` / `delete_file` | File bypass. Session instructions tell the outer agent **not** to cancel a long `start_run` and substitute `write_file` |
| `start_vela_login` / `get_vela_login_status` | Open Design Cloud login. User-facing copy must say “Open Design Cloud”, never the tool names |

`get_run` also points the outer agent at a JSONL event log it can `tail`, because MCP is request/response and a run can take 5–30 minutes ([PR #3141](https://github.com/nexu-io/open-design/pull/3141)). Session instructions tell the outer agent **not** to cancel a “static” poll and substitute `write_file`.

### Codex plugin loop

From [0.17.0](https://open-design.ai/blog/open-design-0-17-0-open-design-for-codex/) and [codex-plugin](https://open-design.ai/codex-plugin/):

1. Install plugin + register local MCP (`od mcp install codex`, marketplace `codex plugin add open-design@open-design`, or “ask Codex to read open-design.ai/codex-plugin”). Plugin MCP points at `od mcp --daemon-url http://127.0.0.1:7456` ([`plugins/open-design/.mcp.json`](https://github.com/nexu-io/open-design/blob/main/plugins/open-design/.mcp.json)). Sidecar mode can refresh the daemon URL via IPC instead of pinning the port ([`mcp-install-info.ts`](https://github.com/nexu-io/open-design/blob/main/apps/daemon/src/mcp-install-info.ts)).
2. New Codex task (plugin/MCP capabilities load at task start).
3. User writes `@open-design …` brief.
4. Codex calls `collect_brief` → host renders the MCP App card → `confirm_brief` → `create_project` → `start_run` (stable `requestId`).
5. Inner agent (user’s configured CLI; may be Claude, Codex `exec`, or Cloud) generates files. [#6273](https://github.com/nexu-io/open-design/releases/tag/open-design-v0.17.0) keeps plugin-started Local Codex runs from re-entering the plugin recursively.
6. Codex polls `get_run` every 30–60s until terminal (runs often take 5–30 minutes).
7. Result is a real Preview / Studio artifact, not a screenshot. There is **no** Ikran-style `open_workbench` tool. `studioUrl` is a markdown link that Codex / Cursor / Zed are expected to open in the built-in browser pane. If the web sidecar is down, only `previewUrl` (`/api/projects/:id/raw/...`) is returned.
8. If Studio cannot load inside the host, Codex still returns the stable preview.
9. Designer finishes last 10% with direct canvas manipulation (Manual Edit), not another prompt.

The iframe `od:slide` / `od:slide-state` postMessage protocol is **preview ↔ Studio host**, not Agent transport.

PR #3141 explicitly records a host limitation Ikran also hits:

> Codex's built-in browser navigation isn't an MCP tool we can call. The user / agent must click the studioUrl link manually.

So even in Lane B, Open Design does **not** have a reliable reverse-activation of the host’s embedded browser. It returns a URL. The host agent or the user opens it.

`od mcp install <slug>` covers claude, codex, cursor, copilot, opencode, cline, openclaw, antigravity, kimi, kiro, trae, raven, reasonix, pi, vibe, hermes, claude-desktop. Strategies: CLI (`codex mcp add`), JSON merge (`~/.cursor/mcp.json`), or print-only.

### Embedding contract for orchestrators

[orchestrator-workspaces.md](https://github.com/nexu-io/open-design/blob/main/docs/orchestrator-workspaces.md): OD will read/write a caller-prepared scratch folder and return a result package (status, files, event log). Git writeback, PRs, and deploy stay outside OD. This is how another control plane can treat OD as a design subprocess.

## Comparison with Ikran

| Dimension | Ikran | Open Design |
|---|---|---|
| Product surface | HTTP Workbench + local Runtime; ideal viewer is Agent-host embedded browser | Web app / Electron + local daemon; Codex in-app browser for plugin Studio |
| Who owns the model loop | Agent host (Cursor, Codex Desktop) | Inner coding-agent CLI spawned by the daemon (or BYOK proxy) |
| Runtime process | One process: MCP stdio **and** HTTP Workbench | Express daemon (HTTP/SSE/SQLite) + optional `od mcp` stdio proxy + optional Electron shell |
| Who starts whom | Host Agent starts/reuses Runtime; Agent calls `open_workbench` | Desktop/plugin starts daemon; daemon starts inner CLI. MCP can start daemon headlessly |
| MCP direction | Host → Ikran only | Both: host → `od mcp` → daemon HTTP; daemon → injects live-artifacts MCP into child |
| UI → Agent | Durable Agent command + `wait_for_agent_command` while a turn is already open. No reverse wake | UI POST `/api/chat` or `/api/runs` **spawns** the worker. No idle-host problem on Lane A |
| Nested agents | No. The host Agent **is** the worker | Yes on Lane B. Outer Codex commissions inner Claude/Codex/… via `start_run` |
| Preview | Runtime-owned prototype preview lifecycle | Sandboxed iframe of generated files; `studioUrl` / `previewUrl` handed to host |
| State writer | Runtime is the only writer of source-of-truth records | Daemon SQLite + project filesystem; MCP server is a stateless proxy |
| Skills | Ikran workflow skills are not the MCP product | `SKILL.md` + `DESIGN.md` files are the product; staged into the inner agent’s cwd |
| Host browser open | Agent instructed to open Workbench URL; not a callable host API | Same limitation: `studioUrl` is a link, not a browser MCP tool |

Ikran’s documented activation split ([docs/agent-host-activation-feasibility-2026-07-22.md](../docs/agent-host-activation-feasibility-2026-07-22.md)) maps cleanly:

- **Active-turn MCP wait** — Ikran’s `wait_for_agent_command`. Open Design Lane B uses poll/`get_run` instead of a long MCP wait.
- **Host-mediated activation** — Ikran does not have this in production. Open Design Lane A has it because OD **is** the process parent of the CLI.
- **MCP reverse injection** — neither product can make Codex/Cursor open a URL by tool call. Open Design returns `studioUrl` and relies on the outer agent or the user.

## What is transferable vs what is a different product bet

Transferable (same problem class as Ikran):

- Local daemon as source of truth; Web UI as viewer; Agent-host embedded browser as ideal chrome.
- MCP as the way a **foreign** coding agent discovers projects and receives a localhost studio URL.
- Headless runtime start from MCP, so the designer does not babysit a second window.
- Explicit admission that “open this in the host browser” is not a protocol capability.

Different product bet:

- Open Design **outsources the agent loop** to PATH CLIs and therefore can start work from a button.
- That forces a nested-agent architecture when the host is also a coding agent: the host must wait minutes, tail an event log, and not try to write the artifact itself.
- Ikran keeps one Agent (the host) as the only reasoner, and uses MCP tools as the only write path into Runtime. That preserves host approvals, Figma MCP, and conversation continuity — and pays for it with the idle-host problem.

## Key source files

| Path | Why it matters |
|---|---|
| `docs/architecture.md` | Runtime topology: web ↔ daemon ↔ spawned CLI |
| `docs/agent-adapters.md` | Adapter thesis + `RuntimeAgentDef` + stream formats |
| `docs/new-agent-runtime-acp.md` | Preferred ACP stdio session |
| `docs/orchestrator-workspaces.md` | Embedding OD behind another control plane |
| `apps/daemon/AGENTS.md` | Daemon ownership |
| `apps/daemon/src/server.ts` | Spawn pipeline + SSE dispatch |
| `apps/daemon/src/runtimes/defs/*.ts` | One object literal per CLI |
| `apps/daemon/src/runtimes/mcp.ts` | MCP injected **into** spawned agents |
| `apps/daemon/src/mcp.ts` | `od mcp` stdio server; `start_run` nested-agent contract; MCP App brief |
| `apps/daemon/src/mcp-agent-install.ts` | `od mcp install <slug>` host adapters |
| `apps/daemon/src/mcp-install-info.ts` | Sidecar IPC daemon-URL discovery |
| `apps/daemon/src/runtimes/defs/codex.ts` | Inner `codex exec --json` + stdin + resume |
| `apps/daemon/src/agent-protocol/acp/session.ts` | ACP JSON-RPC lifecycle |
| `apps/packaged/src/headless.ts` | Windowless daemon + web sidecar |
| `plugins/open-design/.mcp.json` | Codex/Claude plugin MCP launch command |
| `apps/web/src/runtime/srcdoc.ts` | Preview iframe postMessage (`od:slide`) |

## Sources

- https://open-design.ai/official/
- https://open-design.ai/agents/
- https://open-design.ai/codex-plugin/
- https://open-design.ai/blog/open-design-0-17-0-open-design-for-codex/
- https://opendesigner.io/
- https://opendesigner.io/mcp
- https://github.com/nexu-io/open-design
- https://github.com/nexu-io/open-design/blob/main/docs/architecture.md
- https://github.com/nexu-io/open-design/blob/main/docs/agent-adapters.md
- https://github.com/nexu-io/open-design/blob/main/docs/new-agent-runtime-acp.md
- https://github.com/nexu-io/open-design/blob/main/docs/orchestrator-workspaces.md
- https://github.com/nexu-io/open-design/blob/main/apps/daemon/src/mcp.ts
- https://github.com/nexu-io/open-design/blob/main/apps/daemon/src/runtimes/mcp.ts
- https://github.com/nexu-io/open-design/pull/3141
- https://github.com/nexu-io/open-design/pull/399
