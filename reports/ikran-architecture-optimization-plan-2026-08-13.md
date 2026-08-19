# Ikran Architecture Optimization Plan — Draft

Status: draft for designer selection. This plan was produced from the R01–R05 production smoke, `CONTEXT.md`, accepted ADRs, current implementation hot spots, and the explicitly requested `improve-codebase-architecture` review. It proposes architecture directions only; it does not define concrete interfaces and it does not authorize implementation.

## Outcome first

Ikran's main architecture problem is not simply large files. Several important modules are shallow: their interfaces require callers and Agents to understand implementation details such as hidden enum literals, exact JSON envelopes, UUID linkage, stage ordering, later finalization checks, `IKRAN_STATE_DIR`, preview ownership, and which run/version/surface is authoritative.

The desired direction is to move those decisions into a small number of deep modules with narrow interfaces and high leverage:

1. contain Runtime/project ownership first;
2. make one Claim Evaluator authoritative for Design System preparation;
3. unify frozen Alignment evidence and provenance semantics;
4. isolate every Prototype/new-design run around an immutable Design System snapshot;
5. only then consolidate Design System source-change consistency.

## Prioritization

| Phase | Candidate module | Priority reason | Strength |
|---|---|---|---|
| P0 | Runtime Workspace Ownership | Prevent two writable Runtime control planes and wrong-project scope expansion | Strong |
| P1 | Initial Design System Claim Evaluator | Fix release-blocking audit/finalize divergence and impossible provenance closures | Strong — top architecture recommendation |
| P2 | Frozen Alignment Evidence & Provenance | Make local evidence, target scope, enums and provenance executable rather than Prompt conventions | Strong |
| P3 | Prototype Design Run | Enforce new-design read scope, immutable run lineage and render-ready confirmation | Strong |
| P4 | Design System Source Change Cycle | Consolidate repeated filesystem/SQLite consistency paths after semantics stabilize | Worth exploring |

## P0 — Runtime Workspace Ownership module

### Files in scope

- `bin/ikran-mcp.mjs`
- `lib/runtime/runtime-endpoint.mjs`
- `lib/runtime/paths.ts`
- `lib/runtime/project.ts`
- `lib/mcp/project-workspace-tools.ts`

### Problem

Runtime selection and project ownership are currently spread across environment variables, state directories, sockets, start locks, bind locks, active-project pointers and project-local SQLite. A different `IKRAN_STATE_DIR` creates a separate ownership universe. R03/R04 proved that an Agent can first bind an ancestor workspace and then launch a second Runtime for the desired child project, leaving MCP and Workbench attached to different DBs.

This interface is shallow because CLI, MCP, Workbench and the Agent must all understand lifecycle implementation and recovery ordering.

### Architecture direction

Create a deep Runtime Workspace Ownership module that owns canonical workspace identity, Runtime identity, active project, bind/switch/restart/cleanup, and the single-writer invariant. Socket, filesystem and SQLite become internal adapters. CLI, MCP and Workbench depend on one high-level interface and compare the same non-secret Runtime/project identity.

### Benefits

- Locality: ownership conflicts and recovery logic live in one module.
- Leverage: every host and surface inherits the same invariant.
- Prevents workspace mismatch before any project-local write.
- Makes “one Runtime, two surfaces” testable as one contract instead of several scripts.

### Before / after

```text
Before
host config -> stateDir A -> Runtime A -> project pointer X
manual recovery -> stateDir B -> Runtime B -> project pointer Y
MCP and Workbench can continue against different writers

After
CLI / MCP / Workbench adapters
             |
Runtime Workspace Ownership module
             |
one Runtime lifecycle + one active canonical project + internal DB/socket adapters
```

### First regression set

