# Runtime-projected Initial Design System semantic commit

The Initial Design System fast path is a second explicit exception to the
normal Source Artifact write boundary. The Agent remains the semantic author:
it submits one evidence-linked Design System bundle, or a hidden incremental
plan containing the same semantic bundle. Runtime validates that bundle against
the frozen Alignment input, then deterministically projects canonical Design
System JSON, source lineage, extraction work units, residual coverage, and the
global audit before advancing to Draft.

Runtime may write and declare those Initial Design System source files only
inside this atomic commit operation. The exception does not permit Runtime to
invent semantic decisions, edit prototype code, perform later Agent-authored
Rule Updates, or become a general Source Artifact writer. The ordinary path
continues to be Agent-host file editing followed by an Ikran declaration.

## Considered options

- **Keep every mechanical file write and declaration as a separate Agent
  action.** This preserves the original boundary literally, but repeats
  deterministic bookkeeping after the Agent has already made the semantic
  decisions and accounts for most of the observed Alignment-to-Draft latency.
- **Return a projected bundle for the Agent host to write and declare.** This
  keeps file ownership nominally outside Runtime, but still requires a long,
  failure-prone sequence of host edits and MCP calls and cannot make the commit
  atomic across artifacts, lineage, audit, and phase.
- **Let Runtime infer the Design System from answers.** Rejected: semantic
  attribution, ownership, reuse scope, and omission remain Agent decisions.

## Consequences

- Initial Draft creation becomes one transactional semantic boundary instead
  of a progressive mechanical tool loop.
- Runtime validation and canonical projection are deterministic; semantic
  quality remains attributable to the Agent-supplied bundle and its source
  references.
- Failed validation produces no partial Draft eligibility. The existing
  artifact, lineage, coverage, and audit gates remain authoritative.
- Later Source Artifact changes still use the normal Agent-write/declare path,
  except for the separately approved Browser approval/edit write-backs.
