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
10. Design Browser writes stay open for the whole preparation. Direct edits
    and candidate/formalized switches are never disabled or rejected by
    Runtime, whether the command is pending, claimed, or mid-extraction —
    any control the designer can see must be operable, and there is no
    waiting window. Revision (2026-08-06): the original write gate (and its
    later 1-hour/24-hour liveness windows) was retired. It existed to
    protect extraction-owned source files, but in practice a wedged or
    reset durable command locked the designer out indefinitely, and the
    protection was redundant: designer writes already carry optimistic
    concurrency guards (`concurrent_source_changed`,
    `concurrent_edit_superseded`, `source_db_drift` — the losing write
    fails typed and the original bytes are restored), and Agent writes go
    through declaration + ingest + drift sync, so a genuine race degrades
    to a typed retryable failure or an LWW overwrite, never corrupt data.
    The accepted trade-off: when the designer writes mid-extraction, the
    conflict surfaces explicitly at finalize instead of being prevented —
    e.g. a designer edit appends its event id to the entry links, which
    the extraction claims do not cover, so the finalize audit fails with
    `entry_claim_lineage_mismatch` (or
    `formalized_claim_support_insufficient` for a designer-formalized
    entry) naming the affected entry. The agent reconciles (records a
    claim covering the designer's change, or the designer reverts) and
    finalize is retried.
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
