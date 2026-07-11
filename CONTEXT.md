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
canonical events, prototype preview lifecycle, and schema validation. It is the
only writer of source-of-truth records. One process, two surfaces.
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
structured surface. The workbench has **no** seed URL / intent write entry.
_Avoid_: app, UI, front-end, MCP App (we do not use the MCP Apps inline-UI
extension)

**Agent-first Seed**:
Seed registration is performed only by the Agent (Figma seed identity + original
design intent). The Workbench does not provide a URL/intent write path for
seeds; the designer reviews projections, annotations, answers, and confirmations
in the Workbench after the Agent has registered the seed.
_Avoid_: dual seed entry, UI seed form (as a product write path)

**Evidence Surface**:
A canvas object that presents evidence a designer and Agent reason over.
Two kinds: **Figma Evidence Surface** (a Figma visual surface) and
**Prototype Evidence Surface** (a live, interactive prototype iframe — rendered
via tldraw's embed shape).
_Avoid_: panel, viewer

**Evidence lineage / current**:
Evidence packages are append-only. A newer surface may supersede an older one;
**current** evidence is the active surface identified by that lineage, not
“whatever was written last” without an explicit relationship. Historical
surfaces remain for audit and replay when retained.
_Avoid_: overwrite in place, latest row without lineage

**Region Annotation**:
A first-class persistent record anchored to a region of a specific Evidence
Surface. It never exists without a surface (`surfaceArtifactId` or
`surfaceNodeId` required). Anchor schemas: `figma-region`, `prototype-region`.
On the canvas it is a tldraw custom shape (styling fully controlled), but the
record itself is owned by Runtime. The persisted region is the **raw semantic
rect**; Agent display padding is recomputed in Workbench projection and is not
itself research truth.
_Avoid_: box, selection, comment

**Question card**:
A canvas record carrying an agent observation, an agent question, a
conversation thread, an optional Agent **proposed answer**, a **final answer**,
and an **answer source**. The designer types or accepts the final answer on the
card; open clarification happens in the Agent host's chat pane. Empty questions
and empty final answers are rejected; short non-empty answers such as “同意/对”
are allowed.
_Avoid_: answer card (use Question card), card (used loosely)

**Proposed answer / final answer / answer source**:
- **Proposed answer**: optional Agent-prefilled answer on the Question card.
- **Final answer**: the non-empty answer that satisfies the alignment gate.
- **Answer source**: how the final answer was established — for example Agent
  proposed / designer accepted (stage “accept and continue” with unmodified
  prefills) versus designer edited. Empty remaining answers block continue.
_Avoid_: treating proposed and final as the same field without source

**Canvas record**:
A Runtime-owned source-of-truth record projected onto the canvas — Evidence
Surface, Region Annotation, question card, designer answer. The Agent and
designer submit *intent*; Runtime validates, assigns IDs, persists, and
projects.
_Avoid_: node, shape (those are canvas projections, not records)

**Geometry**:
Canvas positions, sizes, viewport, and layout. Owned by the canvas (tldraw),
explicitly **not** source of truth and **not** research data. Lost/reconstructed
freely. Does not enter research export. By contrast, semantic annotation replay
uses the Runtime-owned raw semantic region and its evidence anchor, so a
successful Agent annotation can be reconstructed without depending on
ephemeral canvas layout or display padding.
_Avoid_: layout state (when meant as persistent truth), treating display
padding or canvas layout as the annotation fact

**Successful research case**:
A project that completes the successful recursion **eligibility** threshold:
Design System v1 → new prototype → feedback / confirmed rule update → Design
System v2 → a second new design. Only such projects may generate research
export. Once eligible, the export includes the **full successful semantic
lineage** of that project (including stages before the loop completed: seed,
evidence, annotation, alignment, DS v1, first prototype, etc.) — not only the
endpoint. Runtime records successful semantic facts throughout; the threshold
gates export eligibility, not whether early traces exist. Failed requests,
failed annotations, drafts, cancels, Open Gaps, and canvas layout are not
research facts for export (ops/debug logs may still exist).
_Avoid_: exporting every project folder as a research case; treating the
threshold as “discard pre-completion successful traces”

**Source artifact**:
A source-of-truth project file written by the agent through the Agent host's
native file editing — design-system markdown, `token.json`, component specs,
prototype code. The agent *declares* each write via an Ikran tool.
_Avoid_: source file (when meant as this concept), generated file

**Derived artifact**:
A file Runtime generates from source artifacts — `design-system-view.json`,
research export packages, and rebuildable event exports. Runtime is the only
writer of derived artifacts.
_Avoid_: generated file, output, view (when meant as the file)

**JSONL derived export**:
JSONL event files are a rebuildable **derived export** of canonical SQLite
events, not a second source of truth. Research packages may include JSONL for
analysis outside Ikran.
_Avoid_: treating JSONL as the live canonical store

**Declare**:
The agent calling an Ikran tool after writing a source artifact, so Runtime
records the semantic event, validates the output (one-pass repair per Issue 13),
and generates derived artifacts. File writes happen via the Agent host; Runtime
learns of them by declaration, not by mediating the write.
_Avoid_: log, register, commit

## Source-of-truth split

- **Source of truth**: Canvas records (semantic), owned by Runtime, persisted to
  `.ikran` SQLite (records + canonical events in the same transactional boundary).
- **Not source of truth**: Geometry + canvas layout, owned by tldraw, ephemeral.
- **Derived**: JSONL and research export packages rebuilt from canonical stores.
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
  auto-port, startup-scoped session token in the Workbench URL), sharing one
  command kernel across the two surfaces.
- Ikran has **zero Figma contact**: Figma ingestion stays in the Agent host's
  Figma MCP; Runtime stores canonical seed identity and validates the Agent's
  returned package schema.
