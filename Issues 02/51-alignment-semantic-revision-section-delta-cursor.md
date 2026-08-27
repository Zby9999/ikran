# 51 — Alignment Semantic Revision and Section Delta Cursor

Status: ready-for-agent

## User Story

As an Agent monitoring an active Alignment, I want to receive only the semantic
inputs that changed since my last acknowledged cursor so that I can reason while
the designer answers without repeatedly loading the complete Alignment.

## Description

Give each Alignment attempt a monotonic semantic revision and expose a
Runtime-owned delta cursor through MCP. Relevant Question Card answers, Agent
Annotations, and Designer Annotations participate in the revision and final
digest. A section becomes ready for one analysis batch when all of its Question
Cards have final answers at the current revision.

This ticket delivers the persistent fact layer only. Runtime records what
changed and where it came from; it does not decide what the input means for the
Design System.

## Context and constraints

- SQLite revision state is authoritative. In-memory events may accelerate wakeup
  but must not be required for correctness.
- The Workbench remains visually and behaviorally unchanged.
- Revision, digest, cursor, and delta records are operational state, not new
  research facts.
- Existing immutable completed-attempt semantics remain intact.
- Section batching must not lose later edits to an already-ready section.

## Acceptance criteria

- [ ] Each relevant semantic-input mutation atomically advances the current
      attempt's monotonic semantic revision.
- [ ] A cursor read returns the revision range, changed source records, source
      ids, content digests, and owning Alignment sections since the requested
      revision.
- [ ] A normal delta read does not duplicate the complete Alignment snapshot.
- [ ] Multiple submitted answers in one section can be returned as one ready
      section batch after all Question Cards in that section have final answers.
- [ ] Editing an already-submitted answer creates a new revision and makes the
      affected section eligible for a later delta.
- [ ] Agent Annotations and Designer Annotations participate in the final
      semantic revision and digest rather than being silently omitted.
- [ ] Duplicate reads are safe, and a caller advances its processed cursor only
      through an explicit acknowledgement boundary.
- [ ] Runtime restart, missed in-memory notification, and retry cannot lose a
      persisted delta or advance the cursor incorrectly.
- [ ] Complete freezes the final semantic revision and digest in the same
      successful transaction as Alignment completion.
- [ ] Unit and one-process Runtime/MCP tests cover answer creation, answer edit,
      section batching, duplicate read, restart, missed-event recovery, and
      final revision freeze.

## Technical Notes

- Prefer stable source ids plus canonical content digests over timestamps for
  dependency identity.
- After any wake signal, query the persisted revision again. Treat the event bus
  as a hint, not the source of truth.
- The cursor contract should remain useful to a later monitoring loop without
  requiring that loop to retain the original full snapshot in context.

## Dependencies

None.
