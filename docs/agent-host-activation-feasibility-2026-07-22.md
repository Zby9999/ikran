# Agent Host Activation Feasibility — 2026-07-22

## Decision

Ikran keeps `adaptive wait + durable pending command + next-turn resume` as the
portable workflow contract. None of the investigated surfaces is yet safe to
use as a production dependency for waking the exact Agent conversation that the
designer currently has open.

Codex App Server is the only surface that passes enough of the protocol-shape
gate to justify a post-MVP adapter prototype. It can start or resume a named
thread, submit a structured turn, report status and errors, request approvals,
and interrupt work. The remaining gate is product continuity: a separately
started App Server has not been shown to attach to the current Codex Desktop
process, preserve the user's selected integrations such as the host Figma MCP,
or surface the resumed turn and approvals in that open UI.

Cursor CLI and Claude Agent SDK/CLI are useful headless fallbacks, but there is
no documented control plane for injecting a turn into the currently open Cursor
IDE or Claude Code interaction. Claude Agent View and Remote Control can keep a
Claude Code session alive or remotely accessible, but their documented command
surfaces do not expose a supported third-party `send message to session` API.
Claude Managed Agents does expose a durable event API, but it is a separate
Anthropic-managed runtime and therefore does not satisfy Ikran's host-activation
requirement or its decision not to own another model runtime.

## Activation gate and terminology

An adapter is safe only when an official, supported surface can:

1. identify and resume the intended existing host conversation;
2. preserve its workspace/worktree, history, model, tools/MCP configuration,
   authentication and approval policy;
3. deliver a durable Ikran command while the host is idle;
4. expose acceptance, progress, approval, cancellation and terminal errors;
5. avoid concurrent writers and make the turn visible in the user's host UI.

Three mechanisms must not be conflated:

- **Host-mediated activation:** Ikran asks the host's official control plane to
  start or resume a turn. This is the capability under investigation.
- **Active-turn MCP wait:** an Agent turn is already running and calls
  `wait_for_agent_command`; Runtime returns or continues waiting. No reverse
  injection is involved.
- **MCP reverse injection:** an MCP server attempts to create a new Agent turn.
  Standard MCP does not provide this host lifecycle capability.

Starting a new headless CLI/SDK worker is a useful comparison, but is not a pass
unless it demonstrably resumes the intended host context and user experience.

## Compatibility matrix