- Explicit ancestor, sibling or unrelated path is rejected when `IKRAN_CWD`/Roots identify a workspace; no files or active pointer are written.
- Canonical symlink aliases of the exact workspace pass; ancestors through a symlink fail.
- Two state directories cannot both become writers for one canonical project.
- Workbench and MCP must present the same Runtime/project identity before any semantic operation.
- Recovery atomically reconnects the existing transport instead of instructing the Agent to start another Runtime.

## P1 — Initial Design System Claim Evaluator module

### Files in scope

- `lib/runtime/initial-design-system-preparation.ts`
- `lib/runtime/design-system-status.ts`
- `lib/runtime/design-system-schema.ts`
- `lib/runtime/design-system-ingest.ts`
- `lib/runtime/commands/schemas.ts`

### Problem

Preparation progress, ingest status, Agent audit and finalization apply overlapping but different policies. `readyToFinalize` can be true before finalization checks reverse lineage, Formalized support, captures, component completeness, or cross-file relationships. R04B showed both a deterministic false-ready result and a Formalized entry whose `reasonable` Annotation can be represented in no legal manifest form.

R05 added another symptom: the Agent spent minutes reading source and tests to discover the artifact/work-unit schema, then copied UUIDs manually. One typo entered a Candidate entry because status evaluation required only some valid links; later finalization became the first strict bidirectional check.

### Architecture direction

Create one deep Claim Evaluator module that accepts frozen Alignment input, work units, source index and current entry envelopes, and authoritatively computes:

- atomic claim coverage;
- confidence and evidence authority;
- target-entry lineage;
- Candidate/Formalized/Gap eligibility;
- artifact, capture and component-spec readiness;
- exact typed blockers.

Progress, audit acceptance, declaration/ingest readiness and finalization must project the same evaluation. The implementation may be internally decomposed, but callers see one narrow semantic interface.

### Benefits

- Removes hidden post-audit gates.
- Gives the highest-churn semantic area strong locality.
- Makes “audit passed + ready” meaningful.
- Stops malformed or unsatisfiable entry provenance before it becomes ingested state.
- Provides a stable semantic foundation for Rule Update and new-design generation.

### Before / after

```text
Before
work units -> partial progress evaluator -> ready
source artifact -> separate status evaluator -> ingested
manifest + DB -> larger finalizer policy -> reject

After
frozen input + work units + source index
                  |
          Claim Evaluator module
           /        |         \
      progress    audit     finalize
        (the same authoritative evaluation)
```

### First regression set

- Without concurrent mutation, `audit passed + readyToFinalize=true` implies immediate finalization succeeds.
- A Formalized entry supported by a `reasonable` source fails early with an exact typed blocker or models that source as non-authoritative context.
- Every non-Gap link is known, current and semantically allowed; “one valid plus one unknown” fails.
- Each final-answer clause is independently mapped, deferred or explicitly omitted; one card ID cannot launder an unrelated clause.
- Confirmed semantic roles can coexist with parameter Gaps instead of demoting the entire entry to Gap.
- Cross-file token links, component inventory/spec identity and captures are evaluated in the same readiness result.

## P2 — Frozen Alignment Evidence & Provenance module

### Files in scope

- `lib/runtime/alignment-preparation.ts`
- `lib/runtime/alignment-agent-command.ts`
- `lib/runtime/design-intent-alignment.ts`
- `lib/mcp/design-intent-alignment-tools.ts`
- `lib/mcp/seed-evidence-tools.ts`
- `components/workbench/structural-overlay.ts`

### Problem

Runtime already owns screenshot and positional evidence, but the Alignment read interface exposes mostly identity and timestamps. Agents therefore use host Figma reads, memory, or Designer Annotation text. At the same time, Workbench hit-testing favors the deepest/smallest node, so a statement about an entire navigation can be persisted on a tiny `01` leaf. The schema exposes `inference` as a free string while implementation accepts hidden literals. Designer text can also be restated as an independent `confirmed` Agent observation.

The module is shallow because geometry, source type, target scope, inference authority and model-visible contract are evaluated in different places or only described in Prompt text.

### Architecture direction

