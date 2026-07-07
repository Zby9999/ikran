# Ikran

A local-first research workbench for recursive designer–Agent alignment around a
Figma seed page. The product surfaces as an HTTP Web UI that can be opened in
any browser, with the Agent desktop's embedded browser as the ideal environment;
a local Runtime daemon owns project state and semantic records and talks to the
Agent through traditional MCP.

## Language

**Ikran Runtime** (Runtime):
The local daemon: a traditional MCP server (stdio, to the Agent) **and** an HTTP
Web UI server (to the Agent desktop's embedded browser), plus SQLite state,
event log, prototype preview lifecycle, and schema validation. It is the only
writer of source-of-truth records. One process, two surfaces.
_Avoid_: server, backend, service

**Workbench URL**:
The localhost URL returned by the Agent after Runtime starts the HTTP Web UI,
for example `http://127.0.0.1:{port}/?session={token}`. The designer may open it
in any browser; the ideal target is the Agent host's embedded browser. The
session token is startup-scoped and local-only.
_Avoid_: app URL, public URL

**Agent host**:
The desktop coding-Agent application (Cursor, Codex desktop) whose **embedded
browser** views the Ikran Web UI and whose MCP client talks to Runtime over
stdio. It owns Figma MCP access, the model, and tool approval.
_Avoid_: client, IDE (when used loosely)

**Ikran workbench**:
The HTTP Web UI served by Runtime: canvas, stage tabs, left question list, and
question cards. It can be opened in any browser, but the ideal environment is
the Agent host's embedded browser so chat, tool calls, file edits, and the
spatial workbench stay together. The Agent host's chat pane is where the agent
reasons/responds and where the designer clarifies; the workbench is the spatial,
structured surface.
_Avoid_: app, UI, front-end, MCP App (we do not use the MCP Apps inline-UI
extension)

**Evidence Surface**:
A canvas object that presents evidence a designer and Agent reason over.
Two kinds: **Figma Evidence Surface** (a Figma visual surface) and
**Prototype Evidence Surface** (a live, interactive prototype iframe — rendered
via tldraw's embed shape).
_Avoid_: panel, viewer

**Region Annotation**:
A first-class persistent record anchored to a region of a specific Evidence
Surface. It never exists without a surface (`surfaceArtifactId` or
`surfaceNodeId` required). Anchor schemas: `figma-region`, `prototype-region`.
On the canvas it is a tldraw custom shape (styling fully controlled), but the
record itself is owned by Runtime.
_Avoid_: box, selection, comment

**Question card**:
A canvas record carrying an agent observation, an agent question, a
conversation thread, and a **final designer answer** field. The designer types
the final answer directly into the card; open clarification happens in the
Agent host's chat pane. The card is both the record and the final-answer input
surface (not a general chat box).
_Avoid_: answer card (use Question card), card (used loosely)

**Canvas record**:
A Runtime-owned source-of-truth record projected onto the canvas — Evidence
Surface, Region Annotation, question card, designer answer. The Agent and
designer submit *intent*; Runtime validates, assigns IDs, persists, and
projects.
_Avoid_: node, shape (those are canvas projections, not records)

**Geometry**:
Canvas positions, sizes, viewport, and layout. Owned by the canvas (tldraw),
explicitly **not** source of truth and **not** research data. Lost/reconstructed
freely.
_Avoid_: layout state (when meant as persistent truth)

**Source artifact**:
A source-of-truth project file written by the agent through the Agent host's
native file editing — design-system markdown, `token.json`, component specs,
prototype code. The agent *declares* each write via an Ikran tool.
_Avoid_: source file (when meant as this concept), generated file

**Derived artifact**:
A file Runtime generates from source artifacts — `design-system-view.json`,
research export packages. Runtime is the only writer of derived artifacts.
_Avoid_: generated file, output, view (when meant as the file)

**Declare**:
The agent calling an Ikran tool after writing a source artifact, so Runtime
records the semantic event, validates the output (one-pass repair per Issue 13),
and generates derived artifacts. File writes happen via the Agent host; Runtime
learns of them by declaration, not by mediating the write.
_Avoid_: log, register, commit

## Source-of-truth split

- **Source of truth**: Canvas records (semantic), owned by Runtime, persisted to
  `.ikran` SQLite + events.
- **Not source of truth**: Geometry + canvas layout, owned by tldraw, ephemeral.
- Each tldraw shape carries the `canvas record` id it projects. Semantic
  mutations flow through MCP tools (Runtime validates per Issue 13); geometric
  mutations stay in tldraw and are not persisted as research data.

## Integration shape

- **Agent ↔ Runtime**: traditional MCP over stdio (Agent host spawns Runtime).
  Agent calls semantic MCP tools only — no raw `exec`, no separate geometry tool.
- **Designer ↔ Runtime**: the Web UI (HTTP REST + SSE) served by Runtime, viewed
  in any browser, ideally the Agent host's embedded browser. Designer actions
  become HTTP calls; Runtime pushes updates to the Web UI via SSE.
- Runtime is one process doing both: stdio MCP + HTTP Web UI (localhost,
  auto-port, startup-scoped session token in the Workbench URL).
- Ikran has **zero Figma contact**: Figma ingestion stays in the Agent host's
  Figma MCP; Runtime only stores the verbatim seed reference and validates the
  Agent's returned package schema.
