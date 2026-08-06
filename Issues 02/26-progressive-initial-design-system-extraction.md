# 26 — Progressive Initial Design System Extraction

Status: resolved

## Problem

09B requires one complete extraction manifest before an Agent may finish the
Initial Design System. A real Agent can discover and understand the complete
Alignment snapshot and source contract, yet stall before the first manifest
call because it must pre-plan every artifact, entry id, and JSON pointer in one
atomic payload.

The old manifest also overloads `section`: source records must come from that
Alignment section and targets must resolve to the matching Design System
section. This contradicts the current source contract. For example,
component-bound behavior discovered in Interaction belongs in a component
spec's `stateMatrix`.

## Locked decisions

1. Claiming preparation hydrates the complete immutable Alignment context.
2. The Agent authors progressively by output work unit, never by Alignment
   section:
   - `global`
   - `tokens`
   - `layout`
   - `interaction`
   - one `component:<entry-id>` unit per component
3. A component work unit owns its inventory entry, component spec, and declared
   source captures as one checkpoint.
4. Evidence may cross Alignment sections. Runtime derives source sections from
   record ids and output placement from targets; the Agent does not submit a
   shared `section` field.
5. Runtime derives JSON pointers from stable artifact path + entry id. Optional
   field paths may identify an explicitly omitted component field.
6. A source record may support claims in multiple work units. One claim belongs
   to one output work unit.
7. Before finalize, a work unit may be replaced idempotently; coverage and
   targets are recalculated from the current version. If a component is
   removed or renamed, its obsolete work unit may be explicitly retired.
8. A final residual audit consumes or explicitly classifies every remaining
   Question card, Agent Annotation, and Designer Annotation.
9. The global completeness gate remains atomic at finalize.
10. While Initial Design System preparation is pending or claimed, Design
    Browser content may be read but direct edits and candidate/formalized
    switches are disabled and rejected by Runtime. Writes reopen after
    preparation completes. Liveness refinement (2026-08-06): the durable
    command has no timeout, and an interrupted extraction used to lock
    designer writes forever — migration v22 made this worse by resetting a
    previously completed command back to pending with a fresh updated_at.
    The gate now distinguishes the two stages. A pending (never-claimed)
    command writes nothing, so it only holds the gate for a 1-hour claim
    grace; past that it was abandoned before it started. A claimed command
    blocks while its latest activity — either a command-row update or an
    extraction manifest write — is within 24 hours; past that it is an
    interrupted run and stops blocking. In both cases the command itself
    keeps its status so the agent can still claim/re-claim and resume, and
    a fresh claim re-locks the gate.
11. No compatibility or migration of old extraction manifests or test data.
    The prototype is re-extracted from a fresh project after implementation.

## Runtime and MCP contract

### `claim_initial_design_system_preparation`

Returns the complete frozen snapshot, source contract, declared artifacts,
recorded work units, residual audit, and deterministic progress including
consumed and remaining source record ids. Re-claim is the recovery path after
context compaction or Agent restart.

### `record_design_system_extraction_work_unit`

Records or replaces one attempt-bound work unit. The corresponding artifacts
must already be declared and ingested. Runtime validates source membership,
confidence, work-unit target ownership, component inventory/spec pairing, and
target existence. The response includes resolved JSON pointers and updated
global progress. An obsolete component unit is retired with `retire: true` and
an empty claim list; this also invalidates the previous residual audit.

### `record_design_system_extraction_audit`

Records final residual `omitted` / `conflict` claims plus the global audit.
Every frozen input record must then be consumed. Audit claim ids must exactly
cover all work-unit and residual claims.

### `finalize_initial_design_system_preparation`

Requires the four singleton work units, residual audit, required ingested
artifacts, component pairing, target resolution, bidirectional lineage,
complete source/entry coverage, status eligibility, and no unresolved
conflicts. Successful finalize completes the durable command and enables
Browser writes.

## Acceptance criteria

- [x] Claim/re-claim returns the complete frozen context and progressive state.
- [x] A work unit may cite records from multiple Alignment sections.
- [x] Replacing or retiring one work unit preserves other units and recomputes
      progress.
- [x] Runtime, not the Agent, derives JSON pointers.
- [x] Component inventory + spec are validated as one work unit.
- [x] Residual audit reports exact unconsumed ids and gates finalize.
- [x] Finalize retains 09B reverse entry coverage and lineage guarantees.
- [x] Browser reads remain available while preparation is active, but HTTP and
      Runtime write paths reject edit/approval until completion.
- [x] MCP schemas expose exact enums and discriminated work-unit shapes.
- [x] No old atomic-manifest tool remains in the advertised MCP surface.
- [x] Typecheck, full Vitest, relevant Playwright, and a fresh real-Agent smoke
      pass.

## Real Agent validation

Create an isolated temporary project with empty Ikran state. Use this Seed:

`https://www.figma.com/design/CdsfpEJNybQW1gWMUeLRdK/Untitled?node-id=1-133&t=7s5ftlcKDAGQsfmW-11`

The test Agent must complete the full Initial Design System extraction through
work-unit recording, residual audit, artifact declaration, and finalize without
manual manifest construction help. The test must not modify the main project's
Ikran state or workflow.

### Result — 2026-08-05

PASS on commit `1c1efc1`. A first isolated run exposed that a top-level Zod
union advertised an empty MCP input schema even though raw calls worked. The
schema was changed to an advertised top-level object and the entire flow was
rerun from a second empty project and state directory.

- MCP `listTools` exposed every work-unit field, variant, outcome, and target.
- One claim returned all 12 answered Question cards, 6 Agent Annotations, the
  complete Seed/evidence snapshot, and the source contract before any artifact
  was written.
- Seven artifacts ingested without diagnostics; all six work units recorded on
  their first version.
- The audit checked 18 claims with no residual claims or issues, and finalize
  completed with `readyToFinalize=true`.
- Browser content remained readable and non-editable while pending/claimed;
  after finalize, an edit and Candidate-to-Formalized transition both worked.
- The test worktree finished clean and only the isolated Runtime was stopped.

Preserved evidence:

- Project: `/tmp/ikran-issue26-retest-project.k8b86f`
- State and summary: `/tmp/ikran-issue26-retest-state.11jcxn`
- Summary file: `/tmp/ikran-issue26-retest-state.11jcxn/acceptance-summary.json`
