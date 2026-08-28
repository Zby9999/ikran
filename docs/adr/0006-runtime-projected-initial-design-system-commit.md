# Runtime-projected Initial Design System semantic commit

The Initial Design System fast path is a second explicit exception to the
normal Source Artifact write boundary. The Agent remains the semantic author:
it submits one evidence-linked Design System bundle, or a hidden incremental
plan containing the same semantic bundle. Runtime validates that bundle against
the frozen Alignment input, then deterministically projects canonical Design
System JSON, source lineage, extraction work units, residual coverage, and the
global audit through one idempotent, phase-gated operation before advancing to
Draft.

Runtime may write and declare those Initial Design System source files only
inside this resumable semantic commit operation. The exception does not permit
Runtime to invent semantic decisions, edit prototype code, perform later
Agent-authored Rule Updates, or become a general Source Artifact writer. The
ordinary path continues to be Agent-host file editing followed by an Ikran
declaration.

Every frozen Alignment source must therefore be explicitly mapped to an output
or disposed by an Agent-authored omission with a reason. Runtime does not create
residual semantic judgments. An intentionally empty tokens, layout,
interaction, or components category likewise carries its own evidence-linked
Agent omission so the required empty artifact remains traceable. Foundation
domain rules (including Color rules) are first-class semantic input rather
than being flattened into tokens; evidence-backed Typography roles are
semantic/component composite tokens rather than primitive bundles. Each role
names one stable job and carries one scalar `fontSize`; scales and step
collections remain atomic construction facts unless evidence maps their
individual values to distinct roles.

The compact Q/A/D source map is semantic input, so the claim tool returns it in
model-visible text as well as structured content. A host that does not expose
structured content must still receive every short ref, section, and statement;
otherwise the Agent would be forced to guess lineage from ordering. Incremental
Draft preflight reuses the final Token usage-field contract and reports all
field mismatches before projection, instead of discovering them one at a time
during commit.

## Considered options

- **Keep every mechanical file write and declaration as a separate Agent
  action.** This preserves the original boundary literally, but repeats
  deterministic bookkeeping after the Agent has already made the semantic
  decisions and accounts for most of the observed Alignment-to-Draft latency.
- **Return a projected bundle for the Agent host to write and declare.** This
  keeps file ownership nominally outside Runtime, but still requires a long,
  failure-prone sequence of host edits and MCP calls and cannot keep recovery
  inside one idempotent Runtime operation.
- **Let Runtime infer the Design System from answers.** Rejected: semantic
  attribution, ownership, reuse scope, and omission remain Agent decisions.

## Consequences

- Initial Draft creation becomes one resumable semantic operation instead of a
  progressive mechanical tool loop.
- Runtime validation and canonical projection are deterministic; semantic
  quality remains attributable to the Agent-supplied bundle and its source
  references.
- A later-stage failure may leave already-written files or records in
  preparation state, but it produces no partial Draft eligibility. Runtime
  records the failed request and its projected paths. Repeating the same
  request restarts it deterministically; a corrected request uses a new
  idempotency key and first removes only Runtime-owned projection remnants.
- Final command completion, replayable semantic response, and phase advance
  share one transaction, so a process interruption cannot create a Draft that
  has no replayable commit result.
- Later Source Artifact changes still use the normal Agent-write/declare path,
  except for the separately approved Browser approval/edit write-backs.
