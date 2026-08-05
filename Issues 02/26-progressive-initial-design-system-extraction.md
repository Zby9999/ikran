# 26 — Progressive Initial Design System Extraction

Status: in-progress

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
    preparation completes.
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
- [ ] Typecheck, full Vitest, relevant Playwright, and a fresh real-Agent smoke
      pass.

## Real Agent validation

Create an isolated temporary project with empty Ikran state. Use this Seed:

`https://www.figma.com/design/CdsfpEJNybQW1gWMUeLRdK/Untitled?node-id=1-133&t=7s5ftlcKDAGQsfmW-11`

The test Agent must complete the full Initial Design System extraction through
work-unit recording, residual audit, artifact declaration, and finalize without
manual manifest construction help. The test must not modify the main project's
Ikran state or workflow.
