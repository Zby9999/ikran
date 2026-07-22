# Separate Agent orchestration from the model runtime

Ikran will own a host-neutral Agent orchestration control plane. Where an Agent
host exposes a suitable official interface, a host adapter may start or resume
turns for durable Agent commands; whether each host can preserve the intended
conversation, tools, and approvals must be established by investigation before
product reliance. The Agent host continues to own the model, conversation,
tool approvals, file editing, and implementation-context tools; Ikran MCP
remains the semantic capability and data boundary. This gives Workbench actions
a possible path to resume idle Agents without turning Ikran into another model
runtime or recreating the Agent host.

## Considered Options

- Remaining MCP-only cannot reliably start an idle Agent turn.
- Owning a complete model runtime would duplicate the Agent host and its
  approvals, integrations, accounts, and conversation experience.
- A control plane with host adapters adds integration work but preserves a
  single Ikran workflow contract across Codex, Cursor, Claude, and future hosts.

## Consequences

The portable baseline persists commands and handles them through an active or
later Agent turn, using adaptive waiting when that turn remains available.
Host-specific activation is an investigated capability rather than an assumed
MVP guarantee; compatible adapters may be added incrementally without changing
the Runtime-owned command or workflow semantics.
