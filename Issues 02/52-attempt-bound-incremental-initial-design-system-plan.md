# 52 — Attempt-Bound Incremental Initial Design System Plan

Status: resolved

## User Story

As an Agent, I want to persist Design System planning decisions after each ready
Alignment section so that later answers update only affected decisions and the
final Draft does not require a second full semantic analysis.

## Description

Add a hidden, attempt-bound Incremental Initial Design System Plan. The Agent
authors semantic decisions and their source dependencies; Runtime persists plan
versions, calculates coverage, rejects stale writes, and invalidates decisions
whose supporting source content changed.

A section delta may update multiple output concerns such as global guidance,
tokens, layout, interaction, or components. The plan is preparation state for
the existing Initial Design System contracts, not a replacement for their
artifact, lineage, or completeness gates.

## Context and constraints

- The Agent owns semantic attribution and design decisions. Runtime must not
  infer that an answer belongs to a token, interaction rule, component, or other
  Design System concern.
- Runtime owns versioning, idempotency, dependency tracking, invalidation, and
  coverage calculations.
- The plan is an operational cache. It is not canonical research evidence and
  is not exported as successful research output.
- Recording a plan does not create Draft artifacts or advance the workflow.
- No Workbench UI, progress indicator, toast, or intermediate status is added.

## Acceptance criteria

- [ ] The Agent can record a plan delta for one ready section against an exact
      attempt id and semantic revision.
- [ ] Each semantic decision declares the stable source ids and source digests
      that support it.
- [ ] A section delta may add, replace, or retire decisions across multiple
      Design System output concerns without replacing unrelated plan content.
- [ ] Repeating the same logically identical plan write is idempotent.
- [ ] A stale attempt or a write based on an impossible future revision is
      rejected with a typed, actionable result.
- [ ] Changing one answer invalidates every decision that depends on its former
      digest and preserves decisions with unrelated dependencies.
- [ ] Plan status reports current semantic revision, processed revision, plan
      version, valid coverage, stale decisions, and remaining ready sections.
- [ ] Runtime restart preserves plan content, versions, dependencies,
      invalidation, and progress.
- [ ] Plan state does not appear in canonical research events, successful
      research export, or visible Workbench content.
- [ ] A Runtime/MCP vertical test records two section deltas, edits a source in
      the first section, and proves that only dependent decisions become stale.

## Technical Notes

- Model plan decisions as stable, replaceable units with explicit dependency
  edges instead of one opaque generated document.
- Reuse the vocabulary and output ownership of the progressive Initial Design
  System extraction contract where it improves final handoff, while keeping
  this pre-completion plan distinct from finalized extraction work units.
- The persistence interface should make it possible to combine “record this
  delta” and “wait for the next delta” in a later ticket.

## Dependencies

Blocked by: 51 — Alignment Semantic Revision and Section Delta Cursor.

## Comments

- 2026-08-28: Implemented attempt-bound versioned plans with idempotent writes,
  stable decision-id upsert/retire, durable source/digest dependencies,
  per-section cursors, selective invalidation, and cumulative hidden Draft
  state. Unrelated concurrent answer revisions no longer discard a still-fresh
  section analysis; cross-section decisions can be repaired from the section
  whose edited source invalidated them. Each semantic Draft output path is
  explicitly bound to its authoring decision, preventing an unrelated decision
  that cites the same source from making stale output appear valid. Plan writes
  also compare `basePlanVersion` inside the write transaction, so two analyses
  from one checkpoint cannot silently overwrite cumulative Draft work.
