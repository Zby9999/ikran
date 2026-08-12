# Ikran

A local-first research workbench for recursive designer–Agent alignment around
designer-selected Figma seed references. The product surfaces as an HTTP Web UI
that can be opened in any browser, with the Agent desktop's embedded browser as
the ideal environment; a local Runtime daemon owns project state and semantic
records and talks to the Agent through traditional MCP.

## Language

**Ikran Runtime** (Runtime):
The local daemon: a traditional MCP server (stdio, to the Agent) **and** an HTTP
Web UI server (to the Agent desktop's embedded browser), plus SQLite state,
canonical events, prototype preview lifecycle, and schema validation. It is the
only writer of source-of-truth records. One process, two surfaces.
_Avoid_: server, backend, service

**Ikran Test Release**:
A versioned, allowlisted GitHub Release for external testing. It preserves
Runtime, Workbench, and MCP capability while excluding repository research
archives, local installation state, credentials, generated caches, and real
project data. The repository remains the complete development record; a Test
Release is the supported lightweight distribution boundary.
_Avoid_: source archive, repository snapshot, npm package

**Product Test Kit**:
The Test Release asset for a product tester: Runtime, Workbench, MCP, locked
dependency metadata, and setup and launch guidance. The Release Gate exercises
its minimal artifact smoke after clean extraction. It starts without project
state and does not contain the full contributor test corpus. Its first
supported platform is macOS on Apple silicon.
_Avoid_: demo data bundle, preinstalled checkout

**Contributor Verification Kit**:
The Test Release asset for a developer tester. It contains the Product Test Kit
capabilities plus the complete automated verification surface and deterministic
synthetic fixtures or local substitutes. It never relies on a real Figma
credential, real research data, or a contributor's existing machine state.
_Avoid_: development archive, full repository clone

**Release Gate**:
The acceptance boundary for an Ikran Test Release: type checking, unit tests,
end-to-end tests, and clean extraction followed by dependency installation,
build, Runtime/Workbench/MCP smoke verification, and cleanup must all pass on
the declared platform. An Agent host is described as **verified** only after a
host-native smoke test for that exact release; configuration without such a
test is experimental.
_Avoid_: CI succeeded (when only one part of the gate ran), historical host
validation

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

**Agent command**:
A durable, designer-authorized request for an Agent to perform a specific unit
of Ikran workflow work, created only by an explicit semantic action. An active
Agent may handle it immediately, and a supported Agent host may activate a turn
for it; otherwise it remains pending until a later Agent turn can resume it.
_Avoid_: injected prompt, transient UI event, Agent wake-up

**Agent orchestration control plane**:
The Ikran capability that tracks Agent commands and coordinates their execution
through an Agent host without owning the model or its approval loop.
_Avoid_: model runtime, Agent host, MCP server

**Agent host adapter**:
The host-specific bridge through which Ikran can start or resume an Agent turn
for a pending Agent command while leaving reasoning and approvals in the Agent
host.
_Avoid_: MCP tool, model provider, embedded Agent

**Agent host activation**:
A host-mediated start or resumption of an Agent turn for a pending Agent
command through an officially supported host interface. Whether a host can
preserve the intended conversation, tools, and approvals must be established
before Ikran relies on activation for that host.
_Avoid_: reverse prompt injection, MCP wake-up, headless replacement Agent

**Adaptive Agent wait**:
An active Agent turn waiting for the next explicit Agent command while
Workbench presence indicates that the designer is still engaged. Presence may
extend the wait, but it never substitutes for the designer action that advances
the workflow.
_Avoid_: infinite wait, idle-triggered progression, Agent host activation

**Rule Update Review**:
An explicitly published review identity that groups a complete set of pending
Rule Update proposals for designer decisions. Only an active Rule Update Review
wait scope may extend Adaptive Agent wait beyond Alignment; a post-Alignment
project phase alone never authorizes that wait. A later designer decision is
carried as a scoped durable Agent command and does not imply host activation.
The Review is drafted privately and then published as one complete batch; an
empty published batch is a terminal no-change review. Formalization cannot pass
while a managed Review from the current Consolidate cycle is incomplete.
_Avoid_: global post-Alignment wait, transient decision event, Agent wake-up

**Rule Update Proposal Revision**:
An immutable, directly reviewable version of one proposed Rule: complete title
and body, typed semantic category, exact authorized artifact paths, evidence
linkage, author, and the content digest frozen for every affected source. A
designer edit appends a revision without writing a Design System source or
publishing an Agent command. A decision always names one exact revision.
_Avoid_: mutable draft fields, live Rule edit, UI-only category string

**Rule Update Designer Decision**:
The direct Workbench or chat-compatibility Accept/Reject command for one exact
proposal revision. It atomically records the durable decision and publishes a
Rule Update-scoped Agent command. Accepted means waiting for Agent application;
only a validated artifact declaration means applied. Rejected is a terminal
no-write disposition retained in All interactions.
_Avoid_: confirmation dialog, Agent re-confirmation, accepted-as-applied

**Figma Connection**:
The designer-authorized, read-only connection that lets Runtime capture Figma
source evidence without requiring an active Agent. It is a Runtime ingestion
capability, distinct from the Agent host's Figma MCP access. MVP has one active
installation-scoped connection shared by local projects; credentials are not
project records or research data.
_Avoid_: Figma login, Agent Figma connection, token (when referring to the
product capability)

**Figma Connection Gate**:
The Workbench precondition requiring an active Figma Connection before the
canvas can be used. While the gate is closed, the connection panel is shown,
the canvas is locked, and a pasted Figma link is rejected without creating a
Seed Reference.
_Avoid_: pending Seed Reference, deferred capture

**Figma positional evidence**:
The Runtime-captured visual and spatial reference for a selected Figma source:
its canonical source identity, screenshot, and enough node identity/bounds data
to locate likely source nodes for a region. It deliberately excludes
implementation-level design detail. Runtime capture through the active Figma
Connection is its only active product source; an Agent does not declare or
supply this evidence.
_Avoid_: Figma context (too broad), implementation context

**Figma structural overlay**:
The Workbench projection that maps a Figma positional node index onto its
captured screenshot so semantic nodes can be hovered, highlighted, selected,
and used as annotation targets. Default selection favors Frame, Section,
Component, Instance, Text, Image, and meaningfully named Group nodes; low-level
Vector/Path nodes do not enter the default hit-test. `Tab` drills the current
hover target upward through selectable parents and clamps at the highest one;
moving the pointer resets to the deepest target at the new position. The canvas
does not render node name/type/breadcrumb chrome; Agents read that identity from
Runtime positional evidence and host Figma MCP. Hover and Tab selection are
ephemeral UI state, not research facts.
_Avoid_: sliced screenshot, persisted hover state

**Figma implementation context**:
The detailed source information an Agent retrieves on demand through the Agent
host's Figma MCP after positional evidence identifies the relevant node or
candidates. Runtime does not pre-ingest this context.
_Avoid_: positional evidence, Runtime Figma snapshot

**Figma Node Annotation**:
An annotation anchored to one explicit Figma `node_id` on one captured evidence
version. It remains attached to that historical version; refresh may show a
corresponding node on current evidence but never silently migrates the anchor.
_Avoid_: inferred Region Annotation, current-node annotation without an evidence
version

**Annotation target**:
The explicit semantic subject of an Annotation: a whole Evidence Surface, one
Figma node on one captured evidence version, or a free Region on one Evidence
Surface. Target browsing is ephemeral; the submitted target is Runtime-owned
research truth.
_Avoid_: selection (ephemeral), anchor (when the target kind matters)

**Stale Annotation**:
A historical Figma Node Annotation whose source node has no correspondence in
the current evidence version. It remains valid historical evidence, but the
Workbench must warn the designer that it is stale for the current design.
_Avoid_: invalid annotation, deleted annotation

**Ikran workbench**:
The HTTP Web UI served by Runtime: canvas, stage tabs, left question list, and
question cards. It can be opened in any browser, but the ideal environment is
the Agent host's embedded browser so chat, tool calls, file edits, and the
spatial workbench stay together. The Agent host's chat pane is where the agent
reasons/responds and where the designer clarifies; the workbench is the spatial,
structured surface. The designer may paste Figma seed references into the
workbench after the Figma Connection Gate is open; Runtime captures their
positional evidence without an active Agent.
_Avoid_: app, UI, front-end, MCP App (we do not use the MCP Apps inline-UI
extension)

**Seed Reference**:
A designer- or Agent-selected Figma source considered important enough to bring
into the project's alignment process. A project may contain any number of Seed
References, but one canonical Figma source identity (`file_key` + normalized
`node_id`) projects one Frame and one evidence lineage; repeated submission
through either Workbench paste or the Agent's semantic tool reuses it rather
than duplicating it. The original submitted URL is retained for display and
audit, while share-time and other non-identity query parameters do not affect
identity. All Seed References in a project are evidence of the same design
language and share one project-level Design Language Description; each may
additionally carry a Reference Note. A new Seed Reference, its initial
positional evidence, Evidence Surface, and success event are accepted
atomically; failed capture leaves no persistent Seed Reference or research
fact.
_Avoid_: project seed (when implying uniqueness), Agent-first Seed

**Design Language Description**:
The designer's single project-level description of the shared design language
represented by all Seed References in that project. Its absence does not block
Seed Reference capture or visualization, but it blocks entry into formal Design
Intent Alignment.
_Avoid_: per-reference intent, repeating the description on every Seed
Reference

**Alignment preparation**:
The transition from Seed Reference registration into Design Intent Alignment,
during which the Agent prepares the complete Question card set across all six
Alignment sections. Partial preparation is not yet an answerable Alignment.
_Avoid_: Alignment section, next Alignment phase, partial Alignment

**Alignment input snapshot**:
The immutable set of Seed References, captured evidence versions, Design
Language Description, and Reference Notes accepted when the designer enters
Alignment preparation. The resulting questions and Initial Design System share
this snapshot as their input boundary.
_Avoid_: live Seed Reference collection, current project state, latest evidence

**Alignment attempt**:
One pass from an Alignment input snapshot through preparation and designer
answering. Returning to Seed Reference registration abandons the attempt and
requires a new snapshot and Question card set; the abandoned history remains
auditable but is not part of the current Alignment or successful research case.
Designer completion makes the attempt immutable input to later workflow stages.
_Avoid_: Alignment phase, overwritten Alignment, deleted attempt

**Initial Design System preparation**:
The transition after completed Design Intent Alignment during which the Agent
turns the aligned Seed Reference evidence and final answers into the first
reviewable Design System. It begins even when the responsible Agent command is
still pending.
_Avoid_: Alignment completion, automatic Agent wake-up, Design System review

**Reference Note**:
An optional designer note explaining why a particular Seed Reference matters or
what aspect of the shared design language it demonstrates.
_Avoid_: Design Language Description, required seed intent

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
surfaces remain for audit and replay when retained. Re-pasting an existing Seed
Reference only reuses and focuses its Frame; only an explicit refresh captures
a new positional-evidence version in the same lineage. Node annotations remain
anchored to their captured version; if refresh cannot map their node to current
evidence, they become stale and require an explicit designer-facing warning.
_Avoid_: overwrite in place, latest row without lineage

**Region Annotation**:
A first-class persistent record anchored to a region of a specific Evidence
Surface. It never exists without a surface (`surfaceArtifactId` or
`surfaceNodeId` required). Anchor schemas: `figma-region`, `prototype-region`.
On the canvas it is a tldraw custom shape (styling fully controlled), but the
record itself is owned by Runtime. The persisted region is the **raw semantic
rect**; Agent display padding is recomputed in Workbench projection and is not
itself research truth. For a Figma region, Runtime may rank spatially
intersecting node candidates from positional evidence, but it does not infer a
semantic primary node; only the Agent may confirm `primaryNodeId` after
on-demand source inspection.
_Avoid_: box, selection, comment

**Question card**:
A canvas record carrying an agent observation, an agent question, a
conversation thread, an optional Agent **proposed answer**, a **final answer**,
and an **answer source**. The designer types or accepts the final answer on the
card; open clarification happens in the Agent host's chat pane. Empty questions
and empty final answers are rejected; short non-empty answers such as “同意/对”
are allowed. A proposed answer is only an editor prefill: the designer must
explicitly submit every card before it is answered or contributes to coverage.
_Avoid_: answer card (use Question card), card (used loosely)

**Agent Annotation / Question card preparation pair**:
Every Design Intent Alignment preparation attempt must contain both kinds of
records in every gate section before it can enter answering: first at least one
gray Agent Annotation for that section that states a meaningful confirmed
observation or reasonable Agent assumption, then 2–5 colored Question cards for
designer confirmation, before proceeding to the next section. Agent Annotations
and Question cards are attempt- and section-bound. An Agent must not hide an assumption
inside a question or present genuine uncertainty as an asserted annotation.
Agent Annotations do not count as answered questions or question coverage.

**Proposed answer / final answer / answer source**:
- **Proposed answer**: optional Agent-prefilled answer on the Question card. It
  does not answer the card and never contributes to coverage by itself.
- **Final answer**: the non-empty, explicitly submitted answer that satisfies
  the alignment gate.
- **Answer source**: how the final answer was established — for example Agent
  proposed / designer accepted (the designer submits an unmodified prefill)
  versus designer edited. Empty or merely proposed answers block completion;
  global Complete never promotes proposed answers.
_Avoid_: treating proposed and final as the same field without source

**Canvas record**:
A Runtime-owned source-of-truth record projected onto the canvas — Evidence
Surface, Annotation, question card, designer answer. The Agent and
designer submit *intent*; Runtime validates, assigns IDs, persists, and
projects.
_Avoid_: node, shape (those are canvas projections, not records)

**Geometry**:
Canvas positions, sizes, viewport, and layout. Owned by the canvas (tldraw),
explicitly **not** source of truth and **not** research data. Runtime may persist
project-local Workbench geometry as disposable UX state so Frames and camera
resume where the designer left them; it remains reconstructable, stays outside
canonical events and research export, and may be discarded without losing a
research fact. By contrast, semantic annotation replay uses the Runtime-owned
raw semantic region and its evidence anchor, so a successful Agent annotation
can be reconstructed without depending on saved canvas layout or display
padding.
_Avoid_: layout state (when meant as research truth), treating display padding
or canvas layout as the annotation fact

**Successful research case**:
A project that completes the successful recursion **eligibility** threshold:
Design System v1 → new prototype → feedback / confirmed rule update → Design
System v2 → a second new design. Only such projects may generate research
export. Once eligible, the export includes the **full successful semantic
lineage** of that project (including stages before the loop completed: seed,
evidence, annotation, alignment, DS v1, first prototype, etc.) — not only the
endpoint. Runtime records successful semantic facts throughout; the threshold
gates export eligibility, not whether early traces exist. Failed requests,
failed annotations, drafts, cancels, abandoned Alignment attempts, Open Gaps,
and canvas layout are not research facts for export (ops/debug logs may still
exist).
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
learns of them by declaration, not by mediating the write. One sanctioned
exception: the 09A candidate → formalized approval write-back (decision 5),
where Runtime writes the design-system source JSON itself — the only way to
keep the DB row and the source file in lockstep for the Browser's single write
operation.
_Avoid_: log, register, commit

## Source-of-truth split

- **Source of truth**: Canvas records (semantic), owned by Runtime, persisted to
  `.ikran` SQLite (records + canonical events in the same transactional boundary).
- **Not source of truth**: Geometry + canvas layout, owned by tldraw; optionally
  persisted as disposable project-local Workbench UX state.
- **Derived**: JSONL and research export packages rebuilt from canonical stores.
- Each tldraw shape carries the `canvas record` id it projects. Semantic
  mutations flow through MCP tools (Runtime validates per Issue 13); geometric
  mutations stay in tldraw and are not persisted as research data.

## Integration shape

- **Agent ↔ Runtime**: the Agent host spawns a transient stdio bridge. The bridge
  forwards JSON-RPC over a local owner-only socket and ensures the persistent
  Runtime is running; semantic MCP tools and the Workbench remain in that one
  Runtime process. Disconnecting one bridge releases an MCP lease, not the
  Runtime. Agent calls semantic MCP tools only — no raw `exec`, no separate
  geometry tool.
- **Designer ↔ Runtime**: the Web UI (HTTP REST + SSE) served by Runtime, viewed
  in any browser, ideally the Agent host's embedded browser. Designer actions
  become HTTP calls; Runtime pushes updates to the Web UI via SSE.
- Runtime is one persistent process doing both: semantic MCP + HTTP Web UI (localhost,
  auto-port, startup-scoped session token in the Workbench URL), sharing one
  command kernel across the two surfaces.
- Runtime uses the designer's **Figma Connection** only to capture Figma
  positional evidence and project an immediately visible Evidence Surface.
  Implementation-level Figma context remains on-demand in the Agent host's
  Figma MCP.
