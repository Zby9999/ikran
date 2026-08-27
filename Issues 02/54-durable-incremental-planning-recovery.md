# 54 — Durable Incremental Planning Recovery

Status: ready-for-agent

## User Story

As an Agent whose monitoring turn was interrupted, I want to resume the current
Alignment's answer checking from one simple user prompt so that completed
planning is preserved and unprocessed answers are not lost.

## Description

Persist an Incremental Planning checkpoint and expose a direct resume contract.
The resume path reloads the current attempt, plan version, acknowledged cursor,
unprocessed backlog, and next required action. It must recover whether the
interruption occurred before a delta was delivered, after delivery but before
plan persistence, or after persistence but before the next wait began.

The intended human recovery instruction is:

`打开 Ikran，恢复当前 Alignment 的答案检查。`

## Context and constraints

- Recovery must not depend on the previous in-memory lease or MCP connection.
- The user should not need to provide an attempt id, revision, cursor, or
  command id.
- The frontend remains unchanged and does not expose the checkpoint.
- Existing durable Initial Design System command fallback remains available.
- Recovery after Complete must converge on Draft preparation rather than reopen
  an immutable Alignment.

## Acceptance criteria

- [ ] The durable checkpoint includes the current attempt, current semantic
      revision, processed revision, plan version, and active, paused, or
      completed planning status.
- [ ] If a delta was delivered but its plan delta was not durably accepted,
      resume redelivers that unacknowledged semantic input.
- [ ] If a plan delta was accepted but its response or next wait was
      interrupted, resume does not duplicate the accepted semantic decisions.
- [ ] Resume reports ready backlog, stale decisions, frozen completion state,
      and one explicit next action.
- [ ] Opening an existing Ikran project exposes enough non-visual MCP state for
      an Agent to discover that incremental planning should be resumed.
- [ ] Active MCP instructions map the simple recovery prompt to the resume
      contract without asking the user for internal identifiers.
- [ ] Runtime restart, Workbench reload, MCP disconnect, tool cancellation, and
      Agent context restart preserve recoverability.
- [ ] If Complete occurred while the Agent was away, resume either processes the
      final backlog and continues plan-backed commit or selects the existing
      honest full-analysis fallback.
- [ ] Stale or abandoned attempts cannot be resumed into the current workflow.
- [ ] Deterministic tests cover interruption before delivery, after delivery,
      after plan persistence, during answer edit, and after Complete.

## Technical Notes

- Advance the processed cursor only in the same durable boundary that accepts
  the corresponding plan delta.
- Recovery status is operational state and must remain outside canonical
  research export.

## Dependencies

Blocked by: 53 — Atomic Finalize-to-Monitor Section Loop.
