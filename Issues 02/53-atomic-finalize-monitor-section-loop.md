# 53 — Atomic Finalize-to-Monitor Section Loop

Status: ready-for-agent

## User Story

As an Agent that has finished preparing the Alignment Question Cards, I want to
enter answer monitoring as part of the same active path so that progress does
not depend on the model remembering to invoke a separate wait command.

## Description

Connect Question Card preparation finalization to the first section-delta wait
without an ordinary model decision boundary between them. After the Agent
analyzes a returned section, recording its plan delta also re-enters monitoring
for the next batch. This produces a continuous section-level loop for as long as
the same Agent turn and MCP transport remain active.

The ticket strengthens reliable entry into answer checking; it does not claim
that portable MCP can reverse-wake an Agent host after its turn has ended.

## Context and constraints

- The standard active path must not be “finalize, return success, then hope the
  model chooses to call wait.”
- Reuse the existing Workbench presence and rolling three-minute lease
  semantics.
- A section is analyzed once when it first becomes ready, then again only when
  a relevant semantic revision changes it.
- In-memory wake events are acceleration only; persisted revisions remain the
  correctness mechanism.
- The Workbench frontend remains unchanged.
- Host activation beyond an already-active turn remains out of scope.

## Acceptance criteria

- [ ] The advertised active preparation path enters the first answer monitor
      immediately after successful Question Card preparation finalization,
      without requiring a separate discretionary wait call.
- [ ] A section with unanswered Question Cards does not produce a ready batch.
- [ ] Completing all Question Cards in a section wakes the active monitor and
      returns one merged section delta promptly.
- [ ] Recording the resulting plan delta and acknowledging its revision enters
      the next monitor in the same advertised operation sequence.
- [ ] Editing an already-processed section produces a later delta for that
      section rather than silently preserving the old plan.
- [ ] A pending delta wins races with idle timeout in the same way a durable
      Agent command wins the existing adaptive-wait race.
- [ ] Idle, page disengagement, MCP cancellation, or host termination ends the
      active loop without advancing the processed revision or workflow.
- [ ] Missing an in-memory event still returns the persisted delta on the next
      bounded database recheck.
- [ ] Tool descriptions and next actions make the continuous sequence explicit
      without requiring the Agent to discover unrelated tools.
- [ ] A one-process vertical test proves Question preparation → active monitor →
      Workbench section submission → section delta → plan write → next monitor.

## Technical Notes

- A combined finalize-and-monitor surface and a combined
  record-plan-and-monitor surface are acceptable ways to remove model decision
  gaps; exact public names are not locked by this ticket.
- Preserve transport cancellation and lease cleanup so an interrupted host does
  not leave an in-memory waiter pretending to be active.

## Dependencies

- 51 — Alignment Semantic Revision and Section Delta Cursor.
- 52 — Attempt-Bound Incremental Initial Design System Plan.