| Host / official surface | Stability on 2026-07-22 | New turn | Resume named conversation | Structured command | Idle activation of current host UI | Context preservation | Control and observability | Classification |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Codex CLI `0.145.0-alpha.30` — App Server JSON-RPC | CLI labels surface experimental; OpenAI describes App Server as the integration protocol used by Codex clients | Verified: `thread/start` | Protocol supports `thread/resume`; isolated probe had no pre-existing fixture thread | Verified protocol acceptance with `turn/start` input plus output schema | **Unknown.** A separate server was not shown to attach to the open Desktop process/UI | Workspace, history, model, sandbox and approval policy are expressible; current Desktop-selected plugins/Figma MCP and UI continuity remain unknown | Verified event stream and `turn/interrupt`; protocol documents approvals, status and errors | **Safe to prototype, not production-safe** |
| Codex TypeScript SDK / `codex exec resume` | Official SDK; CLI worker lifecycle | Yes | Yes, for a stored Codex thread ID | Yes, including output schema | No evidence of activation in the already-open Desktop UI | Can select cwd/model/sandbox; host UI, current approvals and selected integration continuity are unverified | Streamed items and process cancellation available | **Limited headless fallback** |
| Cursor Agent CLI `2026.07.01-41b2de7` | Beta | Verified: `agent create-chat` | Documented `--resume <chatId>`; authenticated resume was not verified in isolated fixture | Documented prompt plus JSON/stream-json; isolated authenticated dispatch unknown | No documented API/daemon for an idle Cursor IDE Agent chat | Workspace/worktree and CLI chat history supported; `mcp.json` can be loaded, but current IDE-selected MCP/Figma context, model, approvals and UI history are unknown | Structured output is documented; no documented IDE-turn cancel/status control plane | **Limited headless fallback** |
| Claude Code `2.1.191` — CLI / Agent SDK | CLI generally supported; Agent SDK official | Yes | Documented by session ID; SDK resumes disk-backed history in a new process | Yes through CLI/SDK query | No documented third-party injection into the currently open interaction | Project-scoped history can resume; SDK/print sessions are a separate programmatic lane and do not prove current UI/MCP/approval continuity | SDK/CLI stream and cancellation are available for the process it owns | **Limited headless fallback** |
| Claude Code Agent View / background supervisor | Research preview; some current docs require newer versions than the installed `2.1.191` | User can background/manage a session | Supervisor preserves a backgrounded conversation and can respawn it | UI can reply; no documented third-party CLI/API send operation found | Conditional user-facing wake/attach exists, but no supported Ikran input channel | Docs say backgrounding preserves MCP config, settings, added dirs, plugins, permission mode, model and effort | Status, stop, respawn and errors are documented | **Unavailable as an adapter today** |
| Claude Code Remote Control | Research preview | Operates an existing Claude Code session | Preserves current session | User can send from Anthropic web/mobile UI | User-facing transport only; no documented local integration API | Preserves filesystem, MCP tools and project configuration | User-facing status/control | **Unavailable as an adapter today** |
| Claude Managed Agents API | Beta (`managed-agents-2026-04-01`) | Verified by official API contract | Durable managed session ID | `user.message` event | Yes for its own managed session, **not** for Claude Code UI | Separate agent/environment/tool/MCP/vault configuration; does not inherit a Claude Code conversation | Explicit idle/running status, events, approvals, interrupt and errors | **Out of scope: separate model runtime** |

“Documented” and “verified” are intentionally different. An isolated probe that
could not authenticate a model call is marked unknown rather than promoted to a
pass. Absence of a Cursor or Claude Code live-host control plane is limited to
the official surfaces reviewed on the investigation date, not a claim that an
undocumented private interface cannot exist.

All three headless coding surfaces can edit files when their owned process is
authenticated and approved to do so. That capability is not an activation pass:
for Codex App Server the file-change approval protocol is documented but its
routing into the current Desktop UI is unknown; for Cursor CLI and Claude
CLI/SDK the edits and approvals belong to the newly started process rather than
a proven continuation of the open IDE/session. The prototype gate therefore
tests approval ownership and single-writer file editing separately from basic
tool availability.

## Reproducible probes

All probes used temporary homes/projects under `/tmp/ikran-07f-*`. They did not
read personal conversation history, copy credentials, or make repository edits.
The temporary state was removed after the investigation.

### Codex

Installed executable:

```text
/Applications/ChatGPT.app/Contents/Resources/codex
codex-cli 0.145.0-alpha.30
```

With `CODEX_HOME=/tmp/ikran-07f-codex-home`, an isolated
`codex app-server --stdio` was initialized over JSON-RPC. `thread/list` returned
an empty list. `thread/start` accepted the repository cwd, ephemeral storage and
read-only sandbox, returning a thread ID. `turn/start` then accepted a durable
command as structured input with an output schema and emitted thread/turn/status
events. Network isolation prevented model transport; `turn/interrupt` produced
an interrupted terminal status. This verifies the protocol boundary, event
delivery and cancellation—not model completion or Codex Desktop continuity.

### Cursor

Installed executable and version:

```text
/Users/bingyizhang/.local/bin/agent
2026.07.01-41b2de7
```

With an isolated home and project, `agent create-chat` returned a chat ID.
`agent --resume <chat-id> --print --output-format json <structured-command>`
reached macOS credential lookup and failed with `SecItemCopyMatching failed
-50`; `agent mcp list` failed at the same isolated credential boundary. Creation
is verified; authenticated resume, tool use and completion remain unknown.

### Claude Code

Installed executable and version:

```text
/Users/bingyizhang/.npm-global/bin/claude
2.1.191
```