Create a deep Frozen Alignment Evidence & Provenance module that owns:

- frozen evidence-version resolution;
- a model-readable projection of Runtime-owned positional evidence and safe visual crops;
- target granularity and multi-target scope;
- author, provenance and confidence semantics;
- a versioned, executable authoring contract with precise enums and safe diagnostics.

Host Figma remains an implementation-context adapter for details not intentionally ingested by Runtime. It must not silently replace frozen evidence during Runtime-first Alignment.

### Benefits

- High locality for annotation correctness and provenance.
- Same target semantics across hover, Designer Annotation, Agent Annotation and Question cards.
- Eliminates source-code archaeology for enums and payload shapes.
- Prevents whole-surface, tiny-leaf and relational-claim scope mismatches deterministically.
- Stops Designer direction from being double-counted as independent Agent confirmation.

### First regression set

- Node, region and surface targets have explicit scope policies; a root/near-full node cannot masquerade as a bounded Annotation.
- A body describing two regions requires a target set covering both or is rejected.
- Pointer selection does not silently shrink a Designer's intended parent region to a negligible leaf; parent traversal is visible and deterministic.
- `inference` schema, tool description and failure response all expose the exact same literals.
- A semantically duplicative Agent `confirmed` statement over a Designer Annotation is rejected or retains explicit derived provenance.
- Natural vague-prompt Alignment completes with zero host-Figma calls using only frozen Runtime evidence.

## P3 — Prototype Design Run module

### Files in scope

- `lib/runtime/new-design-run.ts`
- `lib/runtime/prototype-surface.ts`
- `lib/runtime/project-phase.ts`
- `lib/runtime/conversation-reconciliation.ts`
- `lib/runtime/consolidate-review.ts`
- `lib/runtime/source-artifact.ts`
- `lib/runtime/prototype-rebuild-context.ts`

### Problem

The Runtime returns a clean Design System context packet, but the Agent's filesystem still exposes old Prototype code/assets, Design System sources and `.ikran`. R03 proved that old brand values and a financial claim were copied into a supposedly packet-only new design. R05 independently reproduced the same boundary failure in a sterile Luna task: after the exact five-field packet, the Agent read old Prototype/Design System files and reused a packet-external font, palette, local 6px value and rejected numbered chapter-model concept. Candidate use is voluntary, run roots are mutable/shared, code digests can be absent, the Design System version hashes unrelated artifacts, preview can overwrite a run version, and confirmation/reconciliation do not consistently bind one explicit run/surface/artifact snapshot.

The interface is shallow because callers must assemble and preserve run identity across several independent functions.

### Architecture direction

Create a deep Prototype Design Run module that owns:

- an immutable run-start Design System entry snapshot and priority contract;
- the exact allowed reading scope and excluded categories;
- a run-scoped generation workspace containing only the immutable packet, authorized assets/scaffolding and an empty output root;
- automatically recorded Candidate dependencies and Gap dispositions;
- complete artifact graph/digests;
- render health, surface readiness and explicit confirmation;
- transcript reconciliation and Rule Update lineage bound to that run;
- immutable Design System version semantics based only on Design System state.

The preview supervisor remains an internal adapter.

### Benefits

- Makes the user's required Design System reading range enforceable rather than observable only in traces.
- Prevents old Figma/prototype/chat facts from entering new designs.
- Provides locality for run, artifact, surface, confirmation and reconciliation membership.
- Makes historical runs replayable and exportable without resolving to newer mutable files.
- Gives Candidate and Gap use deterministic provenance.

### First regression set

- Sentinels in old Prototype files/assets/DB—including font family, exact local value and rejected rule concept—are unreadable and absent from trace/output.
- The generation Agent's first and only design-bearing input before writing is the frozen packet.
- Candidate reads automatically record run→artifact→entry dependencies; empty voluntary arrays cannot hide use.
- Gap values cannot become executable values without an explicit new decision.
- Two runs have different roots and immutable artifact hashes; the second cannot overwrite the first.
- Main document must be 2xx HTML; fatal JS/resource/empty mount/blank visual/screenshot failure prevents `ready` and Prototype confirmation.
- Confirmation and reconciliation name one exact ready, non-stale run/surface/artifact snapshot.

