# 48 — Automatic Verified Candidate orchestration

**What to build:** For a same-run component whose default and states verify and whose Design System semantics did not change, let Runtime finish the mechanical background work and record an internal Verified Candidate without another Agent tool sequence. This includes consistent source/DB metadata, code provenance, live registration, verification binding, digests, events, invalidation, and recovery. It must not automatically promote the component to Formalized.

Blocked by: 46 — Default-first background verification.

Status: resolved

## Acceptance criteria

- [x] A verified same-run component with no semantic delta reaches internal Verified Candidate after its ordinary artifact declaration without further Agent orchestration.
- [x] Runtime deterministically establishes that the existing component spec and reusable rules are unchanged; uncertainty never silently takes the no-delta path.
- [x] Source metadata, DB rows, content digests, verification identity, canonical events, derived projections, and Browser invalidation complete as one recoverable orchestration with typed failure stages.
- [x] Re-running after interruption is idempotent and resumes from durable completed checkpoints rather than duplicating events or rewriting unchanged sources.
- [x] Verified Candidate is internal eligibility only: existing Candidate/Formalized semantics remain authoritative, and designer-approved formalization gates are not bypassed.
- [x] The Active MCP contract stops asking the Agent to perform mechanical backfill, live declaration, verification, and metadata synchronization for this standard no-delta path.

## Real Agent validation

A real Agent implements a component without changing its existing component contract or reusable rules, declares the artifact, and stops. Runtime brings it to Verified Candidate autonomously; event history contains no fabricated designer approval or automatic Formalized promotion.

## Open gaps

- Semantic-delta detection and Agent handling for non-standard cases are intentionally fail-closed until Issue 49.

## Comments

- 2026-08-27: Claimed. A durable per-registration orchestration will start from ordinary artifact declaration, resume through cached verification checkpoints, and emit exactly one internal Verified Candidate event only after deterministic no-semantic-delta and complete verification; Design System status remains untouched.
- 2026-08-27: Implementation complete. Schema v42 adds per-registration durable orchestration checkpoints. Ordinary declarations schedule verification automatically, resume from cached results, and emit exactly one internal `component_preview_verified_candidate` event only after deterministic no-delta + complete verification. Existing Candidate/Formalized state and designer approval events remain untouched. Relevant tests and typecheck pass.
- 2026-08-27: Resolved after adding registration/semantic digest compare-and-set at every claim, failure, and completion transition. Stale verification cannot sign a newer identity; background exceptions persist typed failed/interrupted records instead of remaining `running`.