With isolated home/config/project directories, `claude agents --json --cwd
<fixture>` returned an empty list and the background daemon reported stopped.
`claude --bg --name ikran-probe <structured-command>` started the background
service but did not yield an authenticated session result before the bounded
probe was stopped. No model call or personal session was accessed. Official
documentation, rather than this incomplete probe, establishes the capabilities
and research-preview limits in the matrix.

## Capability details

### Codex App Server

The official protocol documents `thread/start`, `thread/resume`, `thread/read`,
`thread/list`, `turn/start`, `turn/steer` and `turn/interrupt`. A turn can carry
structured input and an output schema. The client is responsible for rendering
and answering server-initiated tool/file approval requests. Thread and turn
notifications expose lifecycle and error state.

These are the right adapter primitives. They still do not prove that an Ikran
process may safely open the same thread concurrently with Codex Desktop. The
prototype must therefore fail closed unless it can verify exact thread ownership,
single-writer behavior, Desktop visibility, current tool/Figma MCP continuity
and approval routing. `codex exec resume` or the TypeScript SDK is explicitly
not an acceptable substitute for those gates.

### Cursor

The official beta CLI can create or resume CLI chats, select workspace/model,
read project rules and MCP configuration, and emit JSON or stream-json tool
events. No reviewed official document exposes the identity or lifecycle of the
currently open IDE Agent conversation to an external process. Loading the same
`mcp.json` is configuration reconstruction, not proof that the CLI inherited
the user's live IDE tools, approvals or Figma context.

### Claude

Claude Code can resume a session ID and the Agent SDK can resume its disk-backed
conversation in a new client process. Official guidance distinguishes
interactive sessions from programmatic/SDK sessions, so this is a headless
continuation path rather than evidence of controlling an open interaction.

Agent View preserves more host context when the user explicitly backgrounds a
session, including MCP configuration, plugins, permissions, model and effort.
Its shell management surface documents list, attach, logs, stop and respawn, but
not a supported third-party message-send operation. Remote Control similarly
provides a user-facing Anthropic transport, not an Ikran API.

Managed Agents is the clearest example of the desired event model—durable
sessions accept `user.message`, expose idle/running states, approvals, interrupts
and errors—but it creates a separately configured Anthropic agent environment.
Adopting it would change the architecture from host activation to another model
runtime and is therefore excluded.

## Product consequence

- MVP remains non-blocking: Workbench persists Agent commands and advances
  Runtime-owned workflow state regardless of host availability.
- An already-running Agent may use adaptive three-minute waits, extending while
  Workbench activity continues.
- If the wait ends, the command remains pending and the next Agent turn resumes
  it before starting unrelated work.
- Runtime and MCP never claim to wake an idle Agent by themselves.
- Host adapters remain optional optimizations behind the same durable command
  contract. Failure or absence of an adapter must be indistinguishable from an
  ordinary pending command at the workflow layer.

## Official sources

- OpenAI Codex App Server protocol:
  <https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md>
- OpenAI Codex TypeScript SDK:
  <https://github.com/openai/codex/blob/main/sdk/typescript/README.md>
- OpenAI, “Unlocking the Codex harness”:
  <https://openai.com/index/unlocking-the-codex-harness/>
- Cursor CLI overview, usage, parameters and output:
  <https://docs.cursor.com/en/cli/overview>
  <https://docs.cursor.com/en/cli/using>
  <https://docs.cursor.com/en/cli/reference/parameters>
  <https://docs.cursor.com/en/cli/reference/output-format>
- Claude Code sessions, Agent View and Remote Control:
  <https://code.claude.com/docs/en/sessions>
  <https://code.claude.com/docs/en/agent-view>
  <https://code.claude.com/docs/en/remote-control>
- Claude Agent SDK session comparison:
  <https://platform.claude.com/cookbook/claude-agent-sdk-04-migrating-from-openai-agents-sdk>
- Claude Managed Agents sessions, operations and event stream:
  <https://platform.claude.com/docs/en/managed-agents/sessions>
  <https://platform.claude.com/docs/en/managed-agents/session-operations>
  <https://platform.claude.com/docs/en/managed-agents/events-and-streaming>