## P4 — Design System Source Change Cycle module

### Files in scope

- `lib/runtime/design-system-sync.ts`
- `lib/runtime/design-system-edit.ts`
- `lib/runtime/design-system-approval.ts`
- `lib/runtime/project-phase.ts`
- `lib/runtime/rule-update-review.ts`
- `lib/runtime/rule-update-apply.ts`
- `lib/runtime/source-artifact.ts`
- `lib/mcp/rule-update-tools.ts`

### Problem

Designer edit, approval, synchronization, formalization and Rule Update each implement variants of base-digest validation, compare-and-swap, filesystem write, rollback, SQLite transaction, events and ingest. The Agent also must understand create/draft/revise/publish/decide/claim/retry/apply ordering. R01–R03 showed accepted updates that cannot legally declare provenance, proposals without stable entry identity, ambiguous logical entry promotion and disk drift after a safely failed declaration.

### Architecture direction

After Claim Evaluator semantics are stable, create a deep Design System Source Change Cycle module that owns mutation authorization and filesystem/SQLite consistency across:

- host-native Agent write + declaration;
- Designer direct rule editing;
- Candidate promotion;
- accepted Rule Update application;
- finalization/formalization.

These product intents remain distinct, but share one consistency implementation and typed semantic-diff validation.

### Benefits

- High locality for source/DB consistency failures.
- Prevents accepted revision scope from degrading into broad same-file write authority.
- Eliminates duplicated rollback and event/digest logic.
- Reduces lifecycle sequencing exposed to the Agent.
- Makes rejection and failed application reliably zero-write or explicitly recoverable.

### First regression set

- Every `new` proposal freezes entry identity, destination, semantic payload and allowed typed diff before publication.
- Update/move apply only the approved entry diff; collateral mutations fail.
- Accepted feedback provenance supports the exact new/updated entry without borrowing unrelated Alignment IDs.
- Rule Update remains waiting until claimed write and validated declaration; reject is terminal zero-write.
- Failed declaration cannot leave silent disk drift; recovery is explicit and digest-bound.
- Duplicate logical component inventory/spec identities cannot be promoted ambiguously.

## Cross-cutting delivery rules

### Tool self-description

Each Agent-facing interface must be executable from its own versioned contract:

- exact enum literals;
- full top-level schema or canonical minimal scaffold;
- allowed work-unit kinds and rich field paths;
- safe structured diagnostics repeated in model-visible text;
- no need to read `tests/`, `workflow/`, old artifacts or implementation source to recover.

### Security and secrets

- Authentication material never enters generic success envelopes, domain schemas, events, transcripts, screenshots or export.
- Only `open_workbench` returns the startup-scoped URL.
- Domain session IDs are non-secret Runtime/host-generated handles.
- Export applies defense-in-depth secret scanning/redaction.

### Test shape

For each module, add:

1. a pure evaluator/unit layer for local invariants;
2. a real Runtime integration fixture for filesystem/SQLite/process behavior;
3. a natural vague-prompt Luna smoke trace for Agent usability;
4. explicit failure/no-mutation assertions;
5. a Browser projection check when the state is designer-visible.

## Recommended first exploration

The best first architecture exploration is **Initial Design System Claim Evaluator** because it addresses confirmed release blockers, sits in the highest-change semantic area, and supplies the stable claim/status/lineage vocabulary needed by later Rule Update and Prototype work.

Production containment for **Runtime Workspace Ownership** should still ship first as a smaller P0 safety track.

The next step after designer selection is domain modeling for the chosen candidate, followed by interface design and a red-first implementation plan. This document intentionally stops before concrete interface definitions.
