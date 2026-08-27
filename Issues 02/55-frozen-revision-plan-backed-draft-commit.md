# 55 — Frozen-Revision Plan-Backed Draft Commit

Status: resolved

## User Story

As a designer who has completed the Alignment, I want the Draft Design System
to reuse the semantic work already performed while I was answering, without
ever committing a plan based on stale answers.

## Description

Connect the Incremental Plan to the existing fast semantic commit boundary.
Complete freezes the final semantic revision and digest. If the plan covers
that frozen revision, the Agent can commit a compact prepared semantic bundle;
if it is behind, the Agent receives only the final delta; if the plan is absent
or unusable, the existing full-analysis fast path remains the honest fallback.

Runtime validates freshness, dependency integrity, coverage, and commit
eligibility. The Agent remains responsible for the semantic decisions being
committed.

## Context and constraints

- Do not weaken existing artifact, lineage, source-consumption, component
  pairing, or completeness gates.
- Do not show an intermediate Draft that is merely a speculative plan.
- Do not ask Runtime to invent missing semantic decisions.
- Alignment completion remains immutable and cannot be rolled back because the
  plan is stale or the Agent is unavailable.
- The current full-analysis path remains available when incremental preparation
  did not run.
- No frontend changes are in scope.

## Acceptance criteria

- [ ] Complete atomically freezes the Alignment semantic revision and digest
      used by Initial Design System preparation.
- [ ] Runtime can determine whether every plan decision required for commit is
      valid against the frozen revision and current source digests.
- [ ] A caught-up plan produces a compact final commit input without returning
      the complete Alignment snapshot for a second semantic analysis.
- [ ] If the plan is behind, the Agent receives only the semantic delta between
      processed revision and frozen revision plus the affected plan decisions.
- [ ] A stale, incomplete, conflicting, or wrong-attempt plan cannot create a
      Draft Design System.
- [ ] Changing an answer after its section was first analyzed prevents the old
      dependent decision from passing the final revision gate.
- [ ] A successful plan-backed commit produces the same required artifacts,
      lineage, coverage, and Draft eligibility as the existing semantic path.
- [ ] If no valid plan exists, the durable preparation command clearly selects
      the existing full-analysis fallback and records the reason.
- [ ] Fallback is never reported as an incremental success and never creates a
      lower-fidelity Draft.
- [ ] Integration tests cover caught-up commit, small final delta, stale plan,
      missing plan, semantic conflict, retry, and fallback.

## Technical Notes

- Treat the plan as precomputed semantic input to the final commit, not as a
  partially visible Design System artifact.
- Keep final commit idempotent against the frozen attempt and plan version.
- This ticket can proceed in parallel with interruption recovery once the plan
  contract exists.

## Comments

- 2026-08-28: Complete freezes revision/digest atomically. The plan-backed
  commit verifies every current section digest, decision dependency, and Draft
  source reference before reusing the existing semantic projection, artifact,
  lineage, audit, and Draft gates. Missing/stale/unbound plans return the named
  full-analysis fallback and cannot advance phase. Section-bound designer
  annotations are immutable after Complete.

## Dependencies

Blocked by: 52 — Attempt-Bound Incremental Initial Design System Plan.
